-- cjson shim: route require("cjson") to our pure-Lua json module.
-- The C extension is not available in the emulator; scripts that use
-- cjson.encode/decode work fine with this shim.
local json = require("norns.json")
return { encode = json.encode, decode = json.decode, new = function() return json end }
