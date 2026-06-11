// glut.js — WebAudio reimplementation of the Glut norns engine (granular
// sampler, used by the `glut` script). 7 voices, each a granular cloud over a
// loaded sample: grains spawn at `density` Hz, each a `size`-second window read
// at the scanning position (advanced by `speed`, jittered by `jitter`), pitched
// by `pitch`, panned at `pan` ± `spread`. An ASR gate envelope (scaled by
// `envscale`) fades the whole voice in/out. Global FreeVerb-style reverb.
//
// Voices arrive 1-indexed from Lua (the SC engine does msg[1]-1); we map to 0-6.

const NVOICES = 7;
const LOOKAHEAD = 0.1;   // seconds scheduled ahead
const TICK_MS = 25;      // scheduler interval

export class Glut {
  constructor(ctx, destination, log, basePath = "", onPoll = null) {
    this.ctx = ctx;
    this.log = log || (() => {});
    this.basePath = basePath;
    this.onPoll = onPoll;     // (name, value) — emit engine polls (phase_N/level_N)
    this._lastPoll = 0;

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(destination);

    // reverb bus (convolver) — wet level set by reverb_mix
    this.reverb = ctx.createConvolver();
    this._room = 0.5; this._damp = 0.5;
    this.reverb.buffer = this._makeImpulse(this._room, this._damp);
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0.5;
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(this.reverb);
    this.reverb.connect(this.reverbWet);
    this.reverbWet.connect(this.master);

    this.voices = [];
    for (let i = 0; i < NVOICES; i++) {
      const env = ctx.createGain();   // gate ASR envelope
      env.gain.value = 0;
      const vol = ctx.createGain();   // linear volume (gain)
      vol.gain.value = 1;
      env.connect(vol);
      vol.connect(this.master);
      vol.connect(this.reverbIn);
      this.voices.push({
        buffer: null,
        gateOn: false,
        gateOffAt: 0,
        pos: 0,          // scan position 0..1
        freeze: false,
        speed: 1,
        jitter: 0,       // seconds
        size: 0.1,       // seconds
        density: 20,     // hz
        pitch: 1,        // playback ratio
        pan: 0,
        spread: 0,
        envscale: 1,     // seconds
        env, vol,
        nextGrain: 0,
      });
    }

    this._lastTick = ctx.currentTime;
    this._timer = setInterval(() => this._schedule(), TICK_MS);
  }

  _makeImpulse(room, damp) {
    const rate = this.ctx.sampleRate;
    const seconds = 0.3 + room * 2.5;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, (damp * 4) + 1);
      }
    }
    return buf;
  }

  async read(voice, path) {
    const i = voice - 1;
    if (i < 0 || i >= NVOICES) return;
    if (!path || path === '-') return;  // empty sample param — nothing to load
    try {
      const url = `${this.basePath}/api/audio?path=${encodeURIComponent(path)}`;
      const res = await fetch(url);
      if (!res.ok) { this.log(`glut: cannot load "${path}" (${res.status})`); return; }
      const arrayBuf = await res.arrayBuffer();
      this.voices[i].buffer = await this.ctx.decodeAudioData(arrayBuf);
      this.log(`glut: voice ${voice} loaded ${path.split('/').pop()}`);
    } catch (e) {
      this.log(`glut: read error — ${e.message}`);
    }
  }

  _schedule() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dt = now - this._lastTick;
    this._lastTick = now;
    const horizon = now + LOOKAHEAD;

    // emit phase_N / level_N polls at ~20 Hz (glut polls them for grid display)
    const emitPoll = this.onPoll && (now - this._lastPoll >= 0.05);
    if (emitPoll) this._lastPoll = now;

    for (let vi = 0; vi < this.voices.length; vi++) {
      const v = this.voices[vi];
      if (!v.buffer) continue;
      const dur = v.buffer.duration;

      // advance scan position (unless frozen)
      if (!v.freeze && dur > 0) {
        v.pos += (v.speed / dur) * dt;
        v.pos = v.pos - Math.floor(v.pos);  // wrap 0..1
      }

      if (emitPoll) {
        this.onPoll(`phase_${vi + 1}`, v.pos);
        this.onPoll(`level_${vi + 1}`, v.env.gain.value);
      }

      // is the voice audible? (gate on, or still within release tail)
      const audible = v.gateOn || now < v.gateOffAt + v.envscale + 0.05;
      if (!audible || v.density <= 0) { v.nextGrain = now; continue; }

      if (v.nextGrain < now) v.nextGrain = now;
      const interval = 1 / v.density;
      while (v.nextGrain < horizon) {
        this._spawnGrain(v, v.nextGrain, dur);
        v.nextGrain += interval;
      }
    }
  }

  _spawnGrain(v, tg, dur) {
    const ctx = this.ctx;
    const jitterN = dur > 0 ? v.jitter / dur : 0;
    let posN = v.pos + (Math.random() * 2 - 1) * jitterN;
    posN = posN - Math.floor(posN);                 // wrap 0..1
    const startSec = Math.min(posN * dur, Math.max(0, dur - 0.001));
    const size = Math.max(0.005, v.size);

    const src = ctx.createBufferSource();
    src.buffer = v.buffer;
    src.playbackRate.value = Math.max(0.01, v.pitch);

    // triangular grain window
    const win = ctx.createGain();
    win.gain.setValueAtTime(0, tg);
    win.gain.linearRampToValueAtTime(1, tg + size / 2);
    win.gain.linearRampToValueAtTime(0, tg + size);

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, v.pan + (Math.random() * 2 - 1) * v.spread));

    src.connect(win).connect(pan).connect(v.env);
    src.start(tg, startSec, size * src.playbackRate.value + 0.02);
    src.stop(tg + size + 0.02);
  }

  _gate(v, on) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const scale = Math.max(0.001, v.envscale);
    v.env.gain.cancelScheduledValues(t);
    v.env.gain.setValueAtTime(v.env.gain.value, t);
    if (on) {
      v.gateOn = true;
      v.env.gain.linearRampToValueAtTime(1, t + scale);
    } else {
      v.gateOn = false;
      v.gateOffAt = t;
      v.env.gain.linearRampToValueAtTime(0, t + scale);
    }
  }

  set(cmd, args) {
    // global reverb
    switch (cmd) {
      case 'reverb_mix':  this.reverbWet.gain.setTargetAtTime(args[0], this.ctx.currentTime, 0.02); return;
      case 'reverb_room': this._room = args[0]; this.reverb.buffer = this._makeImpulse(this._room, this._damp); return;
      case 'reverb_damp': this._damp = args[0]; this.reverb.buffer = this._makeImpulse(this._room, this._damp); return;
      case 'read':        this.read(args[0], args[1]); return;
    }
    const i = args[0] - 1;
    if (i < 0 || i >= NVOICES) return;
    const v = this.voices[i];
    const x = args[1];
    switch (cmd) {
      case 'gate':     this._gate(v, x !== 0); return;
      case 'seek':     v.pos = x - Math.floor(x); v.freeze = false; return;
      case 'speed':    v.speed = x; break;
      case 'jitter':   v.jitter = x; break;
      case 'size':     v.size = x; break;
      case 'density':  v.density = x; break;
      case 'pitch':    v.pitch = x; break;
      case 'pan':      v.pan = x; break;
      case 'spread':   v.spread = x; break;
      case 'volume':   v.vol.gain.setTargetAtTime(x, this.ctx.currentTime, 0.02); break;
      case 'envscale': v.envscale = x; break;
      default: break;
    }
  }

  dispose() {
    if (this._timer) clearInterval(this._timer);
  }
}
