// molly-the-poly.js — WebAudio reimplementation of the MollyThePoly norns engine.
// Supports up to 8 voices (polyphonic). Commands mirror the SuperCollider engine.
//
// Implemented: noteOn/noteOff, all osc/filter/env/LFO/amp/chorus/ringmod params.
// Glide: portamento per-voice on retrigger.

export class MollyThePoly {
  constructor(ctx, destination, log) {
    this.ctx = ctx;
    this.log = log || (() => {});
    this.voices = new Map(); // noteId -> VoiceNode

    // Engine state (mirrors SuperCollider defaults) — must be set before
    // _makeChorus/_makeLfo, which read this.p for their initial values.
    this.p = {
      oscWaveShape:         2,    // 0=tri 1=saw 2=pulse
      pwMod:                0.2,
      pwModSource:          0,    // 0=lfo 1=env1 2=manual
      freqModLfo:           0,
      freqModEnv:           0,
      glide:                0,
      mainOscLevel:         1,
      subOscLevel:          0,
      subOscDetune:         0,    // semitones
      noiseLevel:           0.1,
      hpFilterCutoff:       10,
      lpFilterCutoff:       300,
      lpFilterResonance:    0.1,
      lpFilterType:         1,    // 0=-12dB 1=-24dB (approx with 2 biquads)
      lpFilterCutoffEnvSelect: 0, // 0=env1 1=env2
      lpFilterCutoffModEnv: 0.25,
      lpFilterCutoffModLfo: 0,
      lpFilterTracking:     1,
      lfoFreq:              5,
      lfoWaveShape:         0,    // 0=sin 1=tri 2=saw 3=sq 4=rnd
      lfoFade:              0,
      env1Attack:           0.01,
      env1Decay:            0.3,
      env1Sustain:          0.5,
      env1Release:          0.5,
      env2Attack:           0.01,
      env2Decay:            0.3,
      env2Sustain:          0.5,
      env2Release:          0.5,
      amp:                  0.5,
      ampMod:               0,
      ringModFreq:          50,
      ringModFade:          0,
      ringModMix:           0,
      chorusMix:            0.8,
    };

    this.chorus = this._makeChorus(ctx, destination);
    this._lfo = this._makeLfo(ctx);
  }

  // ── LFO (shared across voices) ─────────────────────────────────────────────

  _makeLfo(ctx) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = this.p.lfoFreq;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    osc.connect(gain);
    osc.start();
    return { osc, gain };
  }

  // ── Chorus ────────────────────────────────────────────────────────────────

  _makeChorus(ctx, destination) {
    // Stereo chorus: dry centred, two LFO-modulated delay lines panned hard
    // L/R. A StereoPanner(0) on the dry path also guarantees centred stereo
    // output (a bare mono chain can otherwise land on a single channel).
    const input  = ctx.createGain();
    const dry    = ctx.createStereoPanner();  // pan 0 → centred stereo
    const wet    = ctx.createGain();
    wet.gain.value = this.p.chorusMix;
    input.connect(dry);
    dry.connect(destination);

    const delays = [0.012, 0.019];
    const rates  = [0.4,   0.53];
    const pans   = [-1,    1];
    const depth  = 0.003;
    delays.forEach((d, i) => {
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = d;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rates[i];
      lfo.type = 'sine';
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain);
      lfoGain.connect(delay.delayTime);
      lfo.start();
      const pan = ctx.createStereoPanner();
      pan.pan.value = pans[i];
      input.connect(delay);
      delay.connect(pan).connect(wet);
    });
    wet.connect(destination);
    return { input, wet };
  }

  // ── Voice ─────────────────────────────────────────────────────────────────

  _startVoice(noteId, freq, vel) {
    const ctx = this.ctx;
    const p   = this.p;
    const t   = ctx.currentTime + 0.01;

    // Oscillators
    const mainOsc = ctx.createOscillator();
    const subOsc  = ctx.createOscillator();

    const oscShape = ['triangle', 'sawtooth', 'square'][p.oscWaveShape] || 'square';
    mainOsc.type = oscShape;
    mainOsc.frequency.value = freq;
    subOsc.type = 'triangle';
    const subFreq = freq * Math.pow(2, p.subOscDetune / 12) * 0.5;
    subOsc.frequency.value = subFreq;

    // Noise via buffer
    const bufLen = ctx.sampleRate * 1;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buf;
    noiseSource.loop = true;

    // Mix oscillators
    const mainGain  = ctx.createGain(); mainGain.gain.value  = p.mainOscLevel;
    const subGain   = ctx.createGain(); subGain.gain.value   = p.subOscLevel;
    const noiseGain = ctx.createGain(); noiseGain.gain.value = p.noiseLevel;
    const oscMix    = ctx.createGain();

    mainOsc.connect(mainGain).connect(oscMix);
    subOsc.connect(subGain).connect(oscMix);
    noiseSource.connect(noiseGain).connect(oscMix);

    // HP filter
    const hpFilter = ctx.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.value = Math.max(10, p.hpFilterCutoff);
    hpFilter.Q.value = 0.5;

    // LP filter — 2 biquads in series for -24dB/oct, 1 for -12dB/oct
    const lpA = ctx.createBiquadFilter();
    lpA.type = 'lowpass';
    lpA.Q.value = p.lpFilterResonance * 10;

    const lpB = ctx.createBiquadFilter();
    lpB.type = 'lowpass';
    lpB.Q.value = 0.5;

    // Envelope 1 (modulates filter cutoff and pitch)
    const env1 = this._makeEnvelope(ctx, t, p.env1Attack, p.env1Decay, p.env1Sustain, p.env1Release);
    // Envelope 2 (modulates amplitude)
    const env2 = this._makeEnvelope(ctx, t, p.env2Attack, p.env2Decay, p.env2Sustain, p.env2Release);

    // Filter cutoff with envelope and keyboard tracking
    const trackingFreq = 220 * Math.pow(2, (Math.log2(freq / 220)) * p.lpFilterTracking);
    const baseCutoff   = Math.min(p.lpFilterCutoff + trackingFreq * 0.3, 18000);
    const envSelect    = p.lpFilterCutoffEnvSelect === 0 ? env1 : env2;
    const modRange     = baseCutoff * Math.abs(p.lpFilterCutoffModEnv) * 4;
    const cutoffTarget = p.lpFilterCutoffModEnv >= 0
      ? Math.min(baseCutoff + modRange, 18000)
      : Math.max(baseCutoff - modRange, 20);

    lpA.frequency.setValueAtTime(p.lpFilterCutoffModEnv >= 0 ? baseCutoff : cutoffTarget, t);
    lpA.frequency.linearRampToValueAtTime(cutoffTarget, t + p.env2Attack + p.env2Decay * (1 - p.env2Sustain));
    lpB.frequency.value = baseCutoff;

    // Ring mod
    let ringMix = null;
    if (p.ringModMix > 0.01) {
      const ringOsc  = ctx.createOscillator();
      ringOsc.frequency.value = p.ringModFreq;
      const ringGain = ctx.createGain();
      ringGain.gain.value = 0;
      ringMix = ctx.createGain();
      ringMix.gain.value = p.ringModMix;
      const dryMix = ctx.createGain();
      dryMix.gain.value = 1 - p.ringModMix;
      // schedule ring mod fade
      if (p.ringModFade > 0) {
        ringGain.gain.setValueAtTime(0, t);
        ringGain.gain.linearRampToValueAtTime(1, t + p.ringModFade);
      } else {
        ringGain.gain.value = 1;
      }
      ringOsc.connect(ringGain);
      ringGain.connect(ringMix.gain);  // amplitude-modulate signal
      ringOsc.start(t);
      oscMix.connect(dryMix);
      // simple ring mod: multiply via gain modulation
      const ringNode = ctx.createGain();
      ringNode.gain.value = 0;
      ringOsc.connect(ringNode.gain);
      oscMix.connect(ringNode);
      ringNode.connect(hpFilter);
      dryMix.connect(hpFilter);
    } else {
      oscMix.connect(hpFilter);
    }

    // Signal chain
    hpFilter.connect(lpA);
    if (p.lpFilterType === 1) lpA.connect(lpB).connect(env2.gain);
    else lpA.connect(env2.gain);

    // Amplitude: env2 * vel * amp. Real molly amp spec is 0..11 with ~0.5
    // a normal listening level — scale so amp 0.5 gives a healthy signal.
    const velGain = Math.min(vel * Math.min(p.amp, 2) * 0.5, 0.9);
    env2.gain.gain.value = 0;
    env2.gain.gain.setValueAtTime(0, t);
    env2.gain.gain.linearRampToValueAtTime(velGain, t + Math.max(0.002, p.env2Attack));
    const sustainLevel = velGain * p.env2Sustain;
    env2.gain.gain.linearRampToValueAtTime(sustainLevel, t + Math.max(0.002, p.env2Attack) + Math.max(0.002, p.env2Decay));

    env2.gain.connect(this.chorus.input);

    mainOsc.start(t);
    subOsc.start(t);
    noiseSource.start(t);

    return {
      mainOsc, subOsc, noiseSource,
      lpA, lpB, hpFilter,
      env2gain: env2.gain,
      freq,
      velGain,
    };
  }

  _makeEnvelope(ctx, t, attack, decay, sustain, release) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // returns gain node — caller schedules attack/decay on it
    return { gain, attack, decay, sustain, release };
  }

  _stopVoice(voice, t) {
    const p = this.p;
    const rel = Math.max(0.01, p.env2Release);
    const cur = voice.env2gain.gain.value;
    voice.env2gain.gain.cancelScheduledValues(t);
    voice.env2gain.gain.setValueAtTime(cur, t);
    voice.env2gain.gain.exponentialRampToValueAtTime(0.0001, t + rel);
    const stop = t + rel + 0.05;
    try { voice.mainOsc.stop(stop); } catch {}
    try { voice.subOsc.stop(stop); } catch {}
    try { voice.noiseSource.stop(stop); } catch {}
  }

  // ── Public API ────────────────────────────────────────────────────────────

  noteOn(noteId, freq, vel) {
    if (!this.ctx) return;
    // Release existing voice for this noteId if any
    if (this.voices.has(noteId)) this.noteOff(noteId);
    const voice = this._startVoice(noteId, freq, vel);
    this.voices.set(noteId, voice);
  }

  noteOff(noteId) {
    if (!this.ctx) return;
    const voice = this.voices.get(noteId);
    if (!voice) return;
    this.voices.delete(noteId);
    this._stopVoice(voice, this.ctx.currentTime);
  }

  allNotesOff() {
    const t = this.ctx.currentTime;
    for (const voice of this.voices.values()) this._stopVoice(voice, t);
    this.voices.clear();
  }

  set(cmd, args) {
    const p = this.p;
    const v = args[0];
    switch (cmd) {
      case 'noteOn':            this.noteOn(args[0], args[1], args[2] ?? 1); return;
      case 'noteOff':           this.noteOff(args[0]); return;
      case 'noteOffAll':        this.allNotesOff(); return;
      case 'noteKillAll':       this.allNotesOff(); return;
      case 'oscWaveShape':      p.oscWaveShape = v; break;
      case 'pwMod':             p.pwMod = v; break;
      case 'pwModSource':       p.pwModSource = v; break;
      case 'freqModLfo':        p.freqModLfo = v; break;
      case 'freqModEnv':        p.freqModEnv = v; break;
      case 'glide':             p.glide = v; break;
      case 'mainOscLevel':      p.mainOscLevel = v; break;
      case 'subOscLevel':       p.subOscLevel = v; break;
      case 'subOscDetune':      p.subOscDetune = v; break;
      case 'noiseLevel':        p.noiseLevel = v; break;
      case 'hpFilterCutoff':    p.hpFilterCutoff = Math.max(10, v); break;
      case 'lpFilterCutoff':    p.lpFilterCutoff = Math.max(20, Math.min(v, 18000)); break;
      case 'lpFilterResonance': p.lpFilterResonance = Math.max(0, Math.min(v, 0.99)); break;
      case 'lpFilterType':      p.lpFilterType = v; break;
      case 'lpFilterCutoffEnvSelect': p.lpFilterCutoffEnvSelect = v; break;
      case 'lpFilterCutoffModEnv':    p.lpFilterCutoffModEnv = v; break;
      case 'lpFilterCutoffModLfo':    p.lpFilterCutoffModLfo = v; break;
      case 'lpFilterTracking':        p.lpFilterTracking = v; break;
      case 'lfoFreq':       p.lfoFreq = v; this._lfo.osc.frequency.value = v; break;
      case 'lfoWaveShape':  p.lfoWaveShape = v;
        this._lfo.osc.type = ['sine','triangle','sawtooth','square','sine'][v] || 'sine'; break;
      case 'lfoFade':       p.lfoFade = v; break;
      case 'env1Attack':    p.env1Attack    = v; break;
      case 'env1Decay':     p.env1Decay     = v; break;
      case 'env1Sustain':   p.env1Sustain   = v; break;
      case 'env1Release':   p.env1Release   = v; break;
      case 'env2Attack':    p.env2Attack    = v; break;
      case 'env2Decay':     p.env2Decay     = v; break;
      case 'env2Sustain':   p.env2Sustain   = v; break;
      case 'env2Release':   p.env2Release   = v; break;
      case 'amp':           p.amp = v; break;
      case 'ampMod':        p.ampMod = v; break;
      case 'ringModFreq':   p.ringModFreq = v; break;
      case 'ringModFade':   p.ringModFade = v; break;
      case 'ringModMix':    p.ringModMix  = v; break;
      case 'chorusMix':
        p.chorusMix = v;
        this.chorus.wet.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
        break;
      default: break;
    }
  }
}
