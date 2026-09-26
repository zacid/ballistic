// Hold the Fort's "AI director": sizes each wave to the defenders.
//
// After every wave it scores how comfortably the defenders cleared it (lives lost, damage taken per pop,
// health left, time taken) against a target of "a bit of a scramble", and nudges a hidden skill rating.
// The rating plus the wave number set every knob: bot aim and reactions, how many come, how many attack
// at once, how fast they arrive, their guns, and the boss's health.
//
// Rules of thumb: ease off fast, ramp up slowly; only change between waves, except to give breathing
// room when the defenders are hurting mid-wave; keep everything inside sane limits.

import { WeaponId } from './config';

export interface WaveStats { livesLost: number; dmgTaken: number; kills: number; t: number; endHp: number; humans: number; count: number }

/** Fixed difficulties pin the rating; adaptive starts in the middle and moves. */
export const FIXED_SKILL = { easy: -0.8, normal: 0, hard: 0.9 } as const;
const S_MIN = -1, S_MAX = 1.6;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Director {
  skill = 0;
  adaptive = true;
  /** Last wave's verdict for the HUD: -1 easing off, 0 steady, 1 tougher. */
  trend = 0;
  lastPerf = 0;
  stats: WaveStats = this.blank(1, 0);
  private hpSeen = new Map<number, number>();
  private hurtT = 0;         // recent pain: holds back reinforcements for a bit

  reset(difficulty: string) {
    this.adaptive = difficulty === 'adaptive';
    this.skill = this.adaptive ? -0.2 : FIXED_SKILL[difficulty as keyof typeof FIXED_SKILL] ?? 0;
    this.trend = 0; this.lastPerf = 0; this.hpSeen.clear(); this.hurtT = 0;
  }

  private blank(humans: number, count: number): WaveStats { return { livesLost: 0, dmgTaken: 0, kills: 0, t: 0, endHp: 1, humans, count }; }
  startWave(humans: number, count: number) { this.stats = this.blank(humans, count); this.hurtT = 0; }

  /** Effective level: the rating plus a gentle climb per wave. */
  level(n: number) { return this.skill + Math.max(0, n - 1) * 0.09; }
  private t(n: number) { return clamp((this.level(n) + 1) / 2.6, 0, 1); }

  // ---------- the knobs ----------
  aim(n: number) {
    const t = this.t(n);
    return { react: lerp(0.62, 0.14, t), aimErr: lerp(0.26, 0.045, t), lead: lerp(0.25, 1, t), nade: lerp(0.15, 1, t) };
  }
  count(n: number, humans: number) {
    return Math.max(2, Math.round((1.5 + n * 1.1) * (humans > 1 ? 1.35 : 1) * (1 + 0.22 * this.skill)));
  }
  maxAlive(n: number, humans: number) {
    const base = 1 + Math.floor(n / 3) + humans + Math.round(this.skill * 1.5);
    return clamp(base - (this.hurtT > 0 ? 2 : 0), 2, 8);
  }
  spawnGap() { return clamp(1 - 0.25 * this.skill, 0.5, 1.5) * (this.hurtT > 0 ? 2.5 : 1); }
  guns(n: number): WeaponId[] {
    const e = n + Math.round(this.skill * 2);   // strong defenders see the heavy guns sooner
    return e <= 2 ? ['pistol', 'shotgun', 'chaingun'] : e <= 4 ? ['pistol', 'shotgun', 'chaingun', 'bouncer', 'flamethrower']
      : e <= 6 ? ['shotgun', 'chaingun', 'bouncer', 'rocket', 'flamethrower', 'gravity'] : ['shotgun', 'chaingun', 'bouncer', 'rocket', 'railgun', 'flamethrower', 'gravity'];
  }
  /** Bot bullets hit softer while the defenders are finding their feet. */
  botDamage(n: number) { return lerp(0.55, 1.05, clamp(this.t(n) * 1.4, 0, 1)); }
  bossHp(humans: number) { return Math.round(380 * (1 + 0.3 * this.skill) * (humans > 1 ? 1.4 : 1)); }

  // ---------- watching the fight ----------
  /** Per-step bookkeeping: damage the defenders take (from their hp, which the host sees for everyone). */
  watch(dt: number, humans: { id: number; hp: number; alive: boolean }[]) {
    this.stats.t += dt;
    this.hurtT = Math.max(0, this.hurtT - dt);
    let sum = 0, n = 0;
    for (const h of humans) {
      const prev = this.hpSeen.get(h.id);
      if (h.alive && prev !== undefined && h.hp < prev) this.stats.dmgTaken += prev - h.hp;
      this.hpSeen.set(h.id, h.alive ? h.hp : 100);
      if (h.alive) { sum += h.hp; n++; }
    }
    // everyone standing is hurting: give them room to breathe
    if (n && sum / n < 35) this.hurtT = Math.max(this.hurtT, 1);
  }
  lifeLost() { this.stats.livesLost++; this.hurtT = 4; }
  botPopped() { this.stats.kills++; }

  /** Wave cleared: score it and move the rating. Returns the verdict for the HUD. */
  endWave(endHp: number) {
    const s = this.stats; s.endHp = endHp;
    const h = Math.max(1, s.humans);
    const expectT = 5 + (s.count / h) * 4.5;
    const lifeTerm = clamp(0.35 - s.livesLost / h, -1.5, 0.35) / 0.35;        // no deaths = +1, a death each = about -2
    const hpTerm = clamp((s.endHp - 0.5) * 2, -1, 1);
    const dpk = s.dmgTaken / Math.max(1, s.kills);
    const dpkTerm = clamp((22 - dpk) / 22, -1, 1);
    const timeTerm = clamp((expectT - s.t) / expectT, -1, 0.6);
    const perf = clamp(0.45 * lifeTerm + 0.2 * hpTerm + 0.25 * dpkTerm + 0.1 * timeTerm, -1.5, 1);
    this.lastPerf = perf;
    if (!this.adaptive) { this.trend = 0; return 0; }
    const before = this.skill;
    this.skill = clamp(this.skill + (perf > 0 ? 0.3 : 0.55) * perf, S_MIN, S_MAX);
    const d = this.skill - before;
    this.trend = d > 0.06 ? 1 : d < -0.06 ? -1 : 0;
    return this.trend;
  }

  /** 1..5 for the threat meter. */
  threat(n: number) { return clamp(Math.round(this.t(n) * 4) + 1, 1, 5); }
}

// ---------------------------------------------------------------------------------------------
// Free-for-all / solo Gun Game: no waves to judge, so it adjusts continuously, and only changes how
// bots treat *you*. Bot-against-bot fights keep the normal settings, so the match still plays naturally.
//
// Every pop you land nudges the rating up a little; every time you're popped nudges it down more (ease
// off fast, ramp up slowly). Every 15 s the damage you dealt vs took over that stretch nudges it too.
// The rating sets how quickly and accurately bots shoot at you, how hard their hits land, and how keen
// they are to pick you as a target. It's saved, so the next match starts where the last one ended.

export class FfaDirector {
  skill = 0;
  active = false;
  private dealt = 0; private taken = 0; private windowT = 0;
  trend = 0;

  start(active: boolean, saved: number | undefined) {
    this.active = active; this.skill = clamp(saved ?? -0.2, -1, 1.3);
    this.dealt = this.taken = this.windowT = 0; this.trend = 0;
  }
  private nudge(d: number) { const b = this.skill; this.skill = clamp(this.skill + d, -1, 1.3); this.trend = Math.sign(this.skill - b); }

  popped(streak: number) { if (this.active) this.nudge(0.05 + (streak >= 3 ? 0.03 : 0)); }
  died() { if (this.active) this.nudge(-0.11); }
  dealtDamage(d: number) { this.dealt += d; }
  tookDamage(d: number) { this.taken += d; }
  step(dt: number) {
    if (!this.active) return;
    this.windowT += dt;
    if (this.windowT < 15) return;
    const r = (this.dealt + 20) / (this.taken + 20);   // the +20 keeps quiet stretches from swinging it
    this.nudge(clamp((r - 1) * 0.06, -0.08, 0.05));
    this.dealt = this.taken = this.windowT = 0;
  }

  private get t() { return clamp((this.skill + 1) / 2.3, 0, 1); }
  /** Bot skill when shooting at you (Easy-ish at the bottom, a bit past Hard at the top). */
  aim(base: { react: number; aimErr: number; lead: number; nade: number }) {
    if (!this.active) return base;
    const t = this.t;
    return { react: lerp(0.62, 0.15, t), aimErr: lerp(0.26, 0.05, t), lead: lerp(0.25, 1, t), nade: lerp(0.15, 1, t) };
  }
  /** How hard bot hits on you land. */
  damage() { return this.active ? lerp(0.6, 1.1, this.t) : 1; }
  /** Added to a bot's target score for you (lower = more likely to be picked). */
  targetBias() { return this.active ? lerp(3.5, -3, this.t) : 0; }
  threat() { return clamp(Math.round(this.t * 4) + 1, 1, 5); }
}
