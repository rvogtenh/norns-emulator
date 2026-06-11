-- screen.lua — norns Screen API.
-- Mirrors the real norns drawing model: a cairo-like path is built with
-- move/line/curve/rect/arc/circle and rendered with stroke() or fill();
-- text() draws immediately at the current point; level() sets brightness 0-15.
--
-- Drawing ops accumulate in a frame buffer and are flushed to the browser
-- (which replays them on a 128x64 canvas) when screen.update() is called.

local host = require("norns.host")

local M = {}
local ops = {}

local function emit(op) ops[#ops + 1] = op end

-- _norns is the native (C) layer on real norns. We back it with op emission
-- so that vendored norns library code that calls _norns.screen_* also works.
_norns = _norns or {}
local n = _norns

n.screen_clear      = function() emit({ "clear" }) end
n.screen_level      = function(v) emit({ "level", v }) end
n.screen_aa         = function(s) emit({ "aa", s }) end
n.screen_line_width = function(w) emit({ "line_width", w }) end
n.screen_line_cap   = function(s) emit({ "line_cap", s }) end
n.screen_line_join  = function(s) emit({ "line_join", s }) end
n.screen_miter_limit= function(l) emit({ "miter_limit", l }) end
n.screen_move       = function(x, y) emit({ "move", x, y }) end
n.screen_move_rel   = function(x, y) emit({ "move_rel", x, y }) end
n.screen_line       = function(x, y) emit({ "line", x, y }) end
n.screen_line_rel   = function(x, y) emit({ "line_rel", x, y }) end
n.screen_arc        = function(x, y, r, a1, a2) emit({ "arc", x, y, r, a1, a2 }) end
n.screen_circle     = function(x, y, r) emit({ "circle", x, y, r }) end
n.screen_rect       = function(x, y, w, h) emit({ "rect", x, y, w, h }) end
n.screen_curve      = function(x1,y1,x2,y2,x3,y3) emit({ "curve", x1,y1,x2,y2,x3,y3 }) end
n.screen_close      = function() emit({ "close" }) end
n.screen_stroke     = function() emit({ "stroke" }) end
n.screen_fill       = function() emit({ "fill" }) end
n.screen_text       = function(s) emit({ "text", s }) end
n.screen_text_right = function(s) emit({ "text_right", s }) end
n.screen_text_center= function(s) emit({ "text_center", s }) end
n.screen_text_rotate= function(x,y,s,d) emit({ "text_rotate", x, y, s, d }) end
n.screen_font_face  = function(i) emit({ "font_face", i }) end
n.screen_font_size  = function(s) emit({ "font_size", s }) end
n.screen_pixel      = function(x, y) emit({ "pixel", x, y }) end
n.screen_rotate     = function(r) emit({ "rotate", r }) end
n.screen_translate  = function(x, y) emit({ "translate", x, y }) end
n.screen_save       = function() emit({ "save" }) end
n.screen_restore    = function() emit({ "restore" }) end

-- Public Screen table (the `screen` global).
M.aa          = function(s) n.screen_aa(s) end
M.clear       = function() n.screen_clear() end
M.level       = function(v) n.screen_level(v) end
M.line_width  = function(w) n.screen_line_width(w) end
M.line_cap    = function(s) n.screen_line_cap(s) end
M.line_join   = function(s) n.screen_line_join(s) end
M.miter_limit = function(l) n.screen_miter_limit(l) end
M.move        = function(x, y) n.screen_move(x, y) end
M.move_rel    = function(x, y) n.screen_move_rel(x, y) end
M.line        = function(x, y) n.screen_line(x, y) end
M.line_rel    = function(x, y) n.screen_line_rel(x, y) end
M.arc         = function(x, y, r, a1, a2) n.screen_arc(x, y, r, a1, a2) end
M.circle      = function(x, y, r) n.screen_circle(x, y, r) end
M.rect        = function(x, y, w, h) n.screen_rect(x, y, w, h) end
M.curve       = function(x1,y1,x2,y2,x3,y3) n.screen_curve(x1,y1,x2,y2,x3,y3) end
M.close       = function() n.screen_close() end
M.stroke      = function() n.screen_stroke() end
M.fill        = function() n.screen_fill() end
M.text        = function(s) n.screen_text(tostring(s)) end
M.text_right  = function(s) n.screen_text_right(tostring(s)) end
M.text_center = function(s) n.screen_text_center(tostring(s)) end
M.text_rotate = function(x,y,s,d) n.screen_text_rotate(x, y, tostring(s), d) end
M.text_center_rotate = function(x,y,s,d) n.screen_text_rotate(x, y, tostring(s), d) end
M.font_face   = function(i) n.screen_font_face(i) end
M.font_size   = function(s) n.screen_font_size(s) end
M.pixel       = function(x, y) n.screen_pixel(x, y) end
M.rotate      = function(r) n.screen_rotate(r) end
M.translate   = function(x, y) n.screen_translate(x, y) end
M.save        = function() n.screen_save() end
M.restore     = function() n.screen_restore() end
M.ping        = function() end
M.sleep       = function() end
M.blend_mode  = function() end   -- canvas blend modes not rendered; accepted silently
M.invert      = function() end

-- text_extents is normally measured by cairo; approximate (refine client-side).
M.text_extents = function(str)
  return #tostring(str) * 5, 8
end

function M.update()
  host.send({ t = "frame", ops = ops })
  ops = {}
end

-- Flush whatever is buffered without a script-driven update (used at boot).
function M.flush()
  if #ops > 0 then M.update() end
end

return M
