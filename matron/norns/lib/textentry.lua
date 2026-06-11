-- textentry.lua — on real norns this shows an on-screen keyboard driven by
-- enc/key. In the emulator we ask the browser for a line of text and call the
-- script callback with the result (string on accept, nil on cancel), matching
-- the norns textentry contract used by e.g. Cheat Codes 2's "save collection".

local host = require("norns.host")

local textentry = {}

local pending    = {}
local next_cb_id = 1

function textentry.enter(callback, default, heading, check)
  local cb_id = next_cb_id
  next_cb_id  = next_cb_id + 1
  pending[cb_id] = callback
  host.send({
    t       = "textentry_open",
    default = default or "",
    heading = heading or "",
    cb_id   = cb_id,
  })
end

function textentry.exit() end

-- Called by matron.lua when the browser sends {t:"textentry_result"}.
function textentry._dispatch(cb_id, text)
  local cb = pending[cb_id]
  pending[cb_id] = nil
  if type(cb) == "function" then
    -- text is a string on accept, nil on cancel (json null → nil).
    local ok, err = pcall(cb, text)
    if not ok then
      host.send({ t = "log", level = "error", msg = "textentry cb error: " .. tostring(err) })
    end
  end
end

return textentry
