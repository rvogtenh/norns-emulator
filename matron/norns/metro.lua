-- metro.lua — norns metro API (repeating timers).
-- Backed by the Node-owned timer service via host.timer_set.

local host = require("norns.host")

local Metro = {}
Metro.__index = Metro

local metro = {}
metro.num = 36
metro.metros = {}
metro.available = {}

function Metro.new(id)
  local m = setmetatable({}, Metro)
  m.id = id
  m.props = { time = 1, count = -1, event = nil }
  m.stage = 0
  m.timer = nil
  m.is_running = false
  return m
end

function Metro:start(time, count, stage)
  if type(time) == "table" then
    if time.time then self.props.time = time.time end
    if time.count then self.props.count = time.count end
    if time.event then self.props.event = time.event end
    stage = time.stage
  else
    if time then self.props.time = time end
    if count then self.props.count = count end
  end
  self.stage = stage or 1
  self:stop()
  self.is_running = true
  -- Generation token: a script may call :start() again from inside the event
  -- callback (variable-interval one-shot chains, e.g. glut's pattern playback).
  -- That restart resets stage and installs a new timer; without this guard the
  -- *outer* (now-stale) callback would continue past the event and increment
  -- stage / hit the count limit, stopping the freshly-started timer.
  self._gen = (self._gen or 0) + 1
  local gen = self._gen
  self.timer = host.timer_set(self.props.time, true, function()
    if not self.is_running or self._gen ~= gen then return end
    local s = self.stage
    if self.props.event then self.props.event(s) end
    if self._gen ~= gen then return end  -- event restarted this metro; leave new state intact
    self.stage = self.stage + 1
    if self.props.count and self.props.count > 0 and self.stage > self.props.count then
      self:stop()
    end
  end)
end

function Metro:stop()
  if self.timer then host.timer_clear(self.timer); self.timer = nil end
  self.is_running = false
end

-- property proxy so scripts can do m.time = x, m.event = fn, m.count = n
local mt = {
  __index = function(self, k)
    if k == "time" or k == "count" or k == "event" then return self.props[k] end
    return Metro[k]
  end,
  __newindex = function(self, k, v)
    if k == "time" or k == "count" or k == "event" then
      self.props[k] = v
    else
      rawset(self, k, v)
    end
  end,
}

local function wrap(m) return setmetatable(m, mt) end

-- init([callback|table], time, count)
function metro.init(arg, time, count)
  for i = 1, metro.num do
    if metro.metros[i] == nil then
      local m = Metro.new(i)
      if type(arg) == "function" then
        m.props.event = arg
        if time then m.props.time = time end
        if count then m.props.count = count end
      elseif type(arg) == "table" then
        m.props.event = arg.event
        m.props.time = arg.time or 1
        m.props.count = arg.count or -1
      end
      metro.metros[i] = wrap(m)
      return metro.metros[i]
    end
  end
  print("metro.init: no metros available")
  return nil
end

function metro.free(id)
  if metro.metros[id] then metro.metros[id]:stop(); metro.metros[id] = nil end
end

function metro.free_all()
  for i = 1, metro.num do
    if metro.metros[i] then metro.metros[i]:stop() end
  end
  metro.metros = {}
end

-- legacy index access metro[i]
setmetatable(metro, {
  __index = function(_, k)
    if type(k) == "number" then
      if not metro.metros[k] then
        local m = Metro.new(k)
        metro.metros[k] = wrap(m)
      end
      return metro.metros[k]
    end
  end,
})

return metro
