// arc.js — virtual monome arc UI: 4 rings x 64 LEDs.
// Mouse wheel over a ring -> delta; drag rotation -> delta.

export class ArcUI {
  constructor(canvas, onDelta) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onDelta = onDelta; // (ring, delta) => void
    this.rings = 4;
    this.leds = 64;
    this.sensitivity = 5; // drag multiplier — settable via setSensitivity()
    this.ledLength = 8;   // radial length of each LED segment in px
    this.ledWidth  = 3;   // stroke width of each LED segment in px
    this.data = new Array(this.rings * this.leds).fill(0);
    this.dragRing = null;
    this.lastAngle = 0;
    this._bind();
    this.render(this.rings, this.leds, this.data);
  }

  setSensitivity(v) { this.sensitivity = Math.max(1, v); }
  setLedLength(v)   { this.ledLength = Math.max(2, v); this.render(this.rings, this.leds, this.data); }
  setLedWidth(v)    { this.ledWidth  = Math.max(1, v); this.render(this.rings, this.leds, this.data); }

  ringCenters() {
    const r = 60, gap = 10, y = 70;
    const centers = [];
    for (let i = 0; i < this.rings; i++) {
      centers.push({ x: 70 + i * (2 * r + gap) / 1.0 * 0 + 70 + i * 130, y, r });
    }
    // simpler: evenly spaced
    const out = [];
    for (let i = 0; i < this.rings; i++) out.push({ x: 70 + i * 130, y: 70, r: 55 });
    return out;
  }

  // Convert client coordinates to canvas pixel coordinates (accounts for CSS scaling).
  _toCanvas(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (this.canvas.width  / rect.width),
      y: (clientY - rect.top)  * (this.canvas.height / rect.height),
    };
  }

  ringAt(mx, my) {
    const centers = this.ringCenters();
    for (let i = 0; i < centers.length; i++) {
      const c = centers[i];
      const d = Math.hypot(mx - c.x, my - c.y);
      if (d < c.r + 10) return i + 1;
    }
    return null;
  }

  _bind() {
    this.canvas.addEventListener("wheel", (e) => {
      const { x, y } = this._toCanvas(e.clientX, e.clientY);
      const ring = this.ringAt(x, y);
      if (ring) {
        e.preventDefault();
        this.onDelta(ring, e.deltaY > 0 ? 1 : -1);
      }
    }, { passive: false });

    this.canvas.addEventListener("pointerdown", (e) => {
      const { x, y } = this._toCanvas(e.clientX, e.clientY);
      const ring = this.ringAt(x, y);
      if (ring) {
        e.preventDefault();
        this.dragRing = ring;
        this.canvas.setPointerCapture?.(e.pointerId);
        const c = this.ringCenters()[ring - 1];
        this.lastAngle = Math.atan2(y - c.y, x - c.x);
      }
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragRing) return;
      const { x, y } = this._toCanvas(e.clientX, e.clientY);
      const c = this.ringCenters()[this.dragRing - 1];
      const a = Math.atan2(y - c.y, x - c.x);
      let da = a - this.lastAngle;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      const delta = Math.round(da / (2 * Math.PI) * this.leds * this.sensitivity);
      if (delta !== 0) {
        this.onDelta(this.dragRing, delta);
        this.lastAngle = a;
      }
    });
    const endArc = () => { this.dragRing = null; };
    this.canvas.addEventListener("pointerup", endArc);
    this.canvas.addEventListener("pointercancel", endArc);
  }

  render(rings, leds, data) {
    this.rings = rings; this.leds = leds; this.data = data;
    const ctx = this.ctx;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const centers = this.ringCenters();
    for (let ring = 0; ring < rings; ring++) {
      const c = centers[ring];
      for (let i = 0; i < leds; i++) {
        const lvl = data[ring * leds + i] || 0;
        const ang = (i / leds) * 2 * Math.PI - Math.PI / 2;
        const a = lvl / 15;
        ctx.beginPath();
        const r1 = c.r - this.ledLength, r2 = c.r;
        ctx.moveTo(c.x + Math.cos(ang) * r1, c.y + Math.sin(ang) * r1);
        ctx.lineTo(c.x + Math.cos(ang) * r2, c.y + Math.sin(ang) * r2);
        ctx.strokeStyle = lvl === 0 ? "#1c1c1c" : `rgba(255,217,160,${0.15 + a * 0.85})`;
        ctx.lineWidth = this.ledWidth;
        ctx.stroke();
      }
    }
  }
}
