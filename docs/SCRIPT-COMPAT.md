# Script compatibility (current set)

Result of `node scripts/sweep.mjs` — loads every script, sends one encoder turn,
counts rendered screen frames. "OK" = script booted far enough to draw at least
one frame within 1.2 s.

Last run: **2026-05-30** — **19 / 20 render**

> **Update 2026-06-05 (manuell verifiziert mit Audio/Interaktion):** Voll spielbar inkl.
> Ton: constellations, cranes, compass (softcut rec), mlr, mlre, molly_the_poly,
> corners, animator (alle MollyThePoly), **cyrene** (Ack-Engine, 808-Kit auto-load),
> **glut** (Glut-Engine, granular, inkl. Pattern-Recording). Neue WebAudio-Engines:
> MollyThePoly, Ack, Glut (`web/js/`). Sample-Loading (fileselect) funktioniert nun.

| Script | Renders | Notes |
|--------|:-------:|-------|
| examples/hello | ✅ | — |
| examples/gridtest | ✅ | — |
| awake | ✅ | 22 frames; non-fatal nb init warning |
| animator | ✅ | — |
| buoys | ✅ | — |
| cheat_codes_2 | ✅ | minor nb method warning (non-fatal) |
| compass | ✅ | — |
| concrete | ✅ | minor warning in concrete_lfo (non-fatal) |
| constellations | ✅ | — |
| corners | ✅ | 20 frames |
| cranes | ✅ | — |
| cyrene | ✅ | 22 frames |
| eterna | `--` | granular sampler — no screen.update() without audio files; works when used interactively |
| firstlight | ✅ | — |
| glut | ✅ | — |
| mlr | ✅ | — |
| mlre | ✅ | minor warning (non-fatal) |
| molly_the_poly | ✅ | — |
| pitter-patter | ✅ | minor nb warning (non-fatal) |
| vials | ✅ | — |

## Remaining non-fatal init warnings (scripts still render)

| Script | Warning source | Impact |
|--------|---------------|--------|
| cheat_codes_2 | nb calling unimplemented method | cosmetic — script runs |
| concrete | concrete_lfo.lua:549 nil method | cosmetic |
| mlre | mlre:2985 nil method | cosmetic |
| pitter-patter | nb/lib/player nil method | cosmetic |

## eterna

Eterna is a granular sampler that reads audio files from disk. Without audio
files mounted at the expected paths it never calls `screen.update()` within the
sweep timeout. The script loads and initialises cleanly — it simply has nothing
to draw. Use it interactively once audio files are available.

## Re-running

```bash
norns-up          # or: docker compose up -d
node scripts/sweep.mjs
```

Matron-side changes (`matron/`) need a container restart; browser-side (`web/`)
just need a page reload.
