// Sounds. Real recordings in sounds/ are used when they exist:
//   bark1.mp3, bark2.mp3, ... (any number, one is picked at random each time; or a single bark.mp3)
//   growl.mp3 (played as a loop), bloom.mp3
// Anything missing falls back to a synthesised version.

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
    // numbered barks: load until the first missing number
    this.barks = [];
    for (let i = 1; i <= 20; i++) {
      try {
        const r = await fetch(`sounds/bark${i}.mp3`, { cache: 'no-cache' });
        if (!r.ok) break;
        this.barks.push(await this.ctx.decodeAudioData(await r.arrayBuffer()));
      } catch (e) { break; }
    }
    for (const name of ['bark', 'growl', 'bloom']) {
      try {
        const r = await fetch(`sounds/${name}.mp3`, { cache: 'no-cache' });
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

  _playBuffer(buf, { vol = 1, rate = 1, delay = 0 } = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol * this.volume;
    s.connect(g).connect(this.master);
    s.start(this.ctx.currentTime + delay);
    this._mark(delay + buf.duration / rate);
  }

  // opts: { delay (s), rate (pitch/speed, 1 = as recorded), gain }
  bark(opts = {}) {
    if (!this.ctx) return;
    const { delay = 0, rate = 1, gain = 1 } = opts;
    const pool = this.barks?.length ? this.barks : this.files.bark ? [this.files.bark] : null;
    if (pool) {
      // never the same bark twice in a row, and a slightly different pitch each time
      let i = Math.floor(Math.random() * pool.length);
      if (pool.length > 1 && i === this._lastBark) i = (i + 1) % pool.length;
      this._lastBark = i;
      return this._playBuffer(pool[i], { vol: gain, rate: rate * (0.94 + Math.random() * 0.12), delay });
    }
    const c = this.ctx, t = c.currentTime + delay, v = this.volume * gain;
    const pitch = (0.85 + Math.random() * 0.3) * rate;
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
    this._mark(delay + 0.25);
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
    const target = Math.max(0, Math.min(1, level)) * (this.files.growl ? 0.8 : 0.35) * this.volume;
    this.growl.out.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
  }

  // the rose opening: a soft breath of air with a warm, slow swell under it (no bells)
  bloom() {
    if (!this.ctx) return;
    if (this.files.bloom) return this._playBuffer(this.files.bloom);
    const c = this.ctx, t = c.currentTime, v = this.volume;
    // air: noise through a slowly opening band filter, like petals unfolding
    const n = c.createBufferSource(); n.buffer = this._noise; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 1.6);
    bp.frequency.exponentialRampToValueAtTime(900, t + 3.2);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.9);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t); n.stop(t + 3.5);
    // warm swell: a low open fifth, gently detuned, rising in slowly
    [[196, -4], [196, 5], [293.7, 0], [392, 3]].forEach(([fr, cents], i) => {
      const o = c.createOscillator(); o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = fr; o.detune.value = cents;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = c.createGain();
      const t0 = t + 0.15 + i * 0.18;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime((i === 3 ? 0.035 : 0.07) * v, t0 + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.6);
      o.connect(lp).connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 3.7);
    });
    this._mark(1.5);
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
