// grid.js — virtual monome grid UI. Renders LED state and reports key events.

export class GridUI {
  constructor(el, onKey) {
    this.el = el;
    this.onKey = onKey; // (x, y, z) => void
    this.cols = 16;
    this.rows = 8;
    this.cells = [];
    this.pressed = new Set();
    this._down = false;
    this.build();
    // global pointer handling: works for mouse, touch and pen. A drag presses
    // every cell the pointer passes over (all held until release), matching the
    // prior mouse behaviour; touch uses elementFromPoint since the gesture is
    // implicitly captured to the first cell.
    window.addEventListener("pointermove", (e) => {
      if (!this._down) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el.classList.contains("cell")) this.press(+el.dataset.x, +el.dataset.y);
    });
    const end = () => { this._down = false; this.releaseAll(); };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  build() {
    this.el.innerHTML = "";
    this.el.style.gridTemplateColumns = `repeat(${this.cols}, 30px)`;
    this.cells = [];
    for (let y = 1; y <= this.rows; y++) {
      for (let x = 1; x <= this.cols; x++) {
        const c = document.createElement("div");
        c.className = "cell";
        c.dataset.x = x;
        c.dataset.y = y;
        c.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          c.releasePointerCapture?.(e.pointerId);  // let elementFromPoint drive drag-across
          this._down = true;
          this.press(x, y);
        });
        this.cells[(y - 1) * this.cols + (x - 1)] = c;
        this.el.appendChild(c);
      }
    }
  }

  resize(cols, rows) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols; this.rows = rows;
    this.build();
  }

  press(x, y) {
    const key = `${x},${y}`;
    if (this.pressed.has(key)) return;
    this.pressed.add(key);
    this.onKey(x, y, 1);
  }

  release(x, y) {
    const key = `${x},${y}`;
    if (!this.pressed.has(key)) return;
    this.pressed.delete(key);
    this.onKey(x, y, 0);
  }

  releaseAll() {
    for (const key of [...this.pressed]) {
      const [x, y] = key.split(",").map(Number);
      this.release(x, y);
    }
  }

  // data: flat row-major array of levels 0-15
  render(cols, rows, data) {
    this.resize(cols, rows);
    for (let i = 0; i < data.length; i++) {
      const lvl = data[i] || 0;
      const a = lvl / 15;
      const cell = this.cells[i];
      if (!cell) continue;
      cell.style.background = lvl === 0
        ? "#161616"
        : `rgba(255, 217, 160, ${0.12 + a * 0.88})`;
    }
  }
}
