# Architecture

The emulator reproduces the structure of real norns closely enough that the
*same* Lua scripts run, while redirecting all hardware I/O to the browser.

## Real norns vs. the emulator

| norns (hardware)                     | norns-emulator                              |
|--------------------------------------|---------------------------------------------|
| **matron** (C, embeds Lua 5.3)       | **matron-shim**: real Lua 5.3, native funcs reimplemented in Lua (`matron/norns/`) |
| OLED via cairo                       | Canvas 2D, cairo-style op replay (`web/js/screen.js`) |
| encoders / keys (GPIO)               | mouse + keyboard (`web/js/main.js`)         |
| **crone** (SuperCollider engines)    | **WebAudio** host (`web/js/audio.js`) — PolyPerc reimplemented |
| **serialosc** + grid/arc (USB/OSC)   | virtual grid/arc in the browser (`web/js/grid.js`, `arc.js`) |
| MIDI (ALSA)                          | **WebMIDI** (`web/js/midi.js`)              |
| **maiden** (web editor, ws to matron)| script picker + Lua REPL in the panel       |
| Ableton Link / system clock          | Node-owned timers; internal clock in Lua    |

## Processes

```
node server/index.js
  ├── HTTP  : serves web/, GET /api/scripts
  ├── WS    : /ws  ↔ browser
  ├── timers: setInterval/Timeout for metro & clock (accuracy lives in Node)
  └── child : lua5.3 matron/matron.lua  (stdio JSON)
```

Only **one** matron child runs; multiple browser tabs share it (single-user,
like a real norns). If the child dies it is respawned.

## Why real Lua (not Lua-in-JS)

norns' API is *mostly written in Lua already*; matron (C) only provides a
small native boundary (the `_norns.*` functions). By running real Lua 5.3 and
reimplementing that boundary, we:

- run unmodified script logic, including `require`/`include` of libraries,
- match norns' Lua 5.3 semantics exactly (integer division, `//`, bit ops),
- keep the door open to *vendoring norns' own `lua/core` files* later for even
  higher fidelity (see roadmap Phase 2+).

## Wire protocol (newline-delimited JSON)

### Lua → browser (via Node stdout → ws)
| `t`         | payload                                   | meaning |
|-------------|-------------------------------------------|---------|
| `ready`     | `version`                                 | shim booted |
| `frame`     | `ops: [[op,args…], …]`                     | screen frame (on `screen.update()`) |
| `grid`      | `dev, cols, rows, data[]`                 | grid LED buffer |
| `grid_meta` | `dev, cols, rows`                         | grid size announce |
| `arc`       | `dev, rings, leds, data[]`                | arc LED buffer |
| `engine`    | `action(load/command), name, cmd, args`   | engine call → WebAudio |
| `midi_out`  | `dev, data[]`                             | MIDI bytes to send |
| `osc`       | `to, path, args`                          | OSC send (logged) |
| `meta`      | `name, path, params[]`                     | loaded script info |
| `log`       | `level(info/error/print), msg`            | console output |

### Node-internal (Lua → Node, not forwarded)
| `t`                | payload          | meaning |
|--------------------|------------------|---------|
| `timer_set`        | `id, sec, interval` | schedule a metro/clock timer |
| `timer_clear`      | `id`             | cancel a timer |
| `clear_all_timers` | —                | on script cleanup |

### Browser → Lua (via ws → Node stdin)
| `t`        | payload          | calls in Lua |
|------------|------------------|--------------|
| `enc`      | `n, d`           | `enc(n,d)` then redraw |
| `key`      | `n, z`           | `key(n,z)` then redraw |
| `gridkey`  | `dev, x, y, z`   | `g.key(x,y,z)` then redraw |
| `arcdelta` | `dev, n, d`      | `a.delta(n,d)` then redraw |
| `midi`     | `dev, data[]`    | `m.event(data)` |
| `timer`    | `id`             | fire scheduled metro/clock cb |
| `load`     | `path`           | load + init a script |
| `eval`     | `code`           | run Lua in the REPL |
| `tempo`    | `bpm`            | `clock.set_tempo` |
| `cleanup`  | —                | teardown current script |

Every Node→Lua message carries `now` (ms) so the Lua clock has a time source.

## The screen model

norns draws with a cairo path: `move`/`line`/`rect`/`arc`/`curve` build a path,
`stroke()`/`fill()` render it with the current `level` (0–15 → grayscale),
`text()` draws immediately at the current point and advances it. Ops accumulate
in the shim and flush to the browser on `screen.update()`, where
`web/js/screen.js` replays them onto a 128×64 canvas scaled ×6.

## Timing

metro and clock both schedule through `host.timer_set` → Node `setTimeout`/
`setInterval` → `{t:"timer",id}` back to Lua. Node owns the wall clock (accurate
timers, no busy-waiting in Lua). The Lua `clock` computes beats from
`tempo` and the injected `now`, supporting `clock.sync(beats)` and
`clock.sleep(sec)` via coroutines.

## Redraw policy

The shim auto-calls `redraw()` after `enc`/`key`/`gridkey`/`arcdelta` (a small,
documented divergence from hardware norns, which never auto-redraws) so that
scripts feel responsive even if a handler forgets to redraw. metro/clock and
MIDI callbacks do **not** auto-redraw — sequencer-style scripts drive their own
redraw clock, exactly as on hardware.
