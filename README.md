# norns-emulator

A browser-based emulator for **monome norns** — run and test norns Lua scripts
locally on your computer, with a simulated **screen**, **encoders**, **keys**,
**grid** and **arc**, plus **WebAudio** and **WebMIDI** for sound and MIDI I/O.

> Part of the **Little Modular** project. Lets you develop norns scripts
> (in `../current set` and `../new project`) without the hardware.

**Compatibility:** 19/20 scripts from `current set` render (2026-05-30).

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
 └─────────────────────────────┘                                │  matron-shim (matron/)   │
                                                                 │  real Lua 5.3            │
                                                                 │  • norns API reimpl.     │
                                                                 │  • runs your .lua script │
                                                                 └──────────────────────────┘
```

**Key idea:** your script runs in *real Lua 5.3* inside the container. The
norns API (`screen`, `enc`, `key`, `metro`, `clock`, `params`, `grid`, `arc`,
`midi`, `engine`, …) is reimplemented in [`matron/norns/`](matron/norns/) and
emits/consumes JSON over stdio. The browser is the display + input + audio.

---

## Quick start

```bash
# with the norns-up alias (see ~/.aliases):
norns-up           # starts the container
# or:
docker compose up --build

# then open:
open http://localhost:5151
# or: http://norns.local  (if /etc/hosts entry is set)
```

Stop with `norns-down` or `docker compose down`.

`docker-compose.yml` mounts `../current set` and `../new project` into the
container at `/scripts`, so all your norns scripts appear in the script picker.

### Without Docker (local)

Requires Node ≥ 20 and `lua5.3` (`brew install lua@5.3`):

```bash
npm install
npm run dev        # node --watch server/index.js → http://localhost:5151
```

---

## Using it

1. Open `http://localhost:5151`.
2. Pick a script and click **load**. Start with `examples/hello` or `awake`.
3. Drive it:
   | Input | Mouse | Keyboard |
   |-------|-------|----------|
   | E1 | wheel / drag on dial | `q` (−) `w` (+) |
   | E2 | wheel / drag on dial | `e` (−) `r` (+) |
   | E3 | wheel / drag on dial | `u` (−) `i` (+) |
   | K1 / K2 / K3 | click | hold `a` / `s` / `d` |
4. **Grid** — click **show**, then click cells.
5. **Arc** — click **show**, wheel or drag over rings.
6. **audio** checkbox — enable WebAudio (browser requires a user gesture first).
7. **MIDI** — Chrome/Edge: connect automatically; Firefox: click the **connect**
   button that appears and allow the permission dialog.
8. **▶ params** — expand the params panel to adjust all script parameters.
   Click **save** / **load** to persist presets (`pset 1–99`).
   Click **⊙** next to any param to MIDI-learn a CC.
9. **REPL** — evaluate Lua live, e.g. `params:set("cutoff", 800)` or
   `print(clock.get_tempo())`.
10. **↻** (reload button) — hot-reload the current script without a full rebuild.

---

## What works

### Phase 1–3 ✅

- **Screen** — full cairo-style path model (move/line/rect/arc/curve/text/level/transform…)
- **Encoders + keys** — mouse, drag, keyboard shortcuts
- **metro** — timer-based, Node-owned for accuracy
- **clock** — `run`/`sleep`/`sync`, tempo, coroutine-based
- **params** — all types (number/control/option/taper/binary/trigger/file/text)
  - browser params panel with live sliders/selects
  - pset save/load to disk (`/tmp/<script>/pset/<n>.pset`)
  - MIDI CC mapping + learn (stored in localStorage per script)
- **grid** + **arc** — LED buffers + click/drag input GUI
- **MIDI in/out** — WebMIDI; Firefox permission handled via connect button
- **engine: PolyPerc** — reimplemented in WebAudio (hz/amp/pw/release/cutoff/gain/pan)
- **include() / require** — script libs, parent-dir patterns, vendored norns libs
- **Vendored libs** — musicutil, er, sequins, lattice, formatters, lfo,
  pattern_time, ui, filters, gridbuf + stubs for fileselect/textentry

### Not yet (Phase 4+)

- ⛔ **softcut** — stub; Phase 4 (AudioWorklet)
- ⛔ **other engines** (PolySub, MollyThePoly, Ack, Glut…) — accepted silently
- ⛔ **audio.* levels/mixer** — stub
- ⛔ **crow, hid** — deep no-op proxy
- ⛔ **clock sources** MIDI/Link/crow — param registered, no effect
- ⛔ **SYSTEM/menu navigation** — stub

Full plan: [`docs/ROADMAP.md`](docs/ROADMAP.md) ·
API coverage: [`docs/NORNS-API-COVERAGE.md`](docs/NORNS-API-COVERAGE.md) ·
Script compat: [`docs/SCRIPT-COMPAT.md`](docs/SCRIPT-COMPAT.md) ·
Dev guide: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)

---

## Layout

```
norns-emulator/
├── server/index.js        Node gateway (http + ws + timers + spawns lua)
├── matron/
│   ├── matron.lua         entry: stdio loop + dispatch
│   └── norns/             reimplemented norns API (screen, clock, params, grid, …)
│       └── lib/           vendored norns libs (musicutil, er, sequins, …)
├── web/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── main.js        UI wiring + WebSocket client
│       ├── screen.js      canvas renderer (cairo op replay, 5× scale)
│       ├── params.js      params panel (slider/select/MIDI learn)
│       ├── grid.js        grid LED display + input
│       ├── arc.js         arc ring display + input
│       ├── audio.js       WebAudio engine host (PolyPerc)
│       └── midi.js        WebMIDI bridge
├── examples/              demo scripts (hello, gridtest)
├── scripts/sweep.mjs      compatibility test runner
├── docs/                  architecture, roadmap, API coverage, dev guide
└── Dockerfile · docker-compose.yml
```
