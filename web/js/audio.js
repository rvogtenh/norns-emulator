// audio.js — WebAudio host for norns engines and softcut.
// PolyPerc: reimplemented here.
// MollyThePoly: reimplemented in molly-the-poly.js.
// softcut: routed to SoftcutProcessor AudioWorklet (softcut-worklet.js).

import { MollyThePoly } from './molly-the-poly.js';
import { Ack } from './ack.js';
import { Glut } from './glut.js';

export class AudioHost {
  constructor(log, basePath = "") {
    this.log = log || (() => {});
    this.basePath = basePath;
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.warned = new Set();
    // PolyPerc state
    this.pp = { amp: 0.3, pw: 0.5, release: 0.5, cutoff: 1000, gain: 1.0, pan: 0 };
    // MollyThePoly instance (created on first load)
    this.mtp = null;
    // Ack instance (created on first load)
    this.ack = null;
    // Glut instance (created on first load)
    this.glut = null;
    // softcut
    this.softcutNode = null;
    this._softcutQueue = [];
    this.onSoftcutPhase  = null;
    this.onSoftcutRender = null;
    this.onEval          = null;  // send({t:'eval',code:...}) hook for Lua side-effects
    this.onPoll          = null;  // send({t:'engine_poll',name,value}) hook for engine polls
    this._micSource = null;
    this._micStream = null;
  }

  enable() {
    if (this.ctx) { this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx.resume();  // explicit resume for Firefox compatibility

    // ── mixer graph ──────────────────────────────────────────────────────
    // sources → per-bus gain (eng/cut/mon/tp) → master → outGain → speakers.
    // `master` is kept as the node engines/softcut connect to for backward
    // compatibility; the per-source buses sit between sources and master.
    this.engBus  = this.ctx.createGain();   // "eng" — engine output
    this.cutBus  = this.ctx.createGain();   // "cut" — softcut output
    this.monBus  = this.ctx.createGain();   // "mon" — mic monitor to output
    this.tapeBus = this.ctx.createGain();   // "tp"  — tape playback
    this.monBus.gain.value = 0;             // monitor off by default
    this.master  = this.ctx.createGain();   // mix summing node (engines connect here)
    this.master.gain.value = 1.0;
    this.outGain = this.ctx.createGain();   // "out" — master output level
    this.outGain.gain.value = 0.6;          // prior overall level as default

    this.engBus.connect(this.master);
    this.cutBus.connect(this.master);
    this.monBus.connect(this.master);
    this.tapeBus.connect(this.master);
    this.master.connect(this.outGain);

    // ── reverb ───────────────────────────────────────────────────────────
    this._revSend   = this.ctx.createGain();   // send level (0 = off)
    this._revSend.gain.value = 0;
    this._convolver = this.ctx.createConvolver();
    this._convolver.normalize = true;
    this._revReturn = this.ctx.createGain();   // wet return level
    this._revReturn.gain.value = 0.8;
    this._revTime   = 3.0;                     // seconds
    this._revOn     = false;
    this._convolver.buffer = this._generateIR(this._revTime);
    this.outGain.connect(this._revSend);
    this._revSend.connect(this._convolver);
    this._convolver.connect(this._revReturn);

    // ── compressor ───────────────────────────────────────────────────────
    this._comp = this.ctx.createDynamicsCompressor();
    this._comp.threshold.value = -12;
    this._comp.knee.value      =  6;
    this._comp.ratio.value     =  4;
    this._comp.attack.value    =  0.005;
    this._comp.release.value   =  0.1;
    this._compOn = false;
    // Default: compressor is bypassed (transparent ratio=1, threshold=0)
    this._comp.threshold.value = 0;
    this._comp.ratio.value     = 1;

    // ── output chain ─────────────────────────────────────────────────────
    // dry:    outGain → comp → destination
    // reverb: outGain → _revSend → convolver → _revReturn → comp → destination
    this.outGain.connect(this._comp);
    this._revReturn.connect(this._comp);
    this._comp.connect(this.ctx.destination);

    // per-bus stereo level meters (L/R analyser per fader)
    this._meters = {};
    const addMeter = (name, node) => {
      // force an explicit 2-channel tap so mono sources meter on both channels
      // (centred) instead of left-only, matching what reaches the speakers.
      const tap = this.ctx.createGain();
      tap.channelCount = 2;
      tap.channelCountMode = 'explicit';
      tap.channelInterpretation = 'speakers';
      node.connect(tap);
      const splitter = this.ctx.createChannelSplitter(2);
      tap.connect(splitter);
      const anL = this.ctx.createAnalyser(); anL.fftSize = 256;
      const anR = this.ctx.createAnalyser(); anR.fftSize = 256;
      splitter.connect(anL, 0);
      splitter.connect(anR, 1);
      this._meters[name] = { l: anL, r: anR };
    };
    addMeter('out', this.outGain);
    addMeter('eng', this.engBus);
    addMeter('cut', this.cutBus);
    addMeter('mon', this.monBus);
    addMeter('tp',  this.tapeBus);

    // tape: a MediaStream tap on the output for MediaRecorder
    this.tapeDest = this.ctx.createMediaStreamDestination();
    this.outGain.connect(this.tapeDest);

    this.log("audio: enabled");
    this._initSoftcut();
  }

  // mixer level setter — v in 0..1. name ∈ out/eng/cut/mon/tp/in.
  setMixLevel(name, v) {
    if (!this.ctx) return;
    const node = { out: this.outGain, eng: this.engBus, cut: this.cutBus,
                   mon: this.monBus, tp: this.tapeBus }[name];
    if (node) { node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01); return; }
    if (name === 'in') {                    // mic input/record level (0..1 → 0..6×)
      this._micGainValue = v * 6;
      if (this._micGain) this._micGain.gain.setTargetAtTime(this._micGainValue, this.ctx.currentTime, 0.01);
    }
  }

  setAdcCutLevel(v) {
    if (this._adcCutGain) this._adcCutGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  setEngCutLevel(v) {
    if (this._engCutGain) this._engCutGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  // stereo peak levels [L, R] (0..1) for a named bus meter (out/eng/cut/mon/tp/in).
  busLevel(name = 'out') {
    const m = this._meters && this._meters[name];
    if (!m) return [0, 0];
    const buf = this._meterBuf || (this._meterBuf = new Uint8Array(m.l.fftSize));
    const peak = (an) => {
      an.getByteTimeDomainData(buf);
      let p = 0;
      for (let i = 0; i < buf.length; i++) { const d = Math.abs(buf[i] - 128) / 128; if (d > p) p = d; }
      return p;
    };
    return [peak(m.l), peak(m.r)];
  }
  meterLevel() { return this.busLevel('out')[0]; }

  disable() {
    if (this.ctx) this.ctx.suspend();
  }

  async _initSoftcut() {
    if (!this.ctx.audioWorklet) {
      this.log('softcut: AudioWorklet requires a secure context — open http://localhost:5151 instead of norns.local; softcut will be silent');
      return;
    }
    try {
      await this.ctx.audioWorklet.addModule('js/softcut-worklet.js');
      this.softcutNode = new AudioWorkletNode(this.ctx, 'softcut-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.softcutNode.connect(this.cutBus);

      // Gated ADC (mic) and engine routing into softcut.
      // Default gain=0 mirrors norns: audio.level_adc_cut / level_eng_cut must
      // be called explicitly before any signal reaches the record heads.
      this._adcCutGain = this.ctx.createGain();
      this._adcCutGain.gain.value = 0;
      this._engCutGain = this.ctx.createGain();
      this._engCutGain.gain.value = 0;
      this._adcCutGain.connect(this.softcutNode);
      this._engCutGain.connect(this.softcutNode);
      this.engBus.connect(this._engCutGain);

      this.softcutNode.port.onmessage = (e) => {
        const d = e.data;
        if (d.t === 'softcut_phase'  && this.onSoftcutPhase)  this.onSoftcutPhase(d);
        if (d.t === 'softcut_render' && this.onSoftcutRender) {
          // Clear the pending-render throttle for this channel.
          if (this._renderPending) this._renderPending[(d.ch || 1) - 1] = false;
          this.onSoftcutRender(d);
        }
        if (d.t === 'softcut_log')   this.log('softcut: ' + d.msg);
      };
      // If mic was already enabled before the worklet finished loading, wire it now.
      if (this._micGain) this._micGain.connect(this._adcCutGain);
      // Flush commands that arrived before the worklet was ready.
      for (const m of this._softcutQueue) this._sendToWorklet(m);
      this._softcutQueue = [];
      this.log('softcut: worklet ready');
    } catch (e) {
      this.log(`softcut: worklet load failed — ${e.message}`);
    }
  }

  // ── engine messages (PolyPerc etc.) ──────────────────────────────────────

  handle(msg) {
    if (!this.ctx) return;
    if (msg.action === 'load') {
      this.engine = msg.name;
      if (msg.name === 'MollyThePoly') {
        if (!this.mtp) this.mtp = new MollyThePoly(this.ctx, this.engBus, this.log);
        else this.mtp.allNotesOff();
        this.log('engine: MollyThePoly');
      } else if (msg.name === 'Ack') {
        if (!this.ack) this.ack = new Ack(this.ctx, this.engBus, this.log, this.basePath);
        this.log('engine: Ack');
      } else if (msg.name === 'Glut') {
        if (!this.glut) this.glut = new Glut(this.ctx, this.engBus, this.log, this.basePath, (n, v) => this.onPoll && this.onPoll(n, v));
        this.log('engine: Glut');
      } else if (msg.name === 'PolyPerc') {
        this.log('engine: PolyPerc');
      } else {
        this.log(`engine: ${msg.name} (silent — not reimplemented)`);
      }
      return;
    }
    if (msg.action !== 'command') return;
    if (this.engine === 'MollyThePoly') {
      if (!this.mtp) this.mtp = new MollyThePoly(this.ctx, this.engBus);
      this.mtp.set(msg.cmd, msg.args || []);
    } else if (this.engine === 'Ack') {
      if (!this.ack) this.ack = new Ack(this.ctx, this.engBus, this.log, this.basePath);
      this.ack.set(msg.cmd, msg.args || []);
    } else if (this.engine === 'Glut') {
      if (!this.glut) this.glut = new Glut(this.ctx, this.engBus, this.log, this.basePath);
      this.glut.set(msg.cmd, msg.args || []);
    } else if (this.engine === 'PolyPerc' || msg.name === 'PolyPerc') {
      this.polyperc(msg.cmd, msg.args || []);
    } else if (!this.warned.has(this.engine)) {
      this.warned.add(this.engine);
      this.log(`engine "${this.engine}" not reimplemented — commands ignored`);
    }
  }

  polyperc(cmd, args) {
    const a = args[0];
    switch (cmd) {
      case 'hz':      this.playHz(a); break;
      case 'amp':     this.pp.amp     = a; break;
      case 'pw':      this.pp.pw      = a; break;
      case 'release': this.pp.release = a; break;
      case 'cutoff':  this.pp.cutoff  = a; break;
      case 'gain':    this.pp.gain    = a; break;
      case 'pan':     this.pp.pan     = a; break;
      default: break;
    }
  }

  playHz(freq) {
    if (!freq || freq <= 0) return;
    const ctx = this.ctx;
    const t   = ctx.currentTime + 0.20; // 200ms lookahead to absorb WebSocket jitter
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = Math.max(40, Math.min(this.pp.cutoff, 18000));
    filt.Q.value = 1;

    const amp = ctx.createGain();
    const rel = Math.max(0.02, this.pp.release);
    const peak = this.pp.amp * this.pp.gain;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + rel);

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, this.pp.pan));

    osc.connect(filt).connect(amp).connect(pan).connect(this.engBus);
    osc.start(t);
    osc.stop(t + rel + 0.05);
  }

  // ── softcut messages ──────────────────────────────────────────────────────

  handleSoftcut(msg) {
    if (!this.ctx) return;  // audio not enabled yet — commands are ignored
    if (!this.softcutNode) {
      this._softcutQueue.push(msg);
      return;
    }
    this._sendToWorklet(msg);
  }

  _sendToWorklet(msg) {
    if (msg.cmd === 'buffer_read_mono') {
      this._loadBufferMono(msg.args);
    } else if (msg.cmd === 'buffer_read_stereo') {
      this._loadBufferStereo(msg.args);
    } else if (msg.cmd === 'buffer_clear' || msg.cmd === 'buffer_clear_channel') {
      // Reset render throttle so the first render after a clear goes through.
      if (this._renderPending) this._renderPending = [false, false];
      this.softcutNode.port.postMessage(msg);
    } else if (msg.cmd === 'render_buffer') {
      // One render per channel at a time — skip if a result is still pending.
      // This prevents concurrent renders causing the waveform to flicker during
      // recording. buffer_clear resets the flag (handled in buffer_clear branch).
      if (!this._renderPending) this._renderPending = [false, false];
      const ch = Math.max(0, (msg.args[0] || 1) - 1) % 2;
      if (this._renderPending[ch]) return;
      this._renderPending[ch] = true;
      this.softcutNode.port.postMessage(msg);
    } else {
      this.softcutNode.port.postMessage(msg);
    }
  }

  // Fetch an audio file and write decoded samples into the softcut buffer.
  async _loadBufferMono(args) {
    const [file, srcSec, dstSec, durSec, chSrc, chDst] = args;
    try {
      const url = `${this.basePath}/api/audio?path=${encodeURIComponent(file)}`;
      const res = await fetch(url);
      if (!res.ok) { this.log(`softcut: cannot load "${file}" (${res.status})`); return; }
      const arrayBuf = await res.arrayBuffer();
      const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
      // decodeAudioData resamples to ctx.sampleRate automatically.
      const chIdx = Math.max(0, Math.min((chSrc || 1) - 1, audioBuf.numberOfChannels - 1));
      const src   = audioBuf.getChannelData(chIdx);
      // Apply srcSec offset and optional durSec clip.
      const sr        = audioBuf.sampleRate;
      const startSmp  = Math.floor((srcSec || 0) * sr);
      const maxSmp    = durSec > 0 ? Math.min(src.length - startSmp, Math.ceil(durSec * sr)) : src.length - startSmp;
      const slice     = src.slice(startSmp, startSmp + Math.max(0, maxSmp));
      const copy = new Float32Array(slice);
      const n    = copy.length;
      const durLoaded = n / this.ctx.sampleRate;
      this.softcutNode.port.postMessage({
        cmd: '_buffer_write', ch: chDst || 1, offset: dstSec || 0, data: copy,
      }, [copy.buffer]);
      this.log(`softcut: loaded ${n} samples (${durLoaded.toFixed(2)}s) → ch${chDst || 1} @ ${dstSec || 0}s`);
      if (n > 0) {
        // 1. Tell Lua to re-arm waveform viz flags BEFORE the render result arrives.
        //    This is needed when recording was active (which clears waveviz_reel via an
        //    early render with stale data before the file finishes loading).
        if (this.onEval) {
          this.onEval('pcall(function() waveviz_reel=true waveviz_splice=true end)');
        }
        // 2. Trigger render — result arrives at Lua AFTER the eval above because the
        //    worklet audio thread adds at least one processing block of latency.
        this.softcutNode.port.postMessage({
          cmd: 'render_buffer', voice: 0,
          args: [chDst || 1, dstSec || 0, durLoaded, 128],
        });
      }
    } catch (e) {
      this.log(`softcut: buffer_read_mono error — ${e.message}`);
    }
  }

  // ── microphone input ───────────────────────────────────────────────────

  async enableMicInput() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.log('audio: getUserMedia not available (needs localhost or HTTPS)');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      if (!this.ctx) this.enable();
      this._micStream  = stream;
      this._micSource  = this.ctx.createMediaStreamSource(stream);
      // A GainNode between mic and worklet is required in Firefox to activate
      // the AudioWorkletNode input — direct MediaStreamSource→WorkletNode
      // connections can silently fail in some Firefox versions.
      this._micGain    = this.ctx.createGain();
      this._micGain.gain.value = this._micGainValue || 2.0;  // default 2× boost
      this._micSource.connect(this._micGain);
      if (this._adcCutGain) this._micGain.connect(this._adcCutGain);
      if (this.monBus) this._micGain.connect(this.monBus);  // mic monitor ("mon" level)
      if (this._meters) {                                    // "in" level meter (stereo tap)
        const tap = this.ctx.createGain();
        tap.channelCount = 2; tap.channelCountMode = 'explicit'; tap.channelInterpretation = 'speakers';
        this._micGain.connect(tap);
        const splitter = this.ctx.createChannelSplitter(2);
        tap.connect(splitter);
        const anL = this.ctx.createAnalyser(); anL.fftSize = 256;
        const anR = this.ctx.createAnalyser(); anR.fftSize = 256;
        splitter.connect(anL, 0); splitter.connect(anR, 1);
        this._meters.in = { l: anL, r: anR };
      }
      this.log('audio: mic input enabled');
      return true;
    } catch (e) {
      this.log(`audio: mic — ${e.message}`);
      return false;
    }
  }

  disableMicInput() {
    if (this._micGain)   { this._micGain.disconnect();   this._micGain = null; }
    if (this._micSource) { this._micSource.disconnect();  this._micSource = null; }
    if (this._micStream) { this._micStream.getTracks().forEach(t => t.stop()); this._micStream = null; }
    this.log('audio: mic input disabled');
  }

  async _loadBufferStereo(args) {
    const [file, srcSec, dstSec, durSec] = args;
    // Load both channels as mono calls.
    for (let ch = 1; ch <= 2; ch++) {
      await this._loadBufferMono([file, srcSec, dstSec, durSec, ch, ch]);
    }
  }

  // ── tape: record/playback the main output (norns "tape") ─────────────────

  startTapeRec() {
    if (!this.ctx || !this.tapeDest) return false;
    if (this._tapeRec && this._tapeRec.state === 'recording') return true;
    try {
      this._tapeChunks = [];
      this._tapeRec = new MediaRecorder(this.tapeDest.stream);
      this._tapeRec.ondataavailable = (e) => { if (e.data.size) this._tapeChunks.push(e.data); };
      this._tapeRec.onstop = () => {
        const blob = new Blob(this._tapeChunks, { type: this._tapeRec.mimeType || 'audio/webm' });
        this._tapeBlobUrl && URL.revokeObjectURL(this._tapeBlobUrl);
        this._tapeBlobUrl = URL.createObjectURL(blob);
      };
      this._tapeRec.start();
      this.log('tape: recording');
      return true;
    } catch (e) {
      this.log(`tape: rec failed — ${e.message}`);
      return false;
    }
  }

  stopTapeRec() {
    if (this._tapeRec && this._tapeRec.state === 'recording') {
      this._tapeRec.stop();
      this.log('tape: stopped');
    }
  }

  // Play the last recording back through the tape bus.
  playTape(loop = false) {
    if (!this._tapeBlobUrl) { this.log('tape: nothing recorded'); return false; }
    if (this._tapeEl) { try { this._tapeEl.pause(); } catch {} this._tapeEl = null; }  // quiet swap
    const el = new Audio(this._tapeBlobUrl);
    el.loop = !!loop;
    this._tapeEl = el;
    const node = this.ctx.createMediaElementSource(el);
    node.connect(this.tapeBus);
    el.onended = () => { if (!el.loop) this.stopTapePlay(); };
    el.play();
    this.log('tape: playing' + (loop ? ' (loop)' : ''));
    return true;
  }

  isTapePlaying() { return !!this._tapeEl; }

  setTapeLoop(loop) {
    this._tapeLoop = !!loop;
    if (this._tapeEl) this._tapeEl.loop = !!loop;
  }

  stopTapePlay() {
    if (this._tapeEl) { try { this._tapeEl.pause(); } catch {} this._tapeEl = null; }
    if (this.onTapeEnd) this.onTapeEnd();
  }

  // Download the last recording as a file.
  saveTape() {
    if (!this._tapeBlobUrl) return;
    const a = document.createElement('a');
    a.href = this._tapeBlobUrl;
    a.download = `norns-tape-${Date.now()}.webm`;
    a.click();
  }

  // ── reverb ──────────────────────────────────────────────────────────────

  // Generate a synthetic impulse response (exponentially decaying noise).
  _generateIR(decayTime = 3.0) {
    if (!this.ctx) return null;
    const sr  = this.ctx.sampleRate;
    const len = Math.max(sr * 0.1, Math.round(sr * decayTime));
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.exp(-3 * i / len);
      }
    }
    return buf;
  }

  setRevOn(on) {
    if (!this._revSend) return;
    this._revOn = !!on;
    this._revSend.gain.value = this._revOn ? (this._revSendLevel ?? 0.3) : 0;
  }

  setRevSend(v) {           // 0-1: how much of the mix goes into the reverb
    this._revSendLevel = v;
    if (this._revSend && this._revOn) this._revSend.gain.value = v;
  }

  setRevReturn(v) {         // 0-1: wet level coming back from convolver
    if (this._revReturn) this._revReturn.gain.value = v;
  }

  setRevTime(t) {           // decay time in seconds — regenerates IR
    if (!this._convolver) return;
    this._revTime = Math.max(0.1, Math.min(30, t));
    this._convolver.buffer = this._generateIR(this._revTime);
  }

  // ── compressor ──────────────────────────────────────────────────────────

  _compSavedSettings = { threshold: -12, ratio: 4, attack: 0.005, release: 0.1 };

  setCompOn(on) {
    if (!this._comp) return;
    this._compOn = !!on;
    if (this._compOn) {
      const s = this._compSavedSettings;
      this._comp.threshold.value = s.threshold;
      this._comp.ratio.value     = s.ratio;
      this._comp.attack.value    = s.attack;
      this._comp.release.value   = s.release;
    } else {
      this._comp.threshold.value = 0;
      this._comp.ratio.value     = 1;
    }
  }

  setCompThreshold(db) {
    this._compSavedSettings.threshold = db;
    if (this._comp && this._compOn) this._comp.threshold.value = db;
  }

  setCompRatio(r) {
    this._compSavedSettings.ratio = r;
    if (this._comp && this._compOn) this._comp.ratio.value = r;
  }

  setCompAttack(t) {
    this._compSavedSettings.attack = t;
    if (this._comp && this._compOn) this._comp.attack.value = t;
  }

  setCompRelease(t) {
    this._compSavedSettings.release = t;
    if (this._comp && this._compOn) this._comp.release.value = t;
  }
}
