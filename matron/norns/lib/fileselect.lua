-- fileselect.lua — opens the browser file picker and calls back into Lua.
-- fileselect.enter(path, callback, ext) sends a fileselect_open message to
-- the browser; when the user picks a file (or cancels), the browser sends
-- fileselect_result which matron.lua routes to fileselect._dispatch().

local host = require("norns.host")

local fileselect = {}

local pending    = {}     -- cb_id -> function
local next_cb_id = 1

function fileselect.enter(path, callback, ext)
  local cb_id = next_cb_id
  next_cb_id  = next_cb_id + 1
  pending[cb_id] = callback
  host.send({
    t          = "fileselect_open",
    path       = path or "/audio",
    ext        = ext  or "*",
    cb_id      = cb_id,
  })
end

function fileselect.exit()
  -- on hardware: closes the fileselect overlay; no-op here
end

-- pushd/popd: on hardware these pre-navigate the picker into a directory.
-- The emulator opens a native picker at the path passed to enter(), so these
-- are no-ops kept for API compatibility (e.g. mlre calls fileselect.pushd).
function fileselect.pushd(_) end
function fileselect.popd() end

function fileselect.redraw()
  -- on hardware: draws the file picker UI on screen
  -- in the emulator the browser renders the overlay natively
end

-- Called by matron.lua when the browser sends {t:"fileselect_result"}.
function fileselect._dispatch(cb_id, path)
  local cb = pending[cb_id]
  pending[cb_id] = nil
  if type(cb) == "function" then
    local ok, err = pcall(cb, path)
    if not ok then
      host.send({ t = "log", level = "error", msg = "fileselect cb error: " .. tostring(err) })
    end
  else
    host.send({ t = "log", level = "error", msg = "fileselect: stale cb_id " .. tostring(cb_id) .. " (Lua restarted while picker was open?) — reopen the picker" })
  end
end

return fileselect
