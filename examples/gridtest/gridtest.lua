-- gridtest
-- grid + arc + clock + audio demo
--
-- grid: press cells to toggle a step sequencer
-- arc:  ring 1 = tempo, ring 2 = cutoff
-- audio: PolyPerc (enable audio in the panel)

engine.name = "PolyPerc"

local g = grid.connect()
local a = arc.connect()

local STEPS = 16
local ROWS = 8
local steps = {}          -- steps[col] = row (0 = off)
local playhead = 1
local cutoff = 1000

local function note_for_row(row)
  -- map 8 rows to a minor-ish scale (semitones from base)
  local scale = { 0, 3, 5, 7, 10, 12, 15, 17 }
  local base = 48 -- C3
  local idx = ROWS - row + 1
  local midi_note = base + (scale[idx] or 0)
  return 440 * 2 ^ ((midi_note - 69) / 12)
end

function init()
  for i = 1, STEPS do steps[i] = 0 end

  clock.run(function()
    while true do
      clock.sync(1 / 4) -- 16th notes
      playhead = (playhead % STEPS) + 1
      local row = steps[playhead]
      if row and row > 0 then
        engine.cutoff(cutoff)
        engine.hz(note_for_row(row))
      end
      grid_redraw()
      redraw()
    end
  end)

  grid_redraw()
  arc_redraw()
end

function g.key(x, y, z)
  if z == 1 then
    if x >= 1 and x <= STEPS and y >= 1 and y <= ROWS then
      steps[x] = (steps[x] == y) and 0 or y
      grid_redraw()
    end
  end
end

function a.delta(ring, d)
  if ring == 1 then
    clock.set_tempo(util.clamp(clock.get_tempo() + d, 20, 300))
  elseif ring == 2 then
    cutoff = util.clamp(cutoff + d * 50, 100, 16000)
  end
  arc_redraw()
  redraw()
end

function grid_redraw()
  g:all(0)
  for col = 1, STEPS do
    if steps[col] > 0 then g:led(col, steps[col], 8) end
  end
  -- playhead column
  for y = 1, ROWS do
    g:led(playhead, y, g.buffer and 0 or 0)
  end
  g:led(playhead, steps[playhead] > 0 and steps[playhead] or 1, 15)
  g:refresh()
end

function arc_redraw()
  a:all(0)
  local t = util.linlin(20, 300, 1, 64, clock.get_tempo())
  for i = 1, math.floor(t) do a:led(1, i, 6) end
  local c = util.linlin(100, 16000, 1, 64, cutoff)
  for i = 1, math.floor(c) do a:led(2, i, 6) end
  a:refresh()
end

function enc(n, d)
  if n == 1 then clock.set_tempo(util.clamp(clock.get_tempo() + d, 20, 300)) end
  if n == 3 then cutoff = util.clamp(cutoff + d * 100, 100, 16000) end
  redraw()
end

function key(n, z) end

function redraw()
  screen.clear()
  screen.level(15)
  screen.move(0, 10)
  screen.text("gridtest")
  screen.level(4)
  screen.move(0, 24)
  screen.text("tempo " .. math.floor(clock.get_tempo()) .. " bpm")
  screen.move(0, 34)
  screen.text("cutoff " .. math.floor(cutoff) .. " hz")
  screen.move(0, 48)
  screen.text("step " .. playhead .. "/" .. STEPS)
  screen.level(2)
  screen.move(0, 62)
  screen.text("press grid cells. enable audio.")
  screen.update()
end

function cleanup() end
