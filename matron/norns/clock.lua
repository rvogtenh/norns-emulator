-- clock.lua — norns clock API (beat-synced coroutines).
-- Implements the internal clock source: tempo in BPM, run/sleep/sync/cancel,
-- get_beats / get_tempo / get_beat_sec. Coroutines sleep via the Node timer
-- service and resume on fire. Ableton Link / MIDI sources are out of scope.

local host = require("norns.host")

local clock = {}

clock.threads = {}       -- coroutine -> { timer = id }
local id_counter = 0

clock.tempo = 110
clock._origin_ms = 0     -- host time when transport beat 0 occurred
clock._running = true

local function now_ms() return host.now() end

-- current beat position (float)
function clock.get_beats()
  return (now_ms() - clock._origin_ms) / 1000.0 * clock.tempo / 60.0
end

function clock.get_tempo() return clock.tempo end
function clock.get_beat_sec() return 60.0 / clock.tempo end

function clock.set_tempo(bpm)
  -- preserve current beat position across tempo change
  local beat = clock.get_beats()
  clock.tempo = bpm
  clock._origin_ms = now_ms() - (beat * 60.0 / bpm) * 1000.0
end

-- internal: schedule resume of a coroutine after `sec` seconds
local function schedule_resume(co, sec)
  local entry = clock.threads[co]
  if not entry then return end
  if entry.timer then host.timer_clear(entry.timer); entry.timer = nil end
  entry.timer = host.timer_set(math.max(0, sec), false, function()
    entry.timer = nil
    clock._resume(co)
  end)
end

function clock._resume(co, ...)
  if coroutine.status(co) == "dead" then clock.threads[co] = nil; return end
  local ok, mode, arg = coroutine.resume(co, ...)
  if not ok then
    host.send({ t = "log", level = "error", msg = "clock thread: " .. tostring(mode) })
    clock.threads[co] = nil
    return
  end
  if coroutine.status(co) == "dead" then
    clock.threads[co] = nil
    return
  end
  -- the coroutine yielded a sleep request
  if mode == "sleep" then
    schedule_resume(co, arg)
  elseif mode == "sync" then
    local beat = arg
    local cur = clock.get_beats()
    local target = math.ceil(cur / beat) * beat
    if target <= cur + 1e-9 then target = target + beat end
    local sec = (target - cur) * 60.0 / clock.tempo
    schedule_resume(co, sec)
  end
end

-- clock.run(fn, ...) -> id ; start a coroutine
function clock.run(f, ...)
  id_counter = id_counter + 1
  local co = coroutine.create(f)
  clock.threads[co] = { id = id_counter, co = co }
  -- store id->co for cancel
  clock.threads[co].args = { ... }
  local args = { ... }
  clock._resume(co, table.unpack(args))
  return co
end

-- clock.sleep(seconds) — yields from within a clock coroutine
function clock.sleep(sec)
  return coroutine.yield("sleep", sec)
end

-- clock.sync(beats) — sleep until the next multiple of `beats`
function clock.sync(beat)
  return coroutine.yield("sync", beat or 1)
end

-- clock.cancel(id) — id is the coroutine returned by run
function clock.cancel(co)
  local entry = clock.threads[co]
  if entry and entry.timer then host.timer_clear(entry.timer) end
  clock.threads[co] = nil
end

function clock.cleanup()
  for co, entry in pairs(clock.threads) do
    if entry.timer then host.timer_clear(entry.timer) end
  end
  clock.threads = {}
end

-- transport stubs (scripts may call these)
clock.transport = { start = function() end, stop = function() end, reset = function() end }
clock.link = { set_tempo = function(t) clock.set_tempo(t) end, set_quantum = function() end }

clock.internal = { set_tempo = function(t) clock.set_tempo(t) end, start = function() end, stop = function() end }

function clock.add_params() end -- params for clock source; no-op in emulator

return clock
