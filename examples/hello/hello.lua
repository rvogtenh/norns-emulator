-- hello
-- norns-emulator smoke test
--
-- E2/E3 change a value
-- K2/K3 nudge, K1 = alt
-- shows screen + encoders + keys

local value = 0
local big = 50
local alt = false
local blink = false

function init()
  print("hello from the norns-emulator")
  -- a redraw clock so the cursor blinks (demonstrates clock.run)
  clock.run(function()
    while true do
      clock.sleep(0.5)
      blink = not blink
      redraw()
    end
  end)
end

function enc(n, d)
  if n == 2 then value = util.clamp(value + d, 0, 100) end
  if n == 3 then big = util.clamp(big + d, 0, 100) end
  redraw()
end

function key(n, z)
  if n == 1 then alt = z == 1 end
  if z == 1 and n == 2 then value = util.clamp(value + (alt and -10 or 10), 0, 100) end
  if z == 1 and n == 3 then big = util.clamp(big + (alt and -10 or 10), 0, 100) end
  redraw()
end

function redraw()
  screen.clear()

  screen.level(15)
  screen.move(0, 10)
  screen.text("norns-emulator")
  screen.level(4)
  screen.move(0, 20)
  screen.text("hello")

  -- a value bar (E2)
  screen.level(2)
  screen.rect(0, 30, 100, 6)
  screen.stroke()
  screen.level(15)
  screen.rect(0, 30, value, 6)
  screen.fill()
  screen.move(104, 35)
  screen.text(value)

  -- a circle that grows with E3
  screen.level(alt and 15 or 6)
  screen.circle(110, 18, 2 + big / 10)
  screen.stroke()

  -- blinking caret
  if blink then
    screen.level(15)
    screen.rect(0, 44, 3, 8)
    screen.fill()
  end

  screen.level(3)
  screen.move(0, 62)
  screen.text("E2 bar  E3 circle  K1 alt")

  screen.update()
end

function cleanup() end
