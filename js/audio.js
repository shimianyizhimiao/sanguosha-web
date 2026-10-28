/* 三國殺 · 音效（全部由 WebAudio 即時合成，不使用任何外部素材檔）
   用法：SGS_AUDIO.click() / .play('sha') …
*/
(function (root) {
  'use strict';

  const A = {
    ctx: null,
    master: null,
    muted: false,
    vol: 0.55,
    noiseBuf: null,
    last: {},

    init() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.vol;
        this.master.connect(this.ctx.destination);
        // 預先做 1 秒白噪音
        const sr = this.ctx.sampleRate;
        const buf = this.ctx.createBuffer(1, sr, sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      } catch (e) { this.ctx = null; }
      return this.ctx;
    },

    resume() {
      const c = this.init();
      if (c && c.state === 'suspended') c.resume();
    },

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : this.vol;
    },

    /* ---------- 基礎合成 ---------- */
    tone(freq, dur, opt) {
      const c = this.ctx;
      if (!c || this.muted) return;
      opt = opt || {};
      const t = c.currentTime;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = opt.type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (opt.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t + dur);
      const peak = opt.gain == null ? 0.2 : opt.gain;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + (opt.attack || 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = o;
      if (opt.filter) {
        const f = c.createBiquadFilter();
        f.type = opt.filter;
        f.frequency.value = opt.freq || 800;
        node.connect(f); node = f;
      }
      node.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.03);
    },

    noise(dur, opt) {
      const c = this.ctx;
      if (!c || this.muted || !this.noiseBuf) return;
      opt = opt || {};
      const t = c.currentTime;
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      s.playbackRate.value = opt.rate || 1;
      const f = c.createBiquadFilter();
      f.type = opt.filter || 'bandpass';
      f.frequency.setValueAtTime(opt.freq || 1200, t);
      if (opt.sweepTo) f.frequency.exponentialRampToValueAtTime(opt.sweepTo, t + dur);
      f.Q.value = opt.q == null ? 1.2 : opt.q;
      const g = c.createGain();
      const peak = opt.gain == null ? 0.25 : opt.gain;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + (opt.attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t); s.stop(t + dur + 0.03);
    },

    /* ---------- 具體音效 ---------- */
    click() { this.tone(880, 0.05, { type: 'square', gain: 0.05, to: 620 }); },

    draw() { this.noise(0.14, { freq: 600, sweepTo: 2600, gain: 0.12, filter: 'highpass' }); },

    play() {
      this.tone(520, 0.09, { type: 'triangle', gain: 0.12, to: 300 });
      this.noise(0.06, { freq: 2400, sweepTo: 900, gain: 0.09 });
    },

    sha() {
      this.noise(0.26, { freq: 900, sweepTo: 3200, gain: 0.22, filter: 'bandpass', q: 1.6 });
      this.tone(680, 0.18, { type: 'sawtooth', gain: 0.06, to: 220 });
    },

    shan() {
      this.tone(1450, 0.16, { type: 'square', gain: 0.09, to: 900 });
      this.noise(0.12, { freq: 5200, sweepTo: 2600, gain: 0.14, filter: 'bandpass', q: 6 });
    },

    hit() {
      this.tone(120, 0.34, { type: 'sine', gain: 0.4, to: 46 });
      this.noise(0.2, { freq: 420, sweepTo: 120, gain: 0.24, filter: 'lowpass' });
    },

    heal() {
      const seq = [523, 659, 784, 1046];
      seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.26, { type: 'sine', gain: 0.11 }), i * 55));
    },

    judge() {
      this.tone(96, 0.24, { type: 'sine', gain: 0.3, to: 60 });
      this.noise(0.18, { freq: 260, sweepTo: 90, gain: 0.16, filter: 'lowpass' });
    },

    skill() {
      this.tone(1046, 0.18, { type: 'sine', gain: 0.1 });
      setTimeout(() => this.tone(1318, 0.24, { type: 'sine', gain: 0.08 }), 70);
    },

    card() { this.tone(392, 0.1, { type: 'triangle', gain: 0.1, to: 294 }); },

    death() {
      this.tone(220, 0.9, { type: 'sawtooth', gain: 0.18, to: 55, filter: 'lowpass', freq: 900 });
      this.noise(0.7, { freq: 700, sweepTo: 120, gain: 0.2, filter: 'lowpass' });
    },

    win() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, { type: 'triangle', gain: 0.12 }), i * 120));
    },

    lose() {
      [440, 392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, { type: 'sine', gain: 0.14 }), i * 160));
    },

    error() { this.tone(180, 0.16, { type: 'square', gain: 0.1, to: 120 }); },

    play(name) {
      if (this.muted || !this.ctx) return;
      const now = performance.now();
      if (this.last[name] && now - this.last[name] < 40) return;  // 防疊音
      this.last[name] = now;
      if (typeof this[name] === 'function') this[name]();
    },
  };

  root.SGS_AUDIO = A;
})(typeof window !== 'undefined' ? window : globalThis);
