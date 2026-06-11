// params.js — Params panel UI + MIDI CC mapping.
//
// Param types (mirror matron/norns/params.lua):
//   1=NUMBER  2=OPTION  3=CONTROL  4=FILE  5=TAPER  6=TRIGGER
//   7=GROUP   8=SEPARATOR   9=TEXT   10=BINARY

const T = { NUMBER:1, OPTION:2, CONTROL:3, FILE:4, TAPER:5,
            TRIGGER:6, GROUP:7, SEP:8, TEXT:9, BINARY:10 };

export class ParamsPanel {
  constructor(panelEl, countEl, send, log, openFilePicker) {
    this.panelEl        = panelEl;
    this.countEl        = countEl;
    this.send           = send;
    this.log            = log;
    this.openFilePicker = openFilePicker || null;
    this.params         = [];
    this.scriptName     = "";
    this.learnId        = null;
    this.midiMap        = {};
    this._rows          = {};

    this._bindToolbar();
  }

  _bindToolbar() {
    this.slotEl   = this.panelEl.querySelector("#pset-n");
    this.psetList = this.panelEl.querySelector("#pset-list");

    this.panelEl.querySelector("#pset-save").addEventListener("click", () => {
      const n = parseInt(this.slotEl.value) || 1;
      const def  = `${this.scriptName || "norns"}-${String(n).padStart(2, "0")}`;
      const name = window.prompt("PSET name:", def);
      if (name === null) return;            // cancelled
      this.send({ t: "pset_write", n, name });
    });
    this.panelEl.querySelector("#pset-load").addEventListener("click", () => {
      const n = parseInt(this.slotEl.value) || 1;
      this.send({ t: "pset_read", n });
    });
    this.listEl = this.panelEl.querySelector("#params-list");
  }

  // Ask the Lua side for the current list of saved psets.
  requestPsetList() { this.send({ t: "pset_list" }); }

  // Render the saved-pset list (called on pset_list message).
  // items: [{ n, name }], deflt: number|null (the ">" default pset)
  renderPsetList(items, deflt) {
    if (!this.psetList) return;
    this.psetList.innerHTML = "";
    if (!items || !items.length) return;
    // next free slot → convenience default for the save box
    const used = new Set(items.map(i => i.n));
    let next = 1; while (used.has(next)) next++;
    if (this.slotEl) this.slotEl.value = Math.min(next, 99);

    for (const it of items) {
      const isDef = it.n === deflt;
      const row = document.createElement("div");
      row.className = "pset-row" + (isDef ? " is-default" : "");

      const num = document.createElement("span");
      num.className = "pset-num";
      num.textContent = String(it.n).padStart(2, "0");

      const nm = document.createElement("span");
      nm.className = "pset-name";
      nm.textContent = it.name || "—";
      nm.title = it.name || "";

      const load = document.createElement("button");
      load.className = "pset-act";
      load.textContent = "load";
      load.addEventListener("click", () => this.send({ t: "pset_read", n: it.n }));

      const def = document.createElement("button");
      def.className = "pset-act pset-def" + (isDef ? " on" : "");
      def.textContent = isDef ? "▸ default" : "default";
      def.title = "load this PSET automatically when the script starts";
      def.addEventListener("click", () => this.send({ t: "pset_default", n: it.n }));

      const del = document.createElement("button");
      del.className = "pset-act pset-del";
      del.textContent = "✕";
      del.title = "delete this PSET";
      del.addEventListener("click", () => {
        if (window.confirm(`Delete PSET ${num.textContent}${it.name ? ` "${it.name}"` : ""}?`))
          this.send({ t: "pset_delete", n: it.n });
      });

      row.append(num, nm, load, def, del);
      this.psetList.appendChild(row);
    }
  }

  // Called on meta message: rebuild entire panel.
  load(params, scriptName) {
    this.params     = params || [];
    this.scriptName = scriptName || "";
    this._rows      = {};
    this.learnId    = null;
    this._loadMidiMap(scriptName);
    this._build();
    this.requestPsetList();
  }

  _build() {
    this.listEl.innerHTML = "";
    let count = 0;
    const groups = [];          // { header, body } for each GROUP
    let currentBody = null;     // active group body element
    let remaining = 0;          // params left in current group

    for (const p of this.params) {
      if (p.t !== T.SEP && p.t !== T.GROUP) count++;

      if (p.t === T.GROUP) {
        const wrap   = document.createElement("div");
        wrap.className = "param-group-wrap";
        const header = document.createElement("div");
        header.className = "param-group";
        header.innerHTML = `<span class="param-group-arrow">▶</span>${p.name || "group"}`;
        const body   = document.createElement("div");
        body.className = "param-group-body";
        wrap.appendChild(header);
        wrap.appendChild(body);
        this.listEl.appendChild(wrap);
        header.addEventListener("click", () => {
          const open = body.classList.toggle("open");
          header.querySelector(".param-group-arrow").textContent = open ? "▼" : "▶";
        });
        groups.push({ header, body });
        currentBody = body;
        remaining   = p.count || 0;
      } else {
        const target = (currentBody && remaining > 0) ? currentBody : this.listEl;
        const row    = this._makeRow(p, !!currentBody);
        if (row) target.appendChild(row);
        if (currentBody && remaining > 0) {
          remaining--;
          if (remaining === 0) { currentBody = null; }
        }
      }
    }

    // All groups collapsed by default

    const nonBuiltin = this.params.filter(p =>
      p.t !== T.SEP && p.t !== T.GROUP && p.id &&
      !p.id.startsWith("clock_")).length;
    this.countEl.textContent = nonBuiltin ? `${nonBuiltin} params` : "";
  }

  _makeRow(p, indent) {
    if (p.t === T.SEP) {
      const d = document.createElement("div");
      d.className = "param-sep";
      d.textContent = p.name || "—";
      return d;
    }
    if (p.t === T.GROUP) {
      const d = document.createElement("div");
      d.className = "param-group";
      d.textContent = p.name || "group";
      return d;
    }

    const row = document.createElement("div");
    row.className = "param-row" + (indent ? " indented" : "");
    row.dataset.id = p.id;

    // name
    const nameEl = document.createElement("span");
    nameEl.className = "param-name";
    nameEl.textContent = p.name || p.id;
    nameEl.title = p.id;

    // value string
    const valEl = document.createElement("span");
    valEl.className = "param-val";
    valEl.textContent = p.str || "";

    // control widget
    const ctrlEl = document.createElement("div");
    ctrlEl.className = "param-ctrl";
    let inputEl = null;

    if (p.t === T.NUMBER || p.t === T.CONTROL || p.t === T.TAPER) {
      const min = p.min ?? 0, max = p.max ?? 1;
      const slider = document.createElement("input");
      slider.type  = "range";
      slider.className = "param-slider";
      slider.min   = min;
      slider.max   = max;
      slider.step  = (max - min) / 500;
      slider.value = p.value ?? min;
      slider.addEventListener("input", () =>
        this.send({ t: "param_set", id: p.id, value: parseFloat(slider.value) }));
      slider.addEventListener("wheel", (e) => {
        e.preventDefault();
        const step = (max - min) / 200;
        const nv = Math.min(max, Math.max(min, parseFloat(slider.value) + (e.deltaY < 0 ? step : -step)));
        slider.value = nv;
        this.send({ t: "param_set", id: p.id, value: nv });
      }, { passive: false });
      ctrlEl.appendChild(slider);
      inputEl = slider;

    } else if (p.t === T.OPTION) {
      const sel = document.createElement("select");
      sel.className = "param-select";
      for (let i = 0; i < (p.options || []).length; i++) {
        const o = document.createElement("option");
        o.value = i + 1;
        o.textContent = p.options[i];
        sel.appendChild(o);
      }
      sel.value = p.value ?? 1;
      sel.addEventListener("change", () =>
        this.send({ t: "param_set", id: p.id, value: parseInt(sel.value) }));
      ctrlEl.appendChild(sel);
      inputEl = sel;

    } else if (p.t === T.BINARY) {
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.className = "param-check";
      chk.checked = !!p.value;
      chk.addEventListener("change", () =>
        this.send({ t: "param_set", id: p.id, value: chk.checked ? 1 : 0 }));
      ctrlEl.appendChild(chk);
      inputEl = chk;

    } else if (p.t === T.TRIGGER) {
      const btn = document.createElement("button");
      btn.className = "param-trigger-btn";
      btn.textContent = "▶";
      btn.addEventListener("click", () =>
        this.send({ t: "param_set", id: p.id, value: 1 }));
      ctrlEl.appendChild(btn);

    } else if (p.t === T.FILE) {
      const pathEl = document.createElement("span");
      pathEl.className = "param-file-path";
      pathEl.title = p.value || "";
      pathEl.textContent = p.value ? p.value.split("/").pop() : "—";
      // _lastFile: remember the last non-empty value so it shows after reset
      pathEl._lastFile = p.value || "";
      const browseBtn = document.createElement("button");
      browseBtn.className = "param-browse";
      browseBtn.textContent = "browse";
      browseBtn.addEventListener("click", () => {
        if (this.openFilePicker) {
          this.openFilePicker("/audio", "*", (selected) => {
            if (!selected) return;
            const name = selected.split("/").pop();
            pathEl.textContent = name;
            pathEl.title = selected;
            pathEl._lastFile = name;
            this.send({ t: "param_set", id: p.id, value: selected });
          });
        }
      });
      ctrlEl.appendChild(pathEl);
      ctrlEl.appendChild(browseBtn);
      inputEl = pathEl;
    }

    ctrlEl.appendChild(valEl);
    this._rows[p.id] = { el: row, valEl, inputEl };

    // MIDI learn button
    const learnBtn = document.createElement("button");
    learnBtn.className = "param-learn" + (this._getMapped(p.id) ? " mapped" : "");
    learnBtn.textContent = "⊙";
    learnBtn.title = "MIDI learn";
    learnBtn.addEventListener("click", () => this._toggleLearn(p.id, learnBtn));

    row.appendChild(nameEl);
    row.appendChild(ctrlEl);
    row.appendChild(learnBtn);
    return row;
  }

  // Called on param_update message from Lua.
  update(id, value, str) {
    const r = this._rows[id];
    if (!r) return;
    if (r.valEl) r.valEl.textContent = str ?? value;
    if (r.inputEl) {
      const tag = r.inputEl.tagName;
      if (tag === "INPUT" && r.inputEl.type === "range")         r.inputEl.value = value;
      else if (tag === "INPUT" && r.inputEl.type === "checkbox") r.inputEl.checked = !!value;
      else if (tag === "SELECT") r.inputEl.value = value;
      else if (tag === "SPAN" && r.inputEl.className === "param-file-path") {
        const v = String(value || "");
        if (v && v !== "-") {
          // New file loaded: show filename and cache it
          const name = v.split("/").pop();
          r.inputEl.textContent = name;
          r.inputEl.title = v;
          r.inputEl._lastFile = name;
        } else if (r.inputEl._lastFile) {
          // Script reset param to "": keep last filename in dimmed style
          r.inputEl.textContent = r.inputEl._lastFile;
          r.inputEl.title = r.inputEl._lastFile;
          r.inputEl.style.opacity = "0.5";
        } else {
          r.inputEl.textContent = "—";
          r.inputEl.title = "";
        }
      }
    }
  }

  // Called on params_refresh message (after pset load): re-populate all values.
  refresh(params) {
    this.params = params;
    for (const p of params) {
      if (p.id && p.str !== undefined) this.update(p.id, p.value, p.str);
      // also update slider range/options if needed (re-build for now is simpler)
    }
    // re-build preserves learn state; simpler than patching individual rows
    this._rows = {};
    this.listEl.innerHTML = "";
    let indent = false;
    for (const p of params) {
      const row = this._makeRow(p, indent);
      if (row) this.listEl.appendChild(row);
      if (p.t === T.GROUP) indent = true;
      if (p.t === T.SEP)   indent = false;
    }
  }

  // ── MIDI CC routing ────────────────────────────────────────────────────────

  // Returns true if this MIDI data was consumed (learn or mapped CC).
  handleMidi(data) {
    if ((data[0] & 0xF0) !== 0xB0) return false;
    const cc  = data[1];
    const val = data[2];

    if (this.learnId) {
      const p = this.params.find(x => x.id === this.learnId);
      if (p) {
        this.midiMap[String(cc)] = { id: p.id, min: p.min ?? 0, max: p.max ?? 1,
                                      t: p.t, count: p.count };
        this._saveMidiMap(this.scriptName);
        // update learn button appearance
        const r = this._rows[this.learnId];
        if (r) r.el.querySelector(".param-learn")?.classList.add("mapped");
        this.log(`MIDI CC${cc} → "${p.id}"`, "info");
      }
      // clear learn
      this.listEl.querySelector(".learning")?.classList.remove("learning");
      this.learnId = null;
      return true;
    }

    const m = this.midiMap[String(cc)];
    if (!m) return false;
    let value;
    if (m.t === T.OPTION) {
      const n = m.count || 1;
      value = Math.round(val / 127 * (n - 1)) + 1;
    } else if (m.t === T.BINARY) {
      value = val > 63 ? 1 : 0;
    } else {
      const lo = m.min ?? 0, hi = m.max ?? 1;
      value = lo + (val / 127) * (hi - lo);
    }
    this.send({ t: "param_set", id: m.id, value });
    return true;
  }

  _toggleLearn(id, btn) {
    // cancel any previous learn
    this.listEl.querySelector(".learning")?.classList.remove("learning");
    if (this.learnId === id) { this.learnId = null; return; }
    this.learnId = id;
    btn.classList.add("learning");
    this.log(`MIDI learn active — move a CC for "${id}"`, "info");
  }

  _getMapped(id) {
    return Object.values(this.midiMap).some(m => m.id === id);
  }

  _saveMidiMap(name) {
    try { localStorage.setItem(`norns_mm_${name}`, JSON.stringify(this.midiMap)); } catch {}
  }
  _loadMidiMap(name) {
    try {
      const s = localStorage.getItem(`norns_mm_${name}`);
      this.midiMap = s ? JSON.parse(s) : {};
    } catch { this.midiMap = {}; }
  }
}
