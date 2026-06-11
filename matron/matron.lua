-- matron.lua — entry point of the matron-shim.
-- Runs under Lua 5.3 inside the container, spawned by the Node gateway.
-- Reads newline-delimited JSON events on stdin, drives the norns script
-- lifecycle, and writes screen frames / device LED state to stdout.

-- resolve `require("norns.x")` relative to the app root (cwd set by Node)
package.path = table.concat({
  "matron/?.lua",
  "matron/?/init.lua",
  package.path,
}, ";")

local json = require("norns.json")
local host = require("norns.host")
local core = require("norns.core")
local clock = require("norns.clock")
local grid = require("norns.grid")
local arc = require("norns.arc")
local midi = require("norns.midi")
local softcut    = require("norns.softcut")
local fileselect = require("norns.lib.fileselect")
local textentry  = require("norns.lib.textentry")

-- Scripts require these by their bare names (e.g. `require 'fileselect'`),
-- which package.path resolves to the same file but under a different require
-- key — Lua would cache two separate instances, each with its own pending
-- callback table, so dispatched results land in the wrong instance ("stale
-- cb_id"). Alias the bare keys to the instances we dispatch through.
package.loaded["fileselect"] = fileselect
package.loaded["textentry"]  = textentry

-- install the global API once at boot (before any script is loaded)
core.install_globals()
host.send({ t = "ready", version = "norns-emulator 0.1.0" })

-- send the current list of saved psets (+ which one is marked default) to the browser
local function send_pset_list()
  if not _G.params then return end
  host.send({ t = "pset_list",
    items   = _G.params:list_psets(),
    default = _G.params:get_default() })
end

local function dispatch(m)
  if m.now then host._now_ms = m.now end
  local t = m.t

  if t == "enc" then
    if type(_G.enc) == "function" then pcall(_G.enc, m.n, m.d) end
    core.safe_redraw()
  elseif t == "key" then
    if type(_G.key) == "function" then pcall(_G.key, m.n, m.z) end
    core.safe_redraw()
  elseif t == "gridkey" then
    grid._dispatch_key(m.dev or 1, m.x, m.y, m.z)
    core.safe_redraw()
  elseif t == "arcdelta" then
    arc._dispatch_delta(m.dev or 1, m.n, m.d)
    core.safe_redraw()
  elseif t == "arckey" then
    arc._dispatch_key(m.dev or 1, m.n, m.z)
    core.safe_redraw()
  elseif t == "midi" then
    midi._dispatch(m.dev or 1, m.data)
    -- no auto-redraw: midi-driven scripts manage their own redraw
  elseif t == "timer" then
    host.fire(m.id)
    -- no auto-redraw: metro/clock callbacks manage their own redraw
  elseif t == "load" then
    core.load_script(m.path)
  elseif t == "eval" then
    core.eval(m.code)
  elseif t == "cleanup" then
    core.cleanup()
  elseif t == "tempo" then
    clock.set_tempo(m.bpm)
  elseif t == "param_set" then
    _G.params:set(m.id, m.value)
    local val = _G.params:get(m.id)
    local ok, str = pcall(function() return _G.params:string(m.id) end)
    host.send({ t = "param_update", id = m.id, value = val, str = ok and str or tostring(val) })
    core.safe_redraw()
  elseif t == "param_delta" then
    _G.params:delta(m.id, m.d)
    local val = _G.params:get(m.id)
    local ok, str = pcall(function() return _G.params:string(m.id) end)
    host.send({ t = "param_update", id = m.id, value = val, str = ok and str or tostring(val) })
    core.safe_redraw()
  elseif t == "pset_write" then
    local ok, fpath = _G.params:write(m.n, m.name)
    host.send({ t = "log", level = ok and "info" or "error",
      msg = ok and ("pset saved → " .. fpath) or ("pset: write failed") })
    send_pset_list()
  elseif t == "pset_list" then
    send_pset_list()
  elseif t == "pset_delete" then
    local ok = _G.params:delete_pset(m.n)
    host.send({ t = "log", level = ok and "info" or "error",
      msg = ok and ("pset deleted: " .. tostring(m.n)) or ("pset: delete failed") })
    send_pset_list()
  elseif t == "pset_default" then
    -- toggle: clear if already the default, else set. (Note: must use an
    -- explicit if — `cur == n and nil or n` always yields n in Lua.)
    if _G.params:get_default() == m.n then
      _G.params:set_default(nil)
    else
      _G.params:set_default(m.n)
    end
    send_pset_list()
  elseif t == "softcut_phase" then
    softcut._dispatch_phase(m.voice, m.pos)
  elseif t == "engine_poll" then
    if _G.poll and _G.poll._dispatch then _G.poll._dispatch(m.name, m.value) end
  elseif t == "softcut_render" then
    softcut._dispatch_render(m.ch, m.start, m.samples)
  elseif t == "fileselect_result" then
    -- Use the script's global fileselect instance (which holds the pending
    -- callbacks) rather than the local one loaded under a different require key.
    local fs = (type(_G.fileselect) == "table" and _G.fileselect) or fileselect
    fs._dispatch(m.cb_id, m.path)
    core.safe_redraw()
  elseif t == "textentry_result" then
    local te = (type(_G.textentry) == "table" and _G.textentry) or textentry
    te._dispatch(m.cb_id, m.text)
    core.safe_redraw()
  elseif t == "pset_read" then
    local ok, fpath = _G.params:read(m.n)
    if ok then
      _G.params:bang()
      host.send({ t = "params_refresh", data = core.param_summary() })
      core.safe_redraw()
    end
    host.send({ t = "log", level = ok and "info" or "error",
      msg = ok and ("pset loaded ← " .. fpath) or ("pset: not found — " .. fpath) })
  end
end

-- main loop: block on stdin, dispatch each JSON line.
-- Read via io.stdin explicitly (not io.lines()/default input): norns scripts
-- call io.input(file) during e.g. collection loading, which would otherwise
-- hijack matron's control channel and end this loop, killing the Lua process.
for line in io.stdin:lines() do
  if line ~= "" then
    local m = json.decode(line)
    if m and m.t then
      local ok, err = pcall(dispatch, m)
      if not ok then host.send({ t = "log", level = "error", msg = "dispatch: " .. tostring(err) }) end
    end
  end
end
