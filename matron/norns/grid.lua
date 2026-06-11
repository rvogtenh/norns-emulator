-- grid.lua — norns grid API (virtual monome grid in the browser).
-- One virtual device by default (16x8 / 128). LED buffer is flushed to the
-- browser on :refresh(); key presses arrive from the browser and dispatch to
-- the device's .key callback.

local host = require("norns.host")

local Grid = {}
Grid.__index = Grid

local grid = {}
grid.devices = {}

local function make(id, cols, rows)
  local g = setmetatable({}, Grid)
  g.id = id
  g.cols = cols
  g.rows = rows
  g.name = "virtual"
  -- non-nil so scripts can detect grid as connected; a table (not a string)
  -- because some scripts (e.g. mlre) read g.device.cols / g.device.rows.
  g.device = { name = "virtual", cols = cols, rows = rows }
  g.key = nil          -- script sets this: function(x, y, z)
  g._rotation = 0
  g.buffer = {}        -- [(y-1)*cols + x] = level
  for i = 1, cols * rows do g.buffer[i] = 0 end
  return g
end

function Grid:led(x, y, val, rel)
  if x < 1 or x > self.cols or y < 1 or y > self.rows then return end
  local i = (y - 1) * self.cols + x
  if rel then val = (self.buffer[i] or 0) + val end
  self.buffer[i] = math.min(math.max(math.floor(val or 0), 0), 15)
end

function Grid:all(val)
  val = math.min(math.max(math.floor(val or 0), 0), 15)
  for i = 1, self.cols * self.rows do self.buffer[i] = val end
end

function Grid:refresh()
  host.send({ t = "grid", dev = self.id, cols = self.cols, rows = self.rows, data = self.buffer })
end

function Grid:intensity(_) end
function Grid:tilt_enable(_, _) end

function Grid:rotation(val)
  if val ~= nil then self._rotation = val end
  return self._rotation
end

-- grid.connect(n) -> device
function grid.connect(n)
  n = n or 1
  if not grid.devices[n] then
    grid.devices[n] = make(n, 16, 8)
  end
  return grid.devices[n]
end

-- called by the dispatcher on incoming key events from the browser
function grid._dispatch_key(dev, x, y, z)
  local g = grid.devices[dev] or grid.devices[1]
  if g and g.key then
    local ok, err = pcall(g.key, x, y, z)
    if not ok then host.send({ t = "log", level = "error", msg = "grid.key: " .. tostring(err) }) end
  end
end

function grid.cleanup()
  for _, g in pairs(grid.devices) do g.key = nil end
end

-- vports: norns virtual port table — scripts use grid.vports[1].name to detect device type
grid.vports = setmetatable({}, {
  __index = function(_, i)
    if i == 1 then return { name = "virtual", id = 1 } end
    return { name = "none", id = i }
  end
})

-- announce default device so the UI can size itself
function grid.announce()
  host.send({ t = "grid_meta", dev = 1, cols = 16, rows = 8 })
end

return grid
