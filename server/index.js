// norns-emulator — Node gateway
//
// Responsibilities:
//   1. Serve the browser client (web/) over HTTP.
//   2. Bridge browser <-> matron-shim (Lua 5.3 child process) over a WebSocket.
//   3. Own all timers (metro / clock) for accuracy and forward fire events to Lua.
//   4. Expose /api/scripts to list loadable norns scripts from SCRIPTS_DIR.
//
// Wire protocol is newline-delimited JSON.
//   browser  --ws-->  server  --stdin-->  lua    (input events, load, eval)
//   lua      --stdout-->  server  --ws-->  browser (screen frames, grid/arc LEDs, engine, logs)

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createServer } from "node:http";
import { readdir, stat, readFile, writeFile, mkdir, rename as fsRename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = parseInt(process.env.PORT || "5151", 10);
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.resolve(ROOT, "..");
const MATRON = path.join(ROOT, "matron", "matron.lua");
const LUA_BIN = process.env.LUA_BIN || "lua5.3";

// ---------------------------------------------------------------------------
// HTTP + static
// ---------------------------------------------------------------------------
const app = express();
// No-cache for JS/CSS so the browser always loads the latest version.
app.use((req, res, next) => {
  if (req.path.match(/\.(js|css)$/)) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});
// Parse JSON bodies (maiden editor saves script source via PUT /api/script).
app.use(express.json({ limit: "4mb" }));
// API routes must be registered before express.static so they are not shadowed.

// Recursively find norns scripts: <name>/<name>.lua or a top-level <name>.lua.
// Skips lib/, data/, .git and other non-script folders.
async function findScripts(dir, base = dir, depth = 0, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["lib", "data", "doc", "docs", "assets", "node_modules"].includes(e.name)) continue;
      if (depth < 4) await findScripts(full, base, depth + 1, out);
    } else if (e.isFile() && e.name.endsWith(".lua")) {
      // A "main" script is named like its folder, or sits at a shallow depth.
      const folder = path.basename(path.dirname(full));
      const nameNoExt = e.name.replace(/\.lua$/, "");
      if (nameNoExt === folder || depth <= 1) {
        out.push({
          name: nameNoExt,
          rel: path.relative(SCRIPTS_DIR, full),
          path: full,
        });
      }
    }
  }
  return out;
}

app.get("/api/scripts", async (_req, res) => {
  const list = await findScripts(SCRIPTS_DIR);
  list.sort((a, b) => a.rel.localeCompare(b.rel));
  res.json(list);
});

// ── maiden editor: read/write a script's Lua source ─────────────────────────
// Both endpoints restrict access to *.lua files inside SCRIPTS_DIR so the
// editor can never read or overwrite arbitrary files on the host.
const SCRIPTS_ROOT = path.resolve(SCRIPTS_DIR);

function resolveScriptPath(p) {
  if (!p) return null;
  const resolved = path.resolve(p);
  if (!resolved.startsWith(SCRIPTS_ROOT + path.sep)) return null;
  if (!resolved.endsWith(".lua")) return null;
  return resolved;
}

app.get("/api/script", async (req, res) => {
  const resolved = resolveScriptPath(req.query.path);
  if (!resolved) return res.status(400).json({ error: "invalid script path" });
  try {
    const text = await readFile(resolved, "utf8");
    res.json({ path: resolved, text });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.put("/api/script", async (req, res) => {
  const resolved = resolveScriptPath(req.body && req.body.path);
  if (!resolved) return res.status(400).json({ error: "invalid script path" });
  if (typeof (req.body && req.body.text) !== "string") {
    return res.status(400).json({ error: "missing text" });
  }
  try {
    await writeFile(resolved, req.body.text, "utf8");
    res.json({ ok: true, path: resolved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── maiden file-tree operations ──────────────────────────────────────────────
// Looser guard than resolveScriptPath: allows any path inside SCRIPTS_ROOT
// (dirs as well as .lua files). Used for mkdir / delete / rename.
function resolveScriptsEntry(p) {
  if (!p) return null;
  const resolved = path.resolve(p);
  if (resolved !== SCRIPTS_ROOT && !resolved.startsWith(SCRIPTS_ROOT + path.sep)) return null;
  // Prevent escaping via ../../ etc. (path.resolve already normalises, double-check)
  if (resolved.includes("\0")) return null;
  return resolved;
}

// POST /api/scriptdir  { path }  — create directory (recursive)
app.post("/api/scriptdir", async (req, res) => {
  const resolved = resolveScriptsEntry(req.body && req.body.path);
  if (!resolved) return res.status(400).json({ error: "invalid path" });
  try {
    await mkdir(resolved, { recursive: true });
    res.json({ ok: true, path: resolved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/scriptentry?path=  — delete file or directory tree
app.delete("/api/scriptentry", async (req, res) => {
  const resolved = resolveScriptsEntry(req.query.path);
  if (!resolved || resolved === SCRIPTS_ROOT) return res.status(400).json({ error: "invalid path" });
  try {
    await rm(resolved, { recursive: true, force: false });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/scriptentry  { from, to }  — rename / move
app.patch("/api/scriptentry", async (req, res) => {
  const from = resolveScriptsEntry(req.body && req.body.from);
  const to   = resolveScriptsEntry(req.body && req.body.to);
  if (!from || !to) return res.status(400).json({ error: "invalid path" });
  try {
    await fsRename(from, to);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Track currently loaded script path (set when browser sends a "load" WS message).
let currentScriptPath = null;

app.get("/api/readme", async (_req, res) => {
  console.log("[readme] currentScriptPath =", currentScriptPath);
  if (!currentScriptPath) return res.status(404).json({ error: "no script loaded" });
  const scriptDir = path.dirname(currentScriptPath);
  const candidates = ["README.md", "readme.md", "README.txt"];
  for (const name of candidates) {
    const p = path.join(scriptDir, name);
    console.log("[readme] trying:", p);
    try {
      const text = await readFile(p, "utf8");
      return res.type("text/plain; charset=utf-8").send(text);
    } catch (e) { console.log("[readme] not found:", e.message); }
  }
  res.status(404).json({ error: "no README found" });
});

// List files/subdirs for the browser file picker.
// Returns { dirs: [{name, path}], files: [{name, path, ext}] }
const AUDIO_EXTS = new Set(['.wav', '.aif', '.aiff', '.flac', '.ogg', '.mp3']);
const AUDIO_DIR = process.env.AUDIO_DIR || '/audio';

// Allowed roots for the file picker. /data + the norns-native data path let
// scripts browse non-audio files like Cheat Codes 2 collection .cc2 names.
const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE_ROOTS = [AUDIO_DIR, SCRIPTS_DIR, DATA_DIR, '/home/we/dust/data', '/home/we/dust/audio']
  .map(p => path.resolve(p));

app.get('/api/files', async (req, res) => {
  const dir = req.query.dir || AUDIO_DIR;
  const resolved = path.resolve(dir);
  // Basic sanity check — stay within expected locations
  const ok = FILE_ROOTS.some(root => resolved.startsWith(root));
  if (!ok) return res.status(403).json({ error: 'outside allowed roots' });
  // ext filter: absent or "*" → all files; otherwise comma-separated list
  // (with or without leading dot), e.g. fileselect.enter(dir, cb, "cc2").
  const extQ = req.query.ext;
  const extMatches = (ext) => {
    if (!extQ || extQ === '*') return true;
    return String(extQ).split(',').some(e => {
      e = e.trim().toLowerCase();
      // norns special keyword: "audio" means any audio file type, not a literal
      // ".audio" extension (scripts call fileselect.enter(dir, cb, "audio")).
      if (e === 'audio') return AUDIO_EXTS.has(ext);
      if (e && e[0] !== '.') e = '.' + e;
      return e === ext;
    });
  };
  try {
    const entries = await readdir(resolved, { withFileTypes: true });
    const dirs = [], files = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(resolved, e.name);
      if (e.isDirectory()) {
        dirs.push({ name: e.name, path: full });
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (extMatches(ext)) {
          files.push({ name: e.name, path: full, ext });
        }
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ dir: resolved, parent: path.dirname(resolved), dirs, files });
  } catch (e) {
    res.status(404).json({ error: e.message, dir: resolved, parent: path.dirname(resolved), dirs: [], files: [] });
  }
});

// Return audio file metadata: channels, sample_frames (at file SR), samplerate.
// Supports WAV natively; other formats return estimated info.
app.get('/api/fileinfo', async (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).json({ error: 'missing path' });
  const resolved = path.resolve(p);
  try {
    const st = await stat(resolved);
    if (!st.isFile()) return res.status(404).json({ error: 'not a file' });
    // Read up to 128 bytes to find RIFF/WAV fmt + data chunks
    const { createReadStream } = await import('node:fs');
    const buf = await new Promise((resolve, reject) => {
      const chunks = [];
      const s = createReadStream(resolved, { start: 0, end: 127 });
      s.on('data', c => chunks.push(c));
      s.on('end', () => resolve(Buffer.concat(chunks)));
      s.on('error', reject);
    });
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
      // Not a WAV — return a safe default (browser will decode it anyway)
      return res.json({ channels: 1, frames: 48000 * 60, samplerate: 48000, frames_at_48k: 48000 * 60 });
    }
    const channels   = buf.readUInt16LE(22);
    const samplerate = buf.readUInt32LE(24);
    const bps        = buf.readUInt16LE(34);
    const bpf        = channels * Math.max(1, Math.floor(bps / 8));
    // Scan for data chunk (skip LIST/INFO chunks before data)
    let pos = 36;
    let frames = 0;
    while (pos + 8 <= buf.length) {
      const tag  = buf.toString('ascii', pos, pos + 4);
      const size = buf.readUInt32LE(pos + 4);
      if (tag === 'data') { frames = Math.floor(size / bpf); break; }
      pos += 8 + size + (size % 2);
    }
    const frames_at_48k = Math.round(frames * 48000 / Math.max(1, samplerate));
    res.json({ channels, frames, samplerate, frames_at_48k });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Serve audio files for softcut.buffer_read_mono.
// The path must be an existing file (no restriction to SCRIPTS_DIR — scripts may
// reference absolute paths inside the container that happen to be in SCRIPTS_DIR).
app.get("/api/audio", async (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).send("missing path");
  const resolved = path.resolve(p);
  try {
    const s = await stat(resolved);
    if (!s.isFile()) return res.status(404).send("not a file");
    res.sendFile(resolved);
  } catch {
    res.status(404).send("not found");
  }
});

// Static files — registered after API routes so /api/* is never shadowed.
app.use(express.static(path.join(ROOT, "web")));

const server = createServer(app);

// ---------------------------------------------------------------------------
// Lua file watcher — polls matron/ for changes and kills+respawns Lua.
// node --watch can't detect inotify events through Docker bind-mounts on macOS,
// so we poll manually every 1 s instead.
// ---------------------------------------------------------------------------
async function walkMtimes(dir, acc = new Map()) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { await walkMtimes(full, acc); }
    else if (e.isFile() && e.name.endsWith(".lua")) {
      try { const s = await stat(full); acc.set(full, s.mtimeMs); } catch {}
    }
  }
  return acc;
}

let _luaMtimes = new Map();
const MATRON_DIR = path.join(ROOT, "matron");

let _watcherCooldown = false;

async function startLuaWatcher() {
  _luaMtimes = await walkMtimes(MATRON_DIR);
  setInterval(async () => {
    if (_watcherCooldown) return;
    const cur = await walkMtimes(MATRON_DIR);
    let changed = false;
    for (const [f, mt] of cur) {
      if (_luaMtimes.get(f) !== mt) { changed = true; break; }
    }
    if (!changed && cur.size !== _luaMtimes.size) changed = true;
    if (changed) {
      _luaMtimes = cur;
      _watcherCooldown = true;
      setTimeout(() => { _watcherCooldown = false; }, 5000);
      console.log("[watcher] matron/*.lua changed — restarting Lua");
      if (lua && !lua.killed) lua.kill("SIGTERM");
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// matron-shim (Lua child process)
// ---------------------------------------------------------------------------
let lua = null;
let luaBuf = "";
const clients = new Set();
const timers = new Map(); // id -> { handle, interval }

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function sendToLua(obj) {
  if (!lua || lua.killed || !lua.stdin.writable) return;
  obj.now = performance.now();
  try {
    lua.stdin.write(JSON.stringify(obj) + "\n");
  } catch (e) {
    // Lua process died (EPIPE) — the 'exit' handler will respawn it. Swallow
    // the write error so a dead child can't take down the whole gateway.
    console.error("[matron] write failed (lua gone?):", e.code || e.message);
  }
}

function clearAllTimers() {
  for (const { handle, interval } of timers.values()) {
    interval ? clearInterval(handle) : clearTimeout(handle);
  }
  timers.clear();
}

// Handle a single parsed message coming FROM Lua (stdout).
function handleLuaMessage(obj) {
  switch (obj.t) {
    case "timer_set": {
      // { t, id, sec, interval }
      const ms = Math.max(0, obj.sec * 1000);
      const fire = () => sendToLua({ t: "timer", id: obj.id });
      const handle = obj.interval ? setInterval(fire, ms) : setTimeout(() => {
        timers.delete(obj.id);
        fire();
      }, ms);
      timers.set(obj.id, { handle, interval: !!obj.interval });
      break;
    }
    case "timer_clear": {
      const tm = timers.get(obj.id);
      if (tm) {
        tm.interval ? clearInterval(tm.handle) : clearTimeout(tm.handle);
        timers.delete(obj.id);
      }
      break;
    }
    case "clear_all_timers":
      clearAllTimers();
      break;
    default:
      // frame / grid / arc / engine / midi / log / meta -> straight to the browser
      broadcast(obj);
  }
}

function spawnLua() {
  console.log(`[matron] spawning ${LUA_BIN} ${MATRON}`);
  lua = spawn(LUA_BIN, [MATRON], {
    cwd: ROOT,
    env: { ...process.env, SCRIPTS_DIR },
    stdio: ["pipe", "pipe", "pipe"],
  });

  lua.stdout.on("data", (chunk) => {
    luaBuf += chunk.toString("utf8");
    let nl;
    while ((nl = luaBuf.indexOf("\n")) >= 0) {
      const line = luaBuf.slice(0, nl);
      luaBuf = luaBuf.slice(nl + 1);
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (err) {
        console.error("[matron] bad json:", line);
        continue;
      }
      handleLuaMessage(obj);
    }
  });

  // Without an error handler, an EPIPE when writing to a dead child's stdin is
  // emitted as an unhandled 'error' event and crashes the whole Node gateway.
  lua.stdin.on("error", (e) => {
    console.error("[matron] stdin error:", e.code || e.message);
  });

  lua.stderr.on("data", (d) => {
    const s = d.toString();
    process.stderr.write("[lua] " + s);
    broadcast({ t: "log", level: "error", msg: s.trimEnd() });
  });

  lua.on("exit", (code, sig) => {
    console.error(`[matron] exited code=${code} sig=${sig}; respawning in 500ms`);
    clearAllTimers();
    lua = null;
    broadcast({ t: "lua_restart" });
    setTimeout(spawnLua, 500);
  });
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[ws] client connected (${clients.size})`);
  ws.send(JSON.stringify({ t: "hello", port: PORT }));
  ws.on("message", (data) => {
    let obj;
    try {
      obj = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (obj.t === "load" && obj.path) currentScriptPath = obj.path;
    sendToLua(obj); // enc / key / gridkey / arcdelta / midi / load / eval / cleanup
  });
  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[ws] client disconnected (${clients.size})`);
  });
});

// Keep WebSocket connections alive through proxies (ping every 20s).
setInterval(() => {
  for (const ws of clients) {
    if (ws.readyState === 1) ws.ping();
  }
}, 20000);

spawnLua();
if (!process.env.NO_LUA_WATCH) startLuaWatcher();
server.listen(PORT, () => {
  console.log(`norns-emulator on http://localhost:${PORT}`);
  console.log(`scripts dir: ${SCRIPTS_DIR}`);
});
