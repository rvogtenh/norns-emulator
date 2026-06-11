# Development guide

## Run

```bash
# Docker (recommended — bundles lua5.3)
norns-up                          # alias for: docker compose up -d
# or full rebuild:
docker compose up --build         # http://localhost:5151

# Local (needs Node ≥20 + lua5.3 on PATH)
brew install lua@5.3
npm install
npm run dev                       # auto-restarts server on change
```

Hot reload:
- **Browser code** (`web/`) — Hard Reload (Cmd+Shift+R) after JS/CSS changes.
- **Lua** (`matron/*.lua`) — the server polls `matron/` every 1 s and auto-restarts
  Lua on any change. No manual restart needed (Docker/macOS inotify workaround).
- **Server** (`server/index.js`) — `node --watch` erkennt Änderungen automatisch und startet neu (auch auf dem Bolt via Docker bind-mount).
- **A norns script** — click **↻** (reload button) in the panel.

## Repo map

| Path | What |
|------|------|
| `server/index.js`         | Node gateway: http, ws, `/api/scripts`, timer service, spawns Lua |
| `matron/matron.lua`       | shim entry: stdin loop + dispatch |
| `matron/norns/core.lua`   | global install, include(), script lifecycle (load/cleanup) |
| `matron/norns/*.lua`      | norns API modules (screen, metro, clock, params, grid, arc, midi, engine, …) |
| `matron/norns/lib/`       | vendored norns libraries (musicutil, er, sequins, …) |
| `web/js/screen.js`        | canvas renderer (cairo op replay at 5× scale) |
| `web/js/params.js`        | params panel UI (slider/select/checkbox/trigger + MIDI learn) |
| `web/js/grid.js`          | grid LED grid + click input |
| `web/js/arc.js`           | arc ring display + drag input |
| `web/js/audio.js`         | WebAudio host: PolyPerc engine + softcut worklet bridge + mic input |
| `web/js/softcut-worklet.js` | AudioWorklet processor: 6-voice softcut DSP, TPT SVF, render queue |
| `audio/`                  | User audio files — mapped to `/audio` inside container (`_path.audio`) |
| `web/js/midi.js`          | WebMIDI bridge (autoConnect + user-gesture connect button) |
| `web/js/main.js`          | UI wiring + WebSocket client |

## Wire protocol (Node ↔ Lua, browser ↔ Node)

All messages are newline-delimited JSON.

**Browser → Node → Lua:**
| Message | Fields | Effect |
|---------|--------|--------|
| `load` | `path` | load a script |
| `enc` | `n, d` | encoder delta |
| `key` | `n, z` | key press/release |
| `gridkey` | `dev, x, y, z` | grid key |
| `arcdelta` | `dev, n, d` | arc ring delta |
| `midi` | `dev, data` | MIDI bytes |
| `eval` | `code` | run Lua in REPL |
| `tempo` | `bpm` | set clock tempo |
| `param_set` | `id, value` | set a param by id |
| `param_delta` | `id, d` | delta a param |
| `pset_write` | `n` | save pset to disk |
| `pset_read` | `n` | load pset from disk |

**Lua → Node → Browser:**
| Message | Fields | Effect |
|---------|--------|--------|
| `frame` | `ops[]` | screen ops to render |
| `grid` | `cols, rows, data` | grid LED update |
| `arc` | `rings, leds, data` | arc LED update |
| `engine` | (varies) | WebAudio command |
| `midi_out` | `data` | MIDI bytes to send |
| `meta` | `name, path, params[]` | script loaded (after init) |
| `loading` | `name` | script starting (before init) |
| `param_update` | `id, value, str` | single param changed |
| `params_refresh` | `data[]` | all params (after pset load) |
| `log` | `level, msg` | print to browser console |
| `timer_set` | `id, sec, interval` | Node registers timer |
| `timer_clear` | `id` | Node cancels timer |
| `softcut` | `cmd, voice, args[]` | softcut command → AudioWorklet |
| `fileselect_open` | `path, ext, cb_id` | open browser file picker |
| `osc` | `to, path, args` | OSC send (logged) |

**Browser → Node → Lua (additional):**
| Message | Fields | Effect |
|---------|--------|--------|
| `softcut_phase` | `voice, pos` | worklet phase event → Lua callback |
| `softcut_render` | `ch, start, samples[]` | waveform data → Lua event_render |
| `fileselect_result` | `cb_id, path` | file picker result → Lua callback |

## Adding to the API

**A new screen op** — add `_norns.screen_*` emitter in `matron/norns/screen.lua`,
then a matching `case` in `web/js/screen.js`.

**A new param type** — extend `matron/norns/params.lua` + `dump()` + `web/js/params.js`
`_makeRow()` switch.

**A missing library** (`require "foo"` fails) — drop `foo.lua` in
`matron/norns/lib/` (vendor from monome/norns `lua/lib/` where possible).

**A new engine** — extend `web/js/audio.js`: handle the engine name and map
its commands to a WebAudio graph (model after `polyperc`).

**softcut DSP** — all DSP runs in `web/js/softcut-worklet.js` (AudioWorklet,
audio thread). Commands arrive via `port.onmessage` (_cmd); results (phase,
render, log) leave via `port.postMessage`. State: `this.buf[2]` (60 s PCM),
`this.voices[6]`. Filter: TPT SVF (`_svf`). Render: `_doRender` → queued
until `_hasData[ch]` is true (set by `_buffer_write` or first recording write).

**softcut + recording (mic)** — `audio.enableMicInput()` creates
`MediaStreamSource → GainNode → softcutNode`. The GainNode is required for
Firefox to activate the input. Gain controllable via the "mic in ×N" slider.
The 2-channel ADC mix matrix (`voice.inputLevels[2]`) is set per-voice by
`level_input_cut(adc_ch, voice, level)`.

**Waveform race condition (concrete)** — `init_reel` calls `render_buffer`
before the file is loaded. If the buffer already has data (mic recording active),
the render fires immediately with stale data and clears `waveviz_reel`.
Fix: after `_buffer_write`, `audio.js` calls `onEval("waveviz_reel=true …")`
via WebSocket so the viz flags are re-armed before the auto-render result arrives.

## Debugging

- **Browser console pane** (right panel) shows `print()`, `init`/`redraw`
  errors, and load failures — first stop.
- **Server logs** — `docker compose logs -f norns-emulator` for Node + Lua stderr.
- **Run the shim by hand** (no Docker):
  ```bash
  SCRIPTS_DIR="$PWD" printf '%s\n' \
    '{"t":"load","path":"'"$PWD"'/examples/hello/hello.lua","now":1000}' \
    '{"t":"enc","n":2,"d":5,"now":1100}' | lua5.3 matron/matron.lua
  ```
  You should see `frame` JSON lines with screen ops on stdout.

- **Compatibility sweep:**
  ```bash
  node tools/sweep.mjs
  ```

## pset persistence

psets are written to `/tmp/<scriptname>/pset/<n>.pset` inside the container.
They are **lost on container restart** unless you mount a volume:

```yaml
# docker-compose.yml
volumes:
  - ./data:/tmp   # persist psets across restarts
```

## Bolt Deployment

Docker Compose für den Udoo Bolt liegt separat (nicht in Dropbox):
`/mnt/ssd/docker/norns/docker-compose.yml`

Verwendet absolute Dropbox-Pfade für alle Volumes (server/, matron/, web/, audio/).
Netzwerk: `webnet`. URL: `https://raimund-bolt.sytes.net/soundworks/norns/`

Wichtige Besonderheiten gegenüber lokalem Setup:
- `BASE_PATH` in `main.js` und `audio.js` macht alle API/WS-URLs pfad-relativ
- `Permissions-Policy: midi=(self)` Header für Firefox WebMIDI
- WebSocket Keepalive-Ping alle 20s (server/index.js) verhindert Proxy-Timeout
- 200ms Audio-Lookahead in `playHz()` absorbiert WebSocket-Jitter

## Conventions

- Code comments + docs: **English**; communication with Raimund: **Deutsch**.
- Match norns' Lua API signatures exactly (see monome/norns `lua/`).
- Keep the Node↔Lua protocol minimal and JSON-only; one concern per message.
- Prefer **vendoring** monome's own Lua over re-writing (fidelity + less code).
- `meta` is sent **after** `init()` so all script params are available.
