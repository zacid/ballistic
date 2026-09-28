// Rollout: a Brotato-style run. Twenty timed waves of minion swarms (plus gun-bot elites and two
// bosses); popped enemies drop coins, which are both XP and money. Between waves you pick level-up
// upgrades and shop for main guns, items, and turrets that bolt onto your ball and fire by themselves.
//
// Everything here is solo and runs on this client. The minions are deliberately cheap: plain structs,
// one instanced draw for all of them, steering along a flow field instead of per-minion pathfinding.
import * as THREE from 'three';
import type { Game } from './game';
import type { Babo } from './babo';
import { buildGun, setBoss, setWeapon } from './babo';
import { BALL, BURN, GRENADE, WEAPONS, WeaponId } from './config';
import { CLIMB } from './arena';
import { botSkill } from './director';
import {
  RUN, TIERS, TIER_DMG, TIER_RATE, Stats, StatId, blankStats, LEVEL_UPS, ITEMS, ItemDef, ITEM_PRICE, TURRETS, TurretDef, MAIN_GUNS, BALLS, BallType,
  MINIONS, MinionKind, MinionDef,
} from './rundata';

export interface Minion {
  kind: MinionKind; def: MinionDef; x: number; z: number; vx: number; vz: number; r: number;
  hp: number; max: number; dmg: number; speed: number;
  flash: number; burnT: number; burnTick: number; hitCd: number; face: number;
  st: number; stT: number; dx: number; dz: number; shootT: number; dead: boolean;
}
interface Telegraph { x: number; z: number; t: number; kind: MinionKind }
interface Spit { x: number; z: number; vx: number; vz: number; t: number; dmg: number }
interface Coin { x: number; z: number; y: number; vx: number; vz: number; vy: number; v: number; fly: boolean; spin: number }
export interface Turret { def: TurretDef; tier: number; cool: number; grp: THREE.Group; aim: number; target: { x: number; z: number } | null; scanT: number }
export type Offer =
  | { kind: 'item'; item: ItemDef; tier: number; price: number; locked: boolean; sold: boolean }
  | { kind: 'turret'; turret: TurretDef; tier: number; price: number; locked: boolean; sold: boolean }
  | { kind: 'gun'; w: WeaponId; tier: number; price: number; locked: boolean; sold: boolean };
export interface LevelOffer { stat: StatId; tier: number; v: number }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _w = new THREE.Color(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
const MAXM = 180;
const DIFF_MUL: Record<string, number> = { easy: 0.75, normal: 1, hard: 1.3, adaptive: 1 };

export class Run {
  n = 0;
  phase: 'wave' | 'levelup' | 'shop' | 'over' = 'wave';
  t = 0;
  bossId = -1;
  mats = 0; piggy = 0; xp = 0; lvl = 0; pending = 0; earned = 0; pops = 0;
  base = blankStats();                      // from level-ups
  items = new Map<string, number>();
  stats = blankStats();                     // everything added up
  mainTier = 0;
  turrets: Turret[] = [];
  offers: Offer[] = [];
  rerolls = 0;
  levelOffers: LevelOffer[] = [];
  levelRerolls = 0;
  ball: BallType;
  won = false;
  /** Adaptive: eases off if the last wave nearly finished you, tightens a little if it didn't touch you. */
  adapt = 0.85;
  private waveDmgTaken = 0;
  private harvestGrow = 1;
  minions: Minion[] = [];
  private tele: Telegraph[] = [];
  private spits: Spit[] = [];
  private coins: Coin[] = [];
  private spawnT = 0;
  private eliteQ: number[] = [];
  private iframes = 0;
  private regenAcc = 0;
  private lifeCd = 0;
  // flow field towards the player
  private field: Int16Array; private fieldCell = -1; private fieldT = 0;
  // spatial grid of minions (rebuilt each step) for shot tests and separation
  private grid = new Map<number, Minion[]>();
  // meshes
  private group = new THREE.Group();
  private body: THREE.InstancedMesh; private eyes: THREE.InstancedMesh; private coinMesh: THREE.InstancedMesh;
  private teleMesh: THREE.InstancedMesh; private spitMesh: THREE.InstancedMesh;

  constructor(private g: Game) {
    this.ball = BALLS.find(b => b.id === g.saved.ball) ?? BALLS[0];
    this.field = new Int16Array(g.arena.n * g.arena.n);
    const bodyGeo = new THREE.SphereGeometry(1, 20, 14);
    this.body = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.3 }), MAXM);
    this.body.castShadow = true;
    const eyeParts = [-0.36, 0.36].map(x => new THREE.SphereGeometry(0.26, 8, 6).translate(x, 0.42, 0.74));
    const brow = [-0.36, 0.36].map(x => new THREE.BoxGeometry(0.46, 0.1, 0.14).rotateZ(x > 0 ? 0.45 : -0.45).translate(x, 0.72, 0.62));
    this.eyes = new THREE.InstancedMesh(mergeAll([...eyeParts, ...brow]), new THREE.MeshBasicMaterial({ color: 0x1b2340 }), MAXM);
    const coinGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.06, 16);
    this.coinMesh = new THREE.InstancedMesh(coinGeo, new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.6, roughness: 0.3, emissive: 0xa06a00, emissiveIntensity: 0.7 }), 500);
    const x1 = new THREE.BoxGeometry(1, 0.02, 0.18).rotateY(Math.PI / 4), x2 = new THREE.BoxGeometry(1, 0.02, 0.18).rotateY(-Math.PI / 4);
    this.teleMesh = new THREE.InstancedMesh(mergeAll([x1, x2]), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3040).multiplyScalar(1.6), transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false }), 200);
    this.spitMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc07aff).multiplyScalar(2.2), toneMapped: false }), 120);
    for (const m of [this.body, this.eyes, this.coinMesh, this.teleMesh, this.spitMesh]) { m.frustumCulled = false; m.count = 0; this.group.add(m); }
    this.body.setColorAt(0, _c.set(0xffffff));
    g.r.scene.add(this.group);
    this.recalc();
    const p = g.player; p.hp = p.maxHp;
    if (this.ball.turret) this.addTurret(TURRETS.find(t => t.w === this.ball.turret)!, 0);
  }

  dispose() {
    this.g.r.scene.remove(this.group);
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if (m.material) (m.material as THREE.Material).dispose(); });
    for (const t of this.turrets) t.grp.removeFromParent();
  }

  // ---------- stats ----------
  recalc() {
    const s = blankStats(), add = (m: Partial<Stats>, k = 1) => { for (const key in m) s[key as StatId] += (m[key as StatId] ?? 0) * k; };
    add(this.ball.mods); add(this.base);
    for (const [id, n] of this.items) { const it = ITEMS.find(i => i.id === id); if (it) add(it.mods, n); }
    this.stats = s;
    const p = this.g.player;
    p.maxHp = Math.max(10, RUN.startHp + s.maxHp + this.lvl * 2);
    if (p.hp > p.maxHp) p.hp = p.maxHp;
    p.spd = Math.max(0.4, 1 + s.speed / 100);
  }
  get dmgMul() { return Math.max(0.1, 1 + this.stats.damage / 100); }
  get rateMul() { return Math.max(0.2, 1 + this.stats.rate / 100); }
  get rangeMul() { return Math.max(0.3, 1 + this.stats.range / 100); }
  get cdMul() { return 1 / Math.max(0.3, 1 + this.stats.cooldown / 100); }
  get dodge() { return Math.min(60, Math.max(0, this.stats.dodge)); }
  get pickupR() { return 2.8 * Math.max(0.3, 1 + this.stats.pickup / 100); }
  get diff() { const d = this.g.saved.difficulty; return (DIFF_MUL[d] ?? 1) * (d === 'adaptive' ? this.adapt : 1); }

  /** Multiplier on damage the player deals, by source ('turret' shots are already scaled by their tier). */
  outMul(att: Babo, src: string) {
    if (att !== this.g.player) return 1;
    let m = this.dmgMul;
    if (src === 'turret') m *= Math.max(0.1, 1 + this.stats.turretDmg / 100);
    else if (src === att.weapon) m *= TIER_DMG[this.mainTier];
    return m;
  }
  /** Damage coming at the player: dodge, then armour. Returns what's left. */
  incoming(dmg: number): number {
    if (Math.random() * 100 < this.dodge) { this.g.hud.floaterText(this.g.player.x, this.g.player.z, 'DODGE', '#9fe6ff'); return 0; }
    const a = this.stats.armor;
    dmg *= a >= 0 ? 15 / (15 + a) : 1 + -a / 15;
    this.waveDmgTaken += dmg;
    return dmg;
  }
  /** Damage bots deal the player (the elites and bosses): scaled with the wave and difficulty. */
  enemyMul() { return (0.22 + 0.016 * this.n) * this.diff; }
  lifesteal() {
    if (this.lifeCd > 0 || Math.random() * 100 >= this.stats.lifesteal) return;
    const p = this.g.player; if (!p.alive || p.hp >= p.maxHp) return;
    p.hp = Math.min(p.maxHp, p.hp + 3); this.lifeCd = 0.1;
  }

  // ---------- waves ----------
  startWave(n: number) {
    const g = this.g, p = g.player;
    this.n = n; this.phase = 'wave'; this.rerolls = 0; this.waveDmgTaken = 0;
    this.t = RUN.waveTime(n); this.spawnT = 0.6;
    this.recalc();
    p.hp = p.maxHp;   // everyone starts a wave at full health
    p.nades = Math.min(GRENADE.max, p.nades + 1);
    p.abCool = 0;
    // elites (gun bots) from wave 4; a boss on waves 10 and 20
    const boss = RUN.bossWaves.includes(n);
    const elites = n < 4 ? 0 : Math.min(3, Math.floor((n - 1) / 4));
    this.eliteQ = [];
    for (let i = 0; i < elites; i++) this.eliteQ.push(this.t * (0.25 + 0.5 * (i / Math.max(1, elites))));
    this.bossId = -1;
    if (boss) this.spawnBoss(n === RUN.waves);
    g.hud.banner(boss ? (n === RUN.waves ? 'FINAL WAVE: BOSS' : `WAVE ${n}: BOSS`) : `WAVE ${n}`, false, 1.4);
    g.audio.play(boss ? 'boss' : 'go');
  }

  get bossWave() { return RUN.bossWaves.includes(this.n); }

  /** Wave over: pop what's left, bank the loose coins, pay out harvesting, then level-ups and the shop. */
  private endWave() {
    const g = this.g, p = g.player;
    for (const m of this.minions) if (!m.dead) this.burst(m, false);
    this.minions.length = 0; this.tele.length = 0; this.spits.length = 0;
    let loose = 0; for (const c of this.coins) loose += c.v; this.coins.length = 0; this.piggy += loose;
    for (const b of g.babos) if (!b.human && b.alive) { b.alive = false; b.root.visible = false; b.respawnT = 1e9; if (b.boss) setBoss(b, false); }
    const harvest = Math.round(Math.max(0, this.stats.harvest) * this.harvestGrow);
    this.harvestGrow *= 1.05;
    if (harvest > 0) { this.mats += harvest; this.earned += harvest; this.gainXp(harvest); }
    // adaptive: how rough was that?
    const left = p.hp / p.maxHp;
    if (left < 0.35) this.adapt = Math.max(0.6, this.adapt * 0.88);
    else if (this.waveDmgTaken < p.maxHp * 0.15) this.adapt = Math.min(1.25, this.adapt * 1.05);
    if (this.n >= RUN.waves) { this.won = true; this.phase = 'over'; g.end('You cleared all 20 waves!'); return; }
    g.hud.banner(`WAVE ${this.n} CLEARED`, true, 1.2);
    g.audio.play('kill');
    this.toLevelUps();
  }

  private toLevelUps() {
    if (this.pending > 0) { this.phase = 'levelup'; this.levelRerolls = 0; this.rollLevel(); }
    else { this.phase = 'shop'; this.rollShop(); }
    this.g.hud.runUi.open();
  }

  step(dt: number) {
    if (this.phase !== 'wave') return;
    const g = this.g, p = g.player;
    this.lifeCd -= dt; this.iframes -= dt;
    if (!this.bossWave) { this.t -= dt; if (this.t <= 0) { this.endWave(); return; } }
    else this.t += dt;
    // regen
    if (p.alive && this.stats.regen > 0 && p.hp < p.maxHp) { this.regenAcc += this.stats.regen * 0.5 * dt; if (this.regenAcc >= 1) { const h = Math.floor(this.regenAcc); p.hp = Math.min(p.maxHp, p.hp + h); this.regenAcc -= h; } }
    this.spawning(dt);
    this.stepField(dt);
    this.stepMinions(dt);
    this.stepSpits(dt);
    this.stepCoins(dt);
    this.stepTurrets(dt);
    if (this.bossWave && this.bossId >= 0 && !g.babos[this.bossId]?.alive) {
      this.bossId = -1;
      g.hud.banner('BOSS POPPED!', false, 1.4);
      this.endWave();
    }
  }

  // ---------- spawning ----------
  private spawning(dt: number) {
    const n = this.n, g = this.g;
    for (let i = this.eliteQ.length - 1; i >= 0; i--) {
      const elapsed = RUN.waveTime(n) - this.t;
      if (this.bossWave || elapsed >= this.eliteQ[i]) { this.eliteQ.splice(i, 1); this.spawnElite(); }
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(1.2, 2.6 - n * 0.07) * (this.bossWave ? 1.6 : 1);
      const alive = this.minions.length + this.tele.length;
      if (alive < RUN.maxAlive) {
        const size = Math.max(1, Math.round((3 + n * 0.6) * (0.8 + Math.random() * 0.4) * Math.min(1.15, Math.max(0.8, this.diff))));
        const c = this.spawnPoint(); if (c) {
          for (let i = 0; i < Math.min(size, RUN.maxAlive - alive); i++) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * 1.4;
            let x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
            if (g.arena.solidAt(x, z)) { x = c.x; z = c.z; }
            this.tele.push({ x, z, t: 0.9 + Math.random() * 0.25, kind: this.pickKind() });
          }
        }
      }
    }
    for (let i = this.tele.length - 1; i >= 0; i--) {
      const t = this.tele[i]; t.t -= dt;
      if (t.t > 0) continue;
      this.tele.splice(i, 1);
      this.addMinion(t.kind, t.x, t.z);
    }
  }

  private pickKind(): MinionKind {
    const pool = (Object.keys(MINIONS) as MinionKind[]).filter(k => MINIONS[k].from <= this.n && MINIONS[k].weight > 0);
    let tot = 0; for (const k of pool) tot += MINIONS[k].weight;
    let r = Math.random() * tot; for (const k of pool) { r -= MINIONS[k].weight; if (r <= 0) return k; }
    return 'roller';
  }

  /** Somewhere open, at least 6 m from the player. */
  private spawnPoint() {
    const A = this.g.arena, p = this.g.player;
    for (let k = 0; k < 30; k++) {
      const s = A.spawns[(Math.random() * A.spawns.length) | 0];
      if (Math.hypot(s.x - p.x, s.z - p.z) > 6.5) return s;
    }
    return null;
  }

  addMinion(kind: MinionKind, x: number, z: number) {
    if (this.minions.length >= MAXM) return;
    const d = MINIONS[kind], n = this.n;
    const hp = d.hp * (1 + 0.26 * (n - 1)) * (this.g.saved.difficulty === 'hard' ? 1.15 : this.g.saved.difficulty === 'easy' ? 0.85 : 1);
    this.minions.push({
      kind, def: d, x, z, vx: 0, vz: 0, r: d.r, hp, max: hp, dmg: d.dmg * (1 + 0.07 * (n - 1)) * this.diff, speed: d.speed * Math.min(1.25, 1 + 0.012 * n),
      flash: 0, burnT: 0, burnTick: 0, hitCd: 0, face: 0, st: 0, stT: 1 + Math.random(), dx: 0, dz: 0, shootT: 1.5 + Math.random() * 1.5, dead: false,
    });
  }

  private spawnElite() {
    const g = this.g, slot = g.babos.find(b => !b.human && !b.alive && !b.boss);
    if (!slot) return;
    g.spawn(slot);
    const pool: WeaponId[] = this.n < 8 ? ['pistol', 'shotgun'] : this.n < 14 ? ['pistol', 'shotgun', 'bouncer', 'chaingun'] : ['shotgun', 'chaingun', 'bouncer', 'rocket', 'flamethrower'];
    setWeapon(slot, pool[(Math.random() * pool.length) | 0]); slot.reserve = -1;
    slot.maxHp = slot.hp = Math.round(90 * (1 + 0.07 * this.n) * this.diff);
    slot.ability = 'dash';
  }

  private spawnBoss(final: boolean) {
    const g = this.g, slot = g.babos.find(b => !b.human && !b.alive);
    if (!slot) return;
    setBoss(slot, true, final ? 1.8 : 1.5);
    g.spawn(slot);
    setWeapon(slot, 'rocket'); slot.reserve = -1; slot.ability = 'shockwave';
    slot.maxHp = slot.hp = Math.round((final ? 1400 : 650) * this.diff);
    this.bossId = slot.id;
    g.hud.banner(final ? `${slot.name.toUpperCase()}, THE LAST ONE` : `${slot.name.toUpperCase()} THE BIG ONE`, true, 1.8);
  }

  /** Aim and reactions for the elites: fair, and a little sharper as the run goes on. */
  botDiff() { const t = Math.min(1, 0.02 + this.n * 0.03) * Math.min(1.2, this.diff); return botSkill(Math.min(1, t), this.diff < 0.8 ? 0.4 : 0); }

  // ---------- minions ----------
  /** Breadth-first distances from the player's cell, so minions flow around walls. */
  private stepField(dt: number) {
    const A = this.g.arena, p = this.g.player, n = A.n;
    const pc = A.cellOf(p.z) * n + A.cellOf(p.x);
    this.fieldT -= dt;
    if (pc === this.fieldCell && this.fieldT > 0) return;
    this.fieldCell = pc; this.fieldT = 0.3;
    const f = this.field; f.fill(-1);
    if (pc < 0 || pc >= n * n) return;
    const q = new Int32Array(n * n); let h = 0, tl = 0; q[tl++] = pc; f[pc] = 0;
    while (h < tl) {
      const k = q[h++], i = k % n, j = (k / n) | 0;
      for (const [di, dj] of NB4) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const kk = b * n + a; if (f[kk] >= 0 || A.solidCell(a, b, 0.4)) continue;
        f[kk] = f[k] + 1; q[tl++] = kk;
      }
    }
  }

  private stepMinions(dt: number) {
    const g = this.g, A = g.arena, p = g.player, n = A.n;
    this.grid.clear();
    for (const m of this.minions) { const key = gkey(m.x, m.z); let c = this.grid.get(key); if (!c) this.grid.set(key, c = []); c.push(m); }
    for (const m of this.minions) {
      if (m.dead) continue;
      m.flash = Math.max(0, m.flash - dt * 6); m.hitCd -= dt;
      if (m.burnT > 0) {
        m.burnT -= dt; m.burnTick -= dt;
        if (m.burnTick <= 0) { m.burnTick = 0.25; this.damage(p, m, BURN.dps / 4, 0, 0, 'burn'); if (m.dead) continue; }
        if (Math.random() < dt * 20) g.fx.glow(m.x, m.r + 0.2, m.z, 0, 1.4, 0, 0.08, 0xff8a2a, 0.25, 0);
      }
      const dx = p.x - m.x, dz = p.z - m.z, d = Math.hypot(dx, dz) || 1;
      // where to go: straight at the player when there's a clear line, otherwise down the flow field
      let tx = dx / d, tz = dz / d;
      if (d > 2.5 && A.raycast(m.x, m.z, p.x, p.z, 0.4) >= 0) {
        const i = A.cellOf(m.x), j = A.cellOf(m.z), here = this.field[j * n + i];
        let best = here < 0 ? 1e9 : here, bx = 0, bz = 0;
        for (const [di, dj] of NB8) {
          const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const v = this.field[b * n + a]; if (v < 0 || v >= best) continue;
          if (di && dj && (A.solidCell(i + di, j, 0.4) || A.solidCell(i, j + dj, 0.4))) continue;
          best = v; bx = di; bz = dj;
        }
        if (bx || bz) { const l = Math.hypot(bx, bz); tx = bx / l; tz = bz / l; }
      }
      let sp = m.speed;
      if (m.kind === 'dasher') {
        // walk, stop and wind up (flashing), then dash in a straight line
        m.stT -= dt;
        if (m.st === 0 && m.stT <= 0 && d < 9) { m.st = 1; m.stT = 0.5; m.dx = tx; m.dz = tz; }
        else if (m.st === 1) { sp = 0; m.flash = Math.max(m.flash, 0.5 + 0.5 * Math.sin(g.clock * 40)); if (m.stT <= 0) { m.st = 2; m.stT = 0.4; } }
        else if (m.st === 2) { sp = 12; tx = m.dx; tz = m.dz; if (m.stT <= 0) { m.st = 0; m.stT = 1.4 + Math.random(); } }
      } else if (m.kind === 'spitter') {
        // keep at range and lob slow blobs
        if (d < 5) { tx = -tx; tz = -tz; } else if (d < 7) sp *= 0.25;
        m.shootT -= dt;
        if (m.shootT <= 0 && d < 10 && A.raycast(m.x, m.z, p.x, p.z, 0.5) < 0) {
          m.shootT = 2.4 + Math.random() * 0.8;
          const s = 5.5; this.spits.push({ x: m.x, z: m.z, vx: (dx / d) * s, vz: (dz / d) * s, t: 3, dmg: m.dmg });
          g.audio.play('bouncer', m.x, m.z, 0.35);
        }
      }
      const k = Math.min(1, dt * (m.st === 2 ? 20 : 6));
      m.vx += (tx * sp - m.vx) * k; m.vz += (tz * sp - m.vz) * k;
      m.x += m.vx * dt; m.z += m.vz * dt;
      if (Math.abs(tx) + Math.abs(tz) > 0.01) m.face = Math.atan2(tx, tz);
      // keep apart from each other (a light push), and out of walls
      const key = gkey(m.x, m.z);
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
        const c = this.grid.get(key + ox + oz * 1000); if (!c) continue;
        for (const o of c) {
          if (o === m || o.dead) continue;
          const ex = m.x - o.x, ez = m.z - o.z, e2 = ex * ex + ez * ez, min = m.r + o.r;
          if (e2 >= min * min || e2 < 1e-6) continue;
          const e = Math.sqrt(e2), push = (min - e) * 0.5, wm = o.def.mass / (m.def.mass + o.def.mass);
          m.x += (ex / e) * push * wm * 2; m.z += (ez / e) * push * wm * 2;
        }
      }
      A.collide(m, m.r, 0);
      // bumping the player
      if (p.alive && d < m.r + p.rad + 0.02) {
        const nx = dx / d, nz = dz / d, over = m.r + p.rad - d;
        m.x -= nx * over; m.z -= nz * over; m.vx -= nx * 2; m.vz -= nz * 2;
        if (this.stats.thorns > 0 && m.hitCd <= 0) { m.hitCd = 0.5; this.damage(p, m, this.stats.thorns, -nx * 3, -nz * 3, 'thorns'); if (m.dead) continue; }
        if (this.iframes <= 0 && p.spawnShield <= 0) {
          this.iframes = RUN.iframes;
          if (m.st === 2) { m.st = 0; m.stT = 1.2; }
          g.applyDamage(p, m.dmg, -1, nx * 4, nz * 4, 0, 0, 'swarm');
        }
      }
    }
    if (this.minions.some(m => m.dead)) this.minions = this.minions.filter(m => !m.dead);
    // rebuild the grid at the new positions for the shots this step
    this.grid.clear();
    for (const m of this.minions) { const key = gkey(m.x, m.z); let c = this.grid.get(key); if (!c) this.grid.set(key, c = []); c.push(m); }
  }

  private stepSpits(dt: number) {
    const g = this.g, p = g.player;
    for (let i = this.spits.length - 1; i >= 0; i--) {
      const s = this.spits[i]; s.t -= dt;
      s.x += s.vx * dt; s.z += s.vz * dt;
      if (s.t <= 0 || g.arena.solidAt(s.x, s.z, 0.3)) { this.spits.splice(i, 1); g.fx.glow(s.x, 0.5, s.z, 0, 1, 0, 0.1, 0xc07aff, 0.2, 0); continue; }
      if (p.alive && Math.hypot(p.x - s.x, p.z - s.z) < p.rad + 0.18) {
        this.spits.splice(i, 1);
        if (p.spawnShield <= 0) g.applyDamage(p, s.dmg, -1, s.vx * 0.3, s.vz * 0.3, 0, 0, 'swarm');
        for (let k = 0; k < 6; k++) g.fx.glow(s.x, 0.6, s.z, (Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4, 0.07, 0xc07aff, 0.3, 6);
      }
    }
  }

  // ---------- hitting minions ----------
  /** First minion a moving shot touches along a segment (fraction 0..1), or null. */
  raycast(x0: number, z0: number, x1: number, z1: number, pad = 0.08): { m: Minion; t: number } | null {
    const sdx = x1 - x0, sdz = z1 - z0, l2 = sdx * sdx + sdz * sdz;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, reach = Math.sqrt(l2) / 2 + 0.7;
    let best: Minion | null = null, bt = 2;
    const i0 = Math.floor((cx - reach) / GC), i1 = Math.floor((cx + reach) / GC), j0 = Math.floor((cz - reach) / GC), j1 = Math.floor((cz + reach) / GC);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = this.grid.get(i + j * 1000); if (!c) continue;
      for (const m of c) {
        if (m.dead) continue;
        const fx = x0 - m.x, fz = z0 - m.z, rr = m.r + pad;
        const b = fx * sdx + fz * sdz, cc = fx * fx + fz * fz - rr * rr;
        let t: number;
        if (cc <= 0) t = 0; else { if (l2 < 1e-9) continue; const disc = b * b - l2 * cc; if (disc < 0) continue; t = (-b - Math.sqrt(disc)) / l2; }
        if (t >= 0 && t <= 1 && t < bt) { bt = t; best = m; }
      }
    }
    return best ? { m: best, t: bt } : null;
  }
  /** Every minion within r of a point. */
  near(x: number, z: number, r: number, out: Minion[] = []) {
    out.length = 0;
    const i0 = Math.floor((x - r - 0.6) / GC), i1 = Math.floor((x + r + 0.6) / GC), j0 = Math.floor((z - r - 0.6) / GC), j1 = Math.floor((z + r + 0.6) / GC);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = this.grid.get(i + j * 1000); if (!c) continue;
      for (const m of c) if (!m.dead && Math.hypot(m.x - x, m.z - z) < r + m.r) out.push(m);
    }
    return out;
  }
  /** Minions along a line (railgun beams). */
  along(x0: number, z0: number, x1: number, z1: number, pad = 0.1) {
    const out: Minion[] = [], sdx = x1 - x0, sdz = z1 - z0, l2 = sdx * sdx + sdz * sdz || 1;
    for (const m of this.minions) {
      if (m.dead) continue;
      const u = ((m.x - x0) * sdx + (m.z - z0) * sdz) / l2; if (u < 0 || u > 1) continue;
      if (Math.hypot(m.x - (x0 + sdx * u), m.z - (z0 + sdz * u)) < m.r + pad) out.push(m);
    }
    return out;
  }

  /** Hurt a minion. kx/kz is the shove; src picks the damage multiplier. flag 1 sets it alight. */
  damage(att: Babo, m: Minion, dmg: number, kx: number, kz: number, src: string, flag = 0) {
    if (m.dead) return;
    dmg *= this.outMul(att, src);
    m.hp -= dmg; m.flash = 1;
    const kb = Math.max(0, 1 + this.stats.knock / 100) / m.def.mass;
    m.vx += kx * kb; m.vz += kz * kb;
    if (flag & 1) { m.burnT = BURN.t; }
    if (att === this.g.player) {
      if (dmg >= 1 && src !== 'burn') this.g.hud.floater(m.x, m.z, Math.round(dmg));
      this.lifesteal();
    }
    if (m.hp <= 0) this.kill(m);
  }

  private kill(m: Minion) {
    m.dead = true; this.pops++;
    const g = this.g; g.player.kills++;
    this.burst(m, true);
    for (let i = 0; i < m.def.coins; i++) this.dropCoin(m.x, m.z, 1);
    if (m.kind === 'splitter') for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; this.addMinion('mini', m.x + Math.cos(a) * 0.4, m.z + Math.sin(a) * 0.4); }
  }

  private burst(m: Minion, loud: boolean) {
    const g = this.g;
    for (let i = 0; i < (loud ? 9 : 4); i++) { const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5; g.fx.bit(m.x, m.r, m.z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.05 + Math.random() * 0.06, i % 4 === 0 ? 0xffffff : m.def.color, 0.8); }
    if (loud) {
      g.audio.play('mpop', m.x, m.z, 0.8);
      if (Math.random() < 0.15) g.arena.splat(m.x, m.z, m.r * 1.4, m.def.color);
    }
  }

  onEliteDeath(b: Babo) {
    const n = b.boss ? 30 : 8;
    for (let i = 0; i < n; i++) this.dropCoin(b.x + (Math.random() - 0.5), b.z + (Math.random() - 0.5), 1);
  }

  // ---------- coins ----------
  private dropCoin(x: number, z: number, v: number) {
    if (this.coins.length >= 450) { this.piggy += this.coins[0].v; this.coins.shift(); }
    const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2;
    this.coins.push({ x, z, y: 0.4, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 3 + Math.random() * 2, v, fly: false, spin: Math.random() * 6 });
  }

  private stepCoins(dt: number) {
    const g = this.g, p = g.player, R = this.pickupR;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.spin += dt * 5;
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
      if (p.alive && (c.fly || d < R)) {
        c.fly = true;
        const sp = 9 + Math.max(0, 6 - d) * 3;
        c.x += (dx / (d || 1)) * sp * dt; c.z += (dz / (d || 1)) * sp * dt; c.y += (p.y + 0.5 - c.y) * Math.min(1, dt * 8);
        if (d < 0.45) {
          this.coins.splice(i, 1);
          let v = c.v; if (this.piggy > 0) { const b = Math.min(this.piggy, v); this.piggy -= b; v += b; }   // the piggy bank pays out double
          this.mats += v; this.earned += v; this.gainXp(v);
          g.audio.play('coin', undefined, undefined, 0.5);
        }
        continue;
      }
      c.vy -= 20 * dt; c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt;
      const fy = g.arena.floorAt(c.x, c.z) + 0.05;
      if (c.y < fy) { c.y = fy; c.vy = Math.abs(c.vy) * 0.3; c.vx *= 0.6; c.vz *= 0.6; if (c.vy < 0.5) c.vy = 0; }
      if (g.arena.solidAt(c.x, c.z, c.y - 0.1)) { c.x -= c.vx * dt * 2; c.z -= c.vz * dt * 2; c.vx = -c.vx * 0.3; c.vz = -c.vz * 0.3; }
    }
  }

  private gainXp(v: number) {
    this.xp += v;
    while (this.xp >= RUN.xpFor(this.lvl + 1)) {
      this.xp -= RUN.xpFor(this.lvl + 1); this.lvl++; this.pending++;
      this.recalc();
      this.g.hud.floaterText(this.g.player.x, this.g.player.z, 'LEVEL UP', '#ffd84a');
      this.g.audio.play('levelup');
    }
  }
  get xpNeed() { return RUN.xpFor(this.lvl + 1); }

  // ---------- turrets ----------
  addTurret(def: TurretDef, tier: number) {
    const grp = new THREE.Group();
    const base = new THREE.Mesh(turretBaseGeo, new THREE.MeshStandardMaterial({ color: TIERS[tier].color, roughness: 0.35, metalness: 0.3 }));
    grp.add(base);
    const gun = buildGun(def.w, WEAPONS[def.w].color); gun.scale.setScalar(0.72); gun.position.y = 0.08; grp.add(gun);
    const t: Turret = { def, tier, cool: Math.random() * 0.5, grp, aim: 0, target: null, scanT: 0 };
    this.turrets.push(t); this.mountTurrets();
    return t;
  }
  removeTurret(t: Turret) { t.grp.removeFromParent(); const i = this.turrets.indexOf(t); if (i >= 0) this.turrets.splice(i, 1); this.mountTurrets(); }
  setTurretTier(t: Turret, tier: number) { t.tier = tier; ((t.grp.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(TIERS[tier].color); }
  /** Evenly round the ball, on its shoulders. */
  mountTurrets() {
    const p = this.g.player, n = this.turrets.length;
    this.turrets.forEach((t, i) => {
      if (t.grp.parent !== p.root) p.root.add(t.grp);
      const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.PI / 4;
      t.grp.position.set(Math.cos(a) * 0.5, 0.32, Math.sin(a) * 0.5);
    });
  }

  private stepTurrets(dt: number) {
    const g = this.g, p = g.player; if (!p.alive) return;
    const rateMul = Math.max(0.2, 1 + this.stats.turretRate / 100);
    for (const t of this.turrets) {
      const wx = p.x + t.grp.position.x, wz = p.z + t.grp.position.z, y = p.y + 0.55;
      const R = t.def.range * this.rangeMul;
      t.scanT -= dt;
      if (t.scanT <= 0) {
        t.scanT = 0.12; t.target = null; let bd = R;
        for (const m of this.near(wx, wz, R, _near)) { const d = Math.hypot(m.x - wx, m.z - wz); if (d < bd && g.arena.raycast(wx, wz, m.x, m.z, y, false, CLIMB) < 0) { bd = d; t.target = m; } }
        for (const b of g.babos) { if (b.human || !b.alive) continue; const d = Math.hypot(b.x - wx, b.z - wz); if (d < bd && g.arena.raycast(wx, wz, b.x, b.z, y, true, CLIMB) < 0) { bd = d; t.target = b; } }
      }
      const tg = t.target as (Minion | Babo | null);
      if (tg && ('dead' in tg ? tg.dead : !(tg as Babo).alive)) t.target = null;
      if (t.target) { t.aim = Math.atan2(t.target.z - wz, t.target.x - wx); t.grp.rotation.y = Math.atan2(Math.cos(t.aim), Math.sin(t.aim)); }
      t.cool -= dt;
      if (!t.target || t.cool > 0) continue;
      t.cool = 1 / (t.def.rate * TIER_RATE[t.tier] * rateMul);
      this.fireTurret(t, wx, y, wz, R);
    }
  }

  private fireTurret(t: Turret, x: number, y: number, z: number, R: number) {
    const g = this.g, p = g.player, def = t.def, w = WEAPONS[def.w];
    const dmg = def.dmg * TIER_DMG[t.tier];
    g.fx.flash(x + Math.cos(t.aim) * 0.35, y, z + Math.sin(t.aim) * 0.35, w.color, 3, 0.05);
    g.audio.play(def.w, x, z, 0.3);
    if (w.kind === 'zap') { g.fireZap(p, x, y, z, t.aim, R, dmg, 'turret'); return; }
    const pellets = def.pellets ?? 1, spread = def.spread ?? w.spread, speed = def.speed ?? w.speed;
    for (let i = 0; i < pellets; i++) {
      const a = t.aim + (pellets > 1 ? ((i + Math.random()) / pellets - 0.5) * spread : (Math.random() - 0.5) * spread);
      g.addShot({ owner: p.id, x, y, z, vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, life: R / speed * (pellets > 1 ? 0.85 + Math.random() * 0.3 : 1), dist: 0, w: def.w, trailT: 0, cosmetic: false, bounces: w.bounces ? 2 : 0, src: 'turret', mul: dmg / w.damage, range: R });
    }
  }

  // ---------- level-ups ----------
  rollTier(extraLuck = 0): number {
    const n = this.n, k = 1 + Math.max(0, this.stats.luck + extraLuck) / 100, r = Math.random();
    const p4 = n >= 8 ? Math.min(0.1, 0.012 * (n - 7)) * k : 0;
    const p3 = n >= 4 ? Math.min(0.3, 0.025 * (n - 3)) * k : 0;
    const p2 = n >= 2 ? Math.min(0.6, 0.07 * (n - 1)) * k : 0;
    return r < p4 ? 3 : r < p4 + p3 ? 2 : r < p4 + p3 + p2 ? 1 : 0;
  }
  rollLevel() {
    const pool = [...LEVEL_UPS].sort(() => Math.random() - 0.5).slice(0, 4);
    this.levelOffers = pool.map(u => { const tier = this.rollTier(this.lvl * 2); return { stat: u.stat, tier, v: u.v[tier] }; });
  }
  get levelRerollCost() { return Math.max(1, Math.floor(this.n * 0.5)) * (this.levelRerolls + 1); }
  rerollLevel() { const c = this.levelRerollCost; if (this.mats < c) return false; this.mats -= c; this.levelRerolls++; this.rollLevel(); return true; }
  pickLevel(i: number) {
    const o = this.levelOffers[i]; if (!o) return;
    this.base[o.stat] += o.v; this.pending--; this.recalc();
    this.g.player.hp = this.g.player.maxHp;
    if (this.pending > 0) { this.levelRerolls = 0; this.rollLevel(); } else { this.phase = 'shop'; this.rollShop(); }
  }

  // ---------- shop ----------
  private priceScale() { return 1 + 0.15 * Math.max(0, this.n - 1); }
  private makeOffer(forceTurret = false): Offer {
    const r = Math.random(), tier = this.rollTier(), sc = this.priceScale(), tierK = [1, 1.9, 3.2, 5][tier];
    if (forceTurret || r < 0.3) {
      const def = TURRETS[(Math.random() * TURRETS.length) | 0];
      return { kind: 'turret', turret: def, tier, price: Math.round(def.price * tierK * sc), locked: false, sold: false };
    }
    if (r < 0.5) {
      const gdef = MAIN_GUNS[(Math.random() * MAIN_GUNS.length) | 0];
      return { kind: 'gun', w: gdef.w, tier, price: Math.round(gdef.price * tierK * sc), locked: false, sold: false };
    }
    const pool = ITEMS.filter(it => it.tier === tier && !(it.max && (this.items.get(it.id) ?? 0) >= it.max));
    const it = pool.length ? pool[(Math.random() * pool.length) | 0] : ITEMS.filter(i => i.tier === 0)[(Math.random() * 10) | 0];
    return { kind: 'item', item: it, tier: it.tier, price: Math.round(ITEM_PRICE[it.tier] * sc), locked: false, sold: false };
  }
  rollShop() {
    const keep = this.offers.filter(o => o.locked && !o.sold);
    const out: Offer[] = [...keep];
    // the first two shops always show a turret, so the bolt-on guns get introduced early
    const wantTurret = this.n <= 2 && !out.some(o => o.kind === 'turret');
    while (out.length < 4) out.push(this.makeOffer(wantTurret && out.length === keep.length));
    this.offers = out;
  }
  get rerollCost() { return Math.max(1, Math.floor(this.n * 0.75)) + this.rerolls * Math.max(1, Math.floor(this.n * 0.4)); }
  reroll() { const c = this.rerollCost; if (this.mats < c) return false; this.mats -= c; this.rerolls++; this.rollShop(); return true; }

  /** Buy an offer. Returns a message when it can't. */
  buy(i: number): string | null {
    const o = this.offers[i], g = this.g, p = g.player;
    if (!o || o.sold) return null;
    if (this.mats < o.price) return 'Not enough coins';
    if (o.kind === 'turret') {
      const same = this.turrets.find(t => t.def === o.turret && t.tier === o.tier && t.tier < 3);
      if (this.turrets.length >= RUN.turretSlots) {
        if (!same) return 'No free turret slot. Sell one, or buy a match to combine';
        this.setTurretTier(same, same.tier + 1);   // full: combine straight away
      } else this.addTurret(o.turret, o.tier);
    } else if (o.kind === 'gun') {
      if (p.weapon === o.w) this.mainTier = Math.min(3, Math.max(this.mainTier + 1, o.tier));
      else { setWeapon(p, o.w); this.mainTier = o.tier; }
      p.reserve = -1;
    } else {
      this.items.set(o.item.id, (this.items.get(o.item.id) ?? 0) + 1);
      this.recalc();
    }
    this.mats -= o.price; o.sold = true; o.locked = false;
    g.audio.play('pickup');
    return null;
  }
  turretValue(t: Turret) { return Math.round(t.def.price * [1, 1.9, 3.2, 5][t.tier] * this.priceScale()); }
  sell(t: Turret) { this.mats += Math.round(this.turretValue(t) * 0.4); this.removeTurret(t); this.g.audio.play('coin'); }
  /** Two identical turrets of the same tier become one of the next tier. */
  canCombine(t: Turret) { return t.tier < 3 && this.turrets.some(o => o !== t && o.def === t.def && o.tier === t.tier); }
  combine(t: Turret) {
    const o = this.turrets.find(x => x !== t && x.def === t.def && x.tier === t.tier); if (!o || t.tier >= 3) return;
    this.removeTurret(o); this.setTurretTier(t, t.tier + 1); this.g.audio.play('levelup');
  }
  nextWave() { this.g.hud.runUi.close(); this.startWave(this.n + 1); }

  // ---------- drawing ----------
  draw(clock: number) {
    let n = 0;
    for (const m of this.minions) {
      if (m.dead || n >= MAXM) continue;
      const squash = m.kind === 'dasher' && m.st === 1 ? 1 + 0.15 * Math.sin(clock * 40) : 1;
      _q.setFromAxisAngle(_up, m.face); _s.set(m.r * squash, m.r / squash, m.r * squash); _p.set(m.x, m.r / squash, m.z);
      _m.compose(_p, _q, _s); this.body.setMatrixAt(n, _m); this.eyes.setMatrixAt(n, _m);
      _c.set(m.def.color); if (m.flash > 0) _c.lerp(_w, Math.min(1, m.flash) * 0.8);
      this.body.setColorAt(n, _c); n++;
    }
    this.body.count = this.eyes.count = n;
    this.body.instanceMatrix.needsUpdate = true; this.eyes.instanceMatrix.needsUpdate = true; if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    n = 0;
    for (const c of this.coins) {
      _q.setFromAxisAngle(_up, c.spin); _p.set(c.x, c.y + 0.07, c.z); _s.setScalar(1);
      _m.compose(_p, _q, _s); this.coinMesh.setMatrixAt(n++, _m);
    }
    this.coinMesh.count = n; this.coinMesh.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const t of this.tele) {
      const k = 0.5 + 0.2 * Math.sin(clock * 20 + t.x); _q.identity(); _s.set(k, 1, k); _p.set(t.x, 0.03, t.z);
      _m.compose(_p, _q, _s); this.teleMesh.setMatrixAt(n++, _m);
    }
    this.teleMesh.count = n; this.teleMesh.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const s of this.spits) { _q.identity(); _s.setScalar(1); _p.set(s.x, 0.55, s.z); _m.compose(_p, _q, _s); this.spitMesh.setMatrixAt(n++, _m); }
    this.spitMesh.count = n; this.spitMesh.instanceMatrix.needsUpdate = true;
  }

  get coinsOnFloor() { return this.coins.length; }
}

const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const GC = 1.5;   // minion grid cell (m)
const gkey = (x: number, z: number) => Math.floor(x / GC) + Math.floor(z / GC) * 1000;
const _near: Minion[] = [];
const turretBaseGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.12, 14);

function mergeAll(parts: THREE.BufferGeometry[]) {
  // tiny local merge (all parts are non-indexed after toNonIndexed)
  const geos = parts.map(p => (p.index ? p.toNonIndexed() : p));
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array as Float32Array, o * 3); nor.set(g.attributes.normal.array as Float32Array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
void BALL;
