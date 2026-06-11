# Roadmap

A phased build. **Phases 0–4 (core) are implemented. Bolt deployment active (2.6.2026).**

> **Update 2026-06-05:** Engines beyond PolyPerc done — **MollyThePoly, Ack, Glut**
> (`web/js/`). Engine **poll** system (phase/level → grid displays). **Mixer + Tapemachine**
> UI under the norns screen (per-bus stereo meters, rec/play/loop/download). **Touch**
> support (Pointer Events) + responsive centering. Many API fixes (see NORNS-API-COVERAGE).
> Next: norns hardware sync (dust/audio ↔ webapp), Maiden-like editor, params EDIT/PSET/MAP
> completeness.

## Phase 0 — Foundation ✅
- [x] Repo structure, Docker + docker-compose, dev workflow
- [x] Node gateway: static host, WebSocket, Lua child over stdio, timer service
- [x] JSON wire protocol (see ARCHITECTURE.md)
- [x] Docs, skills, session briefing
- [x] `norns.local` hostname (nginx-proxy), `norns-up`/`norns-down` aliases

## Phase 1 — Screen + input + core API ✅
- [x] Screen renderer (cairo path model) on a 128×64 canvas
- [x] Encoders E1-3 + Keys K1-3 (mouse + keyboard shortcuts)
- [x] `metro`, `clock` (run/sleep/sync, tempo), `util`, `tab`, `controlspec`
- [x] `params` (number/control/option/taper/binary/trigger/file/text/group/sep)
- [x] `grid` + `arc` (LED buffers + input GUIs)
- [x] `midi` in/out via WebMIDI; `engine` → WebAudio with **PolyPerc**
- [x] `include`/`require`, vendored `musicutil`
- [x] Example scripts: `hello`, `gridtest`

## Phase 2 — Fidelity ✅ (19/20 scripts render)
- [x] Vendor libs: sequins, lattice, er, formatters, lfo, pattern_time, ui, filters, gridbuf
- [x] Stubs: fileselect (→ nil callback), textentry (→ default callback)
- [x] Compatibility matrix against `current set` (sweep test)
- [x] `norns.enc` as callable metatable (sens/accel + dispatch)
- [x] `midi.vports` (16 virtual ports)
- [x] Built-in params: clock_tempo, clock_source, clock_midi_out_div, etc.
- [x] `_menu` stub (rebuild_params, set_mode, lock, unlock)
- [x] `norns.crow` deep-proxy
- [x] `screen.blend_mode`, `screen.invert` no-ops
- [x] `util.make_dir`, `params:lookup_param`, `controlspec.def`
- [x] include path: SCRIPTS_DIR candidate (fixes `nb/lib/player` paths)
- [x] include path: parent_dir for `scriptname/lib/x` patterns
- [x] pipe-safe `host.send` (pcall + os.exit on closed stdout)

## Phase 3 — Params panel, pset, MIDI mapping ✅
- [x] Full params panel UI in browser (`web/js/params.js`)
  - Slider for NUMBER/CONTROL/TAPER, Select for OPTION, Checkbox for BINARY, Trigger button
  - Meta message sent after `init()` so all script params are included
  - Live updates via `param_update` messages
- [x] pset save/load: `params:write(n)` / `params:read(n)` to disk
  (`/tmp/<scriptname>/pset/<n>.pset`, tab-separated format matching real norns)
- [x] **PSET completeness (2026-06-06):** named psets (`-- <name>` header), saved-pset
  list in the panel with load/delete, and a `>` **default** pset (marker file in the
  pset dir) that auto-loads after `init()` on script start. Protocol: `pset_write{n,name}`,
  `pset_list`, `pset_delete{n}`, `pset_default{n}` (toggle). Backend verified by
  integration test against `matron/norns/params.lua`.
- [x] MIDI CC mapping + learn: ⊙ button per param, CC → param range, stored in localStorage
- [x] WebMIDI Firefox fix: connect button (user-gesture triggered), clear error messages
- [x] `musicutil.note_num_to_name(nil)` guard (returns "?")

## Phase 4 — Audio engines in WebAudio ✅ (core complete)
- [ ] Mixer/levels (`audio.*`) wired to WebAudio gains
- [x] **softcut** AudioWorklet — 6 voices, 2-ch buffer (60 s), loops, rate,
      rec/pre levels, fades, ADC input (mic), render_buffer waveform callback
- [x] Post-filter: **TPT SVF** (unconditionally stable, replaces Chamberlin)
- [x] ADC input routing: 2-channel mix matrix per voice, getUserMedia + GainNode
- [x] `render_buffer` / `event_render` waveform display with queue + race-condition fixes
- [x] `audio.file_info` — WAV + AIFF header parser, multi-samplerate normalisation
- [x] File browser UI: `/audio` folder, modal picker, FILE param browse button
- [x] `fileselect.enter()` → browser modal → Lua callback
- [x] `params:add_group(id, name, n)` 3-arg form; `lookup_param():bang()`
- [x] `softcut.filter_*` short aliases (halfsecond, older scripts)
- [x] Lua file watcher — auto-restart on matron/*.lua changes (Docker/macOS fix)
- [ ] A library of reimplemented engines: PolyPerc ✅, PolySub, Passersby…
- [ ] `poll`s for audio analysis (amp/pitch) back to Lua
- [ ] slew interpolation (level/pan/rate_slew_time)
- [ ] `softcut.rec_offset`, `voice_sync`, `level_cut_cut` matrix

## Phase 5 — Optional high-fidelity: real SuperCollider
- [ ] Run `scsynth` + real `crone`/engines in the container
- [ ] Stream audio to the browser (WebRTC or opus-over-ws)
- [ ] Mode switch: "WebAudio (light)" vs "SuperCollider (faithful)"

## Phase 5.5 — UI & UX (2.6.2026) ✅
- [x] Responsive layout: `--screen-w: clamp(280px, …, 652px)`, max 1400px
- [x] Controls: K1+E1 horizontal oben links, E2+K2 / E3+K3 vertikal unten rechts
- [x] Arc → Grid → Panel rechte Spalte (gleiche Breite, unabhängig von Norns-Höhe)
- [x] Font: Arial/Helvetica, 13px; kbd-Labels über Knobs, Titel "Norns Emulator"
- [x] Grid füllt volle Panel-Breite (`repeat(16, 1fr)`), Arc skaliert proportional
- [x] Params-Panel klappt auf ohne Grid/Arc zu verschieben

## Phase 6 — Maiden editor & polish

### Phase 6a — Script editor ✅ (11.6.2026)
- [x] **maiden** button next to load/↻ opens Ace code editor modal
- [x] `GET /api/script?path=` — read Lua source (guard: only `*.lua` inside SCRIPTS_DIR)
- [x] `PUT /api/script` — write Lua source back to disk (direct Dropbox volume mount)
- [x] **save** / **save & load** (saves + sends `{t:load}` to restart script)
- [x] Ace 1.32.6, monokai theme, Lua syntax mode, 900×680 modal

### Phase 6b — File browser ✅ (11.6.2026)
- [x] Tree view of `/scripts` folder in the maiden modal (lazy expand, remembers open dirs)
- [x] Click file → open in editor; click folder → expand/collapse
- [x] `POST /api/scriptdir` — create folder; `DELETE /api/scriptentry` — delete file/dir (recursive); `PATCH /api/scriptentry` — rename/move (all guarded to SCRIPTS_ROOT)
- [x] **+file** / **+folder** / **rename** / **delete** toolbar buttons
- [x] New-script template (engine, enc/key/redraw stubs)
- [x] After file ops: tree + script-select both refreshed

### Phase 6c — Catalog / package manager ✅ (11.6.2026)
- [x] `GET /api/catalog` — proxy + in-memory cache of norns-community catalog (353 entries)
- [x] `GET /api/catalog/installed` — list installed dirs in `community/`
- [x] `POST /api/catalog/install` — `git clone --depth=1` into `/scripts/community/<name>` (GIT_ASKPASS workaround for non-TTY)
- [x] Uninstall via existing `DELETE /api/scriptentry`
- [x] Catalog overlay: search (name/author/desc/tags), install + remove buttons, ✓ installed badge
- [x] Dockerfile: `git` + `ca-certificates`; docker-compose: `community/` volume mount

### Phase 6d — Polish (partial)
- [x] Vendor Ace locally (offline / Bolt deployment without CDN) ✅ (11.6.2026)
- [ ] Screenshot/GIF export of the screen canvas
- [ ] Connect a physical grid/arc via serialosc bridge (WebSerial or host OSC)
- [ ] Save/restore session; multiple device profiles
- [ ] Package as a one-click app

### Bugfixes & Design (12.6.2026)
- [x] Arc ring 3+4 hit detection — `_toCanvas()` scales client→canvas coords
- [x] `clock.internal.start/stop` forwards to `clock.transport` callbacks (fixes CC2 pattern recording/playback)
- [x] Reverb (ConvolverNode, synthetic IR) + Compressor (DynamicsCompressorNode) — `audio.rev_*` / `audio.comp_*` Lua API
- [x] FX panel (reverb + compressor combined, default collapsed)
- [x] Layout: E2/K2 + E3/K3 beside screen on desktop, below on mobile
- [x] All controls (E1/K1/E2/K2/E3/K3) unified to smaller size (52px dial)
- [x] `scripts/` renamed to `tools/`, removed from repo
- [x] Ace Lua syntax fix (`mode-lua.js` without `.min` suffix)

## Known divergences from hardware (tracked)
- Auto-redraw after enc/key/grid/arc input (convenience; hardware does not)
- Fonts approximate norns bitmap fonts; `text_extents` is estimated
- psets stored in container `/tmp/` (lost on restart); mount a volume for persistence
- No real audio DSP latency/character until Phase 4/5
- Clock source param is registered but only "internal" is active
