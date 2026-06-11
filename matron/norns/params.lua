-- params.lua — norns paramset (subset of lua/core/paramset.lua + param types).
-- Stores parameters, applies clamping/mapping per type, runs actions.
-- The PARAMS edit menu UI is rendered by core/menu (basic) in the emulator.

local controlspec = require("norns.controlspec")

local paramset = {}
paramset.__index = paramset

-- type ids
local tNUMBER, tOPTION, tCONTROL, tFILE, tTAPER, tTRIGGER, tGROUP, tSEPARATOR, tTEXT, tBINARY =
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10

local function new_param(p)
  p.action = p.action or function() end
  -- get(): current mapped value — mirrors paramset:get for a single param.
  p.get = function()
    if p.t == tCONTROL and p.controlspec then return p.controlspec:map(p.raw) end
    return p.value
  end
  -- bang(): trigger action with current value — mirrors norns param object API
  p.bang = function()
    if p.action then p.action(p.get()) end
  end
  -- set(v, silent): per-type write + action — mirrors paramset:set but on the
  -- param object itself. Real norns param objects expose :set; some scripts
  -- (e.g. Cheat Codes 2's collection loader) call params.params[i]:set(v),
  -- which would crash without this. Defined for colon-call (self == p).
  p.set = function(_, v, silent)
    if p.t == tCONTROL then
      p.raw = p.controlspec:unmap(v)
    elseif p.t == tNUMBER then
      p.value = math.min(math.max(v, p.min), p.max)
    elseif p.t == tOPTION then
      p.value = math.min(math.max(math.floor(v), 1), math.max(1, p.count))
    elseif p.t == tBINARY then
      p.value = v ~= 0 and 1 or 0
    else
      p.value = v
    end
    if not silent and p.action then p.action(p.get()) end
  end
  return p
end

function paramset.new(id, name)
  local ps = setmetatable({}, paramset)
  ps.id = id or "params"
  ps.name = name or ""
  ps.params = {}     -- ordered list
  ps.count = 0
  ps.lookup = {}     -- id -> index
  ps.hidden = {}
  ps.group = 0
  return ps
end

function paramset:add_separator(name)
  self.count = self.count + 1
  self.params[self.count] = new_param({ t = tSEPARATOR, id = "separator" .. self.count, name = name or "" })
end

-- add_group supports both old (name, n) and new (id, name, n) norns API.
function paramset:add_group(id_or_name, name_or_n, n)
  local id, name
  if n ~= nil then
    -- new style: add_group(id, name, n)
    id   = id_or_name
    name = name_or_n
  else
    -- old style: add_group(name, n)
    id   = "group" .. (self.count + 1)
    name = id_or_name
    n    = name_or_n
  end
  self.count = self.count + 1
  self.params[self.count] = new_param({ t = tGROUP, id = id or ("group"..self.count), name = name or "", n = n or 0 })
  if id then self.lookup[id] = self.count end
end

local function register(self, p)
  self.count = self.count + 1
  self.params[self.count] = new_param(p)
  if p.id then self.lookup[p.id] = self.count end
end

-- generic add{ type=, id=, name=, ... }
function paramset:add(args)
  local t = args.type
  if t == "number" then
    self:add_number(args.id, args.name, args.min, args.max, args.default, args.formatter, args.wrap)
  elseif t == "option" then
    self:add_option(args.id, args.name, args.options, args.default)
  elseif t == "control" then
    self:add_control(args.id, args.name, args.controlspec, args.formatter)
  elseif t == "taper" then
    self:add_taper(args.id, args.name, args.min, args.max, args.default, args.k, args.units)
  elseif t == "file" then
    self:add_file(args.id, args.name, args.path)
  elseif t == "text" then
    self:add_text(args.id, args.name, args.text)
  elseif t == "trigger" then
    self:add_trigger(args.id, args.name)
  elseif t == "binary" then
    self:add_binary(args.id, args.name, args.behavior, args.default)
  elseif t == "separator" then
    self:add_separator(args.name)
  elseif t == "group" then
    self:add_group(args.name, args.n)
  else
    register(self, { t = tNUMBER, id = args.id, name = args.name, min = 0, max = 1, value = 0 })
  end
  if args.action then self:set_action(args.id, args.action) end
end

function paramset:add_number(id, name, min, max, default, formatter, wrap)
  min = min or 0; max = max or 1
  register(self, { t = tNUMBER, id = id, name = name or id, min = min, max = max,
    value = default or min, default = default or min, formatter = formatter, wrap = wrap })
end

function paramset:add_option(id, name, options, default)
  register(self, { t = tOPTION, id = id, name = name or id, options = options or {},
    value = default or 1, default = default or 1, count = #(options or {}) })
end

function paramset:add_control(id, name, cs, formatter)
  cs = cs or controlspec.UNIPOLAR:copy()
  register(self, { t = tCONTROL, id = id, name = name or id, controlspec = cs,
    raw = cs:unmap(cs.default), default = cs.default, formatter = formatter })
end

function paramset:add_taper(id, name, min, max, default, k, units)
  local cs = controlspec.new(min or 0, max or 1, "lin", 0, default or min or 0, units)
  register(self, { t = tCONTROL, id = id, name = name or id, controlspec = cs,
    raw = cs:unmap(cs.default), default = cs.default })
end

function paramset:add_file(id, name, path)
  register(self, { t = tFILE, id = id, name = name or id, value = path or "-", default = path or "-" })
end

function paramset:add_text(id, name, txt)
  register(self, { t = tTEXT, id = id, name = name or id, value = txt or "", default = txt or "" })
end

function paramset:add_trigger(id, name)
  register(self, { t = tTRIGGER, id = id, name = name or id })
end

function paramset:add_binary(id, name, behavior, default)
  register(self, { t = tBINARY, id = id, name = name or id, behavior = behavior or "toggle",
    value = default or 0, default = default or 0 })
end

-- ---- access --------------------------------------------------------------
function paramset:get_param(id)
  local idx = type(id) == "number" and id or self.lookup[id]
  return self.params[idx], idx
end

function paramset:t(id)
  local p = self:get_param(id)
  return p and p.t or nil
end

function paramset:get_id(idx) return self.params[idx] and self.params[idx].id end
function paramset:get_name(idx) return self.params[idx] and self.params[idx].name end

function paramset:get(id)
  local p = self:get_param(id)
  if not p then return nil end
  if p.t == tCONTROL then return p.controlspec:map(p.raw)
  elseif p.t == tNUMBER or p.t == tOPTION or p.t == tBINARY then return p.value
  elseif p.t == tFILE or p.t == tTEXT then return p.value
  end
  return p.value
end

function paramset:get_raw(id)
  local p = self:get_param(id)
  if not p then return 0 end
  if p.t == tCONTROL then return p.raw end
  if p.t == tNUMBER then return (p.value - p.min) / (p.max - p.min) end
  if p.t == tOPTION then return (p.value - 1) / math.max(1, (p.count - 1)) end
  return 0
end

function paramset:set(id, v, silent)
  local p = self:get_param(id)
  if not p then return end
  -- Norns only fires the action when the value actually changes (e.g.
  -- _control.lua: `if self.raw ~= raw`). Scripts rely on this: a clamp action
  -- that re-sets a param to its current value must NOT re-fire the action, or
  -- it recurses forever (e.g. mlre's clamp_env_levels). Track change here.
  local changed
  if p.t == tCONTROL then
    local raw = p.controlspec:unmap(v)
    changed = p.raw ~= raw
    p.raw = raw
  elseif p.t == tNUMBER then
    local nv = math.min(math.max(v, p.min), p.max)
    changed = p.value ~= nv
    p.value = nv
  elseif p.t == tOPTION then
    local nv = math.min(math.max(math.floor(v), 1), math.max(1, p.count))
    changed = p.value ~= nv
    p.value = nv
  elseif p.t == tBINARY then
    local nv = v ~= 0 and 1 or 0
    changed = p.value ~= nv
    p.value = nv
  else
    changed = p.value ~= v
    p.value = v
  end
  if not silent and changed and p.action then p.action(self:get(id)) end
end

function paramset:set_raw(id, f, silent)
  local p = self:get_param(id)
  if not p then return end
  if p.t == tCONTROL then p.raw = math.min(math.max(f, 0), 1)
  else self:set(id, self:get(id)) end
  if not silent and p.action then p.action(self:get(id)) end
end

function paramset:delta(id, d)
  local p = self:get_param(id)
  if not p then return end
  if p.t == tCONTROL then
    self:set_raw(id, p.raw + d * (p.controlspec.quantum or 0.01))
  elseif p.t == tNUMBER then
    local v = p.value + d
    if p.wrap then
      v = (v - p.min) % (p.max - p.min + 1) + p.min
    end
    self:set(id, v)
  elseif p.t == tOPTION then
    self:set(id, p.value + d)
  elseif p.t == tBINARY then
    self:set(id, 1 - p.value)
  end
end

function paramset:set_action(id, fn)
  local p = self:get_param(id)
  if p then p.action = fn or function() end end
end

function paramset:get_action(id)
  local p = self:get_param(id)
  return p and p.action
end

-- set_save: controls whether a param is persisted in psets. Stored on the
-- param; write/read honour it where implemented.
function paramset:set_save(id, save)
  local p = self:get_param(id)
  if p then p.save = save end
end

function paramset:get_save(id)
  local p = self:get_param(id)
  if p == nil then return true end
  return p.save ~= false
end

-- norns calls a param's formatter as formatter(param), where `param:get()`,
-- `param:get_raw()` and field access (param.controlspec, param.name…) refer to
-- that single param. Internally params are plain tables, so wrap one with the
-- expected method surface before handing it to a script formatter.
local function param_proxy(self, p)
  return setmetatable({
    get     = function() return self:get(p.id) end,
    get_raw = function() return self:get_raw(p.id) end,
    string  = function() return self:string(p.id) end,
  }, { __index = p })
end

function paramset:string(id)
  local p = self:get_param(id)
  if not p then return "" end
  if p.formatter then return p.formatter(param_proxy(self, p)) end
  if p.t == tOPTION then return tostring(p.options[p.value]) end
  if p.t == tCONTROL then
    return string.format("%.2f%s", self:get(id), p.controlspec.units ~= "" and (" " .. p.controlspec.units) or "")
  end
  if p.t == tBINARY then return p.value == 1 and "on" or "off" end
  return tostring(self:get(id))
end

function paramset:bang()
  for _, p in ipairs(self.params) do
    if p.action and (p.t == tNUMBER or p.t == tOPTION or p.t == tCONTROL or p.t == tFILE or p.t == tTEXT) then
      p.action(self:get(p.id))
    elseif p.action and p.t == tBINARY and p.behavior ~= "trigger" then
      p.action(self:get(p.id))
    end
  end
end

function paramset:get_range(id) local p = self:get_param(id); return p and { p.min or 0, p.max or 1 } end
function paramset:hide(id) local _, i = self:get_param(id); if i then self.hidden[i] = true end end
function paramset:show(id) local _, i = self:get_param(id); if i then self.hidden[i] = nil end end
function paramset:visible(idx) return not self.hidden[idx] end

-- lookup_param(id) — alias for get_param, returning the param object
-- Used by nb.lua and other scripts that need direct param access.
function paramset:lookup_param(id)
  return self:get_param(id)
end

-- dump(): full serialisable snapshot of all params (used by core.param_summary / param_update)
function paramset:dump()
  local out = {}
  for i, p in ipairs(self.params) do
    local e = { id = p.id, name = p.name, t = p.t, idx = i }
    if p.t == tGROUP then
      e.count = p.n
    elseif p.t == tNUMBER then
      e.value = p.value; e.min = p.min; e.max = p.max; e.default = p.default
    elseif p.t == tOPTION then
      e.value = p.value; e.options = p.options; e.count = p.count
    elseif p.t == tCONTROL then
      e.value = self:get(p.id)
      e.min = p.controlspec.minval; e.max = p.controlspec.maxval
      e.quantum = p.controlspec.quantum; e.units = p.controlspec.units
      e.warp = p.controlspec.warp
    elseif p.t == tFILE or p.t == tTEXT then
      e.value = p.value
    elseif p.t == tBINARY then
      e.value = p.value
    end
    if p.t ~= tSEPARATOR and p.t ~= tGROUP and p.t ~= tTRIGGER then
      local ok, s = pcall(function() return self:string(p.id) end)
      e.str = ok and s or ""
    else
      e.str = ""
    end
    out[i] = e
  end
  return out
end

-- persistence: pset files under norns.state.data/<script>/pset/<NN>.pset
-- File format (matches norns): an optional first line "-- <name>", then
-- "<param_id>\t<value>" lines. A plain "default" file in the same dir holds the
-- number of the pset that should auto-load when the script starts.

function paramset:_pset_dir()
  local script_name = (_G.norns and _G.norns.state and _G.norns.state.name) or "norns"
  local data_dir    = (_G.norns and _G.norns.state and _G.norns.state.data) or "/tmp/"
  return data_dir .. script_name .. "/pset/"
end

local function pset_nstr(n)
  return type(n) == "number" and string.format("%02d", n) or tostring(n or "01")
end

function paramset:write(n, name)
  local pset_dir = self:_pset_dir()
  os.execute('mkdir -p "' .. pset_dir .. '"')
  local fpath = pset_dir .. pset_nstr(n) .. ".pset"
  local f = io.open(fpath, "w")
  if not f then return false, fpath end
  if name and name ~= "" then f:write("-- " .. name .. "\n") end
  for _, p in ipairs(self.params) do
    if p.id and p.t ~= tSEPARATOR and p.t ~= tGROUP and p.t ~= tTRIGGER then
      local ok, val = pcall(function() return self:get(p.id) end)
      if ok and val ~= nil then f:write(p.id .. "\t" .. tostring(val) .. "\n") end
    end
  end
  f:close()
  return true, fpath
end

function paramset:read(n)
  local fpath = self:_pset_dir() .. pset_nstr(n) .. ".pset"
  local f = io.open(fpath, "r")
  if not f then return false, fpath end
  for line in f:lines() do
    if line:sub(1, 2) ~= "--" then   -- skip the "-- <name>" header
      local id, val_str = line:match("^([^\t]+)\t(.+)$")
      if id and val_str then
        local p = self:get_param(id)
        if p then
          local num = tonumber(val_str)
          pcall(self.set, self, id, num ~= nil and num or val_str, true)
        end
      end
    end
  end
  f:close()
  return true, fpath
end

-- read the "-- <name>" header of pset n (or nil if none/no file)
function paramset:pset_name(n)
  local f = io.open(self:_pset_dir() .. pset_nstr(n) .. ".pset", "r")
  if not f then return nil end
  local first = f:read("*l")
  f:close()
  return first and first:match("^%-%-%s*(.+)$") or nil
end

-- list saved psets → array of { n = <number>, name = <string|nil> }, sorted by n
function paramset:list_psets()
  local out = {}
  local p = io.popen('ls -1 "' .. self:_pset_dir() .. '" 2>/dev/null')
  if not p then return out end
  for fname in p:lines() do
    local num = fname:match("^(%d+)%.pset$")
    if num then
      local n = tonumber(num)
      out[#out + 1] = { n = n, name = self:pset_name(n) }
    end
  end
  p:close()
  table.sort(out, function(a, b) return a.n < b.n end)
  return out
end

function paramset:delete_pset(n)
  local ok = os.remove(self:_pset_dir() .. pset_nstr(n) .. ".pset")
  if self:get_default() == n then self:set_default(nil) end
  return ok and true or false
end

-- default marker: a "default" file in the pset dir holding the pset number
function paramset:get_default()
  local f = io.open(self:_pset_dir() .. "default", "r")
  if not f then return nil end
  local s = f:read("*l"); f:close()
  return s and tonumber(s) or nil
end

function paramset:set_default(n)
  local path = self:_pset_dir() .. "default"
  if n == nil then os.remove(path); return end
  os.execute('mkdir -p "' .. self:_pset_dir() .. '"')
  local f = io.open(path, "w")
  if f then f:write(tostring(n) .. "\n"); f:close() end
end
function paramset:default()
  for _, p in ipairs(self.params) do
    if p.action and p.default ~= nil then
      local val
      if p.t == tCONTROL then val = p.controlspec:map(p.controlspec:unmap(p.default))
      else val = p.default end
      pcall(p.action, val)
    end
  end
end
function paramset:clear() self.params = {}; self.count = 0; self.lookup = {} end

paramset.types = { tNUMBER, tOPTION, tCONTROL, tFILE, tTAPER, tTRIGGER, tGROUP, tSEPARATOR, tTEXT, tBINARY }
paramset.tNUMBER, paramset.tOPTION, paramset.tCONTROL = tNUMBER, tOPTION, tCONTROL
paramset.tFILE, paramset.tTRIGGER, paramset.tGROUP = tFILE, tTRIGGER, tGROUP
paramset.tSEPARATOR, paramset.tTEXT, paramset.tBINARY = tSEPARATOR, tTEXT, tBINARY

return paramset
