# norns API coverage

Status of the norns Lua API in the emulator. ✅ implemented · 🟡 partial ·
⛔ stub (no-op, won't error) · ❌ missing.

> **Update 2026-06-05:** Engines now PolyPerc + **MollyThePoly** + **Ack** + **Glut**
> (WebAudio, `web/js/`). New/fixed APIs: `poll` (real registry → browser engine polls
> via `{t:"engine_poll"}`), `params:set_save`/`get_save`, `params:set` fires action only
> on change (norns semantics; fixes self-clamp recursion), param formatters get a proper
> param-proxy (`param:get()` works), `softcut.pre_filter_*`, `norns.state.lib`,
> `g.device` is now a table (`.cols`/`.rows`), `util.round` nil-guard, `fileselect.pushd/popd`
> + "audio" ext keyword + bare-name require alias, `metro:start` re-entrancy (generation
> token), `_path.dust = /home/we/dust/`, HOME=/home/we. Mixer/tape audio graph + per-bus
> stereo meters. Touch via Pointer Events.

## Lifecycle & globals
| API | Status | Notes |
|-----|--------|-------|
| `init()` `redraw()` `cleanup()` | ✅ | called on load / input / unload |
| `enc(n,d)` `key(n,z)` | ✅ | from mouse + keyboard |
| `include(name)` | ✅ | script dir → parent dir → SCRIPTS_DIR → norns/lib → require |
| `require` | ✅ | package.path includes script dir + vendored libs |
| `norns.enc` | ✅ | callable metatable + .sens/.accel no-ops |
| `norns.key` | ✅ | dispatches to _G.key |
| `norns.crow` | ⛔ | deep no-op proxy |
| `norns.state` | 🟡 | name/path/data set; no real persistence |
| `norns.version.update` | ✅ | "250406" — passes version guards |
| `_menu` | ⛔ | stub (rebuild_params, set_mode, lock, unlock + metatable fallback) |
| `paths` / `_path` | 🟡 | point at scripts dir / /tmp |
| `print` | ✅ | routed to browser console |
| `inf` | ✅ | = math.huge |

## screen
| API | Status |
|-----|--------|
| clear, level, aa, line_width, line_cap/join, miter_limit | ✅ |
| move, move_rel, line, line_rel, rect, circle, arc, curve, close | ✅ |
| stroke, fill, pixel | ✅ |
| text, text_right, text_center, text_rotate, text_center_rotate | ✅ |
| font_size, font_face | 🟡 font_face ignored (default font only) |
| translate, rotate, save, restore | ✅ |
| text_extents | 🟡 estimated (~5px/char) |
| blend_mode, invert | ⛔ no-op |
| display_png, load_png, image/buffer ops, peek/poke | ❌ |

## controls / timing
| API | Status | Notes |
|-----|--------|-------|
| `metro` (init/start/stop, .time/.count/.event) | ✅ | timers owned by Node |
| `clock.run/sleep/sync/cancel` | ✅ | coroutine-based |
| `clock.get_beats/get_tempo/get_beat_sec/set_tempo` | ✅ | |
| clock source: internal | ✅ | |
| clock source: MIDI / Link / crow | ❌ | param registered, no effect (Phase 4) |

## params
| API | Status | Notes |
|-----|--------|-------|
| add{…}, add_number/option/control/taper/binary/trigger/file/text/separator/group | ✅ | |
| set/get/get_raw/set_raw/delta/set_action/get_action/string/bang | ✅ | |
| hide/show/visible/get_range/t/get_id/get_name/count | ✅ | |
| lookup_param | ✅ | alias for get_param |
| dump() | ✅ | full serialisable snapshot incl. values/min/max/options |
| write(n[,name]) / read(n) | ✅ | `/tmp/<script>/pset/<n>.pset`, tab-separated; optional `-- <name>` header |
| PSET list / delete / default | ✅ | panel lists saved psets (load/delete); `>` default pset auto-loads on script start (marker file) |
| built-in params | ✅ | clock_tempo, clock_source, clock_midi_out_div, clock_crow_* |
| PARAMS panel UI | ✅ | browser-side: slider/select/checkbox/trigger per type |
| MIDI CC mapping + learn | ✅ | ⊙ per param, localStorage persistence |

## devices
| API | Status | Notes |
|-----|--------|-------|
| `grid.connect`, `:led/:all/:refresh/:intensity/:rotation`, `.key` | ✅ | 16×8 default |
| `arc.connect`, `:led/:all/:segment/:refresh`, `.delta`, `.key` | ✅ | 4×64 |
| `midi.connect`, `.event`, `:send/:note_on/off/:cc/…`, to_msg/to_data | ✅ | WebMIDI |
| `midi.vports` | ✅ | 16 virtual ports |
| `hid` | ⛔ | stub |
| `crow` | ⛔ | deep no-op proxy |
| `osc.send` | 🟡 | forwarded + logged |
| `osc.event` | ❌ | |

## audio
| API | Status | Notes |
|-----|--------|-------|
| `engine.name=`, `engine.load`, `engine.<cmd>(args)` | ✅ | forwarded to WebAudio |
| WebAudio engine: **PolyPerc** | ✅ | hz/amp/pw/release/cutoff/gain/pan |
| other engines | 🟡 | accepted silently (Phase 4) |
| `audio.file_info(path)` | ✅ | WAV + AIFF header parser; normalises sample count to 48 kHz; returns (ch, frames_at_48k, sr) |
| `audio.level_adc_cut(v)` / `audio.level_eng_cut(v)` | ✅ | gate ADC (mic) and engine into softcut recording input |
| `audio.*` (other levels/monitor/reverb/comp) | ⛔ | stub |
| `softcut.*` — voice params (play/rec/rate/level/pan/loop/loop_start/loop_end/position/fade_time/rec_level/pre_level) | ✅ | AudioWorklet DSP |
| `softcut.*` — routing (buffer/level_input_cut/level_adc_cut) — **2-ch mix matrix** per voice | ✅ | |
| `softcut.*` — slew (level/pan/rate_slew_time) | 🟡 | accepted, instant (no interpolation) |
| `softcut.*` — post-filter (fc/rq/lp/hp/bp/br/dry) | ✅ | **TPT SVF** — stable at all sample rates incl. fc near Nyquist |
| `softcut.filter_fc/lp/hp/bp/br/rq` | ✅ | short aliases for older scripts (halfsecond etc.) |
| `softcut.*` — phase (event_phase/phase_quant/poll_start/stop_phase) | ✅ | worklet → ws → Lua callback |
| `softcut.*` — waveform (render_buffer/event_render) | ✅ | worklet downsamples buffer → ws → Lua; render queued until buffer has data |
| `softcut.buffer_clear / buffer_clear_channel / buffer_clear_region` | ✅ | |
| `softcut.buffer_copy_mono` | ✅ | intra-worklet copy |
| `softcut.buffer_read_mono / buffer_read_stereo` | ✅ | `/api/audio` fetch + decodeAudioData (any browser-decodable format) |
| `softcut.buffer_write_*` | ⛔ | stub (no export to file) |
| `softcut.voice_sync` | ⛔ | stub |
| `softcut.rec_offset` | ⛔ | stub |
| `softcut.level_cut_cut` | ⛔ | stub (cut→cut matrix) |
| **Mic / ADC input** | ✅ | getUserMedia → GainNode → softcut worklet; gain slider in UI |
| `poll` | ⛔ | stub |
| softcut reset on script load | ✅ | all voices stopped + audio routing zeroed in `core.cleanup()` |

## libs vendored under `matron/norns/lib/`
| lib | Status |
|-----|--------|
| `musicutil` | ✅ vendored + nil guards on note_num_to_name / note_num_to_freq / snap_note_to_array |
| `er` (euclidean) | ✅ vendored |
| `sequins` | ✅ vendored |
| `lattice` | ✅ vendored |
| `formatters` | ✅ vendored |
| `lfo` | ✅ vendored |
| `pattern_time` | ✅ vendored |
| `ui` | ✅ vendored |
| `filters` | ✅ vendored |
| `gridbuf` | ✅ vendored |
| `fileselect` | ✅ | browser file picker modal; callback called with path or "cancel" |
| `params:add_group(id, name, n)` | ✅ | both 2-arg (name, n) and 3-arg (id, name, n) norns API supported |
| `params:lookup_param(id):bang()` | ✅ | bang() method on individual param objects |
| `textentry` | ⛔ stub — calls callback(default) |
| `controlspec` | ✅ re-export + .def() alias |
| `util` | ✅ re-export |
| `tabutil` | ✅ re-export |
| `cjson` | 🟡 shim wrapping norns.json |

> Current `current set` script compatibility: **19/20 render** (2026-05-30)
> Tested scripts with audio: **awake** ✅ **firstlight** ✅ **concrete** ✅ (softcut: load/record/playback/waveform)
> See [`SCRIPT-COMPAT.md`](SCRIPT-COMPAT.md) for the full table.
