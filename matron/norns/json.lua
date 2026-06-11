-- Minimal JSON encode/decode for the matron-shim stdio protocol.
-- Sufficient for objects, arrays, strings, numbers, booleans, null.

local json = {}

-- ---- encode --------------------------------------------------------------
local escape_map = {
  ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b',
  ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}

local function escape_str(s)
  return '"' .. s:gsub('[%z\1-\31\\"]', function(c)
    return escape_map[c] or string.format('\\u%04x', c:byte())
  end) .. '"'
end

local function is_array(t)
  local n = 0
  for k in pairs(t) do
    if type(k) ~= "number" then return false end
    n = n + 1
  end
  return n == #t
end

local function encode(v)
  local tv = type(v)
  if tv == "nil" then
    return "null"
  elseif tv == "boolean" then
    return v and "true" or "false"
  elseif tv == "number" then
    if v ~= v then return "0" end          -- NaN -> 0
    if v == math.huge then return "1e999" end
    if v == -math.huge then return "-1e999" end
    if math.type and math.type(v) == "integer" then
      return string.format("%d", v)
    end
    return string.format("%.10g", v)
  elseif tv == "string" then
    return escape_str(v)
  elseif tv == "table" then
    local parts = {}
    if is_array(v) then
      for i = 1, #v do parts[i] = encode(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      for k, val in pairs(v) do
        parts[#parts + 1] = escape_str(tostring(k)) .. ":" .. encode(val)
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return "null"
end
json.encode = encode

-- ---- decode --------------------------------------------------------------
local function decode(s)
  local pos = 1

  local function skip_ws()
    pos = s:find("[^ \t\r\n]", pos) or (#s + 1)
  end

  local parse_value -- fwd decl

  local function parse_string()
    pos = pos + 1 -- opening quote
    local buf = {}
    while pos <= #s do
      local c = s:sub(pos, pos)
      if c == '"' then
        pos = pos + 1
        return table.concat(buf)
      elseif c == "\\" then
        local e = s:sub(pos + 1, pos + 1)
        if e == "n" then buf[#buf+1] = "\n"
        elseif e == "t" then buf[#buf+1] = "\t"
        elseif e == "r" then buf[#buf+1] = "\r"
        elseif e == "b" then buf[#buf+1] = "\b"
        elseif e == "f" then buf[#buf+1] = "\f"
        elseif e == "/" then buf[#buf+1] = "/"
        elseif e == '"' then buf[#buf+1] = '"'
        elseif e == "\\" then buf[#buf+1] = "\\"
        elseif e == "u" then
          local hex = s:sub(pos + 2, pos + 5)
          local cp = tonumber(hex, 16) or 0
          if cp < 0x80 then
            buf[#buf+1] = string.char(cp)
          elseif cp < 0x800 then
            buf[#buf+1] = string.char(0xC0 + math.floor(cp/0x40), 0x80 + cp%0x40)
          else
            buf[#buf+1] = string.char(0xE0 + math.floor(cp/0x1000),
              0x80 + math.floor(cp/0x40)%0x40, 0x80 + cp%0x40)
          end
          pos = pos + 4
        else buf[#buf+1] = e end
        pos = pos + 2
      else
        buf[#buf+1] = c
        pos = pos + 1
      end
    end
    error("unterminated string")
  end

  local function parse_number()
    local s2 = s:find("[^%-+%deE.]", pos) or (#s + 1)
    local num = s:sub(pos, s2 - 1)
    pos = s2
    return tonumber(num)
  end

  local function parse_object()
    pos = pos + 1
    local obj = {}
    skip_ws()
    if s:sub(pos, pos) == "}" then pos = pos + 1; return obj end
    while true do
      skip_ws()
      local key = parse_string()
      skip_ws()
      pos = pos + 1 -- colon
      obj[key] = parse_value()
      skip_ws()
      local c = s:sub(pos, pos)
      pos = pos + 1
      if c == "}" then return obj end
    end
  end

  local function parse_array()
    pos = pos + 1
    local arr = {}
    skip_ws()
    if s:sub(pos, pos) == "]" then pos = pos + 1; return arr end
    while true do
      arr[#arr + 1] = parse_value()
      skip_ws()
      local c = s:sub(pos, pos)
      pos = pos + 1
      if c == "]" then return arr end
    end
  end

  parse_value = function()
    skip_ws()
    local c = s:sub(pos, pos)
    if c == "{" then return parse_object()
    elseif c == "[" then return parse_array()
    elseif c == '"' then return parse_string()
    elseif c == "t" then pos = pos + 4; return true
    elseif c == "f" then pos = pos + 5; return false
    elseif c == "n" then pos = pos + 4; return nil
    else return parse_number() end
  end

  local ok, res = pcall(parse_value)
  if ok then return res else return nil end
end
json.decode = decode

return json
