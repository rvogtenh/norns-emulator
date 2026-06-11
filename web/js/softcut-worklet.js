// softcut-worklet.js — AudioWorklet processor for norns softcut emulation.
// 6 independent voices share a 2-channel buffer of BUFFER_SECS seconds.
// Voice parameters are updated via port.onmessage; phase events are sent back.

const VOICE_COUNT = 6;
// Real norns softcut buffer is 350s. Scripts place samples at fixed offsets
// across that span — e.g. Cheat Codes 2 lays out 3 clips on ch2 at 1/33/65s
// (clip 3 spans 65–97s) and live buffers + delays + monitor voices on ch1 up
// to ~101s. A 60s buffer truncated clip 2/3 and the delay/monitor regions,
// producing silence or modulo-wrapped garbage. 128s covers CC2's full layout
// at ~49MB (128 * 48000 * 2ch * 4 bytes); still well within browser limits.
const BUFFER_SECS = 128;

class SoftcutProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const len = Math.ceil(BUFFER_SECS * sampleRate);
    this.bufLen = len;
    this.buf = [new Float32Array(len), new Float32Array(len)];

    this.voices = Array.from({ length: VOICE_COUNT }, () => ({
      play: false, rec: false,
      rate: 1.0,
      level: 1.0, pan: 0.0,
      loop: true,
      loopStart: 0,          // samples
      loopEnd: sampleRate,   // samples (default: 1 second)
      pos: 0,                // read/write head position (samples, float)
      ended: false,          // non-looping one-shot reached its end (silent until re-triggered)
      recLevel: 1.0, preLevel: 0.0,
      fadeTime: 0,           // samples
      bufCh: 0,              // 0 or 1
      inputLevels: [0.0, 0.0],  // inputLevels[adcCh] → how much of ADC ch feeds this voice
      // phase
      phaseQuant: 0,         // samples; 0 = no phase events
      pollPhase: false,
      lastPhase: -1,
      // post-filter (Chamberlin SVF)
      fc: 20000.0, rq: 0.5,
      mixLp: 0.0, mixHp: 0.0, mixBp: 0.0, mixBr: 0.0, mixDry: 1.0,
      fz1: 0, fz2: 0,        // SVF state: fz1=bp, fz2=lp
    }));

    // Per-channel flag: has real audio been written yet?
    this._hasData  = [false, false];
    // Pending render requests that arrived before the buffer was filled.
    this._renderQ  = [];

    this.port.onmessage = (e) => this._cmd(e.data);
  }

  _cmd(msg) {
    const { cmd, voice, args } = msg;
    const vi = (voice || 0) - 1;
    const s = (vi >= 0 && vi < VOICE_COUNT) ? this.voices[vi] : null;

    switch (cmd) {
      case 'play':    if (s) { s.play = args[0] !== 0; if (s.play) s.ended = false; } break;
      case 'enable':  if (s) { s.play = args[0] !== 0; if (s.play) s.ended = false; } break;
      case 'rec':     if (s) s.rec  = args[0] !== 0; break;

      case 'rate':       if (s) s.rate = args[0]; break;
      // Setting position re-arms a one-shot: clear the ended flag so a
      // re-triggered pad (CC2 sends position+rate+level, never play) resumes.
      case 'position':   if (s) { s.pos = Math.max(0, args[0]) * sampleRate; s.ended = false; } break;

      case 'loop':       if (s) { s.loop = args[0] !== 0; if (s.loop) s.ended = false; } break;
      case 'loop_start': if (s) s.loopStart = Math.max(0, args[0]) * sampleRate; break;
      case 'loop_end':   if (s) s.loopEnd   = Math.min(BUFFER_SECS, args[0]) * sampleRate; break;

      case 'level':      if (s) s.level    = args[0]; break;
      case 'rec_level':  if (s) s.recLevel = args[0]; break;
      case 'pre_level':  if (s) s.preLevel = args[0]; break;
      case 'fade_time':  if (s) s.fadeTime = args[0] * sampleRate; break;
      case 'rec_offset': break;  // write-head offset — stubbed

      case 'pan':    if (s) s.pan   = Math.max(-1, Math.min(1, args[0])); break;
      case 'buffer': if (s) s.bufCh = Math.max(0, (args[0] || 1) - 1) % 2; break;

      case 'level_input_cut':
      case 'level_adc_cut':
        if (s) { const ch = Math.max(0, (args[0] || 1) - 1) % 2; s.inputLevels[ch] = args[1] || 0; }
        break;
      case 'level_cut_cut': break;
      case 'level_cut_dac':   break;

      // slew — not yet interpolated, treat as instant
      case 'level_slew_time': break;
      case 'pan_slew_time':   break;
      case 'rate_slew_time':  break;

      // post-filter
      case 'post_filter_lp':  if (s) s.mixLp = args[0]; break;
      case 'post_filter_hp':  if (s) s.mixHp = args[0]; break;
      case 'post_filter_bp':  if (s) s.mixBp = args[0]; break;
      case 'post_filter_br':  if (s) s.mixBr = args[0]; break;
      case 'post_filter_dry': if (s) s.mixDry = args[0]; break;
      case 'filter_dry':      if (s) s.mixDry = args[0]; break;
      case 'post_filter_fc':  if (s) { s.fc = args[0]; } break;
      case 'post_filter_rq':  if (s) { s.rq = args[0]; } break;

      // phase
      case 'phase_quant':
        if (s) {
          s.phaseQuant = (args[0] || 0) * sampleRate;
          s.lastPhase = -1;
        }
        break;
      case 'poll_start_phase': this.voices.forEach(v => { v.pollPhase = true; }); break;
      case 'poll_stop_phase':  this.voices.forEach(v => { v.pollPhase = false; }); break;

      case 'voice_sync': break;  // stubbed

      case 'reset_all':
        this.voices.forEach(v => {
          v.play = false; v.rec = false;
          v.rate = 1.0; v.level = 1.0; v.pan = 0.0;
          v.loop = true; v.loopStart = 0; v.loopEnd = sampleRate;
          v.pos = 0; v.ended = false;
          v.recLevel = 1.0; v.preLevel = 0.0; v.fadeTime = 0;
          v.bufCh = 0; v.inputLevels = [0.0, 0.0];
          v.phaseQuant = 0; v.pollPhase = false; v.lastPhase = -1;
          v.fc = 20000.0; v.rq = 0.5;
          v.mixLp = 0.0; v.mixHp = 0.0; v.mixBp = 0.0; v.mixBr = 0.0; v.mixDry = 1.0;
          v.fz1 = 0; v.fz2 = 0; v._recLogged = false;
        });
        break;

      // buffer ops
      case 'buffer_clear':
        this.buf[0].fill(0); this.buf[1].fill(0);
        this._hasData[0] = false; this._hasData[1] = false;
        this._renderQ = [];
        break;
      case 'buffer_clear_channel': {
        const cc = Math.max(0, (args[0] || 1) - 1) % 2;
        this.buf[cc].fill(0);
        this._hasData[cc] = false;
        this._renderQ = this._renderQ.filter(r => r[0] !== cc);
        break;
      }
      case 'buffer_clear_region': {
        const st  = Math.max(0, Math.floor(args[0] * sampleRate));
        const end = Math.min(this.bufLen, st + Math.floor(args[1] * sampleRate));
        this.buf[0].fill(0, st, end); this.buf[1].fill(0, st, end); break;
      }
      case 'buffer_clear_region_channel': {
        const ch  = Math.max(0, (args[0] || 1) - 1) % 2;
        const st  = Math.max(0, Math.floor(args[1] * sampleRate));
        const end = Math.min(this.bufLen, st + Math.floor(args[2] * sampleRate));
        this.buf[ch].fill(0, st, end); break;
      }
      // internal: main thread delivers decoded audio (Float32Array, transferred)
      case 'phase_offset': break;  // hardware phase sync offset — no-op
      case 'buffer_copy_mono': {
        const [chSrc, chDst, startSrc, startDst, dur] = args;
        const s  = Math.max(0, (chSrc || 1) - 1) % 2;
        const d  = Math.max(0, (chDst || 1) - 1) % 2;
        const ss = Math.floor((startSrc || 0) * sampleRate);
        const ds = Math.floor((startDst || 0) * sampleRate);
        const n  = dur > 0 ? Math.floor(dur * sampleRate) : this.bufLen - ss;
        const cnt = Math.min(n, this.bufLen - ds, this.bufLen - ss);
        if (cnt > 0) {
          const tmp = this.buf[s].slice(ss, ss + cnt);
          this.buf[d].set(tmp, ds);
        }
        break;
      }
      case 'render_buffer': {
        const [ch, startSec, durSec, nSamples] = args;
        const chIdx = Math.max(0, (ch || 1) - 1) % 2;
        if (!this._hasData[chIdx]) {
          // Buffer not filled yet — queue this request so it fires once data arrives.
          this._renderQ.push([chIdx, ch || 1, startSec || 0, durSec || 1, nSamples || 128]);
        } else {
          this._doRender(chIdx, ch || 1, startSec || 0, durSec || 1, nSamples || 128);
        }
        break;
      }
      case '_buffer_write': {
        const ch  = Math.max(0, (msg.ch || 1) - 1) % 2;
        const off = Math.max(0, Math.floor((msg.offset || 0) * sampleRate));
        const data = msg.data;
        const n = Math.min(data.length, this.bufLen - off);
        if (n > 0) {
          this.buf[ch].set(data.subarray(0, n), off);
          this._hasData[ch] = true;
          // Fire any render requests that were waiting for this channel's data.
          const pending = this._renderQ.filter(r => r[0] === ch);
          this._renderQ  = this._renderQ.filter(r => r[0] !== ch);
          for (const [, rawCh, start, dur, ns] of pending) {
            this._doRender(ch, rawCh, start, dur, ns);
          }
        }
        break;
      }
      default: break;
    }
  }

  // Downsample a buffer region to n amplitude points and send to main thread.
  _doRender(chIdx, rawCh, startSec, durSec, nSamples) {
    const startS = Math.floor(startSec * sampleRate);
    const durS   = Math.max(1, Math.floor(durSec * sampleRate));
    const n      = Math.max(1, Math.floor(nSamples));
    const step   = durS / n;
    const out    = new Array(n);
    for (let i = 0; i < n; i++) {
      const pos = (startS + Math.floor(i * step)) % this.bufLen;
      out[i] = Math.abs(this.buf[chIdx][pos] || 0);
    }
    this.port.postMessage({ t: 'softcut_render', ch: rawCh, start: startSec, samples: out });
  }

  // Trapezoidal (TPT) state-variable filter — unconditionally stable at all
  // sample rates and cutoff frequencies, including fc near Nyquist.
  // Based on Mystran / Zolzer topology-preserving transform.
  _svf(s, x) {
    const fc = Math.min(Math.max(s.fc, 1), sampleRate * 0.499);
    const g  = Math.tan(Math.PI * fc / sampleRate);
    const k  = Math.max(0.001, s.rq);   // rq = 1/Q
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - s.fz2;
    const v1 = a1 * s.fz1 + a2 * v3;
    const v2 = s.fz2 + a2 * s.fz1 + a3 * v3;
    s.fz1 = 2 * v1 - s.fz1;
    s.fz2 = 2 * v2 - s.fz2;
    const lp = v2;
    const bp = v1;
    const hp = x - k * v1 - v2;
    const br = lp + hp;   // notch
    return s.mixDry * x + s.mixLp * lp + s.mixHp * hp + s.mixBp * bp + s.mixBr * br;
  }

  // Linear interpolation read from a buffer channel.
  _read(ch, pos) {
    const len = this.bufLen;
    const i = Math.floor(pos) % len;
    const f = pos - Math.floor(pos);
    return this.buf[ch][i] + f * (this.buf[ch][(i + 1) % len] - this.buf[ch][i]);
  }

  // Fade envelope near loop boundaries.
  _fade(s, pos) {
    if (s.fadeTime <= 0) return 1.0;
    const ds = pos - s.loopStart;
    const de = s.loopEnd - pos;
    const d  = Math.min(Math.max(0, ds), Math.max(0, de));
    return Math.min(1.0, d / s.fadeTime);
  }

  process(inputs, outputs) {
    // Guard against missing output buffers (can happen in some browser configurations).
    if (!outputs || !outputs[0] || !outputs[0][0]) return true;
    const outL = outputs[0][0];
    const outR = outputs[0][1] || outputs[0][0];
    const inp  = (inputs && inputs[0]) || [];
    const inL  = inp[0] || null;   // ADC ch1 (left)
    const inR  = inp[1] || inL;    // ADC ch2 (right) fallback to mono
    const n    = outL.length;

    for (let vi = 0; vi < VOICE_COUNT; vi++) {
      const s = this.voices[vi];
      if (!s.play && !s.rec) continue;

      const loopLen = s.loopEnd - s.loopStart;
      if (loopLen <= 0) continue;

      // One-time diagnostic: log when rec first activates to confirm mic data.
      if (s.rec && !s._recLogged) {
        s._recLogged = true;
        const peakL = inL ? inL.reduce((m, v) => Math.max(m, Math.abs(v)), 0) : 0;
        const peakR = inR ? inR.reduce((m, v) => Math.max(m, Math.abs(v)), 0) : 0;
        this.port.postMessage({ t: 'softcut_log',
          msg: `rec v${vi+1}: levels=[${s.inputLevels}] peakL=${peakL.toFixed(4)} peakR=${peakR.toFixed(4)}` });
      }

      for (let i = 0; i < n; i++) {
        const p = Math.max(s.loopStart, s.pos);

        if (s.rec) {
          // Mix ADC channels according to the per-channel levels matrix.
          const inSmp = (inL ? inL[i] * s.inputLevels[0] : 0)
                      + (inR ? inR[i] * s.inputLevels[1] : 0);
          const idx = Math.floor(p) % this.bufLen;
          this.buf[s.bufCh][idx] =
            s.preLevel * this.buf[s.bufCh][idx] + s.recLevel * inSmp;
          // First write: mark channel as having data and flush pending renders.
          if (!this._hasData[s.bufCh]) {
            this._hasData[s.bufCh] = true;
            const pending = this._renderQ.filter(r => r[0] === s.bufCh);
            this._renderQ  = this._renderQ.filter(r => r[0] !== s.bufCh);
            for (const [, rawCh, start, dur, ns] of pending) {
              this._doRender(s.bufCh, rawCh, start, dur, ns);
            }
          }
        }

        if (s.play && !s.ended) {
          const raw = this._read(s.bufCh, p);
          const sig = this._svf(s, raw) * this._fade(s, p) * s.level;
          // Equal-power pan: pan in [-1, 1] → angle in [0, π/2]
          const angle = (s.pan + 1) * Math.PI * 0.25;
          if (outL) outL[i] += sig * Math.cos(angle);
          if (outR) outR[i] += sig * Math.sin(angle);
        }

        s.pos += s.rate;

        // Loop wrap
        if (s.loop) {
          if (s.rate >= 0 && s.pos >= s.loopEnd) {
            s.pos = s.loopStart + (s.pos - s.loopEnd) % loopLen;
          } else if (s.rate < 0 && s.pos < s.loopStart) {
            s.pos = s.loopEnd - (s.loopStart - s.pos) % loopLen;
          }
        } else if (s.pos >= s.loopEnd || s.pos < s.loopStart) {
          // Non-looping one-shot finished: freeze at the boundary and go silent,
          // but keep the voice ENABLED (s.play stays true). Scripts like Cheat
          // Codes 2 re-trigger a pad by resetting position/level/rate and never
          // re-send play=1 — disabling the voice here muted it permanently after
          // the first hit. s.ended is cleared when a new position is set.
          s.pos = s.rate >= 0 ? s.loopEnd : s.loopStart;
          s.ended = true;
          break;
        }
      }

      // Phase reporting — once per 128-sample block to limit message rate.
      if (s.pollPhase && s.phaseQuant > 0) {
        if (s.lastPhase < 0 || Math.abs(s.pos - s.lastPhase) >= s.phaseQuant) {
          s.lastPhase = s.pos;
          this.port.postMessage({ t: 'softcut_phase', voice: vi + 1, pos: s.pos / sampleRate });
        }
      }
    }

    return true;
  }
}

registerProcessor('softcut-processor', SoftcutProcessor);
