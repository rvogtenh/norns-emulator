-- controlspec.lua — subset of norns controlspec (lua/lib/controlspec.lua).
-- Maps a normalized 0-1 control value to a ranged, optionally exponential value.

local ControlSpec = {}
ControlSpec.__index = ControlSpec

local function new(min, max, warp, step, default, units, quantum)
  local s = setmetatable({}, ControlSpec)
  s.minval = min or 0
  s.maxval = max or 1
  s.warp = warp or "lin"
  s.step = step or 0
  s.default = default or s.minval
  s.units = units or ""
  s.quantum = quantum or 0.01
  return s
end
ControlSpec.new = new

function ControlSpec:copy()
  return new(self.minval, self.maxval, self.warp, self.step, self.default, self.units, self.quantum)
end

-- 0-1 -> value
function ControlSpec:map(f)
  f = math.min(math.max(f, 0), 1)
  local v
  if self.warp == "exp" then
    local lo = self.minval == 0 and 0.0001 or self.minval
    v = lo * math.exp(math.log(self.maxval / lo) * f)
  else
    v = self.minval + (self.maxval - self.minval) * f
  end
  if self.step and self.step > 0 then
    v = math.floor(v / self.step + 0.5) * self.step
  end
  return v
end

-- value -> 0-1
function ControlSpec:unmap(v)
  local f
  if self.warp == "exp" then
    local lo = self.minval == 0 and 0.0001 or self.minval
    f = math.log(v / lo) / math.log(self.maxval / lo)
  else
    f = (v - self.minval) / (self.maxval - self.minval)
  end
  return math.min(math.max(f, 0), 1)
end

-- Common presets used across the script library.
ControlSpec.UNIPOLAR = new(0, 1, "lin", 0, 0)
ControlSpec.BIPOLAR  = new(-1, 1, "lin", 0, 0)
ControlSpec.FREQ     = new(20, 20000, "exp", 0, 440, "Hz")
ControlSpec.LOFREQ   = new(0.1, 100, "exp", 0, 1, "Hz")
ControlSpec.MIDFREQ  = new(25, 12000, "exp", 0, 440, "Hz")
ControlSpec.HIFREQ   = new(100, 20000, "exp", 0, 8000, "Hz")
ControlSpec.WIDEFREQ = new(0.1, 20000, "exp", 0, 440, "Hz")
ControlSpec.DB       = new(-60, 24, "lin", 0, 0, "dB")
ControlSpec.AMP      = new(0, 1, "lin", 0, 0)
ControlSpec.PHASE    = new(0, math.pi, "lin", 0, 0)
ControlSpec.RQ       = new(0.001, 2, "exp", 0, 0.707)
ControlSpec.PAN      = new(-1, 1, "lin", 0, 0)
ControlSpec.DELAY    = new(0.0001, 1, "exp", 0, 0.1, "s")

-- ControlSpec.def{min,max,warp,step,default,units,quantum} constructor alias
function ControlSpec.def(t)
  return new(t.min, t.max, t.warp, t.step, t.default, t.units, t.quantum)
end

-- helpers used by params:add_control short forms
function ControlSpec.unipolar() return ControlSpec.UNIPOLAR:copy() end
function ControlSpec.bipolar() return ControlSpec.BIPOLAR:copy() end
function ControlSpec.freq() return ControlSpec.FREQ:copy() end
function ControlSpec.db() return ControlSpec.DB:copy() end
function ControlSpec.amp() return ControlSpec.AMP:copy() end
function ControlSpec.pan() return ControlSpec.PAN:copy() end

return ControlSpec
