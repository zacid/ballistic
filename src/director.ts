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
const S_MIN = -2, S_MAX = 1.6;

/**
 * Bot behaviour for a 0..1 rating, plus `sub` (0..1) for how far below the old floor it has dropped.
 * The old floor was roughly Easy; below it bots get properly gentle for people still learning.
 */
export interface BotSkill { react: number; aimErr: number; lead: number; nade: number; strafe: number; ability: number }
const TOP: BotSkill = { react: 0.14, aimErr: 0.045, lead: 1, nade: 1, strafe: 1, ability: 1 };
const FLOOR: BotSkill = { react: 0.62, aimErr: 0.26, lead: 0.25, nade: 0.15, strafe: 1, ability: 1 };
const BOTTOM: BotSkill = { react: 1.0, aimErr: 0.42, lead: 0.1, nade: 0.02, strafe: 0.35, ability: 0.25 };
export function botSkill(t: number, sub: number): BotSkill {
  const from = sub > 0 ? FLOOR : FLOOR, to = sub > 0 ? BOTTOM : TOP, k = sub > 0 ? sub : t;
  return { react: lerp(from.react, to.react, k), aimErr: lerp(from.aimErr, to.aimErr, k), lead: lerp(from.lead, to.lead, k), nade: lerp(from.nade, to.nade, k), strafe: lerp(from.strafe, to.strafe, k), ability: lerp(from.ability, to.ability, k) };
}

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
    this.skill = this.adaptive ? -0.6 : FIXED_SKILL[difficulty as keyof typeof FIXED_SKILL] ?? 0;
    this.trend = 0; this.lastPerf = 0; this.hpSeen.clear(); this.hurtT = 0;
  }

  private blank(humans: number, count: number): WaveStats { return { livesLost: 0, dmgTaken: 0, kills: 0, t: 0, endHp: 1, humans, count }; }
  startWave(humans: number, count: number) { this.stats = this.blank(humans, count); this.hurtT = 0; }

  /** Effective level: the rating plus a gentle climb per wave. */
  level(n: number) { return this.skill + Math.max(0, n - 1) * 0.09; }
  private t(n: number) { return clamp((this.level(n) + 1) / 2.6, 0, 1); }
  private sub(n: number) { return clamp(-(this.level(n) + 1), 0, 1); }

  // ---------- the knobs ----------
  aim(n: number) { return botSkill(this.t(n), this.sub(n)); }
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
      : e <= 6 ? ['shotgun', 'chaingun', 'bouncer', 'rocket', 'flamethrower', 'lightning'] : ['shotgun', 'chaingun', 'bouncer', 'rocket', 'railgun', 'flamethrower', 'lightning'];
  }
  /** Bot bullets hit softer while the defenders are finding their feet. */
  botDamage(n: number) { const s = this.sub(n); return s > 0 ? lerp(0.55, 0.35, s) : lerp(0.55, 1.05, clamp(this.t(n) * 1.4, 0, 1)); }
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

interface Form { skill: number; dealt: number; taken: number; windowT: number; trend: number; local: boolean; dry: number }

export class FfaDirector {
  /** Running (on the host / offline): drives the bots. */
  active = false;
  /** Guests don't run it but mirror the host's numbers for their threat meter. */
  shown = false;
  private f = new Map<number, Form>();

  /** Track each human in the match. `local` humans' damage dealt is visible here; a guest's isn't. */
  start(active: boolean, humans: { id: number; skill?: number; local: boolean }[]) {
    this.active = active; this.shown = active; this.f.clear();
    for (const h of humans) this.f.set(h.id, { skill: clamp(h.skill ?? -1.2, -2, 1.3), dealt: 0, taken: 0, windowT: 0, trend: 0, local: h.local, dry: 0 });   // new players start gentle
  }
  has(id: number) { return this.active && this.f.has(id); }
  skillOf(id: number) { return this.f.get(id)?.skill; }
  /** Guest: take the host's ratings. */
  mirror(id: number, skill: number) { const f = this.f.get(id); if (f) f.skill = skill; else this.f.set(id, { skill, dealt: 0, taken: 0, windowT: 0, trend: 0, local: false, dry: 0 }); this.shown = true; }
  ratings(n: number) { return Array.from({ length: n }, (_, id) => { const f = this.f.get(id); return f ? Math.round(f.skill * 100) : -999; }); }

  private nudge(id: number, d: number) { const f = this.f.get(id); if (!f) return; const b = f.skill; f.skill = clamp(f.skill + d, -2, 1.3); f.trend = Math.sign(f.skill - b); }
  popped(id: number, streak: number) { const f = this.f.get(id); if (f) f.dry = 0; if (this.active) this.nudge(id, 0.05 + (streak >= 3 ? 0.03 : 0)); }
  /** Each death eases off; three in a row without landing a pop eases off a big step more. */
  died(id: number) {
    if (!this.active) return;
    this.nudge(id, -0.11);
    const f = this.f.get(id); if (!f) return;
    if (++f.dry >= 3) { f.dry = 0; this.nudge(id, -0.25); }
  }
  dealtDamage(id: number, d: number) { const f = this.f.get(id); if (f) f.dealt += d; }
  tookDamage(id: number, d: number) { const f = this.f.get(id); if (f) f.taken += d; }
  step(dt: number) {
    if (!this.active) return;
    for (const [id, f] of this.f) {
      f.windowT += dt;
      if (f.windowT < 15) continue;
      // the damage balance only counts where we can see both sides of it (not a guest's own shots)
      if (f.local) { const r = (f.dealt + 20) / (f.taken + 20); this.nudge(id, clamp((r - 1) * 0.06, -0.08, 0.05)); }
      f.dealt = f.taken = f.windowT = 0;
    }
  }

  private t(id: number) { const f = this.f.get(id); return f ? clamp((f.skill + 1) / 2.3, 0, 1) : 0.5; }
  private sub(id: number) { const f = this.f.get(id); return f ? clamp(-(f.skill + 1), 0, 1) : 0; }
  /** Bot skill when shooting at this human: from very gentle, through Easy, to a bit past Hard. */
  aim(id: number, base: { react: number; aimErr: number; lead: number; nade: number }) {
    if (!this.has(id)) return base;
    return botSkill(this.t(id), this.sub(id));
  }
  /** How hard bot hits on this human land. */
  damage(id: number) { if (!this.has(id)) return 1; const s = this.sub(id); return s > 0 ? lerp(0.6, 0.4, s) : lerp(0.6, 1.1, this.t(id)); }
  /** Added to a bot's target score for this human (lower = more likely to be picked). */
  targetBias(id: number) { if (!this.has(id)) return 0; const s = this.sub(id); return s > 0 ? lerp(3.5, 6, s) : lerp(3.5, -3, this.t(id)); }
  threat(id: number) { return clamp(Math.round(this.t(id) * 4) + 1, 1, 5); }
  showsFor(id: number) { return this.shown && this.f.has(id); }
}
