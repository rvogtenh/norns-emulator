-- midi.lua — norns midi API bridged to WebMIDI in the browser.
-- Incoming messages (browser -> here) dispatch to device.event(data).
-- Outgoing (:send) are forwarded to the browser to emit via WebMIDI.

local host = require("norns.host")

local Midi = {}
Midi.__index = Midi

local midi = {}
midi.devices = {}

local function make(id)
  local m = setmetatable({}, Midi)
  m.id = id
  m.name = "virtual"
  m.event = nil        -- function(data)  data = {byte, byte, ...}
  return m
end

-- 16 virtual ports, like norns `midi.vports` (scripts iterate/`#` over these)
midi.vports = {}
for i = 1, 16 do
  local d = make(i)
  d.name = i == 1 and "virtual" or "none"
  d.connected = i == 1
  midi.vports[i] = d
end

function Midi:send(data)
  if type(data) == "table" and data.type then data = midi.to_data(data) end
  host.send({ t = "midi_out", dev = self.id, data = data })
end

function Midi:note_on(note, vel, ch)
  self:send({ 0x90 + ((ch or 1) - 1), note, vel or 100 })
end
function Midi:note_off(note, vel, ch)
  self:send({ 0x80 + ((ch or 1) - 1), note, vel or 0 })
end
function Midi:cc(cc, val, ch)
  self:send({ 0xB0 + ((ch or 1) - 1), cc, val })
end
function Midi:program_change(pgm, ch)
  self:send({ 0xC0 + ((ch or 1) - 1), pgm })
end
function Midi:start() self:send({ 0xFA }) end
function Midi:stop() self:send({ 0xFC }) end
function Midi:continue() self:send({ 0xFB }) end
function Midi:clock() self:send({ 0xF8 }) end

function midi.connect(n)
  n = n or 1
  if not midi.devices[n] then midi.devices[n] = make(n) end
  return midi.devices[n]
end

-- parse raw bytes into a message table (subset)
function midi.to_msg(data)
  local b = data[1] or 0
  local status = b & 0xF0
  local ch = (b & 0x0F) + 1
  local msg = { ch = ch, type = "other" }
  if status == 0x90 then
    msg.type = (data[3] and data[3] > 0) and "note_on" or "note_off"
    msg.note = data[2]; msg.vel = data[3]
  elseif status == 0x80 then
    msg.type = "note_off"; msg.note = data[2]; msg.vel = data[3]
  elseif status == 0xB0 then
    msg.type = "cc"; msg.cc = data[2]; msg.val = data[3]
  elseif status == 0xE0 then
    msg.type = "pitchbend"; msg.val = (data[2] or 0) + ((data[3] or 0) << 7)
  elseif b == 0xF8 then msg.type = "clock"
  elseif b == 0xFA then msg.type = "start"
  elseif b == 0xFB then msg.type = "continue"
  elseif b == 0xFC then msg.type = "stop"
  end
  return msg
end

function midi.to_data(msg)
  local ch = (msg.ch or 1) - 1
  if msg.type == "note_on" then return { 0x90 + ch, msg.note, msg.vel or 100 }
  elseif msg.type == "note_off" then return { 0x80 + ch, msg.note, msg.vel or 0 }
  elseif msg.type == "cc" then return { 0xB0 + ch, msg.cc, msg.val }
  elseif msg.type == "pitchbend" then return { 0xE0 + ch, (msg.val & 0x7F), (msg.val >> 7) & 0x7F }
  elseif msg.type == "clock" then return { 0xF8 }
  elseif msg.type == "start" then return { 0xFA }
  elseif msg.type == "stop" then return { 0xFC }
  end
  return {}
end

function midi._dispatch(dev, data)
  local m = midi.devices[dev] or midi.devices[1]
  if m and m.event then
    local ok, err = pcall(m.event, data)
    if not ok then host.send({ t = "log", level = "error", msg = "midi.event: " .. tostring(err) }) end
  end
end

function midi.cleanup()
  for _, m in pairs(midi.devices) do m.event = nil end
end

return midi
