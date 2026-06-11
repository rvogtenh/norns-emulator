-- engine.lua — norns engine API.
-- On real norns, `engine.<command>(args)` sends OSC to crone (SuperCollider).
-- In the emulator we forward commands to the browser, where a WebAudio host
-- (web/js/audio.js) reimplements a set of common engines (e.g. PolyPerc).

local host = require("norns.host")

local engine = {}
local current_name = nil

-- table that turns engine.foo(a,b) into a forwarded command message
local commands = setmetatable({}, {
  __index = function(_, cmd)
    return function(...)
      host.send({ t = "engine", action = "command", name = current_name, cmd = cmd, args = { ... } })
    end
  end,
})

engine.load = function(name, cb)
  current_name = name
  host.send({ t = "engine", action = "load", name = name })
  if cb then cb() end
end

engine.list_commands = function() return {} end
engine.list_polls = function() return {} end
engine.register_commands = function() end
engine.register_polls = function() end

-- the `engine` global: engine.name = "X" sets the engine; engine.cmd(...) sends
return setmetatable(engine, {
  __index = function(t, k)
    if k == "name" then return current_name end
    if rawget(engine, k) then return rawget(engine, k) end
    return commands[k]
  end,
  __newindex = function(t, k, v)
    if k == "name" then
      current_name = v
      host.send({ t = "engine", action = "load", name = v })
    else
      rawset(t, k, v)
    end
  end,
})
