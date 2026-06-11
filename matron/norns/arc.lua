-- arc.lua — norns arc API (virtual monome arc: 4 rings x 64 LEDs).

local host = require("norns.host")

local Arc = {}
Arc.__index = Arc

local arc = {}
arc.devices = {}
local RINGS, LEDS = 4, 64

local function make(id)
  local a = setmetatable({}, Arc)
  a.id = id
  a.name = "virtual"
  a.delta = nil        -- function(ring, delta)
  a.key = nil          -- function(ring, z) (some arcs have a push)
  a.buffer = {}        -- [(ring-1)*64 + x] = level
  for i = 1, RINGS * LEDS do a.buffer[i] = 0 end
  return a
end

function Arc:led(ring, x, val, rel)
  if ring < 1 or ring > RINGS then return end
  -- wrap LED index around the ring (norns hardware wraps modulo 64):
  -- scripts like concrete address LEDs with negative / >64 indices.
  x = ((math.floor(x) - 1) % LEDS) + 1
  local i = (ring - 1) * LEDS + x
  if rel then val = (self.buffer[i] or 0) + val end
  self.buffer[i] = math.min(math.max(math.floor(val or 0), 0), 15)
end

function Arc:all(val)
  val = math.min(math.max(math.floor(val or 0), 0), 15)
  for i = 1, RINGS * LEDS do self.buffer[i] = val end
end

function Arc:segment(ring, from, to, level)
  -- light an arc segment between angles `from`..`to` radians at `level`
  local m = LEDS
  local function led_pos(rads) return math.floor((rads / (2 * math.pi)) * m) % m end
  local a1, a2 = led_pos(from), led_pos(to)
  local i = a1
  while true do
    self:led(ring, i + 1, level)
    if i == a2 then break end
    i = (i + 1) % m
  end
end

function Arc:refresh()
  host.send({ t = "arc", dev = self.id, rings = RINGS, leds = LEDS, data = self.buffer })
end

function Arc:intensity(_) end

function arc.connect(n)
  n = n or 1
  if not arc.devices[n] then arc.devices[n] = make(n) end
  return arc.devices[n]
end

function arc._dispatch_delta(dev, ring, d)
  local a = arc.devices[dev] or arc.devices[1]
  if a and a.delta then
    local ok, err = pcall(a.delta, ring, d)
    if not ok then host.send({ t = "log", level = "error", msg = "arc.delta: " .. tostring(err) }) end
  end
end

function arc._dispatch_key(dev, ring, z)
  local a = arc.devices[dev] or arc.devices[1]
  if a and a.key then pcall(a.key, ring, z) end
end

function arc.cleanup()
  for _, a in pairs(arc.devices) do a.delta = nil; a.key = nil end
end

return arc
