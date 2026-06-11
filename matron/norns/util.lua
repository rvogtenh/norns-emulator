-- util.lua — subset of norns' util library (lua/lib/util.lua).
-- Common helpers used by the majority of scripts.

local util = {}

function util.clamp(n, lo, hi)
  if n == nil or lo == nil or hi == nil then return n or 0 end
  return math.min(math.max(n, lo), hi)
end

function util.linlin(slo, shi, dlo, dhi, f)
  if slo == nil or shi == nil or dlo == nil or dhi == nil or f == nil then return dlo or 0 end
  if f <= slo then return dlo end
  if f >= shi then return dhi end
  return (f - slo) / (shi - slo) * (dhi - dlo) + dlo
end

function util.linexp(slo, shi, dlo, dhi, f)
  if f <= slo then return dlo end
  if f >= shi then return dhi end
  return math.exp(math.log(dhi / dlo) * (f - slo) / (shi - slo)) * dlo
end

function util.explin(slo, shi, dlo, dhi, f)
  if f <= slo then return dlo end
  if f >= shi then return dhi end
  return (math.log(f / slo)) / (math.log(shi / slo)) * (dhi - dlo) + dlo
end

function util.expexp(slo, shi, dlo, dhi, f)
  if f <= slo then return dlo end
  if f >= shi then return dhi end
  return math.exp(math.log(dhi / dlo) * math.log(f / slo) / math.log(shi / slo)) * dlo
end

function util.round(number, quant)
  number = number or 0  -- nil-guard: emulator state may be uninitialised at first redraw
  quant = quant or 1
  if quant == 0 then return number end
  return math.floor(number / quant + 0.5) * quant
end

function util.round_up(number, quant)
  quant = quant or 1
  if quant == 0 then return number end
  return math.ceil(number / quant) * quant
end

function util.wrap(n, lo, hi)
  if hi == nil then hi = lo; lo = 1 end
  return (n - lo) % (hi - lo + 1) + lo
end

function util.wrap_max(n, max)
  return ((n % max) + max) % max
end

function util.clamp_max(n, max)
  return n % max
end

function util.degs_to_rads(degrees) return degrees * (math.pi / 180.0) end
function util.rads_to_degs(radians) return radians * (180.0 / math.pi) end

function util.dbamp(db)
  if db == -math.huge then return 0.0 end
  return 10.0 ^ (db / 20.0)
end
function util.ampdb(amp)
  if amp <= 0 then return -math.huge end
  return 20.0 * math.log(amp, 10)
end

function util.time()
  -- wall-clock seconds (float). Node injects host time; fall back to os.clock.
  local host = package.loaded["norns.host"]
  if host then return host.now() / 1000.0 end
  return os.clock()
end

function util.s_to_hms(s)
  s = math.floor(s)
  return string.format("%02d:%02d:%02d", math.floor(s / 3600), math.floor((s % 3600) / 60), s % 60)
end

function util.file_exists(name)
  local f = io.open(name, "r")
  if f then f:close(); return true end
  return false
end

function util.make_dir(path)
  os.execute('mkdir -p "' .. tostring(path) .. '"')
end

function util.scandir(directory)
  local t = {}
  local p = io.popen('ls -1 "' .. directory .. '" 2>/dev/null')
  if p then
    for line in p:lines() do t[#t + 1] = line end
    p:close()
  end
  return t
end

function util.acronym(s)
  return s:gsub("(%w)%w*%W*", "%1"):upper()
end

function util.trim_string_to_width(str, width)
  -- crude approximation (~5px per char at default font); refined client-side
  local max = math.floor(width / 5)
  if #str <= max then return str end
  return str:sub(1, max)
end

return util
