-- host.lua — bridge between the Lua matron-shim and the Node gateway.
-- All outbound messages and timer scheduling go through here so that
-- metro / clock / screen / devices share one mechanism.

local json = require("norns.json")

local host = {}

host._now_ms = 0          -- updated on every inbound message
local timer_id = 0
local timer_cbs = {}      -- id -> callback(id)

-- Write one JSON line to stdout (consumed by the Node gateway).
-- Use io.stdout explicitly (not io.write/default output): norns scripts call
-- io.output(file) — e.g. params:write during collection save — which would
-- otherwise redirect matron's outbound messages into a script file.
-- If stdout is closed (pipe broken) exit cleanly instead of crashing.
function host.send(obj)
  local ok, err = pcall(function()
    io.stdout:write(json.encode(obj))
    io.stdout:write("\n")
    io.stdout:flush()
  end)
  if not ok then os.exit(0) end  -- pipe gone: exit so Node can respawn
end

function host.now()
  return host._now_ms
end

-- Schedule a timer. Node owns the actual clock and will call host.fire(id).
-- Returns an id usable with host.timer_clear.
function host.timer_set(sec, interval, cb)
  timer_id = timer_id + 1
  local id = timer_id
  timer_cbs[id] = cb
  host.send({ t = "timer_set", id = id, sec = sec, interval = interval and true or false })
  return id
end

function host.timer_clear(id)
  if id == nil then return end
  timer_cbs[id] = nil
  host.send({ t = "timer_clear", id = id })
end

-- Called by the dispatcher when Node reports a timer fired.
function host.fire(id)
  local cb = timer_cbs[id]
  if cb then
    -- one-shots are removed by Node; clear our side defensively for non-repeating
    local ok, err = pcall(cb, id)
    if not ok then host.send({ t = "log", level = "error", msg = "timer cb: " .. tostring(err) }) end
  end
end

function host.clear_all_timers()
  timer_cbs = {}
  host.send({ t = "clear_all_timers" })
end

return host
