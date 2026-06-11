# norns-emulator

A browser-based emulator for **monome norns** — run and develop norns Lua scripts
locally without hardware, with a simulated **screen**, **encoders**, **keys**,
**grid** and **arc**, **WebAudio** engines, **softcut**, **WebMIDI**, and a
built-in **maiden**-style script editor.

> Part of the **Little Modular** project.

**Compatibility:** 19/20 scripts from `current set` render (tested 2026-05-30).

---

## How it works

```
 ┌─────────────────────────────┐        WebSocket (JSON)        ┌──────────────────────────┐
 │  Browser (web/)             │  <───────────────────────────> │  Node gateway (server/)  │
 │  • 128×64 screen on canvas  │   screen frames, grid/arc LEDs  │  • static host + ws      │
 │  • grid / arc GUI           │   ── input events, load, eval ─>│  • owns metro/clock timers│
 │  • virtual E1-3 / K1-3      │                                 │  • spawns Lua child      │
 │  • params panel             │                                 └────────────┬─────────────┘
 │  • WebAudio (engines)       │                                   stdio JSON  │
 │  • WebMIDI                  │                                ┌────────────┴─────────────┐
 │  • maiden script editor     │                                │  matron-shim (matron/)   │
 └─────────────────────────────┘                                │  real Lua 5.3            │
                                                                 │  • norns API reimpl.     │
                                                                 │  • runs your .lua script │
                                                                 └──────────────────────────┘
```

**Key idea:** your script runs in *real Lua 5.3* inside the container. The
norns API (`screen`, `enc`, `key`, `metro`, `clock`, `params`, `grid`, `arc`,
`midi`, `engine`, `softcut`, …) is reimplemented in [`matron/norns/`](matron/norns/)
and emits/consumes JSON over stdio. The browser is the display + input + audio.

---

## Quick start

```bash
# with the norns-up alias (see ~/.aliases):
norns-up           # starts the container
# or:
docker compose up --build

# then open:
open http://localhost:5151
```

Stop with `norns-down` or `docker compose down`.

`docker-compose.yml` mounts `../current set`, `../new project`, and `./examples`
into the container at `/scripts`, so all your norns scripts appear in the picker.

### Without Docker (local)

Requires Node ≥ 20 and `lua5.3` (`brew install lua@5.3`):

```bash
npm install
npm run dev        # node --watch server/index.js → http://localhost:5151
```

---

## Using it

1. **Pick folder + script** — use the two dropdowns (folder left, script name right) and click **load**.  
   Start with `examples / hello` or `current set / awake`.
2. **Drive the script:**

   | Input | Mouse | Keyboard |
   |-------|-------|----------|
   | E1 | scroll / drag dial | `q` (−) `w` (+) |
   | E2 | scroll / drag dial | `e` (−) `r` (+) |
   | E3 | scroll / drag dial | `u` (−) `i` (+) |
   | K1 / K2 / K3 | click | hold `a` / `s` / `d` |

3. **Grid** — click **show**, then click / drag cells.
4. **Arc** — click **show**, scroll or drag over rings.
5. **audio** checkbox — enable WebAudio (browser requires a user gesture first).
6. **mic in** — enable ADC input into softcut via `getUserMedia`.
7. **MIDI** — Chrome/Edge: auto-connect; Firefox: click **connect** and allow permission.
8. **▶ params** — expand to adjust all script parameters live.  
   **save / load** persist named presets (PSET 1–99). **⊙** per param → MIDI CC learn.
9. **REPL** — evaluate Lua live: `params:set("cutoff", 800)` or `print(clock.get_tempo())`.
10. **↻** — hot-reload current script.
11. **fx** — click **show** to expand reverb + compressor panel.
    Reverb: send level, return level, decay time. Compressor: threshold, ratio, attack, release.
    Both activate automatically when a slider is moved.
12. **maiden** — opens the built-in script editor:
    - File tree on the left (expand/collapse folders, click `.lua` to open)
    - Ace editor (Lua syntax, monokai theme) on the right
    - **save** saves to disk; **save & load** saves and immediately reloads the script
    - **+file** creates a new script from a template; **+folder** / **rename** / **delete** manage files

---

## What works

| Feature | Status |
|---------|--------|
| screen (full cairo path model) | ✅ |
| encoders + keys (mouse + keyboard) | ✅ |
| metro, clock (run/sleep/sync/tempo) | ✅ |
| clock.internal.start/stop → transport callbacks | ✅ |
| params (all types, panel, PSETs, MIDI CC map) | ✅ |
| grid + arc (LED buffers + click/drag GUI) | ✅ |
| MIDI in/out (WebMIDI, vports 1–16) | ✅ |
| engine: PolyPerc | ✅ WebAudio |
| engine: MollyThePoly | ✅ WebAudio |
| engine: Ack | ✅ WebAudio |
| engine: Glut | ✅ WebAudio |
| softcut (6 voices, loop/rec/rate/fades, ADC/mic) | ✅ AudioWorklet |
| reverb (ConvolverNode, send/return/time) | ✅ WebAudio |
| compressor (DynamicsCompressorNode) | ✅ WebAudio |
| fileselect (browser modal → Lua callback) | ✅ |
| audio.file_info (WAV/AIFF header parser) | ✅ |
| maiden script editor (Ace, tree browser, file ops) | ✅ |
| catalog / package manager (353 community scripts) | ✅ |
| include() / require / vendored norns libs | ✅ |

### Not yet implemented

| Feature | Notes |
|---------|-------|
| engine: PolySub, Passersby, … | accepted silently (no sound) |
| audio.* mixer/levels | mostly no-op |
| clock sources (MIDI / Link / crow) | param registered, "internal" only |
| crow, hid | deep no-op proxy |
| textentry | stub (returns default value) |
| Catalog / package manager | Phase 6c |

---

## Layout

```
norns-emulator/
├── server/index.js          Node gateway (http + ws + timers + spawns lua)
├── matron/
│   ├── matron.lua           entry: stdio loop + dispatch
│   └── norns/               reimplemented norns API (screen, clock, params, …)
│       └── lib/             vendored norns libs (musicutil, er, sequins, …)
├── web/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── main.js              UI wiring + WebSocket client + maiden editor
│       ├── screen.js            canvas renderer (cairo op replay, 5× scale)
│       ├── params.js            params panel (slider/select/MIDI learn/PSETs)
│       ├── grid.js              grid LED display + input
│       ├── arc.js               arc ring display + input
│       ├── audio.js             WebAudio engine host
│       ├── softcut-worklet.js   AudioWorklet (6-voice softcut)
│       ├── midi.js              WebMIDI bridge
│       ├── ack.js               Ack engine (sample player)
│       ├── glut.js              Glut engine (granular)
│       ├── molly-the-poly.js    MollyThePoly engine
│       └── ace/                 Ace editor (vendored, no CDN needed)
├── audio/                   user audio samples (not tracked in git)
├── data/                    script data / PSETs (not tracked in git)
├── examples/                demo scripts (hello, gridtest)
├── tools/                   dev tools (sweep compatibility test, e2e test, sync-from-norns)
├── docs/                    architecture, roadmap, API coverage, dev guide
└── Dockerfile · docker-compose.yml
```

---

Full plan: [`docs/ROADMAP.md`](docs/ROADMAP.md) ·
API coverage: [`docs/NORNS-API-COVERAGE.md`](docs/NORNS-API-COVERAGE.md) ·
Script compat: [`docs/SCRIPT-COMPAT.md`](docs/SCRIPT-COMPAT.md) ·
Dev guide: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
