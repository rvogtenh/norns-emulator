// screen.js — replays norns screen ops onto a 128x64 canvas.
// Follows the cairo-like model: move/line/rect/arc/curve build a path,
// stroke()/fill() render it at the current level; text() draws at the
// current point; level sets grayscale brightness (0-15).

const W = 128, H = 64, SCALE = 5;

// norns screen.font_face(n) indices → CSS family names (== norns/resources file
// stems, loaded as @font-face in css/fonts.css). 1-based, matching norns'
// Screen.font_face_names. Index 1 ("norns") is the default device screen font.
// The bmp/* faces are .bdf bitmap fonts the browser can't load; they fall back
// to the norns default rather than Courier (whose wide metrics overlap text).
const FONT_FACE_NAMES = [
  "norns", "liquid",
  "Roboto-Thin", "Roboto-Light", "Roboto-Regular", "Roboto-Medium",
  "Roboto-Bold", "Roboto-Black", "Roboto-ThinItalic", "Roboto-LightItalic",
  "Roboto-Italic", "Roboto-MediumItalic", "Roboto-BoldItalic", "Roboto-BlackItalic",
  "VeraBd", "VeraBI", "VeraIt", "VeraMoBd", "VeraMoBI", "VeraMoIt", "VeraMono",
  "VeraSeBd", "VeraSe", "Vera",
  "bmp/tom-thumb", "bmp/creep", "bmp/ctrld-fixed-10b", "bmp/ctrld-fixed-10r",
  "bmp/ctrld-fixed-13b", "bmp/ctrld-fixed-13b-i", "bmp/ctrld-fixed-13r", "bmp/ctrld-fixed-13r-i",
  "bmp/ctrld-fixed-16b", "bmp/ctrld-fixed-16b-i", "bmp/ctrld-fixed-16r", "bmp/ctrld-fixed-16r-i",
  "bmp/scientifica-11", "bmp/scientificaBold-11", "bmp/scientificaItalic-11",
  "bmp/ter-u12b", "bmp/ter-u12n", "bmp/ter-u14b", "bmp/ter-u14n", "bmp/ter-u14v",
  "bmp/ter-u16b", "bmp/ter-u16n", "bmp/ter-u16v", "bmp/ter-u18b", "bmp/ter-u18n",
  "bmp/ter-u20b", "bmp/ter-u20n", "bmp/ter-u22b", "bmp/ter-u22n", "bmp/ter-u24b",
  "bmp/ter-u24n", "bmp/ter-u28b", "bmp/ter-u28n", "bmp/ter-u32b", "bmp/ter-u32n",
  "bmp/unscii-16-full", "bmp/unscii-16", "bmp/unscii-8-alt", "bmp/unscii-8-fantasy",
  "bmp/unscii-8-mcr", "bmp/unscii-8", "bmp/unscii-8-tall", "bmp/unscii-8-thin",
  "Particle", "04B_03__",
];

export class Screen {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    this.ctx = canvas.getContext("2d");
    this.ctx.scale(SCALE, SCALE);
    // User-selectable base font for font_face 1 (the norns default). Set before
    // reset() so it picks it up. Persists across reset() / script reloads.
    this.defaultFont = "norns";
    this.lastOps = null;       // last frame's ops, replayed when the font changes
    this.reset();
    this.clearAll();
    // Preload the default screen font: the canvas doesn't reflow when a web
    // font arrives later, so kick off loading now. norns scripts redraw
    // continuously, so the correct metrics appear within a frame or two.
    if (typeof document !== "undefined" && document.fonts) {
      Promise.all([
        document.fonts.load('8px "norns"'),
        document.fonts.load('8px "Roboto-Regular"'),
      ]).catch(() => {});
    }
  }

  reset() {
    this.level = 15;
    this.lineWidth = 1;
    this.fontSize = 8;
    this.fontName = this.defaultFont || "norns";  // current face (font_face 1 = default)
    this.aa = 0;
    this.cx = 0;
    this.cy = 0;
    this.path = new Path2D();
    this.pathStart = null;
  }

  color() {
    const c = Math.round((this.level / 15) * 255);
    return `rgb(${c},${c},${c})`;
  }

  clearAll() {
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, W, H);
  }

  setFont() {
    // Fall back to the norns default font (not Courier) so unmapped/bitmap
    // faces keep the narrow metrics norns scripts position text against.
    this.ctx.font = `${this.fontSize}px "${this.fontName}", "norns", monospace`;
    this.ctx.textBaseline = "alphabetic";
  }

  // Change the base screen font (font_face 1) and immediately repaint the last
  // frame so the new font is visible without waiting for the script to redraw.
  setDefaultFont(name) {
    this.defaultFont = name || "norns";
    this.fontName = this.defaultFont;
    const repaint = () => { if (this.lastOps) this.render(this.lastOps); };
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.load(`8px "${this.defaultFont}"`).then(repaint).catch(repaint);
    } else {
      repaint();
    }
  }

  render(ops) {
    this.lastOps = ops;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    for (const op of ops) {
      const k = op[0];
      switch (k) {
        case "clear":
          this.clearAll();
          this.path = new Path2D();
          break;
        case "level":
          this.level = op[1];
          break;
        case "aa":
          this.aa = op[1];
          break;
        case "line_width":
          this.lineWidth = op[1];
          break;
        case "font_size":
          this.fontSize = op[1];
          break;
        case "font_face": {
          const i = op[1] || 1;
          // font_face 1 = the norns default → honour the user's chosen base font.
          this.fontName = (i === 1) ? this.defaultFont
                                    : (FONT_FACE_NAMES[i - 1] || this.defaultFont);
          break;
        }
        case "move":
          this.cx = op[1]; this.cy = op[2];
          this.path.moveTo(this.cx, this.cy);
          break;
        case "move_rel":
          this.cx += op[1]; this.cy += op[2];
          this.path.moveTo(this.cx, this.cy);
          break;
        case "line":
          this.cx = op[1]; this.cy = op[2];
          this.path.lineTo(this.cx, this.cy);
          break;
        case "line_rel":
          this.cx += op[1]; this.cy += op[2];
          this.path.lineTo(this.cx, this.cy);
          break;
        case "rect":
          this.path.rect(op[1], op[2], op[3], op[4]);
          this.cx = op[1]; this.cy = op[2];
          break;
        case "circle":
          this.path.moveTo(op[1] + op[3], op[2]);
          this.path.arc(op[1], op[2], op[3], 0, Math.PI * 2);
          break;
        case "arc":
          this.path.arc(op[1], op[2], op[3], op[4], op[5]);
          break;
        case "curve":
          this.path.bezierCurveTo(op[1], op[2], op[3], op[4], op[5], op[6]);
          this.cx = op[5]; this.cy = op[6];
          break;
        case "close":
          this.path.closePath();
          break;
        case "stroke": {
          ctx.strokeStyle = this.color();
          ctx.lineWidth = this.lineWidth;
          ctx.stroke(this.path);
          this.path = new Path2D();
          this.path.moveTo(this.cx, this.cy);
          break;
        }
        case "fill": {
          ctx.fillStyle = this.color();
          ctx.fill(this.path);
          this.path = new Path2D();
          this.path.moveTo(this.cx, this.cy);
          break;
        }
        case "pixel":
          ctx.fillStyle = this.color();
          ctx.fillRect(op[1], op[2], 1, 1);
          break;
        case "text":
          this.drawText(op[1], "left");
          break;
        case "text_right":
          this.drawText(op[1], "right");
          break;
        case "text_center":
          this.drawText(op[1], "center");
          break;
        case "text_rotate":
          this.drawTextRotate(op[1], op[2], op[3], op[4]);
          break;
        case "translate":
          ctx.translate(op[1], op[2]);
          break;
        case "rotate":
          ctx.rotate(op[1]);
          break;
        case "save":
          ctx.save();
          break;
        case "restore":
          ctx.restore();
          break;
        default:
          break;
      }
    }
  }

  drawText(str, align) {
    const ctx = this.ctx;
    this.setFont();
    ctx.fillStyle = this.color();
    const w = ctx.measureText(str).width;
    let x = this.cx;
    if (align === "right") x = this.cx - w;
    else if (align === "center") x = this.cx - w / 2;
    ctx.fillText(str, x, this.cy);
    if (align === "left") this.cx += w; // cairo advances current point
  }

  drawTextRotate(x, y, str, degrees) {
    const ctx = this.ctx;
    this.setFont();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.fillStyle = this.color();
    ctx.fillText(str, 0, 0);
    ctx.restore();
  }
}
