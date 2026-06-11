// ack.js — WebAudio reimplementation of the Ack norns engine (used by cyrene,
// and other Ack-based drum scripts). 8 channels, each plays a loaded sample
// with per-channel volume / pan / speed / filter / AR envelope and delay+reverb
// sends. Channels are 0-indexed (matching the SuperCollider engine commands).

const NUM_CH = 8;

function dbToLin(db) {
  if (db == null || db <= -59 || db === -Infinity) return 0;
  return Math.pow(10, db / 20);
}

export class Ack {
  constructor(ctx, destination, log, basePath = "") {
    this.ctx = ctx;
    this.log = log || (() => {});
    this.basePath = basePath;

    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(destination);

    // ── delay bus (mono feedback delay) ──
    this.delay = ctx.createDelay(5);
    this.delay.delayTime.value = 0.1;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.5;
    this.delayLevel = ctx.createGain();
    this.delayLevel.gain.value = dbToLin(-10);
    this.delayInput = ctx.createGain();
    this.delayInput.connect(this.delay);
    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);          // feedback loop
    this.delay.connect(this.delayLevel);
    this.delayLevel.connect(this.master);

    // ── reverb bus (convolver with a generated impulse) ──
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(0.5, 0.5);
    this.reverbLevel = ctx.createGain();
    this.reverbLevel.gain.value = dbToLin(-10);
    this.reverbInput = ctx.createGain();
    this.reverbInput.connect(this.reverb);
    this.reverb.connect(this.reverbLevel);
    this.reverbLevel.connect(this.master);

    // ── per-channel state ──
    this.ch = [];
    for (let i = 0; i < NUM_CH; i++) {
      this.ch.push({
        buffer: null,
        start: 0, end: 1,
        loop: false, loopPoint: 0,
        speed: 1,
        volume: dbToLin(-10),
        volEnvAtk: 0.001, volEnvRel: 3,
        pan: 0,
        filterCutoff: 20000, filterRes: 0, filterMode: 0,
        filterEnvAtk: 0.001, filterEnvRel: 0.25, filterEnvMod: 0,
        delaySend: 0, reverbSend: 0,
        muteGroup: false,
        active: [],   // currently sounding voices (for mute-group cut)
      });
    }
  }

  _makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay * 6 + 1);
      }
    }
    return buf;
  }

  async loadSample(ch, path) {
    if (ch < 0 || ch >= NUM_CH) return;
    try {
      const url = `${this.basePath}/api/audio?path=${encodeURIComponent(path)}`;
      const res = await fetch(url);
      if (!res.ok) { this.log(`ack: cannot load "${path}" (${res.status})`); return; }
      const arrayBuf = await res.arrayBuffer();
      this.ch[ch].buffer = await this.ctx.decodeAudioData(arrayBuf);
      this.log(`ack: ch${ch} loaded ${path.split('/').pop()}`);
    } catch (e) {
      this.log(`ack: load error — ${e.message}`);
    }
  }

  trig(ch) {
    if (ch < 0 || ch >= NUM_CH) return;
    const c = this.ch[ch];
    if (!c.buffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // mute group: cut other active voices in the same group
    if (c.muteGroup) {
      for (let i = 0; i < NUM_CH; i++) {
        if (i !== ch && this.ch[i].muteGroup) this._cut(this.ch[i], t);
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = c.buffer;
    src.playbackRate.value = Math.abs(c.speed);
    if (c.loop) src.loop = true;

    const dur = c.buffer.duration;
    const startSec = Math.max(0, Math.min(c.start, 1)) * dur;
    const endSec   = Math.max(0, Math.min(c.end, 1)) * dur;
    const playDur  = Math.max(0.001, endSec - startSec);

    // filter
    const filt = ctx.createBiquadFilter();
    filt.type = ['lowpass', 'highpass', 'bandpass'][c.filterMode] || 'lowpass';
    filt.frequency.value = Math.max(20, Math.min(c.filterCutoff, 20000));
    filt.Q.value = 0.5 + c.filterRes * 12;
    if (c.filterEnvMod !== 0) {
      const target = Math.max(20, Math.min(c.filterCutoff * Math.pow(4, c.filterEnvMod), 20000));
      filt.frequency.setValueAtTime(filt.frequency.value, t);
      filt.frequency.linearRampToValueAtTime(target, t + Math.max(0.001, c.filterEnvAtk));
      filt.frequency.linearRampToValueAtTime(filt.frequency.value, t + c.filterEnvAtk + c.filterEnvRel);
    }

    // AR amplitude envelope
    const vca = ctx.createGain();
    const atk = Math.max(0.0005, c.volEnvAtk);
    const rel = Math.max(0.005, c.volEnvRel);
    vca.gain.setValueAtTime(0, t);
    vca.gain.linearRampToValueAtTime(c.volume, t + atk);
    const tail = Math.min(playDur, atk + rel);
    vca.gain.setValueAtTime(c.volume, t + Math.min(atk, tail));
    vca.gain.linearRampToValueAtTime(0.0001, t + tail);

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, c.pan));

    src.connect(filt).connect(vca).connect(pan);
    pan.connect(this.master);
    if (c.delaySend > 0)  { const g = ctx.createGain(); g.gain.value = c.delaySend;  pan.connect(g); g.connect(this.delayInput); }
    if (c.reverbSend > 0) { const g = ctx.createGain(); g.gain.value = c.reverbSend; pan.connect(g); g.connect(this.reverbInput); }

    const stopAt = c.loop ? t + tail : t + Math.min(playDur, tail) + 0.02;
    src.start(t, startSec, c.loop ? undefined : playDur);
    src.stop(stopAt + 0.05);

    const voice = { src, vca };
    c.active.push(voice);
    src.onended = () => { const i = c.active.indexOf(voice); if (i >= 0) c.active.splice(i, 1); };
  }

  _cut(c, t) {
    for (const v of c.active) {
      try {
        v.vca.gain.cancelScheduledValues(t);
        v.vca.gain.setValueAtTime(v.vca.gain.value, t);
        v.vca.gain.linearRampToValueAtTime(0.0001, t + 0.01);
        v.src.stop(t + 0.03);
      } catch {}
    }
    c.active = [];
  }

  multiTrig(...args) {
    const t = this.ctx.currentTime;
    // cut all mute-group voices once up front so simultaneous trigs don't fight
    for (let i = 0; i < Math.min(args.length, NUM_CH); i++) {
      if (args[i] && args[i] !== 0) this.trig(i);
    }
  }

  set(cmd, args) {
    const a0 = args[0];
    // effects / global (no channel arg)
    switch (cmd) {
      case 'multiTrig':     this.multiTrig(...args); return;
      case 'trig':          this.trig(a0); return;
      case 'mainLevel':     this.master.gain.setTargetAtTime(dbToLin(a0), this.ctx.currentTime, 0.01); return;
      case 'delayTime':     this.delay.delayTime.setTargetAtTime(Math.max(0.0001, a0), this.ctx.currentTime, 0.01); return;
      case 'delayFeedback': this.delayFb.gain.setTargetAtTime(Math.min(a0, 0.98), this.ctx.currentTime, 0.01); return;
      case 'delayLevel':    this.delayLevel.gain.setTargetAtTime(dbToLin(a0), this.ctx.currentTime, 0.01); return;
      case 'reverbRoom':    this.reverb.buffer = this._makeImpulse(0.2 + a0 * 2.5, this._damp ?? 0.5); return;
      case 'reverbDamp':    this._damp = a0; return;
      case 'reverbLevel':   this.reverbLevel.gain.setTargetAtTime(dbToLin(a0), this.ctx.currentTime, 0.01); return;
      case 'loadSample':    this.loadSample(a0, args[1]); return;
    }
    // per-channel
    const ch = a0;
    if (ch < 0 || ch >= NUM_CH) return;
    const c = this.ch[ch];
    const v = args[1];
    switch (cmd) {
      case 'sampleStart':       c.start = v; break;
      case 'sampleEnd':         c.end = v; break;
      case 'enableLoop':        c.loop = true; break;
      case 'disableLoop':       c.loop = false; break;
      case 'loopPoint':         c.loopPoint = v; break;
      case 'speed':             c.speed = v; break;
      case 'volume':            c.volume = dbToLin(v); break;
      case 'volumeEnvAttack':   c.volEnvAtk = v; break;
      case 'volumeEnvRelease':  c.volEnvRel = v; break;
      case 'pan':               c.pan = v; break;
      case 'filterCutoff':      c.filterCutoff = v; break;
      case 'filterRes':         c.filterRes = v; break;
      case 'filterMode':        c.filterMode = v; break;
      case 'filterEnvAttack':   c.filterEnvAtk = v; break;
      case 'filterEnvRelease':  c.filterEnvRel = v; break;
      case 'filterEnvMod':      c.filterEnvMod = v; break;
      case 'sampleRate':        break;  // bit/rate degradation not modelled
      case 'bitDepth':          break;
      case 'dist':              break;
      case 'includeInMuteGroup': c.muteGroup = v !== 0; break;
      case 'delaySend':         c.delaySend = dbToLin(v); break;
      case 'reverbSend':        c.reverbSend = dbToLin(v); break;
      default: break;
    }
  }
}
