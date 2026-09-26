// Procedural chiptune soundtrack. A tiny step sequencer on the Web Audio clock: square-wave bass,
// a thin pulse arpeggio, a lead line, and synthesised drums. Nothing is recorded; every note is scheduled
// a moment ahead so timing stays tight even when a frame hitches.
//
// Tracks: 'menu' (laid back), 'match' (driving), 'off'. Intensity 0..2 adds layers and pushes the tempo:
//   0  bass + kick + hats            (countdown, calm moments)
//   1  + snare, arpeggio            (normal play)
//   2  + lead, sixteenth hats, fills (last 30 s, a boss, one pop from winning)

export type Track = 'menu' | 'match' | 'off';

const LOOKAHEAD = 0.14;   // seconds of notes scheduled ahead
const TICK_MS = 25;

// A minor. Chords as MIDI roots plus a minor/major flag.
type Chord = [number, 'm' | 'M'];
const MATCH_PROG: Chord[][] = [
  [[57, 'm'], [53, 'M'], [48, 'M'], [55, 'M']],   // Am F C G
  [[53, 'M'], [55, 'M'], [57, 'm'], [57, 'm']],   // F G Am Am
  [[50, 'm'], [53, 'M'], [52, 'M'], [52, 'M']],   // Dm F E E (tension back to Am)
  [[57, 'm'], [53, 'M'], [48, 'M'], [55, 'M']],
];
const MENU_PROG: Chord[] = [[57, 'm'], [53, 'M'], [48, 'M'], [52, 'M']];
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17];   // A minor pentatonic, as offsets from A

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const triad = (c: Chord) => [c[0], c[0] + (c[1] === 'm' ? 3 : 4), c[0] + 7];

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private pulse: PeriodicWave | null = null;
  private timer = 0;
  private next = 0;          // audio time of the next step
  private step = 0;          // 16th-note counter
  private lead: number[] = [];
  track: Track = 'off';
  intensity = 0;
  enabled = true;
  private vol = 0.5;

  attach(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    if (this.ctx) return;
    this.ctx = ctx; this.noise = noise;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.out.connect(dest);
    // a 12.5% pulse wave: the classic thin NES arpeggio tone
    const n = 32, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.125);
    this.pulse = ctx.createPeriodicWave(re, im);
    this.newLead(1);
    this.timer = window.setInterval(() => this.pump(), TICK_MS);
    this.apply();
  }

  /** Pick what plays. Switching tracks restarts the bar so the new groove lands on the downbeat. */
  set(track: Track, intensity = 1) {
    intensity = Math.max(0, Math.min(2, intensity));
    if (track === this.track && intensity === this.intensity) return;
    const changed = track !== this.track;
    this.track = track; this.intensity = intensity;
    if (changed && this.ctx) { this.step = 0; this.next = this.ctx.currentTime + 0.08; if (track === 'match') this.newLead((Math.random() * 1e9) | 0); }
    this.apply();
  }

  setEnabled(on: boolean) { this.enabled = on; this.apply(); }
  /** 0..1 from the settings slider. */
  setVolume(v: number) { this.vol = 0.6 * v; this.enabled = v > 0; this.apply(); }

  private apply() {
    if (!this.out || !this.ctx) return;
    const target = this.enabled && this.track !== 'off' ? (this.track === 'menu' ? 0.7 : 1) * this.vol : 0;
    const g = this.out.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(target, t + 0.6);
  }

  /** A fresh 2-bar lead motif per match, so every game hums a little differently. */
  private newLead(seed: number) {
    let a = seed >>> 0;
    const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.lead = [];
    let p = 2;
    for (let i = 0; i < 32; i++) {
      const on = i % 4 === 0 ? r() < 0.85 : i % 2 === 0 ? r() < 0.45 : r() < 0.12;
      if (!on) { this.lead.push(-1); continue; }
      p = Math.max(0, Math.min(PENTA.length - 1, p + Math.round((r() - 0.5) * 4)));
      this.lead.push(PENTA[p]);
    }
  }

  private get bpm() { return this.track === 'menu' ? 96 : this.intensity >= 2 ? 150 : 140; }

  private pump() {
    const c = this.ctx; if (!c || !this.out) return;
    if (c.state !== 'running' || this.track === 'off' || !this.enabled) { this.next = c.currentTime + 0.05; return; }
    if (this.next < c.currentTime - 0.2) this.next = c.currentTime + 0.02;   // tab was asleep: don't burst
    while (this.next < c.currentTime + LOOKAHEAD) {
      if (this.track === 'menu') this.menuStep(this.step, this.next); else this.matchStep(this.step, this.next);
      this.next += 60 / this.bpm / 4; this.step++;
    }
  }

  // ---------- arrangements ----------
  private matchStep(i: number, t: number) {
    const s = i % 16, bar = Math.floor(i / 16), I = this.intensity;
    const section = MATCH_PROG[Math.floor(bar / 4) % MATCH_PROG.length], chord = section[bar % 4];
    const root = chord[0] - 24, tri = triad(chord);
    const d16 = 60 / this.bpm / 4;
    // bass: driving eighths with octave pops
    if (s % 2 === 0) this.voice('square', midi(s === 6 || s === 14 ? root + 12 : root), t, d16 * 1.6, 0.16, 700);
    // drums
    if (I === 0 ? s === 0 || s === 8 : s % 4 === 0) this.kick(t);
    if (I >= 1 && (s === 4 || s === 12)) this.snare(t, 0.35);
    if (I >= 2 && bar % 4 === 3 && s >= 12 && s % 1 === 0) this.snare(t, 0.12 + (s - 12) * 0.05);
    if (I >= 2 ? true : s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.1 : 0.05);
    // arpeggio: chord tones climbing two octaves
    if (I >= 1) { const arp = [tri[0], tri[1], tri[2], tri[0] + 12, tri[2], tri[1] + 12, tri[0] + 12, tri[1]]; this.voice(this.pulse, midi(arp[s % 8] + 12), t, d16 * 0.9, 0.05, 4000); }
    // lead
    if (I >= 2) {
      const n = this.lead[(bar % 2) * 16 + s];
      if (n >= 0) this.voice('square', midi(69 + n), t, d16 * 1.8, 0.06, 2600, true);
    }
  }

  private menuStep(i: number, t: number) {
    const s = i % 16, bar = Math.floor(i / 16);
    const chord = MENU_PROG[bar % MENU_PROG.length], tri = triad(chord);
    const d16 = 60 / this.bpm / 4;
    if (s === 0) for (const n of tri) this.voice('triangle', midi(n), t, d16 * 15, 0.06, 1800, false, 0.35);
    if (s === 0 || s === 10) this.voice('triangle', midi(chord[0] - 24), t, d16 * 5, 0.2, 500);
    if (s % 2 === 0) { const arp = [tri[0], tri[1], tri[2], tri[1]]; this.voice(this.pulse, midi(arp[(s / 2) % 4] + 12), t, d16 * 1.2, 0.03, 2500); }
    if (s === 0 || s === 10) this.kick(t, 0.5);
    if (s % 4 === 2) this.hat(t, 0.03);
  }

  // ---------- instruments ----------
  private voice(type: OscillatorType | PeriodicWave | null, f: number, t: number, dur: number, vol: number, cutoff: number, vibrato = false, attack = 0.005) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    if (type instanceof PeriodicWave) o.setPeriodicWave(type); else o.type = type ?? 'square';
    o.frequency.setValueAtTime(f, t);
    if (vibrato) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 6; lg.gain.value = f * 0.012; l.connect(lg); lg.connect(o.frequency); l.start(t + 0.08); l.stop(t + dur + 0.05); }
    lp.type = 'lowpass'; lp.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.6)); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(lp); lp.connect(g); g.connect(this.out!);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private kick(t: number, vol = 0.9) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(this.out!); o.start(t); o.stop(t + 0.22);
  }

  private snare(t: number, vol: number) {
    const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    s.connect(f); f.connect(g); g.connect(this.out!); s.start(t, Math.random() * 0.5); s.stop(t + 0.16);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    og.gain.setValueAtTime(vol * 0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(og); og.connect(this.out!); o.start(t); o.stop(t + 0.08);
  }

  private hat(t: number, vol: number) {
    const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 7000;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    s.connect(f); f.connect(g); g.connect(this.out!); s.start(t, Math.random() * 0.5); s.stop(t + 0.05);
  }

  destroy() { clearInterval(this.timer); }
}
