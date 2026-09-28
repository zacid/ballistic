// Every sound is synthesised: filtered noise bursts plus pitch-swept tones.
import { Music } from './music';

export class Audio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  sfxVol = 1;
  private out: GainNode | null = null;
  listener = { x: 0, z: 0 };
  private noiseBuf: AudioBuffer | null = null;
  private last: Record<string, number> = {};
  music = new Music();

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!C) return;
    const ctx: AudioContext = new C();
    this.ctx = ctx;
    // sound effects -> compressor -> out; music -> out (kept off the compressor so explosions don't duck it)
    this.out = ctx.createGain(); this.out.gain.value = this.muted ? 0 : 1; this.out.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.38 * this.sfxVol;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(this.out);
    const n = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, n, n);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.music.attach(ctx, this.out, this.noiseBuf);
  }

  /**
   * Background weather. Rain is a soft, low patter bed plus individual drops scheduled at random
   * (a few a second, drifting with slow gusts): pits on tarmac and the odd plink into a puddle, each
   * panned somewhere different. Snow is a low wind that swells and fades.
   */
  private amb: { stop: (t: number) => void } | null = null;
  private ambKind = '';
  ambience(kind: 'rain' | 'wind' | '') {
    if (!this.ctx || kind === this.ambKind) return;
    this.ambKind = kind;
    const c = this.ctx, t = c.currentTime;
    if (this.amb) { this.amb.stop(t); this.amb = null; }
    if (!kind) return;
    const g = c.createGain(); g.gain.value = 0; g.connect(this.master!);
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    let timer = 0;
    if (kind === 'rain') {
      // distant patter: dull and quiet, gently swelling
      const lp = c.createBiquadFilter(), hp = c.createBiquadFilter(), bed = c.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 1100; hp.type = 'highpass'; hp.frequency.value = 250;
      bed.gain.value = 0.03;
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.012; lfo.connect(lg); lg.connect(bed.gain); lfo.start();
      src.connect(lp); lp.connect(hp); hp.connect(bed); bed.connect(g);
      // individual drops, scheduled a little ahead on the audio clock
      let next = t + 0.2;
      timer = window.setInterval(() => {
        const now = c.currentTime;
        if (next < now) next = now + 0.02;
        while (next < now + 0.25) {
          this.drop(next, g);
          const rate = 6 + 3 * Math.sin(next * 0.13) + 2 * Math.sin(next * 0.041);   // drops per second, drifting
          next += -Math.log(1 - Math.random()) / rate;
        }
      }, 80);
      g.gain.setTargetAtTime(1, t, 1.2);
    } else {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.8;
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 220; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
      src.connect(f); f.connect(g);
      g.gain.setTargetAtTime(0.22, t, 0.8);
    }
    src.start();
    this.amb = { stop: (at) => { clearInterval(timer); g.gain.setTargetAtTime(0, at, 0.3); src.stop(at + 1.5); } };
  }

  /** One raindrop: a tiny filtered tick, or now and then a rising plink into a puddle. */
  private drop(t: number, out: AudioNode) {
    const c = this.ctx!, pan = c.createStereoPanner(); pan.pan.value = (Math.random() * 2 - 1) * 0.8; pan.connect(out);
    const near = Math.random() < 0.15;
    if (Math.random() < 0.22) {
      const o = c.createOscillator(), og = c.createGain(), f = 900 + Math.random() * 900;
      o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.035);
      const v = (near ? 0.07 : 0.035) * (0.6 + Math.random() * 0.4);
      og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(v, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0003, t + 0.06);
      o.connect(og); og.connect(pan); o.start(t); o.stop(t + 0.07);
      return;
    }
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = near ? 1400 + Math.random() * 1200 : 2800 + Math.random() * 4000; bp.Q.value = 2 + Math.random() * 3;
    const dg = c.createGain(), dur = 0.01 + Math.random() * (near ? 0.03 : 0.015), v = (near ? 0.5 : 0.3) * (0.5 + Math.random() * 0.5);
    dg.gain.setValueAtTime(v, t); dg.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(bp); bp.connect(dg); dg.connect(pan); s.start(t, Math.random() * 0.9); s.stop(t + dur + 0.01);
  }

  setMuted(m: boolean) { this.muted = m; if (this.out) this.out.gain.value = m ? 0 : 1; }
  setSfxVolume(v: number) { this.sfxVol = v; if (this.master) this.master.gain.value = 0.38 * v; }

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
    if (!this.ctx || this.muted || this.sfxVol <= 0) return;
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
      case 'flamethrower': this.noise('lowpass', 1400, 500, 0.12, 0.28 * v, 0.7); this.noise('bandpass', 300, 200, 0.1, 0.2 * v, 0.6); break;
      case 'lightning': this.noise('highpass', 2500, 7000, 0.08, 0.35 * v, 0.8); this.noise('bandpass', 900, 2600, 0.06, 0.25 * v, 4, 0.02); this.tone('square', 1800 + Math.random() * 600, 300, 0.05, 0.05 * v); break;
      case 'gravity': this.tone('sine', 90, 260, 0.5, 0.35 * v); this.tone('triangle', 180, 520, 0.5, 0.12 * v); break;
      case 'fling': this.tone('sine', 520, 70, 0.3, 0.5 * v); this.noise('bandpass', 800, 3000, 0.22, 0.45 * v, 1.2); break;
      case 'slam': this.tone('sine', 140, 40, 0.3, 0.9 * v); this.noise('lowpass', 1600, 120, 0.3, 0.8 * v); break;
      case 'mine': this.tone('square', 900, 900, 0.05, 0.12 * v); this.tone('square', 1350, 1350, 0.05, 0.1 * v, 0.08); this.noise('bandpass', 1500, 900, 0.05, 0.25 * v, 3); break;
      case 'boss': this.tone('sawtooth', 70, 45, 0.9, 0.35); this.tone('square', 140, 90, 0.9, 0.12); this.noise('lowpass', 900, 100, 0.9, 0.5); [220, 208, 196].forEach((f, i) => this.tone('square', f, f * 0.97, 0.22, 0.1, 0.25 + i * 0.22)); break;
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
      case 'mpop': this.tone('sine', 520 + Math.random() * 200, 140, 0.12, 0.35 * v); this.noise('lowpass', 2200, 200, 0.1, 0.35 * v); break;
      case 'coin': { const f = 1400 + Math.random() * 300; this.tone('square', f, f, 0.04, 0.06 * v); this.tone('square', f * 1.5, f * 1.5, 0.06, 0.05 * v, 0.04); break; }
      case 'clink': { const f = 2600 + Math.random() * 1400; this.tone('triangle', f, f * 0.96, 0.05, 0.07 * v); this.tone('sine', f * 1.5, f * 1.45, 0.04, 0.04 * v, 0.045); break; }
      case 'beep': this.tone('square', 1760, 1760, 0.06, 0.12 * v); break;
      case 'nukedrop': this.tone('square', 440, 880, 0.12, 0.14 * v); this.tone('square', 880, 880, 0.08, 0.1 * v, 0.14); this.noise('bandpass', 900, 500, 0.08, 0.3 * v, 2); break;
      case 'nuke':
        this.noise('lowpass', 1800, 40, 1.6, 1.3 * v); this.tone('sine', 90, 22, 1.4, 1.1 * v);
        this.noise('bandpass', 500, 90, 1.1, 0.5 * v, 0.5, 0.08); this.tone('sawtooth', 60, 30, 0.9, 0.25 * v);
        break;
      case 'thunder': this.noise('lowpass', 700, 60, 2.4, 0.9 * v); this.noise('lowpass', 300, 40, 1.6, 0.6 * v, 0.7, 0.35); this.tone('sine', 55, 30, 1.8, 0.35 * v); break;
    }
  }
}
