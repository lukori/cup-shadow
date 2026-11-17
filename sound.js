// Sounds: synthesised placeholders. To use real recordings, put files in
// sounds/ named bark.mp3, growl.mp3 (a loop) and bloom.mp3; they replace the
// synthesised versions automatically.

export class Sound {
  constructor() {
    this.ctx = null;
    this.files = {};
    this.volume = 0.8;
    this.busyUntil = 0; // while our own sound plays, the blow detector ignores the mic
  }

  // must run inside a tap (iOS)
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    // play one silent sample to fully unlock iOS audio
    const b = this.ctx.createBuffer(1, 1, 22050);
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.connect(this.master); s.start(0);
    this.ctx.resume();
    this._noise = this._makeNoise();
    this._startGrowl();
    this._loadFiles();
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  async _loadFiles() {
    for (const name of ['bark', 'growl', 'bloom']) {
      try {
        const r = await fetch(`sounds/${name}.mp3`, { cache: 'no-store' });
        if (!r.ok) continue;
        this.files[name] = await this.ctx.decodeAudioData(await r.arrayBuffer());
        if (name === 'growl') this._startGrowl(true);
      } catch (e) { /* no file: keep the synthesised sound */ }
    }
  }

  _makeNoise() {
    const len = this.ctx.sampleRate * 1.5;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _mark(sec) { this.busyUntil = Math.max(this.busyUntil, performance.now() / 1000 + sec + 0.25); }

  _playFile(name, vol = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.files[name];
    const g = this.ctx.createGain();
    g.gain.value = vol * this.volume;
    s.connect(g).connect(this.master);
    s.start();
    this._mark(s.buffer.duration);
  }

  bark() {
    if (!this.ctx) return;
    if (this.files.bark) return this._playFile('bark');
    const c = this.ctx, t = c.currentTime, v = this.volume;
    const pitch = 0.85 + Math.random() * 0.3;
    // voiced part: falling sawtooth through a "mouth" filter
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(190 * pitch, t + 0.16);
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(1300 * pitch, t);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(f).connect(g).connect(this.master);
    // breathy part
    const n = c.createBufferSource();
    n.buffer = this._noise;
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 900 * pitch; nf.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.008);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    n.connect(nf).connect(ng).connect(this.master);
    o.start(t); o.stop(t + 0.25);
    n.start(t); n.stop(t + 0.2);
    this._mark(0.25);
  }

  _startGrowl(fromFile = false) {
    const c = this.ctx;
    if (this.growl) { try { this.growl.src.stop(); } catch (e) {} this.growl.out.disconnect(); }
    const out = c.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    let src;
    if (fromFile && this.files.growl) {
      src = c.createBufferSource();
      src.buffer = this.files.growl; src.loop = true;
      src.connect(out);
    } else {
      src = c.createOscillator();
      src.type = 'sawtooth'; src.frequency.value = 78;
      // rough, rattling amplitude
      const am = c.createGain(); am.gain.value = 0.5;
      const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 23;
      const lfoG = c.createGain(); lfoG.gain.value = 0.5;
      lfo.connect(lfoG).connect(am.gain);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 4;
      src.connect(am).connect(lp).connect(out);
      lfo.start();
      this._wobble = setInterval(() => {
        const t = c.currentTime;
        src.frequency.setTargetAtTime(70 + Math.random() * 18, t, 0.08);
        lfo.frequency.setTargetAtTime(19 + Math.random() * 8, t, 0.1);
      }, 180);
    }
    src.start();
    this.growl = { src, out };
  }

  // level 0..1, called every frame
  setGrowl(level) {
    if (!this.growl) return;
    const target = Math.max(0, Math.min(1, level)) * 0.35 * this.volume;
    this.growl.out.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
  }

  bloom() {
    if (!this.ctx) return;
    if (this.files.bloom) return this._playFile('bloom');
    const c = this.ctx, t = c.currentTime, v = this.volume;
    [1046.5, 1318.5, 1568, 2093].forEach((fr, i) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = c.createGain();
      const t0 = t + 0.12 + i * 0.11;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25 * v, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      o.connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 1.5);
    });
    this._mark(1.8);
  }
}

// ---- blow detector --------------------------------------------------------
// A blow on the mic is loud, broadband noise (flat spectrum, lots of low end).
// Speech and music are louder in a few harmonics only (low "flatness").
export class BlowDetector {
  constructor(ctx) { this.ctx = ctx; this.db = -100; this.flat = 0; this.low = 0; this.ok = false; }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = this.ctx.createMediaStreamSource(stream);
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 2048;
    this.an.smoothingTimeConstant = 0;
    src.connect(this.an);
    this.time = new Float32Array(this.an.fftSize);
    this.freq = new Float32Array(this.an.frequencyBinCount);
    this.ok = true;
  }

  update() {
    if (!this.ok) return;
    this.an.getFloatTimeDomainData(this.time);
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
    this.db = 10 * Math.log10(sum / this.time.length + 1e-12);
    this.an.getFloatFrequencyData(this.freq);
    const hz = this.ctx.sampleRate / this.an.fftSize;
    const a = Math.floor(80 / hz), b = Math.floor(4000 / hz), mid = Math.floor(600 / hz);
    let logSum = 0, linSum = 0, lowSum = 0;
    for (let i = a; i < b; i++) {
      const p = Math.pow(10, this.freq[i] / 10) + 1e-20;
      logSum += Math.log(p); linSum += p;
      if (i < mid) lowSum += p;
    }
    const n = b - a;
    this.flat = Math.exp(logSum / n) / (linSum / n);
    this.low = lowSum / linSum;
  }
}
