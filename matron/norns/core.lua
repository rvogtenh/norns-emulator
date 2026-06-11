-- core.lua — assembles the norns global environment, loads/cleans up scripts.
-- This is the emulator's equivalent of matron's startup: it installs the
-- global API tables that user scripts expect, sets up include/require paths,
-- and runs the script lifecycle (init / redraw / cleanup).

local host = require("norns.host")
local json = require("norns.json")

local screen = require("norns.screen")
local metro = require("norns.metro")
local clock = require("norns.clock")
local util = require("norns.util")
local tab = require("norns.tab")
local controlspec = require("norns.controlspec")
local paramset = require("norns.params")
local grid = require("norns.grid")
local arc = require("norns.arc")
local midi = require("norns.midi")
local engine = require("norns.engine")
local softcut = require("norns.softcut")

local core = {}

local SCRIPTS_DIR = os.getenv("SCRIPTS_DIR") or "."
local MATRON_DIR  = os.getenv("MATRON_DIR")  or "matron"
local AUDIO_DIR   = os.getenv("AUDIO_DIR")   or "/audio"

-- deep no-op proxy for unimplemented subsystems (crow, hid, ...)
local proxy = setmetatable({}, {
  __index = function() return _G.__norns_proxy end,
  __newindex = function() end,
  __call = function() return _G.__norns_proxy end,
})
_G.__norns_proxy = proxy

local function noop() end

-- ---- install globals -----------------------------------------------------
function core.install_globals()
  _G.screen = screen
  _G.metro = metro
  _G.clock = clock
  _G.util = util
  _G.tab = tab
  _G.tabutil = tab
  _G.controlspec = controlspec
  _G.grid = grid
  _G.arc = arc
  _G.midi = midi
  _G.engine = engine
  _G.softcut = softcut

  -- global paramset instance
  _G.params = paramset.new("params", "")
  _G.paramset = paramset

  -- norns built-in params that scripts reference without adding them
  _G.params:add_number("clock_tempo", "tempo", 1, 300, 120)
  _G.params:set_action("clock_tempo", function(v) clock.set_tempo(v) end)
  _G.params:add_option("clock_source", "clock source", {"internal","midi","link","crow"}, 1)
  _G.params:add_number("clock_midi_out_div", "midi out div", 1, 96, 1)
  _G.params:add_option("clock_crow_out", "crow out", {"none","pulse","ramp","tap tempo"}, 1)
  _G.params:add_number("clock_crow_out_div", "crow out div", 1, 96, 1)
  _G.params:add_number("clock_crow_in_div", "crow in div", 1, 96, 1)

  -- audio (mixer/levels + file_info)
  _G.audio = setmetatable({
    level_cut = noop,
    level_adc_cut = function(v) host.send({ t = "audio_adc_cut", level = v or 0 }) end,
    level_eng_cut = function(v) host.send({ t = "audio_eng_cut", level = v or 0 }) end,
    level_cut_cut = noop, level_dac = noop, level_adc = noop, level_eng = noop,
    level_ext = noop, level_monitor = noop, level_tape = noop,
    monitor_mono = noop, monitor_stereo = noop, monitor_off = noop, monitor_on = noop,
    pitch_on = noop, pitch_off = noop,
    -- reverb
    rev_on  = function()  host.send({ t = "audio_rev_on"  }) end,
    rev_off = function()  host.send({ t = "audio_rev_off" }) end,
    reverb_time      = function(v) host.send({ t = "audio_rev_time",   v = v or 3.5 }) end,
    reverb_size      = function(v) host.send({ t = "audio_rev_send",   v = (v or 50) / 100 }) end,
    level_reverb     = function(v) host.send({ t = "audio_rev_return", v = v or 0.8 }) end,
    level_cut_reverb = function(v) host.send({ t = "audio_rev_send",   v = v or 0 }) end,
    level_monitor_reverb = noop,
    -- compressor
    comp_on  = function() host.send({ t = "audio_comp_on"  }) end,
    comp_off = function() host.send({ t = "audio_comp_off" }) end,
    comp_threshold = function(v) host.send({ t = "audio_comp_threshold", v = v or -12 }) end,
    comp_ratio     = function(v) host.send({ t = "audio_comp_ratio",     v = v or 4   }) end,
    comp_attack    = function(v) host.send({ t = "audio_comp_attack",    v = v or 0.005 }) end,
    comp_release   = function(v) host.send({ t = "audio_comp_release",   v = v or 0.1 }) end,
    comp_mix       = noop,
    output_level = noop, input_level = noop,
    headphone_gain = noop, cut_enable = noop,

    -- Returns (channels, frames_at_48k, samplerate).
    -- frames_at_48k is normalised to 48000 Hz so that scripts which hardcode
    -- division by 48000 (norns convention) get the correct duration for any
    -- source sample rate (44100, 48000, 96000 …).
    -- The browser's decodeAudioData resamples to the AudioContext rate, so
    -- duration-in-seconds is the invariant; frames_at_48k encodes that.
    file_info = function(path)
      if not path or path == "" then return 0, 0, 0 end
      local f = io.open(path, "rb")
      if not f then return 0, 0, 0 end
      local h = f:read(128)
      f:close()
      if not h or #h < 44 then return 0, 0, 0 end
      -- RIFF/WAV
      if h:sub(1,4) == "RIFF" and h:sub(9,12) == "WAVE" then
        local b   = function(i) return h:byte(i) end
        local u16 = function(i) return b(i) + b(i+1)*256 end
        local u32 = function(i) return b(i)+b(i+1)*256+b(i+2)*65536+b(i+3)*16777216 end
        local ch  = u16(23)
        local sr  = u32(25)
        local bps = u16(35)
        local bpf = ch * math.max(1, math.floor(bps / 8))
        local pos = 37
        while pos + 8 <= #h do
          local tag  = h:sub(pos, pos+3)
          local size = u32(pos+4)
          if tag == "data" then
            local frames = math.floor(size / bpf)
            -- Always report 48000 so scripts that enforce 48kHz accept any sample rate.
            -- frames_at_48k gives the correct duration when divided by 48000.
            return ch, math.floor(frames * 48000 / math.max(1, sr)), 48000
          end
          pos = pos + 8 + size + (size % 2)
        end
        local ch2 = h:byte(23) + h:byte(24)*256
        return ch2 > 0 and ch2 or 1, 48000 * 60, u32(25)
      end
      -- AIFF: bytes 0-3 = "FORM", 8-11 = "AIFF"/"AIFC"
      if h:sub(1,4) == "FORM" and (h:sub(9,12) == "AIFF" or h:sub(9,12) == "AIFC") then
        -- Parse COMM chunk for sr and frames (big-endian)
        local b   = function(i) return h:byte(i) end
        local u16b = function(i) return b(i)*256 + b(i+1) end
        local u32b = function(i) return b(i)*16777216 + b(i+1)*65536 + b(i+2)*256 + b(i+3) end
        local pos = 13
        while pos + 8 <= #h do
          local tag  = h:sub(pos, pos+3)
          local size = u32b(pos+4)
          if tag == "COMM" then
            local ch     = u16b(pos+8)
            local frames = u32b(pos+10)
            -- sample rate is an 80-bit extended float at pos+14; read exponent+mantissa
            local exp  = u16b(pos+14) - 16383
            local mant = u32b(pos+16)
            local sr   = math.floor(mant * 2^(exp - 31))
            return ch, math.floor(frames * 48000 / math.max(1, sr)), 48000
          end
          pos = pos + 8 + size + (size % 2)
        end
        return 1, 48000 * 60, 48000
      end
      -- Unknown format — file exists, assume it's decodable by the browser
      -- Return 2 minutes at 48 kHz as a safe default
      return 1, 48000 * 120, 48000
    end,
  }, { __index = function() return noop end })

  -- crow / hid / wifi — deep no-op proxies
  _G.crow = proxy
  _G.hid = setmetatable({ connect = function() return proxy end, devices = {} },
    { __index = function() return noop end })
  _G.wifi = setmetatable({}, { __index = function() return noop end })

  -- osc — forward send to host (so OSC-based scripts at least emit)
  _G.osc = setmetatable({
    send = function(to, path, args) host.send({ t = "osc", to = to, path = path, args = args }) end,
    event = nil,
  }, { __index = function() return noop end })

  -- poll — registry of named engine polls. The browser-side engine emits
  -- values ({t:"engine_poll", name, value}); matron routes them to _dispatch,
  -- which calls the registered callback if the poll has been started.
  _G._polls = {}
  _G.poll = setmetatable({
    set = function(name, fn)
      local p = { name = name, callback = fn, active = false, time = 0.1 }
      p.start  = function(self) self.active = true end
      p.stop   = function(self) self.active = false end
      p.update = noop
      _G._polls[name] = p
      return p
    end,
    _dispatch = function(name, value)
      local p = _G._polls[name]
      if p and p.active and p.callback then pcall(p.callback, value) end
    end,
  }, { __index = function() return noop end })

  -- norns table
  _G.norns = {
    -- version.update as a numeric string >= 250406 so scripts' version guards pass
    version = { update = "250406" },
    state = { name = "none", shortname = "none", path = SCRIPTS_DIR .. "/", data = "/tmp/",
              mix = { amp = 0, cut_input_eng = 0, eng_cut = 0, cut_cut = 0,
                      cut_master = 1, eng_master = 1 } },
    script = {
      redraw = function() end,
      clear  = function() end,   -- no-op: clears the current script on hardware
      load   = function() end,   -- no-op: loads a script path on hardware
    },
    -- norns.encoders: raw table used by internal code
    encoders = { sens = { 1, 1, 1 }, accel = { false, false, false }, set_sens = noop, set_accel = noop },
    none = noop,
    crow = proxy,   -- norns.crow.init() etc. used by some scripts
    scripterror = function(e) host.send({ t = "log", level = "error", msg = "script error: " .. tostring(e) }) end,
    init = noop,
  }
  -- norns.enc is a callable table: norns.enc(n,d) dispatches; norns.enc.sens/accel are no-ops
  _G.norns.enc = setmetatable({
    sens  = function(n, v) end,  -- encoder sensitivity — no-op in emulator
    accel = function(n, v) end,  -- encoder acceleration — no-op
    set_sens  = noop,
    set_accel = noop,
  }, {
    __call = function(_, n, d) if _G.enc then _G.enc(n, d) end end,
  })
  _G.norns.key = function(n, z) if _G.key then _G.key(n, z) end end

  -- _norns: the low-level C-bridge table on hardware. Scripts (e.g. Cheat
  -- Codes 2's collection loader) call _norns.key(n,z)/_norns.enc(n,d) to
  -- synthesise hardware events; route them to the script callbacks like a real
  -- key/encoder press. screen.lua may have already created _norns, so extend
  -- it rather than replacing.
  _G._norns = _G._norns or {}
  _G._norns.key = _G._norns.key or function(n, z) if _G.key then _G.key(n, z) end end
  _G._norns.enc = _G._norns.enc or function(n, d) if _G.enc then _G.enc(n, d) end end

  -- norns.pmap: parameter→MIDI-CC mapping store (port of core/pmap.lua).
  -- Scripts like Cheat Codes 2 call norns.pmap.clear()/assign()/refresh() and
  -- index norns.pmap.rev[dev][ch][cc] during collection load; without this the
  -- load aborts on a nil 'pmap' field. MIDI mapping itself is not wired to real
  -- hardware here, but the bookkeeping keeps scripts running.
  local pmap = { data = {}, rev = {} }
  function pmap.clear()
    pmap.data = {}
    pmap.rev = {}
    for i = 1, 16 do
      pmap.rev[i] = {}
      for n = 1, 16 do pmap.rev[i][n] = {} end
    end
  end
  function pmap.new(id)
    pmap.data[id] = { cc = 100, ch = 1, dev = 1, in_lo = 0, in_hi = 127,
                      out_lo = 0, out_hi = 1, accum = false, echo = false, value = 0 }
  end
  function pmap.remove(id)
    local p = pmap.data[id]
    if p and pmap.rev[p.dev] and pmap.rev[p.dev][p.ch] then pmap.rev[p.dev][p.ch][p.cc] = nil end
    pmap.data[id] = nil
  end
  function pmap.assign(id, dev, ch, cc)
    local prev = pmap.rev[dev] and pmap.rev[dev][ch] and pmap.rev[dev][ch][cc]
    if prev and prev ~= id then pmap.remove(prev) end
    local p = pmap.data[id]
    if not p then pmap.new(id); p = pmap.data[id] end
    if pmap.rev[p.dev] and pmap.rev[p.dev][p.ch] then pmap.rev[p.dev][p.ch][p.cc] = nil end
    p.dev, p.ch, p.cc = dev, ch, cc
    pmap.rev[dev][ch][cc] = id
  end
  function pmap.refresh()
    for k, v in pairs(pmap.data) do pmap.rev[v.dev][v.ch][v.cc] = k end
  end
  function pmap.read() end   -- mappings are loaded by scripts via tab.load
  function pmap.write() end
  pmap.clear()
  _G.norns.pmap = pmap

  -- paths
  _G.paths = {
    home  = SCRIPTS_DIR, dust = SCRIPTS_DIR, code = SCRIPTS_DIR,
    audio = AUDIO_DIR,   data = "/tmp/",     tape = "/tmp/",    this = SCRIPTS_DIR,
  }
  _G._path = {
    home  = SCRIPTS_DIR .. "/", dust = "/home/we/dust/", code = SCRIPTS_DIR .. "/",
    audio = AUDIO_DIR   .. "/", data = "/data/",            tape = "/data/",
  }
  -- _path.dust matches real norns (/home/we/dust/) so scripts that build paths
  -- like _path.dust.."audio/x0x/..." (e.g. cyrene) resolve into the mounted
  -- audio/data dirs. Script code still lives at _path.code (/scripts).

  -- default lifecycle callbacks (scripts override these as globals)
  _G.init = _G.init or noop
  _G.redraw = _G.redraw or noop
  _G.enc = _G.enc or noop
  _G.key = _G.key or noop
  _G.cleanup = _G.cleanup or noop
  _G.inf = math.huge

  -- _menu stub — scripts call _menu.rebuild_params() etc. after adding params
  _G._menu = setmetatable({
    rebuild_params = noop,
    set_mode = noop,
    lock = noop,
    unlock = noop,
  }, { __index = function() return noop end })

  -- route print() to the browser console/log pane
  _G.print = function(...)
    local args = { ... }
    for i = 1, select("#", ...) do args[i] = tostring(args[i]) end
    host.send({ t = "log", level = "print", msg = table.concat(args, "\t") })
  end

  -- include(name): load a lua file relative to the current script dir
  _G.include = core.include
end

-- ---- REPL ----------------------------------------------------------------
function core.eval(code)
  local chunk, err = load(code, "eval", "t", _G)
  if not chunk then
    -- retry as an expression so `1+1` or `params:get("x")` echo a result
    chunk = load("return " .. code, "eval", "t", _G)
  end
  if not chunk then
    host.send({ t = "log", level = "error", msg = tostring(err) })
    return
  end
  local ok, res = pcall(chunk)
  if not ok then
    host.send({ t = "log", level = "error", msg = tostring(res) })
  elseif res ~= nil then
    host.send({ t = "log", level = "print", msg = tostring(res) })
  end
  core.safe_redraw()
end

-- ---- include / require paths --------------------------------------------
core.script_dir = SCRIPTS_DIR

function core.set_paths(script_dir)
  core.script_dir = script_dir
  -- parent allows include('scriptname/lib/foo') patterns (e.g. eterna, pitter-patter)
  local parent = script_dir:match("^(.*)/[^/]+$") or script_dir
  package.path = table.concat({
    script_dir .. "/?.lua",
    script_dir .. "/?/init.lua",
    parent .. "/?.lua",                 -- for include('eterna/lib/foo') style
    parent .. "/?/init.lua",
    MATRON_DIR .. "/norns/?.lua",       -- allows require("lib/gridbuf") → matron/norns/lib/gridbuf.lua
    MATRON_DIR .. "/norns/lib/?.lua",   -- vendored norns libs (musicutil, ...)
    package.path,
  }, ";")
end

function core.include(name)
  -- try relative to script dir, then parent dir (for 'scriptname/lib/x' patterns),
  -- then SCRIPTS_DIR root (for paths built via debug.getinfo like 'current set/foo/lib/nb/lib/player'),
  -- then norns lib, then plain require
  local parent = core.script_dir:match("^(.*)/[^/]+$") or core.script_dir
  local candidates = {
    core.script_dir .. "/" .. name .. ".lua",
    parent .. "/" .. name .. ".lua",
    SCRIPTS_DIR .. "/" .. name .. ".lua",
    MATRON_DIR .. "/norns/lib/" .. name .. ".lua",
  }
  for _, path in ipairs(candidates) do
    local f = io.open(path, "r")
    if f then
      f:close()
      local chunk, err = loadfile(path)
      if not chunk then error("include: " .. tostring(err)) end
      return chunk()
    end
  end
  -- fall back to require (uses package.path)
  local ok, mod = pcall(require, name)
  if ok then return mod end
  error("include: could not find '" .. name .. "'")
end

-- ---- script lifecycle ----------------------------------------------------
function core.cleanup()
  if type(_G.cleanup) == "function" then pcall(_G.cleanup) end
  metro.free_all()
  clock.cleanup()
  grid.cleanup()
  arc.cleanup()
  midi.cleanup()
  host.clear_all_timers()
  -- stop all softcut voices and reset per-voice state (buffer data preserved)
  softcut.reset_all()
  -- reset audio routing gains so next script starts from a clean slate
  host.send({ t = "audio_adc_cut", level = 0 })
  host.send({ t = "audio_eng_cut", level = 0 })
  -- reset lifecycle globals
  _G.init, _G.redraw, _G.enc, _G.key, _G.cleanup = nil, nil, nil, nil, nil
end

function core.safe_redraw()
  if type(_G.redraw) == "function" then
    local ok, err = pcall(_G.redraw)
    if not ok then host.send({ t = "log", level = "error", msg = "redraw: " .. tostring(err) }) end
    screen.flush()
  end
end

function core.load_script(path)
  core.cleanup()
  core.install_globals()

  local script_dir = path:match("^(.*)/[^/]+%.lua$") or "."
  core.set_paths(script_dir)
  local name = path:match("([^/]+)%.lua$") or "script"
  _G.norns.state.name = name
  _G.norns.state.shortname = name
  _G.norns.state.path = script_dir .. "/"
  _G.norns.state.lib = script_dir .. "/lib/"   -- scripts use norns.state.lib for bundled data (e.g. mlre)
  _G.paths.this = script_dir

  local chunk, err = loadfile(path)
  if not chunk then
    host.send({ t = "log", level = "error", msg = "load: " .. tostring(err) })
    return
  end
  local ok, run_err = pcall(chunk)
  if not ok then
    host.send({ t = "log", level = "error", msg = "script top-level: " .. tostring(run_err) })
    return
  end

  -- re-bind include now that script_dir is set (chunk may have reset _G.include)
  _G.include = core.include

  -- notify browser early so name badge updates immediately
  host.send({ t = "loading", name = name })

  if type(_G.init) == "function" then
    local iok, ierr = pcall(_G.init)
    if not iok then host.send({ t = "log", level = "error", msg = "init: " .. tostring(ierr) }) end
  end

  -- auto-load the default pset (the ">" one) if the script marked one. Done
  -- after init() so the values override the script defaults; meta is sent below
  -- and reads current values, so the loaded values reach the browser.
  if _G.params and _G.params.get_default then
    local dflt = _G.params:get_default()
    if dflt then
      local rok = _G.params:read(dflt)
      if rok then
        pcall(function() _G.params:bang() end)
        host.send({ t = "log", level = "info", msg = "pset: loaded default " .. tostring(dflt) })
      end
    end
  end

  grid.announce()
  core.safe_redraw()
  -- send meta after init() so params added during init are included
  host.send({ t = "meta", name = name, path = path, params = core.param_summary() })
  host.send({ t = "log", level = "info", msg = "loaded: " .. name })
end

function core.param_summary()
  return _G.params:dump()
end

return core
