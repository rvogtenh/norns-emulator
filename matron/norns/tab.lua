-- tab.lua — norns' table helpers (lua/lib/tabutil.lua), global as `tab`.

local tab = {}

function tab.print(t)
  for k, v in pairs(t) do print(tostring(k) .. "\t" .. tostring(v)) end
end

function tab.sort(t)
  local keys = {}
  for k in pairs(t) do keys[#keys + 1] = k end
  table.sort(keys)
  return keys
end

function tab.count(t)
  local c = 0
  for _ in pairs(t) do c = c + 1 end
  return c
end

function tab.contains(t, e)
  for _, v in pairs(t) do if v == e then return true end end
  return false
end

function tab.key(t, element)
  for k, v in pairs(t) do if v == element then return k end end
  return nil
end

function tab.invert(t)
  local inv = {}
  for k, v in pairs(t) do inv[v] = k end
  return inv
end

function tab.select_values(t, indices)
  local result = {}
  for _, i in ipairs(indices) do result[#result + 1] = t[i] end
  return result
end

function tab.gather(t1, t2)
  for k, v in pairs(t2) do t1[k] = v end
  return t1
end

function tab.update(t, src)
  for k, v in pairs(src) do t[k] = v end
end

function tab.readonly(params)
  local t = params.table or {}
  local mt = { __index = t, __newindex = function() error("read-only table") end }
  return setmetatable({}, mt)
end

function tab.split(str, sep)
  sep = sep or "%s"
  local out = {}
  for s in string.gmatch(str, "([^" .. sep .. "]+)") do out[#out + 1] = s end
  return out
end

-- Serialize a table to a file, byte-for-byte compatible with norns'
-- lua/lib/tabutil.lua tab.save. Output is a Lua chunk `return { ... }` where
-- the root table is index 1 and every nested table is emitted once and
-- referenced elsewhere as a `{N}` placeholder. This is the format every norns
-- script (e.g. Cheat Codes 2 collections) reads and writes — the previous
-- key=value format here could not round-trip real-hardware data files.
function tab.save(tbl, filename)
  if type(tbl) ~= "table" then return end
  local charS, charE = "   ", "\n"
  local dir = filename:match("^(.*)/[^/]*$")
  if dir then os.execute('mkdir -p "' .. dir .. '"') end
  local file, err = io.open(filename, "wb")
  if err then return err end

  -- initiate variables for save procedure
  local tables, lookup = { tbl }, { [tbl] = 1 }
  file:write("return {" .. charE)

  for idx, t in ipairs(tables) do
    file:write("-- Table: {" .. idx .. "}" .. charE)
    file:write("{" .. charE)
    local thandled = {}

    for i, v in ipairs(t) do
      thandled[i] = true
      local stype = type(v)
      if stype == "table" then
        if not lookup[v] then
          table.insert(tables, v)
          lookup[v] = #tables
        end
        file:write(charS .. "{" .. lookup[v] .. "}," .. charE)
      elseif stype == "string" then
        file:write(charS .. string.format("%q", v) .. "," .. charE)
      elseif stype == "number" then
        file:write(charS .. tostring(v) .. "," .. charE)
      elseif stype == "boolean" then
        file:write(charS .. tostring(v) .. "," .. charE)
      end
    end

    for i, v in pairs(t) do
      if not thandled[i] then
        local str = ""
        local stype = type(i)
        -- handle index
        if stype == "table" then
          if not lookup[i] then
            table.insert(tables, i)
            lookup[i] = #tables
          end
          str = charS .. "[{" .. lookup[i] .. "}]="
        elseif stype == "string" then
          str = charS .. "[" .. string.format("%q", i) .. "]="
        elseif stype == "number" then
          str = charS .. "[" .. tostring(i) .. "]="
        elseif stype == "boolean" then
          str = charS .. "[" .. tostring(i) .. "]="
        end

        if str ~= "" then
          stype = type(v)
          -- handle value
          if stype == "table" then
            if not lookup[v] then
              table.insert(tables, v)
              lookup[v] = #tables
            end
            file:write(str .. "{" .. lookup[v] .. "}," .. charE)
          elseif stype == "string" then
            file:write(str .. string.format("%q", v) .. "," .. charE)
          elseif stype == "number" then
            file:write(str .. tostring(v) .. "," .. charE)
          elseif stype == "boolean" then
            file:write(str .. tostring(v) .. "," .. charE)
          end
        end
      end
    end
    file:write("}," .. charE)
  end
  file:write("}")
  file:close()
end

-- Load a table saved by tab.save. Executes the chunk, then relinks every `{N}`
-- placeholder back to the real table it references (matching norns tabutil).
-- On failure returns nil + error message (a missing/legacy file yields nil),
-- which is what callers like Cheat Codes 2 test for.
function tab.load(sfile)
  local ftables, err = loadfile(sfile)
  if err then return nil, err end
  local tables = ftables()
  if tables ~= nil then
    for idx = 1, #tables do
      local tolinki = {}
      for i, v in pairs(tables[idx]) do
        if type(v) == "table" then
          tables[idx][i] = tables[v[1]]
        end
        if type(i) == "table" and tables[i[1]] then
          table.insert(tolinki, { i, tables[i[1]] })
        end
      end
      -- link indices
      for _, v in ipairs(tolinki) do
        tables[idx][v[2]], tables[idx][v[1]] = tables[idx][v[1]], nil
      end
    end
    return tables[1]
  else
    return nil
  end
end

return tab
