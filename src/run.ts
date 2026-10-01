// Rollout: a Brotato-style run. Twenty timed waves of minion swarms (plus gun-bot elites and two
// bosses); popped enemies drop coins, which are both XP and money. Between waves you pick level-up
// upgrades and shop for main guns, items, and turrets that bolt onto your ball and fire by themselves.
//
// The minions are deliberately cheap: plain structs, one instanced draw for all of them, steering along
// a flow field instead of per-minion pathfinding.
//
// Co-op (two players online): the host runs the wave (spawns, minions, coins, elites, the clock) and
// sends the guest a compact picture of it 20 times a second. Each player shoots their own gun and
// turrets on their own screen; the guest reports its hits on minions to the host in batches. Every coin
// pays both players. Each player has their own build, level-ups and shop; the next wave starts when both
// are ready. A popped player can be revived by their teammate standing next to them.
import * as THREE from 'three';
import type { Game } from './game';
import type { Babo } from './babo';
import { buildGun, setBoss, setWeapon } from './babo';
import { BURN, GRENADE, WEAPONS, WeaponId } from './config';
import { CLIMB } from './arena';
import { botSkill } from './director';
import {
  RUN, TIERS, TIER_DMG, TIER_RATE, Stats, StatId, blankStats, LEVEL_UPS, ITEMS, ItemDef, ITEM_PRICE, TURRETS, TurretDef, MAIN_GUNS, BALLS, BallType,
  MINIONS, MinionKind, MinionDef, dangerMods, COOP, BOMBER, HEALER, SHIELD, TUNE, SPECIALS, SpecialId, SPECIAL_WAVES, WEAPON_CLASS, CLASSES, ClassId, ClassBonus, CRATES,
} from './rundata';

export interface Minion {
  id: number; kind: MinionKind; def: MinionDef; x: number; z: number; vx: number; vz: number; r: number;
  hp: number; max: number; dmg: number; speed: number;
  flash: number; burnT: number; burnTick: number; burnBy: number; hitCd: number; face: number;
  st: number; stT: number; dx: number; dz: number; shootT: number; dead: boolean;
  tg: number; tgT: number;               // who it's chasing (babo id), re-picked twice a second
  tx: number; tz: number; seen: number;  // guest: where the host last put it, and when
}
interface Telegraph { x: number; z: number; t: number; kind: MinionKind }
interface Spit { x: number; z: number; vx: number; vz: number; t: number; dmg: number }
interface Crate { id: number; x: number; z: number; spin: number; gold?: boolean }
interface Coin { id: number; x: number; z: number; y: number; vx: number; vz: number; vy: number; v: number; fly: number; spin: number }
export interface Turret { def: TurretDef; tier: number; cool: number; grp: THREE.Group; aim: number; target: { x: number; z: number } | null; scanT: number }
export type Offer =
  | { kind: 'item'; item: ItemDef; tier: number; price: number; locked: boolean; sold: boolean }
  | { kind: 'turret'; turret: TurretDef; tier: number; price: number; locked: boolean; sold: boolean; deal?: boolean }
  | { kind: 'gun'; w: WeaponId; tier: number; price: number; locked: boolean; sold: boolean };
export interface LevelOffer { stat: StatId; tier: number; v: number }
interface Marker { id: number; x: number; z: number; prog: number; grp: THREE.Group; ring: THREE.Mesh }
export interface WaveLog { n: number; coins: number; pops: number; taken: number }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _w = new THREE.Color(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
const MAXM = 240;
const DIFF_MUL: Record<string, number> = { easy: 0.75, normal: 1, hard: 1.3, adaptive: 1 };
const KINDS = Object.keys(MINIONS) as MinionKind[];
const TDEFS = TURRETS;
/** Names for the end-of-run damage breakdown. */
const SRC_NAME: Record<string, string> = { grenade: 'Grenades', mine: 'Mines', nuke: 'Nuke Bot', shockwave: 'Shockwave', spikesab: 'Spikes', burn: 'Fire', thorns: 'Thorns' };

export class Run {
  n = 0;
  phase: 'wave' | 'crate' | 'levelup' | 'shop' | 'over' | 'won' = 'wave';
  /** This wave's twist, if it has one. */
  special: SpecialId | null = null;
  /** Crates picked up this wave (opened in the break), and the item in the one being opened. */
  /** Crates to open in the break: 0 = normal, 1 = golden (pick one of three). */
  crateQ: number[] = [];
  get cratesPending() { return this.crateQ.length; }
  /** What's inside the crate being opened: one offer, or three for a golden crate. */
  crateOffers: Offer[] = [];
  crates: Crate[] = [];
  private crateId = 1;
  /** Active set bonuses, by class. */
  classBonus = new Map<ClassId, ClassBonus>();
  classCount = new Map<ClassId, number>();
  t = 0;
  bossId = -1;
  mats = 10; piggy = 0; xp = 0; lvl = 0; pending = 0; earned = 0; pops = 0;
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
  endless = false;
  danger: number;
  /** Adaptive: eases off if the last wave nearly finished you, tightens a little if it didn't touch you. */
  adapt = 0.85;
  /** End-of-run numbers: damage by source, and a line per wave. */
  dmgBy = new Map<string, number>();
  waveLog: WaveLog[] = [];
  private waveStart = { coins: 0, pops: 0 };
  waveDmgTaken = 0;
  private harvestGrow = 1;
  minions: Minion[] = [];
  private byId = new Map<number, Minion>();
  private nextId = 1;
  private tele: Telegraph[] = [];
  private spits: Spit[] = [];
  coins: Coin[] = [];
  private coinId = 1;
  private spawnT = 0;
  private eliteQ: number[] = [];
  private iframes = new Map<number, number>();
  private regenAcc = 0;
  private lifeCd = 0;
  // co-op
  readonly coop: boolean;
  readonly host: boolean;
  ready = false;                 // pressed "next wave"
  partnerReady = false;
  private hostPhase = 0;         // guest: the host's last phase (0 wave, 1 break)
  private pendingHits: number[] = [];
  private coinCredit = 0;
  private looseLast = 0;
  private partnerPickup = 2.8;
  private killedAt = new Map<number, number>();
  private markers = new Map<number, Marker>();
  reviveProg = 0;                // mine, while I'm down (the teammate standing next to me fills it)
  private remoteTurrets: Turret[] = [];
  private remoteKey = '';
  private remoteTurretRate = 1;
  // flow fields towards each player
  private fields = new Map<number, { f: Int16Array; cell: number; t: number }>();
  // spatial grid of minions (rebuilt each step) for shot tests and separation
  private grid = new Map<number, Minion[]>();
  // meshes
  private group = new THREE.Group();
  private body: THREE.InstancedMesh; private eyes: THREE.InstancedMesh; private coinMesh: THREE.InstancedMesh;
  private teleMesh: THREE.InstancedMesh; private spitMesh: THREE.InstancedMesh;
  private crateMesh: THREE.InstancedMesh; private crateBand: THREE.InstancedMesh; private shieldMesh: THREE.InstancedMesh;
  private rangeRing: THREE.Mesh;
  /** Shop hover: show a turret's reach around the ball. */
  showRange = 0;

  constructor(private g: Game, danger = 0) {
    this.coop = g.online; this.host = !g.online || g.host;
    this.danger = danger;
    this.ball = BALLS.find(b => b.id === g.saved.ball) ?? BALLS[0];
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
    this.crateMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), new THREE.MeshStandardMaterial({ color: 0xb0773a, roughness: 0.6 }), 16);
    this.crateBand = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0xffd84a, metalness: 0.5, roughness: 0.3, emissive: 0x805000, emissiveIntensity: 0.6 }), 16);
    this.shieldMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.3, 0.22).translate(0, 0, 1.05), new THREE.MeshStandardMaterial({ color: 0xcfe0f5, metalness: 0.6, roughness: 0.25 }), 60);
    this.crateMesh.castShadow = true;
    for (const m of [this.body, this.eyes, this.coinMesh, this.teleMesh, this.spitMesh, this.crateMesh, this.crateBand, this.shieldMesh]) { m.frustumCulled = false; m.count = 0; this.group.add(m); }
    this.body.setColorAt(0, _c.set(0xffffff));
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }));
    this.rangeRing.visible = false; this.group.add(this.rangeRing);
    g.r.scene.add(this.group);
    this.recalc();
    const p = g.player; p.hp = p.maxHp;
    if (this.ball.turret) this.addTurret(TURRETS.find(t => t.w === this.ball.turret)!, 0);
  }

  dispose() {
    this.g.r.scene.remove(this.group);
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if (m.material) (m.material as THREE.Material).dispose(); });
    for (const t of [...this.turrets, ...this.remoteTurrets]) t.grp.removeFromParent();
    for (const mk of this.markers.values()) this.g.r.scene.remove(mk.grp);
  }

  private get humans() { return this.g.babos.filter(b => b.human); }
  private get dm() { return dangerMods(this.danger); }

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
    this.recalcClasses();
  }
  /** Count the main gun and turrets by class; two or more of a class switch on its set bonus. */
  recalcClasses() {
    this.classCount.clear(); this.classBonus.clear();
    const add = (w: WeaponId) => { const c = WEAPON_CLASS[w]; if (c) this.classCount.set(c, (this.classCount.get(c) ?? 0) + 1); };
    add(this.g.player.weapon); for (const t of this.turrets) add(t.def.w);
    for (const [c, n] of this.classCount) if (n >= 2) this.classBonus.set(c, CLASSES[c].tiers[Math.min(n, 4) - 2]);
  }
  /** Which weapon a damage source is (a gun, or a turret by name). */
  private srcWeapon(src: string): WeaponId | null {
    if (src.startsWith('turret:')) return TDEFS.find(t => t.name === src.slice(7))?.w ?? null;
    return src in WEAPONS ? src as WeaponId : null;
  }
  private bonusOf(w: WeaponId | null) { const c = w ? WEAPON_CLASS[w] : undefined; return c ? this.classBonus.get(c) : undefined; }
  /** Main gun fire rate and range, with the set bonus for its class. */
  gunRate(w: WeaponId) { return this.rateMul * (1 + (this.bonusOf(w)?.rate ?? 0)); }
  gunRange(w: WeaponId) { return this.rangeMul * (1 + (this.bonusOf(w)?.range ?? 0)); }
  /** Explosive set bonus: bigger blasts. */
  blastMul(src: string) { return 1 + (this.bonusOf(this.srcWeapon(src))?.radius ?? 0); }
  /** Elemental set bonus: lightning chains further. */
  extraChains(src: string) { return this.bonusOf(this.srcWeapon(src))?.chains ?? 0; }
  /** What your stats would be with some extra mods (for the shop's hover preview). */
  preview(mods: Partial<Stats>): Stats {
    const s = { ...this.stats }; for (const k in mods) s[k as StatId] += mods[k as StatId] ?? 0; return s;
  }
  get dmgMul() { return Math.max(0.1, 1 + this.stats.damage / 100); }
  get rateMul() { return Math.max(0.2, 1 + this.stats.rate / 100); }
  get rangeMul() { return Math.max(0.3, 1 + this.stats.range / 100); }
  get cdMul() { return 1 / Math.max(0.3, 1 + this.stats.cooldown / 100); }
  get dodge() { return Math.min(60, Math.max(0, this.stats.dodge)); }
  get pickupR() { return 3.4 * Math.max(0.3, 1 + this.stats.pickup / 100); }
  get diff() { const d = this.g.saved.difficulty; return (DIFF_MUL[d] ?? 1) * (d === 'adaptive' ? this.adapt : 1); }
  /** Damage per second of the main gun and each turret (the shop shows these). */
  mainDps(w: WeaponId = this.g.player.weapon, tier = this.mainTier) {
    const d = WEAPONS[w], b = this.bonusOf(w);
    return d.damage * d.pellets * (d.kind === 'zap' ? 1.6 : 1) * d.rate * this.gunRate(w) * TIER_DMG[tier] * this.dmgMul * (1 + (b?.dmg ?? 0));
  }
  turretDps(def: TurretDef, tier: number) {
    const b = this.bonusOf(def.w);
    return def.dmg * (def.pellets ?? 1) * def.rate * TIER_RATE[tier] * TIER_DMG[tier] * Math.max(0.2, 1 + this.stats.turretRate / 100) * (1 + (b?.rate ?? 0)) * this.dmgMul * Math.max(0.1, 1 + this.stats.turretDmg / 100) * (1 + (b?.dmg ?? 0));
  }

  /** Multiplier on damage the player deals, by source ('turret' shots are already scaled by their tier). */
  outMul(att: Babo, src: string) {
    if (att !== this.g.player) return 1;
    let m = this.dmgMul;
    if (src.startsWith('turret')) m *= Math.max(0.1, 1 + this.stats.turretDmg / 100);
    else if (src === att.weapon) m *= TIER_DMG[this.mainTier];
    m *= 1 + (this.bonusOf(this.srcWeapon(src))?.dmg ?? 0);
    return m;
  }
  /** Tally damage the local player dealt, by source, for the results screen. */
  record(src: string, dmg: number) {
    if (dmg <= 0) return;
    const name = src.startsWith('turret:') ? src.slice(7) : SRC_NAME[src] ?? (src in WEAPONS ? WEAPONS[src as WeaponId].name : src);
    this.dmgBy.set(name, (this.dmgBy.get(name) ?? 0) + dmg);
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
  enemyMul() { return (0.22 + 0.019 * this.n) * this.diff * this.dm.dmg * TUNE.dmg; }
  lifesteal() {
    if (this.lifeCd > 0 || Math.random() * 100 >= this.stats.lifesteal) return;
    const p = this.g.player; if (!p.alive || p.hp >= p.maxHp) return;
    p.hp = Math.min(p.maxHp, p.hp + 3); this.lifeCd = 0.1;
  }

  // ---------- waves ----------
  /** Every client: heal up, bring back anyone who was down, and (host) schedule the wave. */
  startWave(n: number) {
    const g = this.g, p = g.player;
    this.n = n; this.phase = 'wave'; this.rerolls = 0; this.waveDmgTaken = 0; this.ready = false; this.partnerReady = false;
    this.waveStart = { coins: this.earned, pops: this.pops };
    this.t = this.waveTime(n); this.spawnT = 0.6;
    this.recalc();
    this.clearMarkers();
    if (!p.alive) this.reviveAt(p, null);
    p.hp = p.maxHp;   // everyone starts a wave at full health
    p.nades = Math.min(GRENADE.max, p.nades + 1);
    p.abCool = 0;
    this.g.hud.runUi.close();
    const boss = this.isBossWave(n);
    if (this.host) {
      // a twist on some waves
      this.special = null;
      if (!boss && (SPECIAL_WAVES.includes(n) || (n > RUN.waves && n % 3 === 1))) {
        const pool = (Object.keys(SPECIALS) as SpecialId[]).filter(k => SPECIALS[k].from <= n);
        this.special = pool[(Math.random() * pool.length) | 0] ?? null;
      }
      // elites (gun bots) from wave 4; a boss on waves 10 and 20 (and every 10th in endless)
      const d = this.dm;
      let elites = n < d.eliteFrom ? 0 : Math.min(4, Math.floor((n - d.eliteFrom + 3) / 3.5)) + (n >= 6 ? d.elites : 0);
      if (this.coop && n >= 4) elites++;
      if (this.special === 'elites') elites += 3;
      elites = Math.min(g.babos.filter(b => !b.human).length - (boss ? 1 : 0), elites);
      this.eliteQ = [];
      for (let i = 0; i < elites; i++) this.eliteQ.push(this.t * (0.2 + 0.55 * (i / Math.max(1, elites))));
      this.bossId = -1;
      if (boss) this.spawnBoss(n >= RUN.waves);
    }
    const sp = this.special ? SPECIALS[this.special] : null;
    g.hud.banner(boss ? (n === RUN.waves ? 'FINAL WAVE: BOSS' : `WAVE ${n}: BOSS`) : sp ? `WAVE ${n}: ${sp.name}` : `WAVE ${n}`, false, sp ? 2 : 1.4);
    if (sp) g.hud.toast(sp.blurb);
    g.audio.play(boss ? 'boss' : 'go');
  }

  /** Most minions alive at once: 110 early, climbing to the tuned cap by wave 15. */
  maxAlive() { const n = this.n, top = Math.min(MAXM - 10, TUNE.maxAlive); return Math.round(n <= 7 ? Math.min(RUN.maxAlive, top) : RUN.maxAlive + (top - RUN.maxAlive) * Math.min(1, (n - 7) / 8)); }
  waveTime(n: number) { return n > RUN.waves ? 60 : RUN.waveTime(n); }
  isBossWave(n: number) { return RUN.bossWaves.includes(n) || (n > RUN.waves && n % 10 === 0); }
  get bossWave() { return this.isBossWave(this.n); }

  /** Host: the wave is over. Pop what's left, bank loose coins, and go to the break. */
  private endWave() {
    const g = this.g;
    for (const m of this.minions) if (!m.dead) this.burst(m, false);
    this.minions.length = 0; this.byId.clear(); this.tele.length = 0; this.spits.length = 0;
    let loose = 0; for (const c of this.coins) loose += c.v; this.coins.length = 0;
    this.looseLast = loose;
    // crates nobody reached go to whoever is nearest
    for (const c of this.crates) {
      let best: Babo | null = null, bd = 1e9; for (const h of this.humans) { const d = Math.hypot(h.x - c.x, h.z - c.z); if (d < bd) { bd = d; best = h; } }
      if (best?.isPlayer) this.gotCrate(c.gold); else if (best) g.net.send({ k: 'rk', n: 1, g: c.gold ? 1 : 0 });
    }
    this.crates.length = 0;
    for (const b of g.babos) if (!b.human && b.alive) { b.alive = false; b.root.visible = false; b.respawnT = 1e9; if (b.boss) setBoss(b, false); }
    this.breakLocal(loose);
  }

  /** Every client, when a wave ends: piggy bank, harvesting, adaptive, then level-ups or the shop. */
  private breakLocal(loose: number) {
    const g = this.g, p = g.player;
    const swept = Math.round(loose * TUNE.sweep);
    if (swept > 0) { this.credit(swept, false); this.g.hud.toast(`+${swept} coins swept up from the floor${swept < loose ? ` (${loose - swept} lost)` : ''}`); }
    else if (loose > 0) this.g.hud.toast(`${loose} coins left on the floor, lost`);
    const harvest = Math.round(Math.max(0, this.stats.harvest) * this.harvestGrow);
    this.harvestGrow *= 1.05;
    if (harvest > 0) { this.mats += harvest; this.earned += harvest; this.gainXp(harvest); }
    this.waveLog.push({ n: this.n, coins: this.earned - this.waveStart.coins, pops: this.pops - this.waveStart.pops, taken: Math.round(this.waveDmgTaken) });
    const left = p.alive ? p.hp / p.maxHp : 0;
    if (left < 0.35) this.adapt = Math.max(0.6, this.adapt * 0.88);
    else if (this.waveDmgTaken < p.maxHp * 0.15) this.adapt = Math.min(1.25, this.adapt * 1.05);
    this.clearMarkers();
    if (this.n === RUN.waves && !this.endless) {
      // won the run: offer to keep going
      this.won = true; this.phase = 'won';
      g.audio.play('win');
      g.hud.runUi.open();
      return;
    }
    g.hud.banner(`WAVE ${this.n} CLEARED`, true, 1.2);
    g.audio.play('kill');
    this.toLevelUps();
  }

  /** The wave log, including the wave in progress (for the results screen when the run ends mid-wave). */
  fullLog(): WaveLog[] {
    const log = [...this.waveLog];
    if (this.n > 0 && !log.some(w => w.n === this.n)) log.push({ n: this.n, coins: this.earned - this.waveStart.coins, pops: this.pops - this.waveStart.pops, taken: Math.round(this.waveDmgTaken) });
    return log;
  }

  /** After winning: carry on into endless waves, or finish. */
  keepGoing() { this.endless = true; this.toLevelUps(); }

  private toLevelUps() {
    if (this.cratesPending > 0) { this.phase = 'crate'; if (!this.crateOffers.length) this.rollCrate(); this.g.hud.runUi.open(); return; }
    if (this.pending > 0) { this.phase = 'levelup'; this.levelRerolls = 0; this.rollLevel(); }
    else { this.phase = 'shop'; this.rollShop(); }
    this.g.hud.runUi.open();
  }

  step(dt: number) {
    const g = this.g, p = g.player;
    this.stepMarkers(dt);
    if (this.phase !== 'wave') return;
    this.lifeCd -= dt;
    for (const [id, v] of this.iframes) this.iframes.set(id, v - dt);
    if (this.host) {
      if (!this.bossWave) { this.t -= dt; if (this.t <= 0) { this.endWave(); return; } }
      else this.t += dt;
    }
    // regen
    if (p.alive && this.stats.regen > 0 && p.hp < p.maxHp) { this.regenAcc += this.stats.regen * 0.5 * dt; if (this.regenAcc >= 1) { const h = Math.floor(this.regenAcc); p.hp = Math.min(p.maxHp, p.hp + h); this.regenAcc -= h; } }
    if (this.host) {
      this.spawning(dt);
      this.stepFields(dt);
      this.stepMinions(dt);
      this.stepSpits(dt);
      this.stepCoins(dt);
      this.stepCrates(dt);
    } else this.stepMirror(dt);
    this.stepTurrets(dt, p, this.turrets, false);
    const partner = this.coop ? g.babos.find(b => b.human && !b.isPlayer) : null;
    if (partner) this.stepTurrets(dt, partner, this.remoteTurrets, true);
    if (this.host && this.bossWave && this.bossId >= 0 && !g.babos[this.bossId]?.alive) {
      this.bossId = -1;
      g.hud.banner('BOSS POPPED!', false, 1.4);
      this.endWave();
    }
  }

  // ---------- spawning (host) ----------
  private spawning(dt: number) {
    const n = this.n, g = this.g, d = this.dm;
    for (let i = this.eliteQ.length - 1; i >= 0; i--) {
      const elapsed = this.waveTime(n) - this.t;
      if (this.bossWave || elapsed >= this.eliteQ[i]) { this.eliteQ.splice(i, 1); this.spawnElite(); }
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(1.2, 2.6 - Math.min(n, 20) * 0.07) * (this.bossWave ? 1.6 : 1);
      const alive = this.minions.length + this.tele.length;
      const cap = this.maxAlive();
      if (alive < cap) {
        const endless = Math.max(0, n - RUN.waves) * 0.4;
        const spk = this.special === 'horde' ? 2.2 : this.special === 'elites' ? 0.6 : 1;
        const size = Math.max(1, Math.round((3 + n * 0.6 + endless) * (0.8 + Math.random() * 0.4) * Math.min(1.15, Math.max(0.8, this.diff)) * d.count * (this.coop ? COOP.count : 1) * spk * TUNE.count));
        const c = this.spawnPoint(); if (c) {
          for (let i = 0; i < Math.min(size, cap - alive); i++) {
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
    if (this.special === 'horde' && Math.random() < 0.75) return Math.random() < 0.6 ? 'roller' : 'mini';
    if (this.special === 'bombers' && Math.random() < 0.6) return 'bomber';
    const pool = KINDS.filter(k => MINIONS[k].from <= this.n && MINIONS[k].weight > 0);
    let tot = 0; for (const k of pool) tot += MINIONS[k].weight;
    let r = Math.random() * tot; for (const k of pool) { r -= MINIONS[k].weight; if (r <= 0) return k; }
    return 'roller';
  }

  /** Somewhere open, at least 6.5 m from every player. */
  private spawnPoint() {
    const A = this.g.arena, hs = this.humans.filter(h => h.alive);
    for (let k = 0; k < 30; k++) {
      const s = A.spawns[(Math.random() * A.spawns.length) | 0];
      if (hs.every(h => Math.hypot(s.x - h.x, s.z - h.z) > 6.5)) return s;
    }
    return null;
  }

  addMinion(kind: MinionKind, x: number, z: number, id = this.nextId++) {
    if (this.minions.length >= MAXM) return null;
    const d = MINIONS[kind], n = this.n, dm = this.dm;
    const hp = (this.special === 'horde' ? 0.5 : 1) * d.hp * (1 + 0.26 * (n - 1) + TUNE.hpLate * Math.max(0, n - 8) ** 2) * TUNE.hp * (this.g.saved.difficulty === 'hard' ? 1.15 : this.g.saved.difficulty === 'easy' ? 0.85 : 1) * dm.hp * (this.coop ? COOP.hp : 1);
    const m: Minion = {
      id, kind, def: d, x, z, vx: 0, vz: 0, r: d.r, hp, max: hp, dmg: d.dmg * (1 + 0.09 * (n - 1)) * this.diff * dm.dmg * TUNE.dmg, speed: d.speed * Math.min(1.3, 1 + 0.012 * n) * dm.speed,
      flash: 0, burnT: 0, burnTick: 0, burnBy: -1, hitCd: 0, face: 0, st: 0, stT: 1 + Math.random(), dx: 0, dz: 0, shootT: 1.5 + Math.random() * 1.5, dead: false,
      tg: -1, tgT: 0, tx: x, tz: z, seen: 0,
    };
    this.minions.push(m); this.byId.set(id, m);
    return m;
  }

  private spawnElite() {
    const g = this.g, slot = g.babos.find(b => !b.human && !b.alive && !b.boss);
    if (!slot) return;
    g.spawn(slot);
    const pool: WeaponId[] = this.n < 8 ? ['pistol', 'shotgun'] : this.n < 14 ? ['pistol', 'shotgun', 'bouncer', 'chaingun'] : ['shotgun', 'chaingun', 'bouncer', 'rocket', 'flamethrower'];
    setWeapon(slot, pool[(Math.random() * pool.length) | 0]); slot.reserve = -1;
    slot.maxHp = slot.hp = Math.round(90 * (1 + 0.07 * this.n) * this.diff * this.dm.hp * TUNE.hp);
    slot.ability = 'dash';
  }

  private spawnBoss(final: boolean) {
    const g = this.g, slot = g.babos.find(b => !b.human && !b.alive);
    if (!slot) return;
    setBoss(slot, true, final ? 1.8 : 1.5);
    g.spawn(slot);
    setWeapon(slot, 'rocket'); slot.reserve = -1; slot.ability = 'shockwave';
    const endless = Math.max(0, this.n - RUN.waves) / 10;
    slot.maxHp = slot.hp = Math.round((final ? 1400 : 650) * (1 + endless) * this.diff * this.dm.hp * (this.coop ? COOP.boss : 1));
    this.bossId = slot.id;
    g.hud.banner(final ? `${slot.name.toUpperCase()}, THE LAST ONE` : `${slot.name.toUpperCase()} THE BIG ONE`, true, 1.8);
  }

  /** Aim and reactions for the elites: fair, and a little sharper as the run goes on. */
  botDiff() { const t = Math.min(1, 0.02 + this.n * 0.03 + this.dm.aim) * Math.min(1.2, this.diff); return botSkill(Math.min(1, t), this.diff < 0.8 ? 0.4 : 0); }

  // ---------- minions (host) ----------
  /** Breadth-first distances from each player's cell, so minions flow around walls. */
  private stepFields(dt: number) {
    const A = this.g.arena, n = A.n;
    for (const h of this.humans) {
      let F = this.fields.get(h.id); if (!F) this.fields.set(h.id, F = { f: new Int16Array(n * n), cell: -1, t: 0 });
      const pc = A.cellOf(h.z) * n + A.cellOf(h.x);
      F.t -= dt;
      if (pc === F.cell && F.t > 0) continue;
      F.cell = pc; F.t = 0.3;
      const f = F.f; f.fill(-1);
      if (pc < 0 || pc >= n * n) continue;
      const q = new Int32Array(n * n); let hd = 0, tl = 0; q[tl++] = pc; f[pc] = 0;
      while (hd < tl) {
        const k = q[hd++], i = k % n, j = (k / n) | 0;
        for (const [di, dj] of NB4) {
          const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const kk = b * n + a; if (f[kk] >= 0 || A.solidCell(a, b, 0.4)) continue;
          f[kk] = f[k] + 1; q[tl++] = kk;
        }
      }
    }
  }

  private rebuildGrid() {
    this.grid.clear();
    for (const m of this.minions) { if (m.dead) continue; const key = gkey(m.x, m.z); let c = this.grid.get(key); if (!c) this.grid.set(key, c = []); c.push(m); }
  }

  private stepMinions(dt: number) {
    const g = this.g, A = g.arena, n = A.n;
    const hs = this.humans;
    this.rebuildGrid();
    for (const m of this.minions) {
      if (m.dead) continue;
      m.flash = Math.max(0, m.flash - dt * 6); m.hitCd -= dt;
      if (m.burnT > 0) {
        m.burnT -= dt; m.burnTick -= dt;
        if (m.burnTick <= 0) {
          m.burnTick = 0.25; const mine = m.burnBy === g.player.id || m.burnBy < 0;
          if (mine) this.record('burn', Math.min(m.hp, (BURN.dps / 4) * this.outMul(g.player, 'burn')));
          this.hostDamage(g.babos[m.burnBy] ?? g.player, m, BURN.dps / 4, 0, 0, 'burn', 0, !mine);
          if (m.dead) continue;
        }
        if (Math.random() < dt * 20) g.fx.glow(m.x, m.r + 0.2, m.z, 0, 1.4, 0, 0.08, 0xff8a2a, 0.25, 0);
      }
      // chase the nearest player still standing
      m.tgT -= dt;
      if (m.tgT <= 0 || !g.babos[m.tg]?.alive) {
        m.tgT = 0.5; let bd = 1e9; m.tg = -1;
        for (const h of hs) if (h.alive) { const d = Math.hypot(h.x - m.x, h.z - m.z); if (d < bd) { bd = d; m.tg = h.id; } }
      }
      const p = g.babos[m.tg];
      if (!p || !p.alive) { m.vx *= 0.9; m.vz *= 0.9; continue; }
      const dx = p.x - m.x, dz = p.z - m.z, d = Math.hypot(dx, dz) || 1;
      // where to go: straight at the player when there's a clear line, otherwise down the flow field
      let tx = dx / d, tz = dz / d;
      const F = this.fields.get(p.id);
      if (F && d > 2.5 && A.raycast(m.x, m.z, p.x, p.z, 0.4) >= 0) {
        const i = A.cellOf(m.x), j = A.cellOf(m.z), here = F.f[j * n + i];
        let best = here < 0 ? 1e9 : here, bx = 0, bz = 0;
        for (const [di, dj] of NB8) {
          const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const v = F.f[b * n + a]; if (v < 0 || v >= best) continue;
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
      } else if (m.kind === 'bomber') {
        // close in, stop, fizz, bang
        if (m.st === 0 && d < BOMBER.trigger + p.rad) { m.st = 1; m.stT = BOMBER.fuse; g.audio.play('beep', m.x, m.z, 0.8); }
        if (m.st === 1) { sp = 0; m.stT -= dt; m.flash = Math.max(m.flash, 0.5 + 0.5 * Math.sin(g.clock * 50)); if (m.stT <= 0) { this.bomberDetonate(m); continue; } }
      } else if (m.kind === 'healer') {
        // hang back and patch up the minions nearby
        if (d < 5.5) { tx = -tx; tz = -tz; } else if (d < 7.5) sp *= 0.3;
        m.shootT -= dt;
        if (m.shootT <= 0) {
          m.shootT = HEALER.every; let healed = 0;
          for (const o of this.near(m.x, m.z, HEALER.radius)) if (o !== m && o.hp < o.max) { o.hp = Math.min(o.max, o.hp + o.max * HEALER.heal); healed++; }
          if (healed) { m.dx = 0.4; g.fx.ring(m.x, m.z, HEALER.radius, 0x7dffb0, 0.4); g.audio.play('heal', m.x, m.z, 0.4); }
        }
        m.dx = Math.max(0, m.dx - dt);
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
      // bumping into players
      for (const h of hs) {
        if (!h.alive) continue;
        const ex = h.x - m.x, ez = h.z - m.z, e = Math.hypot(ex, ez) || 1;
        if (e >= m.r + h.rad + 0.02) continue;
        const nx = ex / e, nz = ez / e, over = m.r + h.rad - e;
        m.x -= nx * over; m.z -= nz * over; m.vx -= nx * 2; m.vz -= nz * 2;
        if (h.isPlayer && this.stats.thorns > 0 && m.hitCd <= 0) { m.hitCd = 0.5; this.damage(h, m, this.stats.thorns, -nx * 3, -nz * 3, 'thorns'); if (m.dead) break; }
        if ((this.iframes.get(h.id) ?? 0) <= 0 && h.spawnShield <= 0) {
          this.iframes.set(h.id, RUN.iframes);
          if (m.st === 2) { m.st = 0; m.stT = 1.2; }
          this.hurtHuman(h, m.dmg, nx * 4, nz * 4);
        }
      }
    }
    if (this.minions.some(m => m.dead)) this.minions = this.minions.filter(m => !m.dead);
    // rebuild the grid at the new positions for the shots this step
    this.rebuildGrid();
  }

  /** Minion and spit damage to a player: applied here for the host's ball, sent over for the guest's. */
  private hurtHuman(h: Babo, dmg: number, kx: number, kz: number) {
    if (h.local) this.g.applyDamage(h, dmg, -1, kx, kz, 0, 0, 'swarm');
    else this.g.net.send({ k: 'hit', v: h.id, a: -1, d: Math.round(dmg * 10) / 10, x: Math.round(kx * 10) / 10, z: Math.round(kz * 10) / 10, y: 0, w: 'swarm' });
  }

  private stepSpits(dt: number) {
    const g = this.g;
    for (let i = this.spits.length - 1; i >= 0; i--) {
      const s = this.spits[i]; s.t -= dt;
      s.x += s.vx * dt; s.z += s.vz * dt;
      if (s.t <= 0 || g.arena.solidAt(s.x, s.z, 0.3)) { this.spits.splice(i, 1); g.fx.glow(s.x, 0.5, s.z, 0, 1, 0, 0.1, 0xc07aff, 0.2, 0); continue; }
      for (const h of this.humans) {
        if (!h.alive || Math.hypot(h.x - s.x, h.z - s.z) >= h.rad + 0.18) continue;
        this.spits.splice(i, 1);
        if (h.spawnShield <= 0) this.hurtHuman(h, s.dmg, s.vx * 0.3, s.vz * 0.3);
        for (let k = 0; k < 6; k++) g.fx.glow(s.x, 0.6, s.z, (Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4, 0.07, 0xc07aff, 0.3, 6);
        break;
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

  /**
   * The local player (or, cosmetically, the partner) hurts a minion. kx/kz is the shove; src picks the
   * damage multiplier and the breakdown line. flag 1 sets it alight. On the guest the hit is shown right
   * away and sent to the host, which owns the minion.
   */
  damage(att: Babo, m: Minion, dmg: number, kx: number, kz: number, src: string, flag = 0) {
    if (m.dead || !att.local) return;
    dmg *= this.outMul(att, src);
    // shielders shrug off most of a hit from the front (blasts, fire and thorns go round the shield)
    if (m.kind === 'shielder' && !SHIELD_EXEMPT.has(src) && !src.startsWith('turret:Rocket') && (kx || kz)) {
      const l = Math.hypot(kx, kz), fx = Math.sin(m.face), fz = Math.cos(m.face);
      if ((kx / l) * fx + (kz / l) * fz < -Math.cos(SHIELD.arc)) {
        dmg *= 1 - SHIELD.block;
        if (Math.random() < 0.5) { this.g.fx.glow(m.x + fx * m.r, m.r, m.z + fz * m.r, (Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3, 0.06, 0xdfe8ff, 0.2, 8); this.g.audio.play('wall', m.x, m.z, 0.5); }
      }
    }
    const mine = att === this.g.player;
    if (mine) {
      const dealt = Math.min(dmg, Math.max(0, m.hp));
      this.record(src, dealt); this.g.ms.dmg += dealt;
      if (dmg >= 1 && src !== 'burn') this.g.hud.floater(m.x, m.z, Math.round(dmg));
      this.lifesteal();
    }
    const popGun = () => { if (mine && m.dead) { const w = this.srcWeapon(src) ?? src; this.g.ms.gunPops[w] = (this.g.ms.gunPops[w] ?? 0) + 1; } };
    if (this.host) { this.hostDamage(att, m, dmg, kx, kz, src, flag, true); popGun(); return; }
    // guest: predict, and tell the host
    m.hp -= dmg; m.flash = 1;
    this.pendingHits.push(m.id, Math.round(dmg * 10), Math.round(kx * 10), Math.round(kz * 10), flag);
    if (m.hp <= 0) { m.dead = true; this.killedAt.set(m.id, performance.now()); this.burst(m, true); this.pops++; this.g.player.kills++; }
    popGun();
  }

  /** Host: apply damage that's already scaled. */
  private hostDamage(att: Babo, m: Minion, dmg: number, kx: number, kz: number, _src: string, flag = 0, scaled = false) {
    if (m.dead) return;
    if (!scaled) dmg *= this.outMul(att, _src);
    m.hp -= dmg; m.flash = 1;
    const kb = Math.max(0, 1 + (att === this.g.player ? this.stats.knock : 0) / 100) / m.def.mass;
    m.vx += kx * kb; m.vz += kz * kb;
    if (flag & 1) { m.burnT = BURN.t; m.burnBy = att.id; }
    if (m.hp <= 0) this.kill(m, att);
  }

  private kill(m: Minion, by: Babo | null) {
    m.dead = true;
    if (by) by.kills++;
    if (by === this.g.player) this.pops++;
    this.burst(m, true);
    for (let i = 0; i < m.def.coins * (this.special === 'gold' ? 2 : 1); i++) this.dropCoin(m.x, m.z, 1);
    if (Math.random() < CRATES.minion * TUNE.crate * (1 + Math.max(0, this.stats.luck) / 100)) this.dropCrate(m.x, m.z);
    if (m.kind === 'bomber' && m.st !== 3) this.bomberBlast(m, by);
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
    if (!this.host) return;
    const n = b.boss ? 30 : 8;
    for (let i = 0; i < n; i++) this.dropCoin(b.x + (Math.random() - 0.5), b.z + (Math.random() - 0.5), 1);
    if (b.boss) { this.dropCrate(b.x - 0.5, b.z, true); this.dropCrate(b.x + 0.5, b.z); }
    else if (Math.random() < Math.min(1, CRATES.elite * TUNE.crate)) this.dropCrate(b.x, b.z);
  }

  // ---------- loot crates ----------
  private dropCrate(x: number, z: number, gold = false) {
    if (this.crates.length >= 12) return;
    this.crates.push({ id: this.crateId++, x, z, spin: Math.random() * 6, gold });
    this.g.fx.ring(x, z, 1.2, 0xffd84a, 0.4); this.g.audio.play('pickup', x, z, 0.6);
  }
  /** Host: whoever rolls over a crate gets it (the guest is told). */
  private stepCrates(dt: number) {
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i]; c.spin += dt * 1.5;
      for (const h of this.humans) {
        if (!h.alive || Math.hypot(h.x - c.x, h.z - c.z) > 1.0) continue;
        this.crates.splice(i, 1);
        if (h.isPlayer) this.gotCrate(c.gold); else this.g.net.send({ k: 'rk', n: 1, g: c.gold ? 1 : 0 });
        break;
      }
    }
  }
  /** A crate for me: opened in the break. */
  gotCrate(gold = false) { if (gold) this.crateQ.unshift(1); else this.crateQ.push(0); this.g.hud.floaterText(this.g.player.x, this.g.player.z, gold ? 'GOLDEN CRATE!' : 'CRATE!', '#ffd84a'); this.g.audio.play('levelup'); }
  /** Fill the crate being opened: an item, a turret or a main gun, never below the wave's minimum tier. */
  rollCrate() {
    const gold = this.crateQ[0] === 1, out: Offer[] = [];
    for (let i = 0; i < (gold ? 3 : 1); i++) {
      let o: Offer | null = null;
      for (let k = 0; k < 8 && !o; k++) { o = this.crateOffer(gold); if (o && out.some(x => this.sameOffer(x, o!))) o = null; }
      if (o) out.push(o);
    }
    this.crateOffers = out;
  }
  private sameOffer(a: Offer, b: Offer) {
    return a.kind === b.kind && (a.kind === 'item' ? a.item === (b as typeof a).item : a.kind === 'turret' ? a.turret === (b as typeof a).turret : a.w === (b as typeof a).w);
  }
  private crateOffer(gold: boolean): Offer | null {
    const tier = Math.min(3, Math.max(this.rollTier(30), CRATES.minTier(this.n) + (gold ? 1 : 0)));
    const sc = this.priceScale(), tierK = [1, 1.9, 3.2, 5][tier], r = Math.random();
    if (r < 0.3) {
      // a turret, but only one you can place (a free slot, or a match to combine with)
      const fits = TURRETS.filter(d => this.turrets.length < RUN.turretSlots || this.turrets.some(t => t.def === d && t.tier === tier && t.tier < 3));
      if (fits.length) { const def = fits[(Math.random() * fits.length) | 0]; return { kind: 'turret', turret: def, tier, price: Math.round(def.price * tierK * sc), locked: false, sold: false }; }
    } else if (r < 0.45) {
      const gdef = MAIN_GUNS[(Math.random() * MAIN_GUNS.length) | 0];
      return { kind: 'gun', w: gdef.w, tier, price: Math.round(gdef.price * tierK * sc), locked: false, sold: false };
    }
    const pool = ITEMS.filter(it => it.tier === tier && !(it.max && (this.items.get(it.id) ?? 0) >= it.max));
    if (!pool.length) return null;
    const it = pool[(Math.random() * pool.length) | 0];
    return { kind: 'item', item: it, tier: it.tier, price: Math.round(ITEM_PRICE[it.tier] * sc), locked: false, sold: false };
  }
  /** Coins for selling the crate unopened-ish: half the best thing inside. */
  crateValue() { return this.crateOffers.length ? Math.round(Math.max(...this.crateOffers.map(o => o.price)) * 0.5) : 0; }
  /** Take offer `i` from the crate (free), or sell the lot with i = -1. */
  openCrate(i: number) {
    if (!this.crateOffers.length) return;
    const o = this.crateOffers[i];
    if (o) { const m = this.grant(o); if (m) return m; this.g.audio.play('pickup'); }
    else { this.mats += this.crateValue(); this.g.audio.play('coin'); }
    this.crateQ.shift(); this.crateOffers = [];
    if (this.crateQ.length > 0) this.rollCrate(); else this.toLevelUps();
    return null;
  }

  // ---------- bombers ----------
  /** A bomber popped by someone takes its neighbours with it (credited to whoever popped it). */
  private bomberBlast(m: Minion, by: Babo | null) {
    m.st = 3;
    this.blastFx(m.x, m.z);
    for (const o of this.near(m.x, m.z, BOMBER.radius)) {
      if (o === m || o.dead) continue;
      const dx = o.x - m.x, dz = o.z - m.z, d = Math.hypot(dx, dz) || 0.1;
      if (by === this.g.player) this.record('Bomber blasts', Math.min(o.hp, BOMBER.chain));
      this.hostDamage(by ?? this.g.player, o, BOMBER.chain, (dx / d) * 8, (dz / d) * 8, 'blast', 0, true);
    }
  }
  /** A bomber reached a player and went off. */
  private bomberDetonate(m: Minion) {
    m.st = 3; m.dead = true;
    this.blastFx(m.x, m.z);
    for (const h of this.humans) {
      if (!h.alive) continue;
      const dx = h.x - m.x, dz = h.z - m.z, d = Math.hypot(dx, dz);
      if (d > BOMBER.radius + h.rad || h.spawnShield > 0) continue;
      const k = Math.max(0.3, 1 - d / (BOMBER.radius + h.rad));
      this.hurtHuman(h, m.dmg * k, (dx / (d || 1)) * 10 * k, (dz / (d || 1)) * 10 * k);
    }
  }
  private blastFx(x: number, z: number) {
    const g = this.g;
    g.fx.explosion(x, z, BOMBER.radius); g.audio.play('boom', x, z, 0.8);
    const pd = Math.hypot(g.player.x - x, g.player.z - z); g.r.addShake(Math.max(0, 0.5 - pd / 20));
    if (this.coop) g.net.send({ k: 'boom', o: -1, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, r: BOMBER.radius, y: 0, m: 3 });
  }

  // ---------- coins (host decides pickups; every coin pays both players) ----------
  private dropCoin(x: number, z: number, v: number) {
    if (this.coins.length >= 450) { const c = this.coins.shift()!; this.credit(c.v, false); if (this.coop) this.coinCredit += c.v; }
    const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2;
    this.coins.push({ id: this.coinId++, x, z, y: 0.4, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 3 + Math.random() * 2, v, fly: -1, spin: Math.random() * 6 });
  }

  private stepCoins(dt: number) {
    const g = this.g, hs = this.humans;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.spin += dt * 5;
      // pulled towards whoever it's flying at, or whoever comes within their pickup range
      if (c.fly < 0) for (const h of hs) {
        if (!h.alive) continue;
        const R = h.isPlayer ? this.pickupR : this.partnerPickup;
        if (Math.hypot(h.x - c.x, h.z - c.z) < R) { c.fly = h.id; break; }
      }
      const h = c.fly >= 0 ? g.babos[c.fly] : null;
      if (h && h.alive) {
        const dx = h.x - c.x, dz = h.z - c.z, d = Math.hypot(dx, dz), sp = 9 + Math.max(0, 6 - d) * 3;
        c.x += (dx / (d || 1)) * sp * dt; c.z += (dz / (d || 1)) * sp * dt; c.y += (h.y + 0.5 - c.y) * Math.min(1, dt * 8);
        if (d < 0.45) {
          this.coins.splice(i, 1);
          this.credit(c.v, h.isPlayer);
          if (this.coop) this.coinCredit += c.v;
        }
        continue;
      }
      c.fly = -1;
      c.vy -= 20 * dt; c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt;
      const fy = g.arena.floorAt(c.x, c.z) + 0.05;
      if (c.y < fy) { c.y = fy; c.vy = Math.abs(c.vy) * 0.3; c.vx *= 0.6; c.vz *= 0.6; if (c.vy < 0.5) c.vy = 0; }
      if (g.arena.solidAt(c.x, c.z, c.y - 0.1)) { c.x -= c.vx * dt * 2; c.z -= c.vz * dt * 2; c.vx = -c.vx * 0.3; c.vz = -c.vz * 0.3; }
    }
  }

  /** Coins into my pocket (the piggy bank pays out double while it lasts). */
  credit(v: number, loud = true) {
    if (this.piggy > 0) { const b = Math.min(this.piggy, v); this.piggy -= b; v += b; }
    this.mats += v; this.earned += v; this.gainXp(v);
    if (loud) this.g.audio.play('coin', undefined, undefined, 0.5);
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
  private makeTurret(def: TurretDef, tier: number): Turret {
    const grp = new THREE.Group();
    const base = new THREE.Mesh(turretBaseGeo, new THREE.MeshStandardMaterial({ color: TIERS[tier].color, roughness: 0.35, metalness: 0.3 }));
    grp.add(base);
    const gun = buildGun(def.w, WEAPONS[def.w].color); gun.scale.setScalar(0.72); gun.position.y = 0.08; grp.add(gun);
    return { def, tier, cool: Math.random() * 0.5, grp, aim: 0, target: null, scanT: 0 };
  }
  addTurret(def: TurretDef, tier: number) {
    const t = this.makeTurret(def, tier);
    this.turrets.push(t); this.mount(this.g.player, this.turrets);
    return t;
  }
  removeTurret(t: Turret) { t.grp.removeFromParent(); const i = this.turrets.indexOf(t); if (i >= 0) this.turrets.splice(i, 1); this.mount(this.g.player, this.turrets); }
  setTurretTier(t: Turret, tier: number) { t.tier = tier; ((t.grp.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(TIERS[tier].color); }
  /** Evenly round the ball, on its shoulders. */
  private mount(owner: Babo, list: Turret[]) {
    const n = list.length;
    list.forEach((t, i) => {
      if (t.grp.parent !== owner.root) owner.root.add(t.grp);
      const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.PI / 4;
      t.grp.position.set(Math.cos(a) * 0.5, 0.32, Math.sin(a) * 0.5);
    });
  }
  mountTurrets() { this.mount(this.g.player, this.turrets); }

  /** My loadout, for the other player's screen: pickup range, turret speed, and [turret index, tier] pairs. */
  loadout() {
    return { pr: Math.round(this.pickupR * 10) / 10, tr: Math.round(Math.max(0.2, 1 + this.stats.turretRate / 100) * 100) / 100, t: this.turrets.flatMap(t => [TDEFS.indexOf(t.def), t.tier]) };
  }
  /** The partner's loadout: rebuild their (cosmetic) turrets when it changes. */
  remoteLoadout(owner: Babo, ru: { pr: number; tr: number; t: number[] }) {
    this.partnerPickup = ru.pr ?? 2.8; this.remoteTurretRate = ru.tr ?? 1;
    const key = (ru.t ?? []).join(',');
    if (key === this.remoteKey) return;
    this.remoteKey = key;
    for (const t of this.remoteTurrets) t.grp.removeFromParent();
    this.remoteTurrets = [];
    for (let i = 0; i + 1 < (ru.t ?? []).length; i += 2) { const d = TDEFS[ru.t[i]]; if (d) this.remoteTurrets.push(this.makeTurret(d, ru.t[i + 1])); }
    this.mount(owner, this.remoteTurrets);
  }

  private stepTurrets(dt: number, owner: Babo, list: Turret[], cosmetic: boolean) {
    const g = this.g; if (!owner.alive || !list.length) return;
    const rateMul = cosmetic ? this.remoteTurretRate : Math.max(0.2, 1 + this.stats.turretRate / 100);
    for (const t of list) {
      const wx = owner.x + t.grp.position.x, wz = owner.z + t.grp.position.z, y = owner.y + 0.55;
      const cb = cosmetic ? undefined : this.bonusOf(t.def.w);
      const R = t.def.range * (cosmetic ? 1 : this.rangeMul) * (1 + (cb?.range ?? 0));
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
      t.cool = 1 / (t.def.rate * TIER_RATE[t.tier] * rateMul * (1 + (cb?.rate ?? 0)));
      this.fireTurret(owner, t, wx, y, wz, R, cosmetic);
    }
  }

  private fireTurret(owner: Babo, t: Turret, x: number, y: number, z: number, R: number, cosmetic: boolean) {
    const g = this.g, def = t.def, w = WEAPONS[def.w];
    const dmg = def.dmg * TIER_DMG[t.tier];
    g.fx.flash(x + Math.cos(t.aim) * 0.35, y, z + Math.sin(t.aim) * 0.35, w.color, 3, 0.05);
    g.audio.play(def.w, x, z, 0.3);
    const src = 'turret:' + def.name;
    if (w.kind === 'zap') { g.fireZap(owner, x, y, z, t.aim, R, dmg, src); return; }
    const pellets = def.pellets ?? 1, spread = def.spread ?? w.spread, speed = def.speed ?? w.speed;
    for (let i = 0; i < pellets; i++) {
      const a = t.aim + (pellets > 1 ? ((i + Math.random()) / pellets - 0.5) * spread : (Math.random() - 0.5) * spread);
      g.addShot({ owner: owner.id, x, y, z, vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, life: R / speed * (pellets > 1 ? 0.85 + Math.random() * 0.3 : 1), dist: 0, w: def.w, trailT: 0, cosmetic, bounces: w.bounces ? 2 : 0, src, mul: dmg / w.damage, range: R });
    }
  }

  // ---------- downed and revived (co-op) ----------
  /** A player went down: leave a marker where they fell. Every client does this. */
  onHumanDown(b: Babo) {
    if (!this.coop) return;
    this.dropMarker(b.id, b.x, b.z);
    if (this.host && this.humans.every(h => !h.alive)) setTimeout(() => { if (this.g.state === 'playing' && this.humans.every(h => !h.alive)) { this.phase = 'over'; this.g.end(`Swarmed on wave ${this.n}`); } }, 900);
  }
  private dropMarker(id: number, x: number, z: number) {
    if (this.markers.has(id)) return;
    const b = this.g.babos[id], grp = new THREE.Group();
    const ghost = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), new THREE.MeshStandardMaterial({ color: b?.color ?? 0xffffff, transparent: true, opacity: 0.35, roughness: 0.3 }));
    ghost.position.y = 0.5; grp.add(ghost);
    const base = new THREE.Mesh(new THREE.RingGeometry(COOP.reviveR - 0.08, COOP.reviveR, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.35, depthWrite: false }));
    base.position.y = 0.03; grp.add(base);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 48, 1, 0, 0.001).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dffb0).multiplyScalar(1.6), toneMapped: false, depthWrite: false, transparent: true }));
    ring.position.y = 0.05; grp.add(ring);
    grp.position.set(x, this.g.arena.floorAt(x, z), z);
    this.g.r.scene.add(grp);
    this.markers.set(id, { id, x, z, prog: 0, grp, ring });
  }
  private clearMarkers() { for (const mk of this.markers.values()) this.g.r.scene.remove(mk.grp); this.markers.clear(); this.reviveProg = 0; }
  /** Remote side: the downed player's progress, from their snapshot. */
  setRemoteRevive(id: number, prog: number) { const mk = this.markers.get(id); if (mk) mk.prog = prog; }

  private stepMarkers(dt: number) {
    const g = this.g, p = g.player;
    // my own revive: the downed player's client counts it (the teammate standing on my marker)
    if (this.coop && !p.alive && this.phase === 'wave') {
      const mk = this.markers.get(p.id), mate = g.babos.find(b => b.human && !b.isPlayer);
      if (mk && mate?.alive && Math.hypot(mate.x - mk.x, mate.z - mk.z) < COOP.reviveR) this.reviveProg += dt / COOP.reviveT;
      else this.reviveProg = Math.max(0, this.reviveProg - dt * 0.5);
      if (mk) mk.prog = this.reviveProg;
      if (this.reviveProg >= 1) { this.reviveAt(p, mk ?? null); p.hp = Math.round(p.maxHp / 2); g.hud.banner('BACK IN!', true, 1.2); }
    }
    for (const mk of this.markers.values()) {
      mk.ring.geometry.dispose();
      mk.ring.geometry = new THREE.RingGeometry(0.62, 0.78, 48, 1, 0, Math.max(0.001, Math.min(1, mk.prog)) * Math.PI * 2).rotateX(-Math.PI / 2);
      (mk.grp.children[0] as THREE.Mesh).position.y = 0.5 + Math.sin(g.clock * 3) * 0.08;
    }
  }
  /** Bring a (local) player back, at their marker or somewhere safe. */
  reviveAt(p: Babo, mk: Marker | null) {
    const g = this.g;
    if (mk) { p.x = mk.x; p.z = mk.z; } else { const s = g.arena.spawns[(Math.random() * g.arena.spawns.length) | 0]; p.x = s.x; p.z = s.z; }
    p.y = p.gy = g.arena.floorAt(p.x, p.z); p.vx = p.vz = p.vy = 0;
    p.alive = true; p.root.visible = true; p.hp = p.maxHp; p.spawnShield = 1.5; p.burnT = 0;
    const m = this.markers.get(p.id); if (m) { g.r.scene.remove(m.grp); this.markers.delete(p.id); }
    this.reviveProg = 0;
    g.fx.ring(p.x, p.z, 1.6, p.color, 0.45, p.gy); g.audio.play('spawn', p.x, p.z);
  }
  /** Someone came back (seen on the other client through their snapshot). */
  onRemoteRevive(id: number) { const m = this.markers.get(id); if (m) { this.g.r.scene.remove(m.grp); this.markers.delete(id); } }

  // ---------- co-op sync ----------
  /** Host: the wave as the guest needs to see it. */
  netState() {
    const q = (v: number) => Math.round(v * 10);
    const m: number[] = [];
    for (const x of this.minions) if (!x.dead) m.push(x.id, KINDS.indexOf(x.kind), q(x.x), q(x.z), Math.round((100 * x.hp) / x.max), (x.st & 3) + (x.burnT > 0 ? 4 : 0) + (x.flash > 0.5 ? 8 : 0) + (x.kind === 'healer' && x.dx > 0.3 ? 16 : 0));
    const c: number[] = []; for (const k of this.coins) { if (c.length >= 600) break; c.push(k.id, q(k.x), q(k.z)); }
    const tl: number[] = []; for (const t of this.tele) tl.push(q(t.x), q(t.z));
    const sp: number[] = []; for (const s of this.spits) sp.push(q(s.x), q(s.z), q(s.vx), q(s.vz));
    const k: number[] = []; for (const c of this.crates) k.push(c.gold ? -c.id - 1 : c.id, q(c.x), q(c.z));
    return { k, sw: this.special ? Object.keys(SPECIALS).indexOf(this.special) : -1, n: this.n, t: Math.round(this.t * 10) / 10, ph: this.phase === 'wave' ? 0 : 1, b: this.bossId, hr: this.ready ? 1 : 0, lc: this.looseLast, e: this.endless ? 1 : 0, m, c, tl, sp, mh: this.g.babos.map(b => b.maxHp) };
  }
  /** Host: take the coins picked up since the last update (they're credited to the guest too). */
  takeCoinCredit() { const v = this.coinCredit; this.coinCredit = 0; return v; }
  /** Guest: hits since the last update, flat [id, dmg*10, kx*10, kz*10, flag]... */
  takeHits() { const h = this.pendingHits; this.pendingHits = []; return h; }

  /** Host: the guest's hits on minions. */
  applyGuestHits(att: Babo, h: number[]) {
    if (this.phase !== 'wave') return;   // late hits after the wave ended
    for (let i = 0; i + 4 < h.length; i += 5) {
      const m = this.byId.get(h[i]); if (!m || m.dead) continue;
      this.hostDamage(att, m, h[i + 1] / 10, h[i + 2] / 10, h[i + 3] / 10, 'guest', h[i + 4], true);
    }
    if (this.minions.some(m => m.dead)) { this.minions = this.minions.filter(m => !m.dead); for (const [id, m] of this.byId) if (m.dead) this.byId.delete(id); this.rebuildGrid(); }
  }

  /** Guest: follow the host's picture of the wave. */
  applyNet(r: any) {
    if (this.host || !r) return;
    const g = this.g, now = performance.now();
    this.t = r.t; this.endless = r.e === 1;
    this.special = r.sw >= 0 ? (Object.keys(SPECIALS)[r.sw] as SpecialId) : null;
    if (Array.isArray(r.k)) { const K = r.k as number[]; this.crates = []; for (let i = 0; i + 2 < K.length; i += 3) { const gold = K[i] < 0, id = gold ? -K[i] - 1 : K[i]; this.crates.push({ id, x: K[i + 1] / 10, z: K[i + 2] / 10, spin: this.g.clock + id, gold }); } }
    if ((r.hr === 1) !== this.partnerReady) { this.partnerReady = r.hr === 1; if (g.hud.runUi.isOpen) g.hud.runUi.render(); }
    // boss changes
    if (r.b !== this.bossId) {
      const old = g.babos[this.bossId]; if (old?.boss) setBoss(old, false);
      const nb = g.babos[r.b]; if (nb) setBoss(nb, true, this.n >= RUN.waves ? 1.8 : 1.5);
      this.bossId = r.b;
    }
    if (Array.isArray(r.mh)) r.mh.forEach((v: number, i: number) => { const b = g.babos[i]; if (b && !b.human) b.maxHp = v; });
    // wave start / end
    if (r.ph === 0 && (this.phase !== 'wave' || r.n !== this.n) && r.n > 0 && (this.hostPhase === 1 || r.n !== this.n)) { this.startWave(r.n); }
    else if (r.ph === 1 && this.hostPhase === 0 && this.phase === 'wave') {
      for (const m of this.minions) if (!m.dead) this.burst(m, false);
      this.minions = []; this.byId.clear(); this.coins = []; this.tele = []; this.spits = []; this.crates = [];
      this.breakLocal(r.lc ?? 0);
    }
    this.hostPhase = r.ph;
    if (r.ph !== 0) return;
    // minions: add, move, update, and drop the ones the host no longer has
    const seen = new Set<number>();
    const M = r.m as number[];
    for (let i = 0; i + 5 < M.length; i += 6) {
      const id = M[i]; seen.add(id);
      const ka = this.killedAt.get(id); if (ka !== undefined && now - ka < 600) continue;   // I just popped it; the host will catch up
      let m = this.byId.get(id);
      const x = M[i + 2] / 10, z = M[i + 3] / 10;
      if (!m || m.dead) { if (m) this.minions.splice(this.minions.indexOf(m), 1); m = this.addMinion(KINDS[M[i + 1]] ?? 'roller', x, z, id)!; if (!m) continue; }
      if (m.seen) { m.vx = (x - m.tx) / Math.max(0.03, (now - m.seen) / 1000); m.vz = (z - m.tz) / Math.max(0.03, (now - m.seen) / 1000); }
      m.tx = x; m.tz = z; m.seen = now;
      m.hp = (M[i + 4] / 100) * m.max;
      const f = M[i + 5]; m.st = f & 3; m.burnT = f & 4 ? 0.3 : 0; if (f & 8) m.flash = Math.max(m.flash, 0.6);
      if (f & 16 && m.dx <= 0) { m.dx = 1; g.fx.ring(m.x, m.z, HEALER.radius, 0x7dffb0, 0.4); } else if (!(f & 16)) m.dx = 0;
    }
    for (const m of this.minions) if (!seen.has(m.id) && !m.dead) { m.dead = true; this.burst(m, true); }
    this.minions = this.minions.filter(m => !m.dead);
    for (const [id, m] of this.byId) if (m.dead || !seen.has(id)) this.byId.delete(id);
    for (const [id, t] of this.killedAt) if (now - t > 2000) this.killedAt.delete(id);
    // coins, telegraphs, spit blobs: just positions
    const C = r.c as number[], keep = new Map(this.coins.map(c => [c.id, c]));
    const coins: Coin[] = [];
    for (let i = 0; i + 2 < C.length; i += 3) {
      const c = keep.get(C[i]) ?? { id: C[i], x: C[i + 1] / 10, z: C[i + 2] / 10, y: 0.05, vx: 0, vz: 0, vy: 0, v: 1, fly: -1, spin: Math.random() * 6 };
      c.x += (C[i + 1] / 10 - c.x) * 0.6; c.z += (C[i + 2] / 10 - c.z) * 0.6;
      coins.push(c);
    }
    this.coins = coins;
    this.tele = []; const T = r.tl as number[]; for (let i = 0; i + 1 < T.length; i += 2) this.tele.push({ x: T[i] / 10, z: T[i + 1] / 10, t: 1, kind: 'roller' });
    this.spits = []; const S = r.sp as number[]; for (let i = 0; i + 3 < S.length; i += 4) this.spits.push({ x: S[i] / 10, z: S[i + 1] / 10, vx: S[i + 2] / 10, vz: S[i + 3] / 10, t: 1, dmg: 0 });
  }

  /** Guest: glide the mirrored minions towards where the host last put them. */
  private stepMirror(dt: number) {
    const k = Math.min(1, dt * 12);
    for (const m of this.minions) {
      if (m.dead) continue;
      m.tx += m.vx * dt * 0.5; m.tz += m.vz * dt * 0.5;
      m.x += (m.tx - m.x) * k; m.z += (m.tz - m.z) * k;
      if (Math.abs(m.vx) + Math.abs(m.vz) > 0.2) m.face = Math.atan2(m.vx, m.vz);
      m.flash = Math.max(0, m.flash - dt * 6);
    }
    for (const s of this.spits) { s.x += s.vx * dt; s.z += s.vz * dt; }
    for (const c of this.coins) c.spin += dt * 5;
    this.rebuildGrid();
  }

  /** Both pressed "next wave"? (Host starts it; the guest follows the host state.) */
  pressReady() {
    this.ready = true;
    if (!this.coop) { this.startWave(this.n + 1); return; }
    if (this.host) this.tryStart();
    else this.g.net.send({ k: 'rr', n: this.n + 1 });
    this.g.hud.runUi.render();
  }
  onPartnerReady(n: number) { if (n === this.n + 1) { this.partnerReady = true; this.tryStart(); this.g.hud.runUi.render(); } }
  private tryStart() { if (this.host && this.ready && this.partnerReady && this.phase !== 'wave') this.startWave(this.n + 1); }

  // ---------- level-ups ----------
  rollTier(extraLuck = 0): number {
    const n = Math.min(this.n, 20), k = 1 + Math.max(0, this.stats.luck + extraLuck) / 100, r = Math.random();
    const p4 = n >= 8 ? Math.min(0.06, 0.008 * (n - 7)) * k : 0;
    const p3 = n >= 4 ? Math.min(0.22, 0.02 * (n - 3)) * k : 0;
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
    if (this.g.player.alive) this.g.player.hp = this.g.player.maxHp;
    if (this.pending > 0) { this.levelRerolls = 0; this.rollLevel(); } else { this.phase = 'shop'; this.rollShop(); }
  }

  // ---------- shop ----------
  private priceScale() { return (1 + TUNE.priceGrow * Math.max(0, this.n - 1)) * this.dm.price * TUNE.price; }
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
    while (out.length < 4) {
      const force = wantTurret && out.length === keep.length, o = this.makeOffer(force);
      if (force && o.kind === 'turret') { o.price = Math.round(o.price * 0.7); o.deal = true; }   // a starter turret at a discount
      out.push(o);
    }
    this.offers = out;
  }
  get rerollCost() { return Math.max(1, Math.floor(Math.min(this.n, 25) * 0.75)) + this.rerolls * Math.max(2, Math.floor(Math.min(this.n, 25) * 0.6)); }
  reroll() { const c = this.rerollCost; if (this.mats < c) return false; this.mats -= c; this.rerolls++; this.rollShop(); return true; }

  /** Buy an offer. Returns a message when it can't. */
  buy(i: number): string | null {
    const o = this.offers[i], g = this.g;
    if (!o || o.sold) return null;
    if (this.mats < o.price) return 'Not enough coins';
    const m = this.grant(o); if (m) return m;
    this.mats -= o.price; o.sold = true; o.locked = false;
    g.audio.play('pickup');
    return null;
  }
  /** Put an offer into your kit (bought or from a crate). Returns a message when it can't. */
  grant(o: Offer): string | null {
    const p = this.g.player;
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
    this.recalcClasses();
    return null;
  }
  turretValue(t: Turret) { return Math.round(t.def.price * [1, 1.9, 3.2, 5][t.tier] * this.priceScale()); }
  sellValue(t: Turret) { return Math.round(this.turretValue(t) * TUNE.sell); }
  sell(t: Turret) { this.mats += this.sellValue(t); this.removeTurret(t); this.recalcClasses(); this.g.audio.play('coin'); }
  itemValue(id: string) { const it = ITEMS.find(i => i.id === id); return it ? Math.round(ITEM_PRICE[it.tier] * this.priceScale() * TUNE.sell) : 0; }
  sellItem(id: string) {
    const n = this.items.get(id) ?? 0; if (!n) return;
    this.mats += this.itemValue(id);
    if (n > 1) this.items.set(id, n - 1); else this.items.delete(id);
    this.recalc(); this.g.audio.play('coin');
  }
  /** Two identical turrets of the same tier become one of the next tier. */
  canCombine(t: Turret) { return t.tier < 3 && this.turrets.some(o => o !== t && o.def === t.def && o.tier === t.tier); }
  combine(t: Turret) {
    const o = this.turrets.find(x => x !== t && x.def === t.def && x.tier === t.tier); if (!o || t.tier >= 3) return;
    this.removeTurret(o); this.setTurretTier(t, t.tier + 1); this.g.audio.play('levelup');
  }
  nextWave() { this.pressReady(); }

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
      if (n >= 500) break;
    }
    this.coinMesh.count = n; this.coinMesh.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const t of this.tele) {
      const k = 0.5 + 0.2 * Math.sin(clock * 20 + t.x); _q.identity(); _s.set(k, 1, k); _p.set(t.x, 0.03, t.z);
      _m.compose(_p, _q, _s); this.teleMesh.setMatrixAt(n++, _m);
      if (n >= 200) break;
    }
    this.teleMesh.count = n; this.teleMesh.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const s of this.spits) { _q.identity(); _s.setScalar(1); _p.set(s.x, 0.55, s.z); _m.compose(_p, _q, _s); this.spitMesh.setMatrixAt(n++, _m); if (n >= 120) break; }
    this.spitMesh.count = n; this.spitMesh.instanceMatrix.needsUpdate = true;
    n = 0; let sh = 0;
    for (const c of this.crates) {
      if (n >= 16) break;
      _q.setFromAxisAngle(_up, c.spin); _p.set(c.x, (c.gold ? 0.34 : 0.26) + Math.sin(clock * 3 + c.id) * 0.06, c.z); _s.setScalar(c.gold ? 1.4 : 1);
      _m.compose(_p, _q, _s); this.crateMesh.setMatrixAt(n, _m); this.crateBand.setMatrixAt(n, _m); n++;
    }
    this.crateMesh.count = this.crateBand.count = n; this.crateMesh.instanceMatrix.needsUpdate = true; this.crateBand.instanceMatrix.needsUpdate = true;
    for (const m of this.minions) {
      if (m.dead || m.kind !== 'shielder' || sh >= 60) continue;
      _q.setFromAxisAngle(_up, m.face); _s.setScalar(m.r); _p.set(m.x, m.r, m.z);
      _m.compose(_p, _q, _s); this.shieldMesh.setMatrixAt(sh++, _m);
    }
    this.shieldMesh.count = sh; this.shieldMesh.instanceMatrix.needsUpdate = true;
    // turret reach while hovering one in the shop
    const p = this.g.player;
    this.rangeRing.visible = this.showRange > 0 && p.alive;
    if (this.rangeRing.visible) { this.rangeRing.position.set(p.x, p.gy + 0.04, p.z); this.rangeRing.scale.setScalar(this.showRange); }
  }

  get coinsOnFloor() { return this.coins.length; }
}

const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const GC = 1.5;   // minion grid cell (m)
const gkey = (x: number, z: number) => Math.floor(x / GC) + Math.floor(z / GC) * 1000;
const _near: Minion[] = [];
/** Damage that goes round a shielder's shield. */
const SHIELD_EXEMPT = new Set(['burn', 'thorns', 'mine', 'nuke', 'grenade', 'rocket', 'shockwave', 'blast', 'spikesab']);
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
