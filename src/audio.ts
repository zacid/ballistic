// Every sound is synthesised: filtered noise bursts plus pitch-swept tones.

export class Audio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  listener = { x: 0, z: 0 };
  private noiseBuf: AudioBuffer | null = null;
  private last: Record<string, number> = {};

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!C) return;
    const ctx: AudioContext = new C();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.38;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(ctx.destination);
    const n = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, n, n);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.38; }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master!); o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(type: BiquadFilterType, f0: number, f1: number, dur: number, vol: number, q = 1, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master!); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  play(name: string, x?: number, z?: number, vol = 1) {
    if (!this.ctx || this.muted) return;
    let v = vol;
    if (x !== undefined && z !== undefined) {
      const d = Math.hypot(x - this.listener.x, z - this.listener.z);
      const k = Math.max(0, 1 - d / 26); v *= k * k;
    }
    if (v < 0.02) return;
    const now = this.ctx.currentTime;
    if (now - (this.last[name] ?? -1) < 0.03) return;
    this.last[name] = now;
    switch (name) {
      case 'shotgun':
        this.noise('lowpass', 4200, 300, 0.22, 0.9 * v, 0.7); this.tone('sine', 160, 45, 0.16, 0.55 * v);
        this.noise('bandpass', 1800, 900, 0.05, 0.4 * v, 1.5, 0.19); // pump
        break;
      case 'chaingun':
        this.noise('bandpass', 2800, 900, 0.06, 0.45 * v, 0.9); this.tone('square', 900, 240, 0.045, 0.08 * v);
        break;
      case 'rocket':
        this.noise('bandpass', 700, 2400, 0.35, 0.5 * v, 0.8); this.tone('sawtooth', 110, 260, 0.25, 0.12 * v);
        break;
      case 'railgun': this.tone('sawtooth', 2400, 180, 0.35, 0.22 * v); this.tone('sine', 1200, 60, 0.4, 0.4 * v); this.noise('highpass', 4000, 9000, 0.3, 0.2 * v); break;
      case 'bouncer': this.tone('sine', 700, 1400, 0.09, 0.3 * v); this.tone('triangle', 350, 520, 0.08, 0.15 * v); break;
      case 'pistol': this.noise('bandpass', 2400, 900, 0.07, 0.6 * v, 1.2); this.tone('square', 520, 160, 0.06, 0.18 * v); break;
      case 'grenade': this.noise('bandpass', 600, 1800, 0.14, 0.25 * v, 1.2); break;
      case 'levelup': [523, 784, 1046, 1568].forEach((f, i) => this.tone('square', f, f * 1.01, 0.12, 0.14, i * 0.06)); this.tone('sine', 260, 1040, 0.35, 0.18); break;
      case 'demote': [494, 392, 311].forEach((f, i) => this.tone('sawtooth', f, f * 0.9, 0.16, 0.12, i * 0.1)); break;
      case 'boom':
        this.noise('lowpass', 2200, 60, 0.7, 1.1 * v); this.tone('sine', 120, 30, 0.55, 0.9 * v);
        this.noise('bandpass', 600, 150, 0.45, 0.35 * v, 0.6, 0.04);
        break;
      case 'throw': this.noise('bandpass', 600, 1800, 0.14, 0.25 * v, 1.2); break;
      case 'bounce': this.tone('triangle', 520, 380, 0.06, 0.18 * v); break;
      case 'hit': this.tone('triangle', 820, 300, 0.07, 0.32 * v); this.noise('highpass', 2500, 1500, 0.04, 0.15 * v); break;
      case 'hurt': this.tone('square', 240, 140, 0.1, 0.12 * v); break;
      case 'wall': this.noise('bandpass', 3200, 1600, 0.035, 0.12 * v, 2); break;
      case 'bonk': this.tone('sine', 190, 90, 0.12, 0.45 * v); this.noise('lowpass', 900, 200, 0.08, 0.25 * v); break;
      case 'pop':  // babo bursts
        this.noise('lowpass', 3000, 120, 0.4, 0.9 * v); this.tone('sine', 420, 60, 0.3, 0.6 * v);
        this.tone('triangle', 900, 1400, 0.08, 0.2 * v, 0.02);
        break;
      case 'kill': [523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.22, i * 0.05)); break;
      case 'pickup': [660, 880, 1320].forEach((f, i) => this.tone('triangle', f, f * 1.01, 0.12, 0.25 * v, i * 0.06)); break;
      case 'heal': [440, 660, 990].forEach((f, i) => this.tone('sine', f, f * 1.05, 0.16, 0.3 * v, i * 0.07)); break;
      case 'reload': this.noise('bandpass', 1400, 1000, 0.05, 0.3 * v, 3); this.noise('bandpass', 2200, 1800, 0.05, 0.3 * v, 3, 0.12); break;
      case 'empty': this.tone('square', 1200, 1100, 0.03, 0.1 * v); break;
      case 'spawn': this.tone('sine', 300, 900, 0.25, 0.25 * v); this.noise('highpass', 1200, 5000, 0.25, 0.12 * v); break;
      case 'count': this.tone('square', 660, 660, 0.1, 0.16); break;
      case 'go': this.tone('square', 990, 990, 0.25, 0.2); this.tone('square', 1320, 1320, 0.25, 0.12, 0.02); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.22, 0.14, i * 0.12)); break;
      case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.3, 0.22, i * 0.16)); break;
      case 'dash': this.noise('bandpass', 500, 3000, 0.22, 0.45 * v, 1.2); this.tone('sine', 300, 700, 0.18, 0.2 * v); break;
      case 'spikes': this.tone('sawtooth', 180, 520, 0.12, 0.15 * v); this.noise('highpass', 3000, 6000, 0.12, 0.25 * v); break;
      case 'stab': this.noise('bandpass', 1800, 500, 0.12, 0.7 * v, 1.5); this.tone('square', 300, 90, 0.12, 0.25 * v); break;
      case 'bubble': this.tone('sine', 260, 780, 0.3, 0.3 * v); this.tone('sine', 390, 1170, 0.3, 0.15 * v, 0.03); break;
      case 'wave': this.noise('lowpass', 1400, 80, 0.45, 1 * v); this.tone('sine', 90, 40, 0.4, 0.8 * v); this.noise('bandpass', 400, 2400, 0.25, 0.3 * v, 0.8); break;
      case 'ready': this.tone('triangle', 880, 880, 0.08, 0.15); this.tone('triangle', 1320, 1320, 0.1, 0.12, 0.07); break;
      case 'click': this.tone('triangle', 900, 700, 0.05, 0.2); break;
    }
  }
}
