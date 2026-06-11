// main.js — wires UI, WebSocket, screen, grid, arc, audio, MIDI.

import { Screen } from "./screen.js";
import { GridUI } from "./grid.js";
import { ArcUI } from "./arc.js";
import { AudioHost } from "./audio.js";
import { MidiBridge } from "./midi.js";
import { ParamsPanel } from "./params.js";

// Base path for API and WebSocket — works both locally (/ws) and behind a proxy (/norns/ws).
const BASE_PATH = window.location.pathname.replace(/\/$/, "");

// ── elements ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const consoleEl = $("console");
const connEl    = $("conn");
const nameEl    = $("script-name");

function log(msg, level = "info") {
  const line = document.createElement("div");
  line.className = level;
  line.textContent = msg;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
  while (consoleEl.childNodes.length > 500) consoleEl.removeChild(consoleEl.firstChild);
}

// ── file picker ───────────────────────────────────────────────────────────
const fpOverlay   = $("filepicker-overlay");
const fpList      = $("fp-list");
const fpBreadcrumb = $("fp-breadcrumb");
const fpSelected  = $("fp-selected");
const AUDIO_EXTS_WEB = new Set([".wav", ".aif", ".aiff", ".flac", ".ogg", ".mp3"]);
let   _fpCallback = null;   // (path|null) -> void

let _fpExt = "*";
function openFilePicker(startPath, ext, callback) {
  _fpCallback = callback;
  _fpExt = ext || "*";
  fpSelected.textContent = "";
  fpOverlay.classList.remove("hidden");
  _fpNavigate(startPath || "/audio");
}

function _fpClose(selected) {
  fpOverlay.classList.add("hidden");
  // Return focus to body so keyboard events (norns keys/enc) are not swallowed
  // by a <select> or <input> that Firefox may have moved focus to when the
  // dialog opened or navigated.
  document.activeElement?.blur();
  const cb = _fpCallback;
  _fpCallback = null;
  if (cb) cb(selected || null);
}

async function _fpNavigate(dir) {
  fpBreadcrumb.textContent = dir;
  fpList.innerHTML = '<div class="fp-empty">loading…</div>';
  let data;
  try {
    const r = await fetch(`${BASE_PATH}/api/files?dir=${encodeURIComponent(dir)}&ext=${encodeURIComponent(_fpExt)}`);
    data = await r.json();
  } catch (e) {
    fpList.innerHTML = `<div class="fp-empty">error: ${e.message}</div>`;
    return;
  }
  fpBreadcrumb.textContent = data.dir || dir;
  fpList.innerHTML = "";

  // "up" entry (unless already at /audio root)
  if (data.parent && data.parent !== data.dir) {
    const up = _fpItem("⬆", ".. (up)", "up");
    up.addEventListener("click", () => _fpNavigate(data.parent));
    fpList.appendChild(up);
  }

  // subdirs
  for (const d of (data.dirs || [])) {
    const el = _fpItem("▶", d.name, "dir");
    el.addEventListener("click", () => _fpNavigate(d.path));
    fpList.appendChild(el);
  }

  // files (audio samples, collection .cc2 names, etc.)
  for (const f of (data.files || [])) {
    const icon = AUDIO_EXTS_WEB.has(f.ext) ? "♪" : "·";
    const el = _fpItem(icon, f.name, "file");
    el.addEventListener("click", () => {
      // highlight
      fpList.querySelectorAll(".fp-item.file").forEach(i => i.classList.remove("selected"));
      el.classList.add("selected");
      fpSelected.textContent = f.name;
      _fpClose(f.path);
    });
    fpList.appendChild(el);
  }

  if (!data.dirs?.length && !data.files?.length) {
    fpList.innerHTML = '<div class="fp-empty">no files here</div>';
  }
}

function _fpItem(icon, name, cls) {
  const el = document.createElement("div");
  el.className = `fp-item ${cls}`;
  el.innerHTML = `<span class="fp-item-icon">${icon}</span><span class="fp-item-name">${name}</span>`;
  return el;
}

$("fp-close").addEventListener("click",  () => _fpClose(null));
$("fp-cancel").addEventListener("click", () => _fpClose(null));
fpOverlay.addEventListener("click", (e) => { if (e.target === fpOverlay) _fpClose(null); });

// ── help / README modal ───────────────────────────────────────────────────
const helpOverlay = $("help-overlay");

function markdownToHtml(md) {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm,  "<h2>$1</h2>")
    .replace(/^# (.+)$/gm,   "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g,    "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^---+$/gm, "<hr>")
    .replace(/^\* (.+)$/gm,  "<li>$1</li>")
    .replace(/^- (.+)$/gm,   "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n+/g, "</p><p>")
    .replace(/^(?!<[hup]|<li|<hr)(.+)$/gm, (m) => m.trim() ? m : "")
    .replace(/^<\/p><p>(<h[123])/gm, "$1")
    .replace(/(<h[123][^>]*>.*<\/h[123]>)<\/p>/g, "$1");
}

async function openHelp() {
  const res = await fetch(`${BASE_PATH}/api/readme`);
  if (!res.ok) {
    $("help-body").innerHTML = "<p>Kein README für dieses Script gefunden.</p>";
    $("help-title").textContent = "README";
  } else {
    const md = await res.text();
    const firstLine = md.split("\n").find(l => l.startsWith("# "));
    $("help-title").textContent = firstLine ? firstLine.replace(/^# /, "") : "README";
    $("help-body").innerHTML = "<p>" + markdownToHtml(md) + "</p>";
  }
  helpOverlay.classList.remove("hidden");
}

$("help-btn").addEventListener("click", openHelp);
$("help-close").addEventListener("click", () => helpOverlay.classList.add("hidden"));
helpOverlay.addEventListener("click", (e) => { if (e.target === helpOverlay) helpOverlay.classList.add("hidden"); });

// ── settings modal ─────────────────────────────────────────────────────────
const settingsOverlay = $("settings-overlay");
$("settings-btn").addEventListener("click", () => settingsOverlay.classList.remove("hidden"));
$("settings-close").addEventListener("click", () => settingsOverlay.classList.add("hidden"));
settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) settingsOverlay.classList.add("hidden"); });

// ── theme (background / box grey levels + accent colour) ────────────────────
// Sliders map to a grey value; panels derive lighter/darker shades from it so
// surfaces, raised boxes and borders stay consistent. Applied to CSS variables
// live and saved to localStorage.
const DEFAULT_THEME = { bg: 26, box: 36, accent: "#f0a040" };
const _grey = (v) => `rgb(${v}, ${v}, ${Math.min(255, v + 4)})`;
function _shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * f)}, ${Math.round(((n >> 8) & 255) * f)}, ${Math.round((n & 255) * f)})`;
}
function applyTheme(t) {
  const s = document.documentElement.style;
  s.setProperty("--bg", _grey(t.bg));
  s.setProperty("--surface", _grey(t.box));
  s.setProperty("--raised", _grey(t.box + 10));
  s.setProperty("--border", _grey(t.box + 22));
  s.setProperty("--border-lo", _grey(t.box + 6));
  s.setProperty("--amber", t.accent);
  s.setProperty("--amber-lo", _shade(t.accent, 0.5));
}
const THEME_VARS = ["--bg", "--surface", "--raised", "--border", "--border-lo", "--amber", "--amber-lo"];
// Remove all theme overrides so the original :root palette (style.css) applies
// exactly — the derived shades can't be reproduced byte-for-byte, so "default"
// means *no override*, not approximated values.
function clearTheme() { for (const v of THEME_VARS) document.documentElement.style.removeProperty(v); }
const _hasSavedTheme = localStorage.getItem("uiTheme") != null;
let _theme = { ...DEFAULT_THEME };
try { Object.assign(_theme, JSON.parse(localStorage.getItem("uiTheme") || "{}")); } catch {}
function _syncThemeControls() {
  $("set-bg").value = _theme.bg;
  $("set-box").value = _theme.box;
  $("set-accent").value = _theme.accent;
}
function _saveTheme() { localStorage.setItem("uiTheme", JSON.stringify(_theme)); }
_syncThemeControls();
if (_hasSavedTheme) applyTheme(_theme);  // pristine :root colours when nothing is saved
$("set-bg").addEventListener("input", (e) => { _theme.bg = +e.target.value; applyTheme(_theme); _saveTheme(); });
$("set-box").addEventListener("input", (e) => { _theme.box = +e.target.value; applyTheme(_theme); _saveTheme(); });
$("set-accent").addEventListener("input", (e) => { _theme.accent = e.target.value; applyTheme(_theme); _saveTheme(); });
$("set-reset").addEventListener("click", () => {
  _theme = { ...DEFAULT_THEME };
  _syncThemeControls();
  clearTheme();                       // restore the exact original colours
  localStorage.removeItem("uiTheme");
  _arcSens = ARC_SENS_DEFAULT; _applyArcSens(_arcSens); localStorage.removeItem("arcSens");
  _arcLen   = ARC_LEN_DEFAULT;   _applyArcLen(_arcLen);   localStorage.removeItem("arcLen");
  _arcWidth = ARC_WIDTH_DEFAULT; _applyArcWidth(_arcWidth); localStorage.removeItem("arcWidth");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { helpOverlay.classList.add("hidden"); return; }
  if (e.key === "h" && !inField(e)) {
    if (helpOverlay.classList.contains("hidden")) openHelp(); else helpOverlay.classList.add("hidden");
  }
});

// ── subsystems ────────────────────────────────────────────────────────────
const screen = new Screen($("screen"));
const audio  = new AudioHost((m) => log(m, "info"), BASE_PATH);
const grid   = new GridUI($("grid"), (x, y, z) => send({ t: "gridkey", dev: 1, x, y, z }));
const arc    = new ArcUI($("arc"),   (ring, d) => send({ t: "arcdelta", dev: 1, n: ring, d }));

// ── ARC appearance & sensitivity ─────────────────────────────────────────
const ARC_SENS_DEFAULT  = 5;
const ARC_LEN_DEFAULT   = 8;
const ARC_WIDTH_DEFAULT = 3;
let _arcSens  = parseInt(localStorage.getItem("arcSens")  || ARC_SENS_DEFAULT,  10);
let _arcLen   = parseInt(localStorage.getItem("arcLen")   || ARC_LEN_DEFAULT,   10);
let _arcWidth = parseInt(localStorage.getItem("arcWidth") || ARC_WIDTH_DEFAULT, 10);

function _applyArcSens(v)  { arc.setSensitivity(v); $("set-arc-sens").value  = v; $("set-arc-sens-val").textContent  = v; }
function _applyArcLen(v)   { arc.setLedLength(v);   $("set-arc-len").value   = v; $("set-arc-len-val").textContent   = v; }
function _applyArcWidth(v) { arc.setLedWidth(v);    $("set-arc-width").value = v; $("set-arc-width-val").textContent = v; }

$("set-arc-sens").addEventListener("input",  (e) => { _arcSens  = +e.target.value; _applyArcSens(_arcSens);   localStorage.setItem("arcSens",  _arcSens); });
$("set-arc-len").addEventListener("input",   (e) => { _arcLen   = +e.target.value; _applyArcLen(_arcLen);     localStorage.setItem("arcLen",   _arcLen); });
$("set-arc-width").addEventListener("input", (e) => { _arcWidth = +e.target.value; _applyArcWidth(_arcWidth); localStorage.setItem("arcWidth", _arcWidth); });

_applyArcSens(_arcSens);
_applyArcLen(_arcLen);
_applyArcWidth(_arcWidth);

// MIDI: route CC to params panel first; unhandled data forwarded to Lua.
const midi = new MidiBridge((data) => {
  if (!params.handleMidi(data)) send({ t: "midi", dev: 1, data });
}, (m) => log(m, "info"));

// Firefox needs a user gesture to show the MIDI permission dialog.
midi.onNeedPermission = () => {
  $("midi-connect").classList.remove("hidden");
  log("MIDI: click 'connect' to grant permission", "info");
};
midi.onConnected = () => $("midi-connect").classList.add("hidden");

const params = new ParamsPanel($("params-panel"), $("params-count"), send, log, openFilePicker);

// ── WebSocket ─────────────────────────────────────────────────────────────
let ws = null;
let lastScriptPath = null;

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${BASE_PATH}/ws`);
  ws.onopen  = () => { connEl.textContent = "connected"; connEl.className = "badge on"; };
  ws.onclose = () => {
    connEl.textContent = "disconnected"; connEl.className = "badge off";
    // Hide file picker without sending fileselect_result — WS is already closed
    // and the Lua callback will be stale after reconnect anyway.
    if (_fpCallback) {
      fpOverlay.classList.add("hidden");
      document.activeElement?.blur();
      _fpCallback = null;
    }
    setTimeout(connect, 1000);
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function handle(msg) {
  switch (msg.t) {
    case "frame":   screen.render(msg.ops); break;
    case "grid":    grid.render(msg.cols, msg.rows, msg.data); break;
    case "grid_meta": grid.resize(msg.cols, msg.rows); break;
    case "arc":     arc.render(msg.rings, msg.leds, msg.data); break;
    case "engine":        audio.handle(msg); break;
    case "softcut":       audio.handleSoftcut(msg); break;
    case "audio_adc_cut": audio.setAdcCutLevel(msg.level ?? 0); break;
    case "audio_eng_cut": audio.setEngCutLevel(msg.level ?? 0); break;
    case "audio_rev_on":       audio.setRevOn(true);             _syncRevUI(); break;
    case "audio_rev_off":      audio.setRevOn(false);            _syncRevUI(); break;
    case "audio_rev_time":     audio.setRevTime(msg.v ?? 3.0);   break;
    case "audio_rev_send":     audio.setRevSend(msg.v ?? 0);     break;
    case "audio_rev_return":   audio.setRevReturn(msg.v ?? 0.8); break;
    case "audio_comp_on":      audio.setCompOn(true);            _syncCompUI(); break;
    case "audio_comp_off":     audio.setCompOn(false);           _syncCompUI(); break;
    case "audio_comp_threshold": audio.setCompThreshold(msg.v ?? -12); break;
    case "audio_comp_ratio":     audio.setCompRatio(msg.v ?? 4);       break;
    case "audio_comp_attack":    audio.setCompAttack(msg.v ?? 0.005);  break;
    case "audio_comp_release":   audio.setCompRelease(msg.v ?? 0.1);   break;
    case "fileselect_open":
      openFilePicker(msg.path || "/audio", msg.ext || "*", (selected) => {
        send({ t: "fileselect_result", cb_id: msg.cb_id, path: selected || "cancel" });
      });
      break;
    case "textentry_open": {
      // Native prompt: returns the typed string, or null on cancel. null → nil
      // in Lua, which scripts (e.g. Cheat Codes 2 save) treat as "canceled".
      const heading = msg.heading && msg.heading.length ? msg.heading : "enter name:";
      const text = window.prompt(heading, msg.default || "");
      send({ t: "textentry_result", cb_id: msg.cb_id, text: text });
      break;
    }
    case "lua_restart":
      if (_fpCallback) {
        fpOverlay.classList.add("hidden");
        document.activeElement?.blur();
        _fpCallback = null;
        log("Lua restarted — file picker closed, please reopen", "info");
      }
      break;
    case "midi_out": midi.send(msg.data); break;
    case "loading":
      nameEl.textContent = msg.name + "…";
      break;
    case "meta":
      nameEl.textContent = msg.name;
      params.load(msg.params || [], msg.name);
      break;
    case "param_update":
      params.update(msg.id, msg.value, msg.str);
      break;
    case "params_refresh":
      params.refresh(msg.data || []);
      break;
    case "pset_list":
      params.renderPsetList(msg.items || [], msg.default ?? null);
      break;
    case "log":
      log(msg.msg, msg.level === "error" ? "err" : msg.level === "print" ? "print" : "info");
      break;
    default: break;
  }
}

// ── encoder knob rotation ─────────────────────────────────────────────────
// Each encoder accumulates angle (degrees). One encoder step = 15°.
const DEG_PER_STEP = 15;
const encState = { 1: { angle: 0 }, 2: { angle: 0 }, 3: { angle: 0 } };

function rotateKnob(n, delta) {
  encState[n].angle += delta * DEG_PER_STEP;
  const dial = $(`enc${n}`);
  dial.style.transform = `rotate(${encState[n].angle}deg)`;
}

function enc(n, d) {
  rotateKnob(n, d);
  send({ t: "enc", n, d });
}

function key(n, z) {
  send({ t: "key", n, z });
  $(`key${n}`).classList.toggle("active", z === 1);
}

// ── on-screen dials: mouse wheel + vertical drag ──────────────────────────
[1, 2, 3].forEach((n) => {
  const dial = $(`enc${n}`);

  // Scroll wheel
  dial.parentElement.addEventListener("wheel", (e) => {
    e.preventDefault();
    enc(n, e.deltaY > 0 ? -1 : 1);
  }, { passive: false });

  // Pointer drag (vertical) — works for mouse, touch and pen
  let dragging = false, lastY = 0, accum = 0;
  dial.addEventListener("pointerdown", (e) => {
    dragging = true; lastY = e.clientY; accum = 0;
    dial.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  dial.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    accum += lastY - e.clientY;
    lastY = e.clientY;
    const steps = Math.trunc(accum / 4);
    if (steps !== 0) {
      enc(n, steps);
      accum -= steps * 4;
    }
  });
  const endDrag = () => { dragging = false; };
  dial.addEventListener("pointerup", endDrag);
  dial.addEventListener("pointercancel", endDrag);
});

// ── on-screen keys ────────────────────────────────────────────────────────
[1, 2, 3].forEach((n) => {
  const btn = $(`key${n}`);
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); key(n, 1); });
  btn.addEventListener("pointerup",   () => key(n, 0));
  btn.addEventListener("pointercancel", () => { if (btn.classList.contains("active")) key(n, 0); });
});

// ── keyboard ──────────────────────────────────────────────────────────────
const ENC_KEYS = { q: [1,-1], w: [1,1], e: [2,-1], r: [2,1], u: [3,-1], i: [3,1] };
const KEY_KEYS  = { a: 1, s: 2, d: 3 };
const heldKeys  = new Set();

// Only block norns keys when the user is actually typing in a text field.
// SELECT and checkbox focus must not block enc/key events.
function inField(e) {
  const t = e.target;
  if (t.tagName === "TEXTAREA") return true;
  if (t.tagName === "INPUT" && t.type !== "checkbox" && t.type !== "range") return true;
  return false;
}

window.addEventListener("keydown", (e) => {
  if (inField(e)) return;
  const ec = ENC_KEYS[e.key];
  if (ec) { enc(ec[0], ec[1]); e.preventDefault(); return; }
  const kn = KEY_KEYS[e.key];
  if (kn && !heldKeys.has(e.key)) { heldKeys.add(e.key); key(kn, 1); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => {
  const kn = KEY_KEYS[e.key];
  if (kn) { heldKeys.delete(e.key); key(kn, 0); }
});

// ── panel controls ────────────────────────────────────────────────────────
let _allScripts = [];

function _topFolder(rel) {
  const i = rel.indexOf("/");
  return i === -1 ? "" : rel.slice(0, i);
}

function _populateScriptSelect(folder) {
  const sel = $("script-select");
  sel.innerHTML = "";
  const filtered = folder ? _allScripts.filter(s => _topFolder(s.rel) === folder) : _allScripts;
  for (const s of filtered) {
    const o = document.createElement("option");
    o.value = s.path;
    o.textContent = s.name;
    sel.appendChild(o);
  }
}

async function loadScriptList() {
  try {
    _allScripts = await (await fetch(`${BASE_PATH}/api/scripts`)).json();
    const folders = [...new Set(_allScripts.map(s => _topFolder(s.rel)).filter(Boolean))];
    const folderSel = $("script-folder");
    folderSel.innerHTML = "";
    for (const f of folders) {
      const o = document.createElement("option");
      o.value = f; o.textContent = f;
      folderSel.appendChild(o);
    }
    _populateScriptSelect(folderSel.value);
    log(`${_allScripts.length} scripts available`, "info");
  } catch (e) {
    log("could not list scripts: " + e, "err");
  }
}

$("script-folder").addEventListener("change", (e) => {
  _populateScriptSelect(e.target.value);
});

$("load-btn").addEventListener("click", (e) => {
  const path = $("script-select").value;
  if (path) { lastScriptPath = path; send({ t: "load", path }); }
  e.target.blur();
});
$("reload-btn").addEventListener("click", (e) => {
  if (lastScriptPath) send({ t: "load", path: lastScriptPath });
  e.target.blur();
});

// ── maiden script editor ───────────────────────────────────────────────────
let _maidenEditor   = null;
let _maidenPath     = null;   // currently open file in editor
let _maidenRoot     = "";     // SCRIPTS_DIR root (computed on first open)
let _maidenSelected = null;   // selected item path in tree
const _maidenOpen   = new Set(); // expanded folder paths

const NEW_SCRIPT_TEMPLATE = (name) =>
`-- ${name}
-- description
--
-- E2/E3 : edit
-- K2/K3 : action

engine.name = "PolyPerc"

function init()
end

function enc(n, d)
end

function key(n, z)
end

function redraw()
  screen.clear()
  screen.move(64, 32)
  screen.text_center("${name}")
  screen.update()
end
`;

function _maidenStatus(msg, kind = "") {
  const el = $("maiden-status");
  el.textContent = msg;
  el.className = "maiden-status" + (kind ? " " + kind : "");
}

// ── tree ──────────────────────────────────────────────────────────────────

function _mtSelect(el, path) {
  $("maiden-tree-list").querySelectorAll(".mt-item.selected")
    .forEach(x => x.classList.remove("selected"));
  el.classList.add("selected");
  _maidenSelected = path;
}

async function _mtRenderDir(parentEl, dir, depth = 0) {
  let data;
  try {
    data = await (await fetch(`${BASE_PATH}/api/files?dir=${encodeURIComponent(dir)}`)).json();
  } catch { return; }

  for (const d of (data.dirs || [])) {
    const wrap = document.createElement("div");
    const row  = document.createElement("div");
    row.className = "mt-item dir";
    row.style.paddingLeft = (8 + depth * 14) + "px";
    const arrow = document.createElement("span");
    arrow.className = "mt-arrow" + (_maidenOpen.has(d.path) ? " open" : "");
    arrow.textContent = "▶";
    const label = document.createElement("span");
    label.className = "mt-name";
    label.textContent = d.name;
    row.append(arrow, label);
    wrap.appendChild(row);
    parentEl.appendChild(wrap);

    const children = document.createElement("div");
    children.className = "mt-children";
    wrap.appendChild(children);

    if (_maidenOpen.has(d.path)) await _mtRenderDir(children, d.path, depth + 1);

    row.addEventListener("click", async (e) => {
      e.stopPropagation();
      _mtSelect(row, d.path);
      if (_maidenOpen.has(d.path)) {
        _maidenOpen.delete(d.path);
        arrow.classList.remove("open");
        children.innerHTML = "";
      } else {
        _maidenOpen.add(d.path);
        arrow.classList.add("open");
        await _mtRenderDir(children, d.path, depth + 1);
      }
    });
  }

  for (const f of (data.files || [])) {
    if (!f.name.endsWith(".lua")) continue;
    const row = document.createElement("div");
    row.className = "mt-item" + (_maidenSelected === f.path ? " selected" : "");
    row.style.paddingLeft = (20 + depth * 14) + "px";
    const label = document.createElement("span");
    label.className = "mt-name";
    label.textContent = f.name;
    row.appendChild(label);
    parentEl.appendChild(row);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      _mtSelect(row, f.path);
      _maidenOpenFile(f.path);
    });
  }
}

async function _maidenRefreshTree() {
  if (!_maidenRoot) return;
  const list = $("maiden-tree-list");
  list.innerHTML = "";
  await _mtRenderDir(list, _maidenRoot, 0);
}

// ── open file in editor ────────────────────────────────────────────────────

async function _maidenOpenFile(filePath) {
  if (typeof ace === "undefined") return;
  _maidenPath = filePath;
  $("maiden-name").textContent = filePath.split("/").pop();
  if (!_maidenEditor) {
    ace.config.set("basePath", BASE_PATH + "js/ace/");
    _maidenEditor = ace.edit("maiden-editor");
    _maidenEditor.setTheme("ace/theme/monokai");
    _maidenEditor.session.setMode("ace/mode/lua");
    _maidenEditor.setOptions({ fontSize: "13px", useSoftTabs: true, tabSize: 2 });
  }
  _maidenStatus("loading…");
  try {
    const r = await fetch(`${BASE_PATH}/api/script?path=${encodeURIComponent(filePath)}`);
    if (!r.ok) throw new Error((await r.json()).error || r.status);
    const { text } = await r.json();
    _maidenEditor.setValue(text, -1);
    _maidenStatus(filePath.replace(_maidenRoot + "/", ""));
    _maidenEditor.focus();
  } catch (e) {
    _maidenStatus("could not load: " + e.message, "err");
  }
}

// ── open modal ────────────────────────────────────────────────────────────

async function openMaiden() {
  if (typeof ace === "undefined") { log("maiden: editor failed to load", "err"); return; }
  $("maiden-overlay").classList.remove("hidden");

  // Compute SCRIPTS_ROOT from script list if not yet known
  if (!_maidenRoot && _allScripts.length) {
    const s0 = _allScripts[0];
    _maidenRoot = s0.path.slice(0, s0.path.length - s0.rel.length - 1);
  }

  await _maidenRefreshTree();

  // Open the currently selected script automatically
  const selectedPath = $("script-select").value || lastScriptPath;
  if (selectedPath && selectedPath !== _maidenPath) {
    // Expand the parent folder in tree
    const parentDir = selectedPath.slice(0, selectedPath.lastIndexOf("/"));
    if (parentDir !== _maidenRoot) _maidenOpen.add(parentDir);
    await _maidenRefreshTree();
    _maidenSelected = selectedPath;
    await _maidenOpenFile(selectedPath);
  } else if (_maidenPath) {
    _maidenStatus(_maidenPath.replace(_maidenRoot + "/", ""));
  }
}

function closeMaiden() {
  $("maiden-overlay").classList.add("hidden");
}

// ── save ──────────────────────────────────────────────────────────────────

async function saveMaiden() {
  if (!_maidenPath || !_maidenEditor) return false;
  _maidenStatus("saving…");
  try {
    const r = await fetch(`${BASE_PATH}/api/script`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: _maidenPath, text: _maidenEditor.getValue() }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.status);
    _maidenStatus("saved ✓", "ok");
    log("maiden: saved " + _maidenPath.split("/").pop(), "info");
    return true;
  } catch (e) {
    _maidenStatus("save failed: " + e.message, "err");
    return false;
  }
}

// ── file-tree operations ─────────────────────────────────────────────────

function _maidenContextDir() {
  // Returns the directory to use for new-file / new-folder actions.
  if (!_maidenSelected) return _maidenRoot;
  // If selected is a .lua file, use its parent
  if (_maidenSelected.endsWith(".lua")) {
    return _maidenSelected.slice(0, _maidenSelected.lastIndexOf("/"));
  }
  return _maidenSelected; // it's a folder
}

$("maiden-new-file").addEventListener("click", async () => {
  const name = prompt("New file name (.lua):");
  if (!name) return;
  const fname = name.endsWith(".lua") ? name : name + ".lua";
  const dir   = _maidenContextDir();
  const fpath = dir + "/" + fname;
  const scriptName = fname.replace(/\.lua$/, "");
  try {
    const r = await fetch(`${BASE_PATH}/api/script`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: fpath, text: NEW_SCRIPT_TEMPLATE(scriptName) }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.status);
    _maidenOpen.add(dir);
    await _maidenRefreshTree();
    await loadScriptList();
    _maidenSelected = fpath;
    await _maidenOpenFile(fpath);
    _maidenStatus("created " + fname, "ok");
  } catch (e) { _maidenStatus("create failed: " + e.message, "err"); }
});

$("maiden-new-folder").addEventListener("click", async () => {
  const name = prompt("New folder name:");
  if (!name) return;
  const dir = _maidenContextDir();
  const fpath = dir + "/" + name;
  try {
    const r = await fetch(`${BASE_PATH}/api/scriptdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: fpath }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.status);
    await _maidenRefreshTree();
    _maidenStatus("folder created", "ok");
  } catch (e) { _maidenStatus("mkdir failed: " + e.message, "err"); }
});

$("maiden-rename-entry").addEventListener("click", async () => {
  if (!_maidenSelected) return;
  const oldName = _maidenSelected.split("/").pop();
  const newName = prompt("Rename to:", oldName);
  if (!newName || newName === oldName) return;
  const to = _maidenSelected.slice(0, _maidenSelected.lastIndexOf("/")) + "/" + newName;
  try {
    const r = await fetch(`${BASE_PATH}/api/scriptentry`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: _maidenSelected, to }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.status);
    if (_maidenPath === _maidenSelected) _maidenPath = to;
    _maidenSelected = to;
    await _maidenRefreshTree();
    await loadScriptList();
    _maidenStatus("renamed to " + newName, "ok");
  } catch (e) { _maidenStatus("rename failed: " + e.message, "err"); }
});

$("maiden-delete-entry").addEventListener("click", async () => {
  if (!_maidenSelected) return;
  const name = _maidenSelected.split("/").pop();
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    const r = await fetch(`${BASE_PATH}/api/scriptentry?path=${encodeURIComponent(_maidenSelected)}`,
      { method: "DELETE" });
    if (!r.ok) throw new Error((await r.json()).error || r.status);
    if (_maidenPath === _maidenSelected) { _maidenPath = null; $("maiden-name").textContent = "—"; if (_maidenEditor) _maidenEditor.setValue(""); }
    _maidenSelected = null;
    await _maidenRefreshTree();
    await loadScriptList();
    _maidenStatus("deleted " + name, "ok");
  } catch (e) { _maidenStatus("delete failed: " + e.message, "err"); }
});

// ── button wiring ─────────────────────────────────────────────────────────

$("maiden-btn").addEventListener("click", (e) => { openMaiden(); e.target.blur(); });
$("maiden-close").addEventListener("click", closeMaiden);
$("maiden-save").addEventListener("click", () => saveMaiden());
$("maiden-save-run").addEventListener("click", async () => {
  if (await saveMaiden()) {
    lastScriptPath = _maidenPath;
    send({ t: "load", path: _maidenPath });
    closeMaiden();
  }
});
$("maiden-overlay").addEventListener("click", (e) => {
  if (e.target.id === "maiden-overlay") closeMaiden();
});

// ── catalog / package manager ─────────────────────────────────────────────
let _catalogEntries = [];
let _catalogInstalled = new Set();

function _catalogSetStatus(msg) { $("catalog-status").textContent = msg; }

function _catalogRender(filter = "") {
  const list = $("catalog-list");
  list.innerHTML = "";
  const q = filter.toLowerCase().trim();
  const filtered = q
    ? _catalogEntries.filter(e =>
        e.project_name?.toLowerCase().includes(q) ||
        e.author?.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q) ||
        (e.tags || []).some(t => t.toLowerCase().includes(q)))
    : _catalogEntries;

  _catalogSetStatus(`${filtered.length} of ${_catalogEntries.length} scripts`);

  for (const entry of filtered) {
    const name   = entry.project_name || "";
    const author = entry.author || "";
    const desc   = entry.description || "";
    const tags   = entry.tags || [];
    const url    = entry.project_url || "";
    const installed = _catalogInstalled.has(name);

    const item = document.createElement("div");
    item.className = "catalog-item";

    const info = document.createElement("div");
    info.className = "catalog-info";
    info.innerHTML = `
      <div><span class="catalog-name">${name}</span><span class="catalog-author">${author}</span></div>
      <div class="catalog-desc" title="${desc.replace(/"/g,"&quot;")}">${desc}</div>
      ${tags.length ? `<div class="catalog-tags">${tags.map(t => `<span class="catalog-tag">${t}</span>`).join("")}</div>` : ""}
    `;

    const action = document.createElement("div");
    action.className = "catalog-action";

    if (installed) {
      const badge = document.createElement("span");
      badge.className = "catalog-installed";
      badge.textContent = "✓ installed";
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "remove";
      removeBtn.style.marginTop = "4px";
      removeBtn.style.display = "block";
      removeBtn.addEventListener("click", async () => {
        if (!confirm(`Remove "${name}"?`)) return;
        removeBtn.disabled = true;
        removeBtn.textContent = "…";
        try {
          const communityPath = _maidenRoot + "/community/" + name;
          const r = await fetch(`${BASE_PATH}/api/scriptentry?path=${encodeURIComponent(communityPath)}`, { method: "DELETE" });
          if (!r.ok) throw new Error((await r.json()).error);
          _catalogInstalled.delete(name);
          await loadScriptList();
          _catalogRender($("catalog-search").value);
        } catch (e) { alert("Remove failed: " + e.message); removeBtn.disabled = false; removeBtn.textContent = "remove"; }
      });
      action.append(badge, removeBtn);
    } else {
      const btn = document.createElement("button");
      btn.textContent = "install";
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "cloning…";
        _catalogSetStatus(`Installing ${name}…`);
        try {
          const r = await fetch(`${BASE_PATH}/api/catalog/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_url: url, project_name: name }),
          });
          if (!r.ok) throw new Error((await r.json()).error);
          _catalogInstalled.add(name);
          await loadScriptList();
          _catalogRender($("catalog-search").value);
          _catalogSetStatus(`Installed ${name} ✓`);
        } catch (e) {
          _catalogSetStatus("Install failed: " + e.message);
          btn.disabled = false; btn.textContent = "install";
        }
      });
      action.appendChild(btn);
    }

    item.append(info, action);
    list.appendChild(item);
  }
}

async function openCatalog() {
  $("catalog-overlay").classList.remove("hidden");
  if (_catalogEntries.length) { _catalogRender($("catalog-search").value); return; }

  _catalogSetStatus("Loading catalog…");
  $("catalog-list").innerHTML = "";
  try {
    // Load catalog + installed list in parallel
    const [catData, installed] = await Promise.all([
      fetch(`${BASE_PATH}/api/catalog`).then(r => r.json()),
      fetch(`${BASE_PATH}/api/catalog/installed`).then(r => r.json()),
    ]);
    _catalogEntries = catData.entries || [];
    _catalogInstalled = new Set(installed);
    _catalogRender();
  } catch (e) {
    _catalogSetStatus("Could not load catalog: " + e.message);
  }
}

function closeCatalog() { $("catalog-overlay").classList.add("hidden"); }

$("catalog-btn").addEventListener("click",   (e) => { openCatalog(); e.target.blur(); });
$("catalog-close").addEventListener("click", closeCatalog);
$("catalog-overlay").addEventListener("click", (e) => { if (e.target.id === "catalog-overlay") closeCatalog(); });
$("catalog-search").addEventListener("input", (e) => _catalogRender(e.target.value));

$("tempo").addEventListener("change", (e) => {
  send({ t: "tempo", bpm: parseFloat(e.target.value) });
});

$("audio-enable").addEventListener("change", (e) => {
  if (e.target.checked) audio.enable(); else audio.disable();
});

$("mic-gain").addEventListener("input", (e) => {
  const v = parseFloat(e.target.value);
  $("mic-gain-label").textContent = `×${v}`;
  if (audio._micGain) audio._micGain.gain.value = v;
});

$("mic-enable").addEventListener("change", async (e) => {
  if (e.target.checked) {
    const ok = await audio.enableMicInput();
    if (!ok) e.target.checked = false;
  } else {
    audio.disableMicInput();
  }
});

$("repl-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const code = e.target.value.trim();
    if (code) { log("› " + code, "info"); send({ t: "eval", code }); e.target.value = ""; }
  }
});

$("grid-toggle").addEventListener("click", () => {
  const g = $("grid");
  g.classList.toggle("hidden");
  $("grid-toggle").textContent = g.classList.contains("hidden") ? "show" : "hide";
});

// Screen base font selector — lets you compare the real norns pixel font with
// VeraMono/Roboto live. Persisted so the choice survives reloads.
const _screenFontSel = $("screen-font");
if (_screenFontSel) {
  const saved = localStorage.getItem("screenFont");
  if (saved) { _screenFontSel.value = saved; screen.setDefaultFont(saved); }
  _screenFontSel.addEventListener("change", (e) => {
    const f = e.target.value;
    localStorage.setItem("screenFont", f);
    screen.setDefaultFont(f);
  });
}
$("arc-toggle").addEventListener("click", () => {
  const a = $("arc");
  a.classList.toggle("hidden");
  $("arc-toggle").textContent = a.classList.contains("hidden") ? "show" : "hide";
});
$("params-toggle").addEventListener("click", () => {
  const p = $("params-panel");
  p.classList.toggle("collapsed");
  $("params-toggle").textContent = p.classList.contains("collapsed") ? "▶ params" : "▼ params";
});

// Route softcut phase events from the AudioWorklet back to Lua via WebSocket.
audio.onSoftcutPhase  = (e) => send(e);
audio.onSoftcutRender = (e) => send(e);
audio.onEval          = (code) => send({ t: 'eval', code });
audio.onPoll          = (name, value) => send({ t: 'engine_poll', name, value });

// ── mixer + tape ────────────────────────────────────────────────────────────
// Vertical faders drive audio bus gains; values persist across reloads.
const _mixSaved = (() => { try { return JSON.parse(localStorage.getItem("mixLevels") || "{}"); } catch { return {}; } })();
const _mixInputs = {};
function _applyMix(name, input) {
  audio.enable();                // ensure the graph exists before setting levels
  audio.setMixLevel(name, +input.value / 100);
  _mixSaved[name] = +input.value;
  localStorage.setItem("mixLevels", JSON.stringify(_mixSaved));
}
document.querySelectorAll(".mix-strip[data-mix]").forEach((strip) => {
  const name = strip.dataset.mix;
  const input = strip.querySelector("input");
  if (!input) return;
  _mixInputs[name] = input;
  if (_mixSaved[name] != null) input.value = _mixSaved[name];
  input.addEventListener("input", () => _applyMix(name, input));
  // custom pointer dragging — the vertical range input needs touch-action:none
  // (so the page doesn't scroll), which disables its own touch handling, so we
  // drive the value from the pointer Y position ourselves.
  let active = false;
  const setFromY = (clientY) => {
    const r = input.getBoundingClientRect();
    const frac = 1 - (clientY - r.top) / r.height;   // top = max, bottom = min
    const v = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    if (v !== +input.value) { input.value = v; _applyMix(name, input); }
  };
  input.addEventListener("pointerdown", (e) => { active = true; input.setPointerCapture?.(e.pointerId); setFromY(e.clientY); e.preventDefault(); });
  input.addEventListener("pointermove", (e) => { if (active) setFromY(e.clientY); });
  const end = () => { active = false; };
  input.addEventListener("pointerup", end);
  input.addEventListener("pointercancel", end);
});
// Apply saved levels to the audio graph once it exists (after first gesture).
let _mixApplied = false;
function _applyMixIfReady() {
  if (_mixApplied || !audio.ctx) return;
  _mixApplied = true;
  for (const [name, input] of Object.entries(_mixInputs)) audio.setMixLevel(name, +input.value / 100);
}

const MIX_DEFAULTS = { out: 60, in: 50, mon: 0, eng: 100, cut: 100, tp: 100 };
$("mixer-reset").addEventListener("click", () => {
  for (const [name, input] of Object.entries(_mixInputs)) {
    const def = MIX_DEFAULTS[name] ?? 100;
    input.value = def;
    audio.setMixLevel(name, def / 100);
    _mixSaved[name] = def;
  }
  localStorage.setItem("mixLevels", JSON.stringify(_mixSaved));
});

$("mixer-toggle").addEventListener("click", (e) => {
  const body = $("mixer-body");
  body.classList.toggle("hidden");
  e.target.textContent = body.classList.contains("hidden") ? "show" : "hide";
});

// ── reverb controls ──────────────────────────────────────────────────────────
function _syncRevUI() {
  $("rev-on").checked = audio._revOn ?? false;
}
$("rev-on").addEventListener("change", (e) => {
  audio.enable(); audio.setRevOn(e.target.checked);
});
$("rev-send").addEventListener("input", (e) => {
  const v = +e.target.value / 100;
  $("rev-send-val").textContent = e.target.value;
  audio.enable(); audio.setRevSend(v);
  if (!audio._revOn && v > 0) { audio.setRevOn(true); _syncRevUI(); }
});
$("rev-return").addEventListener("input", (e) => {
  $("rev-return-val").textContent = e.target.value;
  audio.enable(); audio.setRevReturn(+e.target.value / 100);
});
$("rev-time").addEventListener("input", (e) => {
  const t = +e.target.value / 10;  // 1-120 → 0.1-12s
  $("rev-time-val").textContent = t.toFixed(1) + "s";
  audio.enable(); audio.setRevTime(t);
});

// ── compressor controls ──────────────────────────────────────────────────────
function _syncCompUI() {
  $("comp-on").checked = audio._compOn ?? false;
}
$("comp-on").addEventListener("change", (e) => {
  audio.enable(); audio.setCompOn(e.target.checked);
});
$("comp-thresh").addEventListener("input", (e) => {
  $("comp-thresh-val").textContent = e.target.value + "dB";
  audio.enable(); audio.setCompThreshold(+e.target.value);
  if (!audio._compOn) { audio.setCompOn(true); _syncCompUI(); }
});
$("comp-ratio").addEventListener("input", (e) => {
  $("comp-ratio-val").textContent = e.target.value + ":1";
  audio.enable(); audio.setCompRatio(+e.target.value);
  if (!audio._compOn) { audio.setCompOn(true); _syncCompUI(); }
});
$("comp-attack").addEventListener("input", (e) => {
  $("comp-attack-val").textContent = e.target.value + "ms";
  audio.enable(); audio.setCompAttack(+e.target.value / 1000);
  if (!audio._compOn) { audio.setCompOn(true); _syncCompUI(); }
});
$("comp-release").addEventListener("input", (e) => {
  $("comp-release-val").textContent = e.target.value + "ms";
  audio.enable(); audio.setCompRelease(+e.target.value / 1000);
  if (!audio._compOn) { audio.setCompOn(true); _syncCompUI(); }
});
$("tape-toggle").addEventListener("click", (e) => {
  const body = $("tape-body");
  body.classList.toggle("hidden");
  e.target.textContent = body.classList.contains("hidden") ? "show" : "hide";
});

// tape transport
let _tapeRecording = false;
$("tape-rec").addEventListener("click", () => {
  audio.enable();
  if (_tapeRecording) {
    audio.stopTapeRec();
    _tapeRecording = false;
    $("tape-rec").classList.remove("armed");
    $("tape-rec").textContent = "● rec";
    $("tape-status").textContent = "recorded";
  } else if (audio.startTapeRec()) {
    _tapeRecording = true;
    $("tape-rec").classList.add("armed");
    $("tape-rec").textContent = "■ stop";
    $("tape-status").textContent = "recording…";
  }
});
let _tapeLoop = false;
$("tape-loop").addEventListener("click", () => {
  _tapeLoop = !_tapeLoop;
  audio.setTapeLoop(_tapeLoop);
  $("tape-loop").classList.toggle("active", _tapeLoop);
});
function _setPlayActive(on) {
  $("tape-play").classList.toggle("active", on);
  $("tape-play").textContent = on ? "■ stop" : "▶ play";
}
$("tape-play").addEventListener("click", () => {
  audio.enable();
  if (audio.isTapePlaying()) {
    audio.stopTapePlay();                 // triggers onTapeEnd → clears state
  } else if (audio.playTape(_tapeLoop)) {
    _setPlayActive(true);
    $("tape-status").textContent = _tapeLoop ? "looping" : "playing";
  }
});
audio.onTapeEnd = () => { _setPlayActive(false); $("tape-status").textContent = "ready"; };
$("tape-save").addEventListener("click", () => audio.saveTape());

// per-bus level meters (one thin bar per fader, drawn continuously)
const _meterStrips = [...document.querySelectorAll(".mix-strip[data-mix]")].map((strip) => {
  const canvas = strip.querySelector(".strip-meter");
  return canvas ? { name: strip.dataset.mix, ctx: canvas.getContext("2d"), w: canvas.width, h: canvas.height, peakL: 0, peakR: 0 } : null;
}).filter(Boolean);

function _drawMeters() {
  _applyMixIfReady();
  for (const m of _meterStrips) {
    const [rawL, rawR] = audio.busLevel ? audio.busLevel(m.name) : [0, 0];
    // perceptual scaling so quiet signals stay visible; smooth peak decay
    m.peakL = Math.max(Math.min(1, Math.pow(rawL, 0.6) * 1.3), m.peakL * 0.9);
    m.peakR = Math.max(Math.min(1, Math.pow(rawR, 0.6) * 1.3), m.peakR * 0.9);
    const { ctx, w, h } = m;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, "#40c040");
    grad.addColorStop(0.7, "#f0a040");
    grad.addColorStop(1, "#ff5a5a");
    ctx.fillStyle = grad;
    const bw = Math.floor((w - 1) / 2);          // two channel bars with a 1px gap
    ctx.fillRect(0,        h - Math.round(m.peakL * h), bw, Math.round(m.peakL * h));
    ctx.fillRect(w - bw,   h - Math.round(m.peakR * h), bw, Math.round(m.peakR * h));
  }
  requestAnimationFrame(_drawMeters);
}
_drawMeters();

// ── boot ──────────────────────────────────────────────────────────────────
connect();
loadScriptList();
midi.autoConnect($("midi-in"), $("midi-out"));

$("midi-connect").addEventListener("click", () => midi.connect());

log("norns emulator ready — choose a script and click load", "info");
