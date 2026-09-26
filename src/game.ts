import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CLIMB, Arena, CELL } from './arena';
import { Audio } from './audio';
import { Babo, makeBabo, setTeamRing, setWeapon, updateBaboVisual } from './babo';
import {
  ABILITIES, AbilityId, BALL, BOT_NAMES, COLORS, DASH, DIFFICULTY, Difficulty, GRENADE, LADDER, MapChoice, MODES, ModeDef, ModeId,
  PICKABLE, SPIKES, WAVE, WEAPONS, WeaponId,
} from './config';
import type { MapId } from './arena';
import { Fx } from './fx';
import { Renderer, Quality } from './render';
import { Hud } from './hud';
import { Input } from './input';
import { thinkBot } from './bots';
import { Stats } from './stats';
import { Net, NetEvent, RosterEntry, StartOffer, HostState } from './net';
import { PeerRoom, newCode } from './peerroom';
import { WsRoom } from './wsroom';
import { DuoRoom } from './duoroom';
import { RELAY_URL } from './config';

interface Shot { owner: number; x: number; y: number; z: number; vx: number; vz: number; life: number; dist: number; w: WeaponId; mesh?: THREE.Object3D; trailT: number; cosmetic: boolean; bounces: number }
interface Nade { owner: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; mesh: THREE.Mesh; cosmetic: boolean }
type PickKind = 'health' | 'nades' | 'mega';
interface Pickup { kind: PickKind; x: number; z: number; t: number; mesh: THREE.Group }

const RESPAWN: Record<PickKind, number> = { health: 11, nades: 13, mega: 30 };
const G = 24;
const WIDS = Object.keys(WEAPONS) as WeaponId[];
const BOT_ABILITIES = (gun: boolean) => (Object.keys(ABILITIES) as AbilityId[]).filter(a => !(gun && a === 'spikes'));
const AIDS = Object.keys(ABILITIES) as AbilityId[];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const INTERP_MS = 110;

const STORE = 'ballistic.v1';
export interface Saved {
  weapon: WeaponId; ability: AbilityId; color: number; difficulty: Difficulty; quality: Quality | 'auto';
  muted: boolean; best?: number; perf?: boolean; nick: string;
  soloMode: 'solo' | 'gungame'; map: MapChoice;
}
function load(): Saved {
  let s: Partial<Saved> = {};
  try { s = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { s = {}; }
  return {
    weapon: s.weapon ?? 'shotgun', ability: s.ability ?? 'dash', color: s.color ?? 0, difficulty: s.difficulty ?? 'normal',
    quality: s.quality ?? 'auto', muted: !!s.muted, best: s.best, perf: s.perf, nick: s.nick ?? '',
    soloMode: s.soloMode ?? 'solo', map: s.map ?? 'auto',
  };
}

export class Game {
  r: Renderer;
  arena!: Arena;
  fx: Fx;
  audio = new Audio();
  hud: Hud;
  input: Input;
  net = new Net();
  saved = load();
  mode: ModeDef = MODES.solo;
  map: MapId = 'random';
  lastMode: ModeId = 'duel';
  babos: Babo[] = [];
  shots: Shot[] = [];
  nades: Nade[] = [];
  pickups: Pickup[] = [];
  state: 'menu' | 'lobby' | 'countdown' | 'playing' | 'over' = 'menu';
  paused = false;
  clock = 0;
  matchT = 0;
  countT = 0;
  player!: Babo;
  pendingWeapon: WeaponId;
  pendingAbility: AbilityId;
  // online
  online = false;
  host = true;
  epoch = 0;
  partner = '';
  endReason = '';
  private offer: StartOffer | null = null;
  private netT = 0;
  private peerOffset = new Map<string, number>();
  private tracer: THREE.InstancedMesh;
  private last = performance.now();
  private acc = 0;
  private perf = { t: 0, frames: 0 };
  private rocketGeo = new THREE.CapsuleGeometry(0.1, 0.35, 4, 8).rotateX(Math.PI / 2);
  private rocketMat = new THREE.MeshStandardMaterial({ color: 0xf4f0ea, roughness: 0.4, emissive: 0xff5a2a, emissiveIntensity: 0.2 });
  private nadeGeo = new THREE.SphereGeometry(0.17, 14, 10);
  private nadeMat = new THREE.MeshStandardMaterial({ color: 0x3b8f4a, roughness: 0.5 });
  private aimPoint = new THREE.Vector3();
  seed = (Math.random() * 1e9) | 0;
  stats = new Stats();
  tSim = 0; tRender = 0; tHud = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.r = new Renderer(canvas);
    this.fx = new Fx(this.r.scene);
    this.audio.setMuted(this.saved.muted);
    this.pendingWeapon = this.saved.weapon;
    this.pendingAbility = this.saved.ability;
    const tg = new THREE.BoxGeometry(0.07, 0.07, 1); tg.translate(0, 0, -0.5);
    this.tracer = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ toneMapped: false }), 400);
    this.tracer.frustumCulled = false; this.tracer.count = 0;
    this.tracer.setColorAt(0, new THREE.Color(1, 1, 1));
    this.r.scene.add(this.tracer);
    this.hud = new Hud(this);
    this.input = new Input(this, canvas);
    this.wireNet();
    this.newArena(MODES.solo.size);
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    // opened from an invite link: go straight to the lobby
    if (!this.inArtifact && /^#[a-z0-9]{6}$/.test(location.hash)) setTimeout(() => this.openLobby(), 50);
  }

  save() { try { localStorage.setItem(STORE, JSON.stringify(this.saved)); } catch { /* storage unavailable */ } }

  newArena(size: number, map: MapId = 'random') {
    if (this.arena) { this.r.scene.remove(this.arena.group); }
    this.arena = new Arena(this.seed, size, map);
    this.r.scene.add(this.arena.group);
    this.fx.floorAt = (x, z) => this.arena.floorAt(x, z);
    for (const p of this.pickups) this.r.scene.remove(p.mesh);
    this.pickups = this.arena.pickups.map((s, i) => {
      let kind: PickKind = this.arena.pickupKinds[i] ?? (i === this.arena.pickups.length - 1 ? 'mega' : Math.floor(i / 4) === 1 ? 'nades' : 'health');
      if (this.mode?.gun && kind === 'nades') kind = 'health';   // no spare grenades in Gun Game
      const mesh = pickupMesh(kind); mesh.position.set(s.x, this.arena.floorAt(s.x, s.z), s.z); this.r.scene.add(mesh);
      return { kind, x: s.x, z: s.z, t: 0, mesh };
    });
  }

  /** Which arena a mode plays on, given the player's map choice. */
  resolveMap(mode: ModeDef, choice: MapChoice = this.saved.map): MapId {
    if (choice === 'auto') return mode.map ?? 'random';
    return choice;
  }

  canDamage(a: Babo, v: Babo) { return a === v || !this.mode.teams || a.team !== v.team; }
  nameOf(b: Babo) { return b.isPlayer ? 'You' : b.name; }

  // ---------- match flow ----------
  /** Solo match against bots. */
  startSolo() {
    this.online = false; this.host = true; this.partner = ''; this.epoch = 0;
    const mode = MODES[this.saved.soloMode] ?? MODES.solo;
    const pc = this.saved.color % COLORS.length;
    const roster: RosterEntry[] = [{ id: 0, name: 'You', color: COLORS[pc].hex, team: 0, human: true }];
    const cols = COLORS.filter((_, i) => i !== pc);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < mode.bots; i++) roster.push({ id: i + 1, name: names[i], color: cols[i % cols.length].hex, team: i + 1, human: false });
    this.begin(mode, (Math.random() * 1e9) | 0, roster, 0, this.resolveMap(mode));
  }

  start() {
    if (this.online) { this.hud.toLobby(); return; }
    this.startSolo();
  }

  private begin(mode: ModeDef, seed: number, roster: RosterEntry[], myId: number, map: MapId = 'random') {
    this.audio.unlock();
    for (const b of this.babos) this.r.scene.remove(b.root);
    for (const s of this.shots) if (s.mesh) this.r.scene.remove(s.mesh);
    for (const n of this.nades) this.r.scene.remove(n.mesh);
    this.babos = []; this.shots = []; this.nades = [];
    this.mode = mode; this.seed = seed; this.endReason = ''; this.map = map;
    this.newArena(mode.size, map);
    this.fx.clear();
    const rnd = mulberry(seed ^ 0x5bd1e995);
    for (const e of roster) {
      const me = e.id === myId;
      const w = mode.gun ? LADDER[0] : me ? this.saved.weapon : PICKABLE[Math.floor(rnd() * PICKABLE.length)];
      const bots = BOT_ABILITIES(!!mode.gun);
      let ab = me ? this.saved.ability : bots[Math.floor(rnd() * bots.length)];
      if (mode.gun && ab === 'spikes') { ab = 'dash'; if (me) setTimeout(() => this.hud.toast('Spikes is off in Gun Game (it is the last weapon), so you have Dash'), 1200); }
      const b = makeBabo(e.id, e.name, e.color, w, me, ab);
      b.human = e.human; b.team = mode.teams ? e.team : e.id;
      b.local = me || (!e.human && this.host);
      if (mode.teams && !me) setTeamRing(b, b.team === roster[myId].team ? 0x7dffb0 : 0xff5a6a, 0.8);
      this.babos.push(b);
      if (me) this.player = b;
    }
    for (const b of this.babos) { this.r.scene.add(b.root); if (b.local) this.spawn(b, true); else { b.alive = false; b.root.visible = false; } }
    this.matchT = mode.time; this.countT = 3.2; this.state = 'countdown';
    this.paused = false;
    this.hud.onStart();
    this.r.follow(this.player.x, this.player.z, this.player.x, this.player.z, 0, true);
  }

  end(reason = '') {
    if (this.state === 'over') return;
    this.state = 'over'; this.endReason = reason;
    const ranked = this.mode.gun
      ? [...this.babos].sort((a, b) => Number(b.won) - Number(a.won) || b.tier - a.tier || b.tierKills - a.tierKills || b.kills - a.kills)
      : [...this.babos].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    let won: boolean;
    if (this.mode.teams) { const ts = this.teamScores(); won = ts[this.player.team] >= Math.max(...Object.values(ts)); }
    else won = ranked[0] === this.player;
    const place = ranked.indexOf(this.player) + 1;
    if (!this.online && (!this.saved.best || place < this.saved.best)) { this.saved.best = place; this.save(); }
    this.audio.play(won ? 'win' : 'lose');
    if (this.online && this.host) this.flushNet(true);
    this.hud.showResult(ranked, place, won);
  }

  teamScores() {
    const t: Record<number, number> = {};
    for (const b of this.babos) t[b.team] = (t[b.team] ?? 0) + b.kills;
    return t;
  }

  private checkLimit() {
    if (!this.host || this.state !== 'playing') return;
    if (this.mode.gun) { if (this.babos.some(b => b.won)) setTimeout(() => { if (this.state === 'playing') this.end(); }, 900); return; }
    const hit = this.mode.teams ? Object.values(this.teamScores()).some(v => v >= this.mode.limit) : this.babos.some(b => b.kills >= this.mode.limit);
    if (hit) setTimeout(() => { if (this.state === 'playing') this.end(); }, 900);
  }

  spawn(b: Babo, initial = false) {
    // co-op on a hand-made map: the humans start and respawn inside their base
    const pool = this.mode.teams && b.human && this.map !== 'random' && this.arena.homeSpawns.length ? this.arena.homeSpawns : this.arena.spawns;
    let best = pool[0];
    if (initial && pool === this.arena.homeSpawns) {
      best = pool[(b.id * 7) % pool.length];
    } else if (initial) {
      // spread starting positions evenly around the arena (deterministic by id)
      const a = (b.id / Math.max(2, this.babos.length)) * Math.PI * 2 + 0.6, r = this.arena.half * 0.7;
      const tx = Math.cos(a) * r, tz = Math.sin(a) * r; let bd = 1e9;
      for (const s of this.arena.spawns) { const d = Math.hypot(s.x - tx, s.z - tz); if (d < bd) { bd = d; best = s; } }
    } else {
      let bestScore = -1;
      for (let k = 0; k < 40; k++) {
        const s = pool[(Math.random() * pool.length) | 0];
        let near = 1e9;
        for (const o of this.babos) if (o !== b && o.alive && this.canDamage(o, b)) near = Math.min(near, Math.hypot(o.x - s.x, o.z - s.z));
        if (near > bestScore) { bestScore = near; best = s; }
      }
    }
    if (this.mode.gun) {
      const w = LADDER[Math.min(b.tier, LADDER.length - 1)];
      if (b.weapon !== w) setWeapon(b, w); else { b.ammo = WEAPONS[w].clip; b.reloadT = 0; }
      if (b.isPlayer && this.pendingAbility !== 'spikes' && b.ability !== this.pendingAbility) { b.ability = this.pendingAbility; b.abCool = 0; }
      if (!b.human) { const ab = BOT_ABILITIES(true); b.ability = ab[(Math.random() * ab.length) | 0]; }
    } else if (!b.human) { setWeapon(b, PICKABLE[(Math.random() * PICKABLE.length) | 0]); b.ability = AIDS[(Math.random() * AIDS.length) | 0]; }
    else if (b.isPlayer) {
      if (b.weapon !== this.pendingWeapon) setWeapon(b, this.pendingWeapon); else { b.ammo = WEAPONS[b.weapon].clip; b.reloadT = 0; }
      if (b.ability !== this.pendingAbility) { b.ability = this.pendingAbility; b.abCool = 0; }
    }
    b.x = best.x; b.z = best.z; b.vx = b.vz = 0; b.y = b.gy = this.arena.floorAt(best.x, best.z); b.vy = 0;
    b.hp = BALL.hp; b.alive = true; b.root.visible = true; b.nades = this.mode.gun ? 0 : GRENADE.start; b.cool = 0.3; b.streak = 0; b.abT = 0;
    b.spawnShield = initial ? 0 : 1.3; b.lastHitBy = -1; b.brain = undefined;
    if (!initial) this.spawnFx(b);
  }

  private spawnFx(b: Babo) {
    this.audio.play('spawn', b.x, b.z, 0.8);
    this.fx.ring(b.x, b.z, 1.6, b.color, 0.45, b.gy);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; this.fx.glow(b.x, 0.3 + b.gy, b.z, Math.cos(a) * 3, 3, Math.sin(a) * 3, 0.08, b.color, 0.4, 4); }
  }

  // ---------- combat ----------
  fire(b: Babo) {
    const w = WEAPONS[b.weapon];
    if (w.kind === 'melee') return;
    if (w.kind === 'lob') {
      if (b.cool > 0) return;
      b.cool = 1 / w.rate; b.spawnShield = 0;
      const d = Math.min(GRENADE.maxThrow, Math.max(2, b.aimDist));
      this.throwNade(b, b.x + b.aimX * d, b.z + b.aimZ * d, true);
      return;
    }
    if (w.semi && b.isPlayer) { if (b.semiLock) return; }
    if (b.reloadT > 0 || b.cool > 0) return;
    if (w.semi && b.isPlayer) b.semiLock = true;
    if (b.ammo <= 0) { this.reload(b); return; }
    b.ammo--; b.cool = 1 / w.rate; b.spawnShield = 0;
    this.spawnShots(b);
    b.vx -= b.aimX * w.recoil; b.vz -= b.aimZ * w.recoil;
    if (b.ammo <= 0) this.reload(b);
  }

  /** Projectiles + muzzle effects. Shots from balls simulated elsewhere are cosmetic here. */
  private spawnShots(b: Babo) {
    const w = WEAPONS[b.weapon];
    const base = Math.atan2(b.aimZ, b.aimX);
    const sy = b.y + 0.55;
    let mx = b.x + b.aimX * 0.85, mz = b.z + b.aimZ * 0.85;
    if (this.arena.raycast(b.x, b.z, mx, mz, sy) >= 0) { mx = b.x; mz = b.z; }
    if (w.kind === 'rail') { this.fireRail(b, mx, sy, mz); }
    else for (let i = 0; i < w.pellets; i++) {
      const a = base + (w.pellets > 1 ? ((i + Math.random()) / w.pellets - 0.5) * w.spread : (Math.random() - 0.5) * w.spread);
      const sp = w.speed * (w.pellets > 1 ? 0.9 + Math.random() * 0.2 : 1);
      const s: Shot = { owner: b.id, x: mx, y: sy, z: mz, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, life: w.life * (w.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1), dist: 0, w: w.id, trailT: 0, cosmetic: !b.local, bounces: w.bounces ?? 0 };
      if (w.kind === 'rocket') { const m = new THREE.Mesh(this.rocketGeo, this.rocketMat); m.castShadow = true; m.position.set(mx, sy, mz); m.rotation.y = Math.atan2(s.vx, s.vz); this.r.scene.add(m); s.mesh = m; }
      this.shots.push(s);
    }
    b.recoilZ = w.kind === 'rocket' || w.kind === 'rail' ? 0.25 : w.pellets > 1 ? 0.2 : 0.06;
    const fx = b.x + b.aimX * 1.1, fz = b.z + b.aimZ * 1.1;
    this.fx.flash(fx, 0.9 + b.y, fz, w.color, w.pellets > 1 ? 14 : w.kind === 'rocket' ? 10 : 5, 0.07);
    const n = w.pellets > 1 ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() - 0.5) * (w.pellets > 1 ? 0.8 : 0.5), s = 4 + Math.random() * 6;
      this.fx.glow(fx, sy, fz, Math.cos(a) * s, Math.random() * 2, Math.sin(a) * s, 0.06 + Math.random() * 0.06, w.color, 0.08 + Math.random() * 0.06);
    }
    if (w.pellets > 1) this.fx.puff(fx, sy, fz, 0.18, 0.4, b.aimX * 3, 0.6, b.aimZ * 3, 1.5);
    this.audio.play(w.id, b.x, b.z, b.isPlayer ? 1 : 0.75);
    if (b.isPlayer) this.r.addShake(w.kind === 'rocket' || w.kind === 'rail' ? 0.25 : w.pellets > 1 ? 0.3 : 0.05);
  }

  /** Railgun: instant beam to the first wall, piercing every ball on the way. */
  private fireRail(b: Babo, x0: number, y: number, z0: number) {
    const w = WEAPONS.railgun, R = w.range!;
    const x1 = x0 + b.aimX * R, z1 = z0 + b.aimZ * R;
    let t = this.arena.raycast(x0, z0, x1, z1, y, false, CLIMB); if (t < 0) t = 1;
    const ex = x0 + (x1 - x0) * t, ez = z0 + (z1 - z0) * t;
    this.fx.beam(x0, y, z0, ex, ez, w.color);
    for (let k = 0; k < 4; k++) this.fx.glow(ex, y, ez, (Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6, 0.07, w.color, 0.3, 10);
    if (!b.local) return;
    const sdx = ex - x0, sdz = ez - z0, l2 = sdx * sdx + sdz * sdz || 1;
    for (const v of this.babos) {
      if (v === b || !v.alive || !this.canDamage(b, v)) continue;
      const u = ((v.x - x0) * sdx + (v.z - z0) * sdz) / l2; if (u < 0 || u > 1) continue;
      const px = x0 + sdx * u, pz = z0 + sdz * u;
      if (Math.hypot(v.x - px, v.z - pz) > BALL.radius + 0.1) continue;
      this.hit(b, v, w.damage, b.aimX * w.knock, b.aimZ * w.knock, 2);
      for (let k = 0; k < 6; k++) this.fx.bit(v.x, v.y + 0.5, v.z, b.aimX * 6 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, b.aimZ * 6 + (Math.random() - 0.5) * 4, 0.07, v.color, 0.7);
    }
  }

  reload(b: Babo) {
    const w = WEAPONS[b.weapon];
    if (b.reloadT > 0 || b.ammo >= w.clip) return;
    b.reloadT = w.reload;
    if (b.isPlayer) this.audio.play('reload');
  }

  throwNade(b: Babo, tx: number, tz: number, free = false) {
    if (!b.alive) return;
    if (!free) { if (b.nades <= 0 || b.nadeCool > 0) return; b.nades--; b.nadeCool = GRENADE.cooldown; }
    b.spawnShield = 0;
    let dx = tx - b.x, dz = tz - b.z; let d = Math.hypot(dx, dz);
    if (d > GRENADE.maxThrow) { dx *= GRENADE.maxThrow / d; dz *= GRENADE.maxThrow / d; d = GRENADE.maxThrow; }
    const T = 0.45 + d * 0.035;
    const sx = b.x + (dx / (d || 1)) * 0.6, sz = b.z + (dz / (d || 1)) * 0.6, sy = b.y + 0.9;
    // aim at the ground height where it will land
    const dy = this.arena.floorAt(b.x + dx, b.z + dz) - sy;
    const vx = dx / T + b.vx * 0.3, vy = (G * T) / 2 + dy / T, vz = dz / T + b.vz * 0.3;
    this.addNade(b.id, sx, sy, sz, vx, vy, vz, false);
    if (this.online) this.net.send({ k: 'nade', o: b.id, x: r2(sx), y: r2(sy), z: r2(sz), vx: r2(vx), vy: r2(vy), vz: r2(vz) });
  }

  private addNade(owner: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, cosmetic: boolean, fuse = GRENADE.fuse) {
    const m = new THREE.Mesh(this.nadeGeo, this.nadeMat); m.castShadow = true; this.r.scene.add(m);
    this.nades.push({ owner, x, y, z, vx, vy, vz, fuse, mesh: m, cosmetic });
    const b = this.babos[owner]; this.audio.play('throw', b?.x ?? x, b?.z ?? z);
  }

  /** The attacker's owner decides every hit. Local victims take it now; remote ones get a message. */
  hit(att: Babo, v: Babo, dmg: number, kx: number, kz: number, vy = 0) {
    if (!att.local || !v.alive || !this.canDamage(att, v)) return;
    if (att.isPlayer && v !== att && v.spawnShield <= 0) { this.hud.floater(v.x, v.z, Math.round(dmg * (v.abT > 0 && v.ability === 'bubble' ? 0.3 : 1))); this.audio.play('hit', undefined, undefined, 0.8); }
    if (v.local) this.applyDamage(v, dmg, att.id, kx, kz, vy);
    else {
      v.hurtT = 0.12;
      this.net.send({ k: 'hit', v: v.id, a: att.id, d: r2(dmg), x: r2(kx), z: r2(kz), y: r2(vy) });
    }
  }

  applyDamage(v: Babo, dmg: number, by: number, kx: number, kz: number, vy = 0) {
    if (!v.alive) return;
    if (v.abT > 0 && v.ability === 'bubble') { dmg *= 0.3; kx *= 0.3; kz *= 0.3; vy *= 0.3; }
    if (v.abT > 0 && v.ability === 'dash') { kx = kz = vy = 0; }
    v.vx += kx; v.vz += kz; v.vy += vy;
    if (v.spawnShield > 0) return;
    v.hp -= dmg; v.hurtT = 0.12;
    if (by !== v.id) { v.lastHitBy = by; v.lastHitT = this.clock; }
    if (v.isPlayer) { this.hud.hurt(Math.min(1, dmg / 40)); this.r.addShake(Math.min(0.5, dmg / 60)); this.audio.play('hurt'); }
    if (v.hp <= 0) {
      let killer = by;
      if ((by === v.id || by < 0) && v.lastHitBy >= 0 && this.clock - v.lastHitT < 3) killer = v.lastHitBy;
      if (this.online) this.net.send({ k: 'die', v: v.id, by: killer });
      this.onDeath(v, killer);
    }
  }

  /** Runs on every client for every death (local ones directly, remote ones from the network). */
  onDeath(v: Babo, killer: number) {
    if (!v.root.visible && !v.alive && !v.local) { /* already hidden by snapshot; still show the burst */ }
    v.alive = false; v.root.visible = false; v.deaths++; v.streak = 0; v.abT = 0;
    if (v.local) v.respawnT = BALL.respawn;
    const k = this.babos[killer];
    const knifed = !!(k && k !== v && k.weapon === 'spikes');
    if (k && k !== v) { k.kills++; k.streak++; } else if (k === v) { v.kills = Math.max(0, v.kills - 1); }
    this.hud.feed(k && k !== v ? k : null, v, knifed);
    if (this.mode.gun) this.gunGameKill(v, k && k !== v ? k : null, knifed);
    else if (k?.isPlayer && k !== v) {
      this.audio.play('kill');
      const msgs: Record<number, string> = { 2: 'DOUBLE!', 3: 'TRIPLE!', 4: 'RAMPAGE!', 5: 'UNSTOPPABLE!' };
      this.hud.banner(msgs[Math.min(5, k.streak)] ?? `POPPED ${v.name.toUpperCase()}`, !msgs[Math.min(5, k.streak)]);
    }
    if (v.isPlayer) this.hud.onPlayerDeath(k && k !== v ? k : null);
    if (v.gy < 0.1) this.arena.splat(v.x, v.z, 1.1 + Math.random() * 0.4, v.color);
    this.audio.play('pop', v.x, v.z);
    this.fx.flash(v.x, 1 + v.y, v.z, v.color, 18, 0.25);
    this.fx.ring(v.x, v.z, 2.4, v.color, 0.3, v.gy);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 8;
      this.fx.bit(v.x, 0.6 + v.y, v.z, Math.cos(a) * s + v.vx * 0.4, 3 + Math.random() * 7, Math.sin(a) * s + v.vz * 0.4, 0.07 + Math.random() * 0.12, i % 5 === 0 ? 0xffffff : v.color, 1.2 + Math.random() * 1.2);
    }
    for (let i = 0; i < 6; i++) this.fx.puff(v.x + (Math.random() - 0.5), 0.5 + v.y, v.z + (Math.random() - 0.5), 0.35, 0.6);
    this.checkLimit();
  }

  /**
   * Gun Game ladder. Runs on every client in the same order; online, the host's copy of the
   * levels wins (it's in the host state), so a missed message can't split the ladder.
   */
  private gunGameKill(v: Babo, k: Babo | null, knifed: boolean) {
    const last = LADDER.length - 1, per = this.mode.perTier ?? 1;
    if (this.babos.some(b => b.won)) return;   // someone already won; the match is wrapping up
    if (k) {
      if (k.tier >= last) { k.won = true; }
      else {
        k.tierKills++;
        if (k.tierKills >= per) { k.tier++; k.tierKills = 0; this.onLevelUp(k); }
        else if (k.isPlayer) this.hud.banner(`${per - k.tierKills} MORE WITH ${WEAPONS[k.weapon].name.toUpperCase()}`, true, 1.1);
      }
    }
    // spikes kills and self-pops cost a level (the CS knife rule)
    if (knifed || !k) {
      if (v.tier > 0) { v.tier--; v.tierKills = 0; }
      if (v.isPlayer) { this.audio.play('demote'); this.hud.banner(knifed ? 'SPIKED! DOWN A LEVEL' : 'DOWN A LEVEL', true, 1.4); }
      else if (knifed && k?.isPlayer) this.hud.banner(`SPIKED ${v.name.toUpperCase()}! THEY DROP A LEVEL`, true, 1.3);
    }
    if (k?.won && k.isPlayer) this.hud.banner('YOU WIN!', false, 2);
  }

  private onLevelUp(b: Babo) {
    const w = LADDER[b.tier];
    if (b.local && b.alive) { setWeapon(b, w); b.cool = 0.2; }
    if (b.isPlayer) { this.audio.play('levelup'); this.hud.banner(`LEVEL ${b.tier + 1}: ${WEAPONS[w].name.toUpperCase()}`, false, 1.2); }
    if (w === 'spikes') { this.hud.toast(`${this.nameOf(b)} ${b.isPlayer ? 'have' : 'has'} SPIKES. One pop to win!`); if (!b.isPlayer) this.audio.play('spikes'); }
  }

  /** Explosion visuals everywhere; damage only where the owner is simulated. */
  explode(x: number, z: number, owner: number, r: number, dmg: number, knock: number, authoritative: boolean, y = this.arena.floorAt(x, z)) {
    this.fx.explosion(x, z, r, y);
    if (y < 0.1) this.arena.scorch(x, z, r * 0.7);
    this.audio.play('boom', x, z);
    const pd = Math.hypot(this.player.x - x, this.player.z - z);
    if (!reducedMotion) this.r.addShake(Math.max(0, 0.7 - pd / 20));
    for (const n of this.nades) if (Math.hypot(n.x - x, n.z - z) < r * 0.6) n.fuse = Math.min(n.fuse, 0.08);
    const att = this.babos[owner];
    if (!authoritative || !att) return;
    for (const b of this.babos) {
      if (!b.alive) continue;
      const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
      if (d > r + BALL.radius) continue;
      if (Math.abs((b.y + 0.5) - (y + 0.5)) > r) continue;
      if (d > 0.3 && this.arena.raycast(x - (dx / d) * 0.05, z - (dz / d) * 0.05, b.x, b.z, Math.max(y, b.y) + 0.5, true) >= 0) continue;
      const k = Math.max(0, 1 - Math.max(0, d - BALL.radius) / r);
      const nx = d > 0.01 ? dx / d : Math.random() - 0.5, nz = d > 0.01 ? dz / d : Math.random() - 0.5;
      this.hit(att, b, dmg * Math.pow(k, 0.7) * (b.id === owner ? 0.45 : 1), nx * knock * k, nz * knock * k, 6 * k);
    }
  }

  // ---------- abilities ----------
  useAbility(b: Babo) {
    const def = ABILITIES[b.ability];
    if (b.abCool > 0 || !b.alive) return;
    b.abCool = def.cooldown; b.abT = def.dur; b.abCount++; b.spawnShield = 0;
    if (b.ability === 'dash') {
      let dx = b.moveX, dz = b.moveZ; let l = Math.hypot(dx, dz);
      if (l < 0.1) { dx = b.aimX; dz = b.aimZ; l = 1; }
      b.vx = (dx / l) * DASH.speed; b.vz = (dz / l) * DASH.speed;
    }
    if (b.ability === 'spikes') b.spikeHits.clear();
    this.abilityFx(b);
    if (b.ability === 'shockwave') {
      for (const v of this.babos) {
        if (v === b || !v.alive) continue;
        const dx = v.x - b.x, dz = v.z - b.z, d = Math.hypot(dx, dz);
        if (d > WAVE.radius + BALL.radius) continue;
        if (this.arena.raycast(b.x, b.z, v.x, v.z, b.y + 0.5, true) >= 0) continue;
        const k = 1 - Math.max(0, d - BALL.radius * 2) / WAVE.radius;
        this.hit(b, v, WAVE.damage * (0.5 + 0.5 * k), (dx / (d || 1)) * WAVE.knock * (0.5 + 0.5 * k), (dz / (d || 1)) * WAVE.knock * (0.5 + 0.5 * k), 4);
      }
    }
  }

  /** Effects only; also used when a remote ball's ability counter changes. */
  abilityFx(b: Babo) {
    if (b.ability === 'dash') {
      this.audio.play('dash', b.x, b.z);
      for (let i = 0; i < 8; i++) this.fx.puff(b.x, 0.3, b.z, 0.22, 0.35, (Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2, 1.2);
    } else if (b.ability === 'spikes') this.audio.play('spikes', b.x, b.z);
    else if (b.ability === 'bubble') this.audio.play('bubble', b.x, b.z);
    else {
      this.audio.play('wave', b.x, b.z);
      this.fx.ring(b.x, b.z, WAVE.radius, 0xbfe6ff, 0.35);
      this.fx.ring(b.x, b.z, WAVE.radius * 0.6, 0xffffff, 0.25);
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; this.fx.puff(b.x + Math.cos(a) * 0.8, 0.3, b.z + Math.sin(a) * 0.8, 0.25, 0.4, Math.cos(a) * 9, 0.4, Math.sin(a) * 9, 1.2); }
      if (b.isPlayer || Math.hypot(this.player.x - b.x, this.player.z - b.z) < 8) this.r.addShake(0.3);
    }
  }

  private stepAbility(b: Babo, dt: number) {
    b.abCool -= dt;
    const spikeWeapon = b.weapon === 'spikes';
    if (b.abT <= 0 && !spikeWeapon) return;
    if (b.abT > 0) b.abT -= dt;
    if (b.abT > 0 && b.ability === 'dash' && Math.random() < dt * 40) this.fx.glow(b.x, 0.4 + b.y, b.z, -b.vx * 0.1, 0.5, -b.vz * 0.1, 0.12, b.color, 0.25);
    if ((spikeWeapon || (b.abT > 0 && b.ability === 'spikes')) && b.local) {
      for (const v of this.babos) {
        if (v === b || !v.alive || !this.canDamage(b, v)) continue;
        // the ability hits each ball once per use; the Gun Game spikes can hit again after a moment
        if (spikeWeapon ? (b.spikeCd.get(v.id) ?? 0) > this.clock : b.spikeHits.has(v.id)) continue;
        const dx = v.x - b.x, dz = v.z - b.z, d = Math.hypot(dx, dz);
        if (d > BALL.radius * 2 + 0.32 || Math.abs(v.y - b.y) > 0.8) continue;
        if (spikeWeapon) b.spikeCd.set(v.id, this.clock + 0.6); else b.spikeHits.add(v.id);
        const nx = dx / (d || 1), nz = dz / (d || 1);
        this.hit(b, v, spikeWeapon ? 100 : SPIKES.damage, nx * SPIKES.knock, nz * SPIKES.knock, 3);
        b.vx -= nx * 4; b.vz -= nz * 4;
        this.audio.play('stab', v.x, v.z);
        for (let i = 0; i < 8; i++) this.fx.bit(v.x - nx * 0.4, 0.6 + v.y, v.z - nz * 0.4, nx * 6 + (Math.random() - 0.5) * 5, 2 + Math.random() * 4, nz * 6 + (Math.random() - 0.5) * 5, 0.07, v.color, 0.7);
      }
    }
  }

  // ---------- simulation ----------
  step(dt: number) {
    this.clock += dt;
    const live = this.state === 'playing';
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countT); this.countT -= dt; const after = Math.ceil(this.countT);
      if (after !== before && after > 0) { this.audio.play('count'); this.hud.banner(String(after), false, 0.7); }
      // guests wait for the host's go (with a safety margin if the message is late)
      if (this.countT <= 0 && (this.host || this.countT < -1.5)) this.go();
    }
    if (live && this.host) { this.matchT -= dt; if (this.matchT <= 0) { this.matchT = 0; this.end(); } }
    else if (live) this.matchT = Math.max(0, this.matchT - dt);

    const diff = DIFFICULTY[this.saved.difficulty];
    for (const b of this.babos) {
      if (!b.local) { this.stepRemote(b, dt); continue; }
      if (!b.alive) {
        if (this.state === 'playing' || this.state === 'countdown') { b.respawnT -= dt; if (b.respawnT <= 0) this.spawn(b); }
        continue;
      }
      b.cool -= dt; b.nadeCool -= dt; b.spawnShield = Math.max(0, b.spawnShield - dt);
      if (b.reloadT > 0) { b.reloadT -= dt; if (b.reloadT <= 0) { b.ammo = WEAPONS[b.weapon].clip; if (b.isPlayer) this.audio.play('reload'); } }
      if (b.hp > BALL.hp) b.hp = Math.max(BALL.hp, b.hp - dt * 3);
      if (this.state === 'countdown') { b.moveX = b.moveZ = 0; b.fire = false; b.wantAbility = false; }
      else if (b.isPlayer) this.input.apply(b);
      else if (this.state === 'playing') thinkBot(this, b, dt, diff);
      else { b.moveX = b.moveZ = 0; b.fire = false; b.wantAbility = false; }
      if (b.wantAbility && live) this.useAbility(b);
      b.wantAbility = false;
      if (!b.fire) b.semiLock = false;
      if (b.fire && live) this.fire(b);
      this.stepAbility(b, dt);
      this.physics(b, dt);
    }
    // ball vs ball: remote balls are immovable obstacles for the local ones
    for (let i = 0; i < this.babos.length; i++) for (let j = i + 1; j < this.babos.length; j++) {
      const a = this.babos[i], c = this.babos[j]; if (!a.alive || !c.alive || (!a.local && !c.local)) continue;
      const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz), min = BALL.radius * 2;
      if (d >= min || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, over = min - d;
      const wa = a.local ? (c.local ? 0.5 : 1) : 0, wc = c.local ? (a.local ? 0.5 : 1) : 0;
      a.x -= nx * over * wa; a.z -= nz * over * wa; c.x += nx * over * wc; c.z += nz * over * wc;
      const rel = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz;
      if (rel < 0) {
        const imp = -(1 + BALL.ballBounce) * rel;
        if (a.local) { a.vx -= nx * imp * wa; a.vz -= nz * imp * wa; }
        if (c.local) { c.vx += nx * imp * wc; c.vz += nz * imp * wc; }
        if (-rel > 4) this.audio.play('bonk', a.x, a.z, Math.min(1, -rel / 10));
      }
    }
    this.stepShots(dt);
    this.stepNades(dt);
    this.stepPickups(dt);
  }

  private go() {
    if (this.state !== 'countdown') return;
    this.state = 'playing'; this.audio.play('go'); this.hud.banner('ROLL!', false, 0.9);
  }

  /** Remote balls: fire cosmetic shots at their weapon's rate while their trigger is held. */
  private stepRemote(b: Babo, dt: number) {
    b.cool -= dt;
    if (b.abT > 0) b.abT -= dt;
    const kind = WEAPONS[b.weapon].kind;
    if (b.alive && b.netFire && !b.netReload && b.cool <= 0 && this.state === 'playing' && kind !== 'lob' && kind !== 'melee') {
      b.cool = 1 / WEAPONS[b.weapon].rate; this.spawnShots(b);
    }
    if (b.abT > 0 && b.ability === 'dash' && Math.random() < dt * 40) this.fx.glow(b.x, 0.4 + b.y, b.z, -b.vx * 0.1, 0.5, -b.vz * 0.1, 0.12, b.color, 0.25);
  }

  physics(b: Babo, dt: number) {
    const dashing = b.abT > 0 && b.ability === 'dash';
    const ml = Math.hypot(b.moveX, b.moveZ);
    const sp = Math.hypot(b.vx, b.vz);
    if (dashing) { /* keep the burst */ }
    else if (ml > 0.01) {
      const mx = b.moveX / Math.max(1, ml), mz = b.moveZ / Math.max(1, ml);
      const vmax = BALL.maxSpeed * (b.weapon === 'spikes' ? 1.15 : 1);   // the Gun Game finale is a bit quicker
      const tx = mx * vmax, tz = mz * vmax;
      let dx = tx - b.vx, dz = tz - b.vz; const dl = Math.hypot(dx, dz);
      const lim = BALL.accel * dt * (sp > BALL.maxSpeed * 1.1 ? 0.35 : 1);
      if (dl > lim) { dx *= lim / dl; dz *= lim / dl; }
      b.vx += dx; b.vz += dz;
    } else {
      const k = Math.exp(-BALL.coast * dt); b.vx *= k; b.vz *= k;
    }
    if (!dashing && sp > BALL.maxSpeed) { const k = Math.exp(-1.6 * dt); b.vx *= k; b.vz *= k; }
    b.x += b.vx * dt; b.z += b.vz * dt;
    const hit = this.arena.collide(b, BALL.radius, b.y);
    // follow the ground: roll up ramps, drop off ledges
    const gy = this.arena.floorAt(b.x, b.z); b.gy = gy;
    if (b.y < gy) { b.y = gy; if (b.vy < 0) b.vy = 0; }
    else if (b.y > gy || b.vy > 0) {
      b.vy -= 28 * dt; b.y += b.vy * dt;
      if (b.y <= gy) { if (b.vy < -6) this.audio.play('bounce', b.x, b.z, 0.5); b.y = gy; b.vy = b.vy < -5 ? -b.vy * 0.3 : 0; }
    }
    if (hit) {
      const vn = b.vx * hit.nx + b.vz * hit.nz;
      if (vn < 0) {
        b.vx -= (1 + BALL.wallBounce) * vn * hit.nx; b.vz -= (1 + BALL.wallBounce) * vn * hit.nz;
        if (vn < -5) { this.audio.play('bonk', b.x, b.z, Math.min(1, -vn / 14)); this.fx.puff(b.x - hit.nx * 0.5, 0.3, b.z - hit.nz * 0.5, 0.2, 0.4); }
      }
    }
  }

  stepShots(dt: number) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]; const w = WEAPONS[s.w];
      s.life -= dt;
      const nx = s.x + s.vx * dt, nz = s.z + s.vz * dt;
      // shots skim up onto raised floors (there's no vertical aim in a top-down game); walls still stop them
      let t = this.arena.raycast(s.x, s.z, nx, nz, s.y, false, CLIMB);
      let victim: Babo | null = null;
      const sdx = nx - s.x, sdz = nz - s.z, l2 = sdx * sdx + sdz * sdz;
      const shooter = this.babos[s.owner];
      for (const b of this.babos) {
        if (!b.alive || b.id === s.owner || (shooter && !this.canDamage(shooter, b))) continue;
        if (Math.abs(b.y + 0.5 - s.y) > 1.35) continue;   // shot passes over or under
        const fx = s.x - b.x, fz = s.z - b.z;
        const bq = fx * sdx + fz * sdz, c = fx * fx + fz * fz - (BALL.radius + 0.08) ** 2;
        let tt: number;
        if (c <= 0) tt = 0; else { const disc = bq * bq - l2 * c; if (disc < 0) continue; tt = (-bq - Math.sqrt(disc)) / l2; }
        if (tt < 0 || tt > 1) continue;
        if (t < 0 || tt < t) { t = tt; victim = b; }
      }
      const hx = t >= 0 ? s.x + sdx * t : nx, hz = t >= 0 ? s.z + sdz * t : nz;
      const l = Math.hypot(s.vx, s.vz);
      // bouncer: ricochet off walls a few times
      if (t >= 0 && !victim && s.bounces > 0 && s.life > 0) {
        const sx = Math.sign(s.vx) * 0.06, sz = Math.sign(s.vz) * 0.06;
        const hitX = this.arena.blocks(this.arena.cellOf(hx + sx), this.arena.cellOf(hz), s.y, CLIMB);
        const hitZ = this.arena.blocks(this.arena.cellOf(hx), this.arena.cellOf(hz + sz), s.y, CLIMB);
        if (hitX || !hitZ) s.vx = -s.vx;
        if (hitZ || !hitX) s.vz = -s.vz;
        s.x = hx - sx * 0.5; s.z = hz - sz * 0.5; s.bounces--;
        s.dist += Math.sqrt(l2) * t;
        this.audio.play('bounce', hx, hz, 0.5);
        this.fx.glow(hx, s.y, hz, 0, 1, 0, 0.12, w.color, 0.15);
        continue;
      }
      const ended = t >= 0 || s.life <= 0;
      if (w.kind === 'rocket') {
        s.trailT -= dt;
        if (s.trailT <= 0) { s.trailT = 0.03; this.fx.puff(s.x, s.y, s.z, 0.13, 0.32, 0, 0.6, 0, 1.3); this.fx.glow(s.x, s.y, s.z, 0, 0, 0, 0.14, 0xffa040, 0.08); }
        if (s.mesh) s.mesh.position.set(hx, s.y, hz);
        if (ended) {
          if (s.cosmetic) {
            // the owner's client decides where it blew up; wait briefly for that, else fizzle
            if (s.life > -0.4 && t >= 0) { s.vx = s.vz = 0; s.x = hx; s.z = hz; continue; }
            this.fx.puff(hx, s.y, hz, 0.3, 0.4);
          } else {
            const back = t >= 0 && !victim ? 0.15 : 0;
            const ex = hx - (s.vx / l) * back, ez = hz - (s.vz / l) * back;
            if (victim && shooter) this.hit(shooter, victim, w.damage, (s.vx / l) * w.knock, (s.vz / l) * w.knock);
            this.explode(ex, ez, s.owner, w.splash!.radius, w.splash!.damage, w.splash!.knock, true, s.y - 0.55);
            if (this.online) this.net.send({ k: 'boom', o: s.owner, x: r2(ex), z: r2(ez), r: w.splash!.radius, y: r2(s.y - 0.55) });
          }
          if (s.mesh) this.r.scene.remove(s.mesh);
          this.shots.splice(i, 1); continue;
        }
      } else if (ended) {
        if (victim) {
          if (!s.cosmetic && shooter) {
            const travelled = s.dist + Math.sqrt(l2) * t;
            const range = w.speed * w.life;
            const dmg = w.damage * (1 - (w.falloff ?? 0) * Math.min(1, travelled / range));
            this.hit(shooter, victim, dmg, (s.vx / l) * w.knock, (s.vz / l) * w.knock);
          }
          for (let k = 0; k < 3; k++) this.fx.bit(hx, s.y, hz, s.vx * 0.12 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, s.vz * 0.12 + (Math.random() - 0.5) * 4, 0.06, victim.color, 0.6);
          if (Math.random() < 0.25 && victim.gy < 0.1) this.arena.splat(hx + s.vx * 0.02, hz + s.vz * 0.02, 0.18 + Math.random() * 0.15, victim.color);
        } else if (t >= 0) {
          for (let k = 0; k < 2; k++) this.fx.glow(hx, s.y, hz, -s.vx * 0.08 + (Math.random() - 0.5) * 5, 1 + Math.random() * 3, -s.vz * 0.08 + (Math.random() - 0.5) * 5, 0.05, 0xfff2a0, 0.18, 14);
          if (Math.random() < 0.3) this.audio.play('wall', hx, hz, 0.6);
        }
        this.shots.splice(i, 1); continue;
      }
      s.dist += Math.sqrt(l2); s.x = nx; s.z = nz;
      { const fy = this.arena.floorAt(nx, nz) + 0.55; if (fy > s.y) s.y = fy; }
    }
  }

  stepNades(dt: number) {
    const A = this.arena;
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.fuse -= dt;
      n.vy -= G * dt;
      const ox = n.x, oz = n.z;
      n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt;
      const ci = A.cellOf(n.x), cj = A.cellOf(n.z);
      const top = A.top(ci, cj);
      if (top > 0.01) {
        if (n.y < top + 0.17) {
          const oi = A.cellOf(ox), oj = A.cellOf(oz);
          if (oi !== ci) n.vx *= -0.5; if (oj !== cj) n.vz *= -0.5;
          if (oi === ci && oj === cj) { n.vy = Math.abs(n.vy) * 0.4; n.y = top + 0.17; } else { n.x = ox; n.z = oz; }
          this.audio.play('bounce', n.x, n.z, 0.6);
        }
      }
      const ground = A.floorAt(n.x, n.z) + 0.17;
      if (n.y < ground) {
        n.y = ground;
        if (n.vy < -2) { n.vy = -n.vy * 0.42; this.audio.play('bounce', n.x, n.z, 0.6); } else n.vy = 0;
        n.vx *= 0.72; n.vz *= 0.72;
      }
      if (n.y <= ground + 0.01) { const k = Math.exp(-1.5 * dt); n.vx *= k; n.vz *= k; }
      n.mesh.position.set(n.x, n.y, n.z); n.mesh.rotation.x += n.vz * dt * 3; n.mesh.rotation.z -= n.vx * dt * 3;
      if (Math.random() < dt * 20) this.fx.glow(n.x, n.y + 0.2, n.z, 0, 0.5, 0, 0.05, n.fuse < 0.5 ? 0xff3030 : 0xffe070, 0.1);
      if (n.fuse <= 0) {
        this.r.scene.remove(n.mesh); this.nades.splice(i, 1);
        // grenade flight is deterministic, so every client explodes it in the same place;
        // only the thrower's client deals the damage
        this.explode(n.x, n.z, n.owner, GRENADE.radius, GRENADE.damage, GRENADE.knock, !n.cosmetic, n.y - 0.17);
      }
    }
  }

  stepPickups(dt: number) {
    this.pickups.forEach((p, idx) => {
      const item = p.mesh.userData.item as THREE.Object3D;
      if (p.t > 0) { p.t -= dt; item.visible = false; if (p.t <= 0) { this.fx.ring(p.x, p.z, 1, 0xffffff, 0.3); } return; }
      item.visible = true;
      item.rotation.y += dt * 2; item.position.y = 0.75 + Math.sin(this.clock * 3 + p.x) * 0.12;
      for (const b of this.babos) {
        if (!b.local || !b.alive || Math.hypot(b.x - p.x, b.z - p.z) > 0.95) continue;
        if (p.kind === 'health' && b.hp >= BALL.hp) continue;
        if (p.kind === 'nades' && b.nades >= GRENADE.max) continue;
        if (p.kind === 'health') b.hp = Math.min(BALL.hp, b.hp + 35);
        else if (p.kind === 'nades') b.nades = Math.min(GRENADE.max, b.nades + 2);
        else b.hp = Math.min(150, Math.max(b.hp, BALL.hp) + 50);
        this.takePickup(idx);
        if (this.online) this.net.send({ k: 'pick', i: idx });
        if (b.isPlayer) this.hud.toast(p.kind === 'health' ? '+35 health' : p.kind === 'nades' ? '+2 grenades' : 'MEGA HEALTH +50');
        break;
      }
    });
  }

  private takePickup(idx: number) {
    const p = this.pickups[idx]; if (!p || p.t > 0) return;
    p.t = RESPAWN[p.kind];
    this.audio.play(p.kind === 'nades' ? 'pickup' : 'heal', p.x, p.z);
    for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2; this.fx.glow(p.x, 0.8, p.z, Math.cos(a) * 2, 2 + Math.random() * 2, Math.sin(a) * 2, 0.07, p.kind === 'nades' ? 0x7dff9a : p.kind === 'mega' ? 0xffd84a : 0xff6a6a, 0.4, 3); }
  }

  // ---------- online ----------
  private wireNet() {
    const net = this.net;
    net.onEvent = (_from, e) => this.onNetEvent(e);
    net.onSnapshot = (from, s, _recv, offset) => this.onSnapshot(from, s, offset);
    net.onHost = (from, h) => this.onHostState(from, h);
    net.onLeft = peer => {
      if (this.online && peer === this.partner && (this.state === 'countdown' || this.state === 'playing')) {
        this.hud.toast('Your friend left the match'); this.end('Your friend left the match.');
      }
    };
    net.changed(() => { this.checkOffers(); this.hud.renderLobby(); });
  }

  /** Inside claude.ai the page can't open WebRTC connections, so online play lives on the hosted build. */
  get inArtifact() { return !!(window as any).claude?.use; }
  peerRoom: PeerRoom | WsRoom | DuoRoom | null = null;

  /** Relay if one is configured (works on any network); otherwise direct WebRTC. */
  private makeRoom(role: 'host' | 'guest', code: string) {
    const relay = (window as any).__RELAY ?? new URLSearchParams(location.search).get('relay') ?? RELAY_URL;
    const q = new URLSearchParams(location.search).get('transport');
    const mode = q === 'ws' || q === 'p2p' ? q : 'auto';
    return relay ? new DuoRoom(role, code, relay, mode) : new PeerRoom(role, code);
  }

  openLobby() {
    this.audio.unlock();
    this.state = 'lobby';
    this.hud.showLobby();
    if (this.inArtifact) { this.net.status = 'unavailable'; this.net.error = 'artifact'; this.hud.renderLobby(); return; }
    const code = (location.hash.match(/^#([a-z0-9]{6})$/) || [])[1];
    if (this.peerRoom) this.joinPresence();
    else if (code) this.joinInvite(code);
    this.hud.renderLobby();
  }

  private joinPresence() {
    this.net.set({ n: this.saved.nick || 'Player', c: this.saved.color, lob: 1, start: null, s: null, ev: null, h: null });
  }

  async createInvite(retry = 1) {
    this.peerRoom?.destroy();
    const room = this.makeRoom('host', newCode());
    this.peerRoom = room;
    await this.net.connect(room);
    this.joinPresence();
    room.onConnection(() => {}, e => {
      // someone else already holds this code: pick a fresh one
      if (e.code === 'unavailable-id' && retry > 0 && this.peerRoom === room) this.createInvite(retry - 1);
      this.hud.renderLobby();
    });
    this.hud.renderLobby();
  }

  async joinInvite(code: string) {
    this.peerRoom?.destroy();
    const room = this.makeRoom('guest', code);
    this.peerRoom = room;
    await this.net.connect(room);
    this.joinPresence();
    this.hud.renderLobby();
  }

  leaveLobby() {
    this.net.set({ lob: null, start: null, s: null, ev: null, h: null });
    this.peerRoom?.destroy(); this.peerRoom = null;
    this.net.reset();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    this.offer = null; this.online = false;
    this.state = 'menu';
  }

  setNick(n: string) { this.saved.nick = n.slice(0, 16); this.save(); this.net.set({ n: this.saved.nick || 'Player' }); }

  /** Host side: offer a match to the first friend in the lobby and start it here. */
  hostMatch(modeId: ModeId) {
    const friend = this.net.others()[0];
    if (!friend) { this.hud.toast('Waiting for your friend to open the page'); return; }
    const mode = MODES[modeId];
    const myC = this.saved.color % COLORS.length;
    let theirC = Number(friend.presence.c) % COLORS.length; if (!(theirC >= 0) || theirC === myC) theirC = (myC + 1) % COLORS.length;
    const roster: RosterEntry[] = [
      { id: 0, name: this.saved.nick || 'Player 1', color: COLORS[myC].hex, team: 0, human: true, peer: this.net.me },
      { id: 1, name: String(friend.presence.n || 'Friend').slice(0, 16), color: COLORS[theirC].hex, team: mode.teams ? 0 : 1, human: true, peer: friend.peer },
    ];
    const cols = COLORS.filter((_, i) => i !== myC && i !== theirC);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < mode.bots; i++) roster.push({ id: i + 2, name: names[i], color: cols[i % cols.length].hex, team: mode.teams ? 1 : i + 2, human: false });
    const offer: StartOffer = { e: (Math.random() * 1e9) | 0, mode: modeId, seed: (Math.random() * 1e9) | 0, guest: friend.peer, roster, diff: this.saved.difficulty, map: this.resolveMap(mode) };
    this.offer = offer; this.lastMode = modeId;
    this.net.clearMatch();
    this.net.set({ start: offer });
    this.online = true; this.host = true; this.partner = friend.peer; this.epoch = offer.e;
    this.begin(mode, offer.seed, roster, 0, offer.map as MapId);
  }

  /** Guest side: join when a friend's offer names us. Simultaneous offers: lower peer id hosts. */
  private checkOffers() {
    if (this.state === 'menu') return;
    for (const p of this.net.others()) {
      const o = p.presence.start as StartOffer | undefined;
      if (!o || o.guest !== this.net.me || o.e === this.epoch) continue;
      // both pressed start at once: the lower peer id hosts
      if (this.host && this.offer && this.offer.guest === p.peer && this.net.me < p.peer) continue;
      if (this.online && this.partner && this.partner !== p.peer && (this.state === 'countdown' || this.state === 'playing')) continue;
      this.offer = null;
      this.net.set({ start: null });
      this.net.clearMatch();
      this.online = true; this.host = false; this.partner = p.peer; this.epoch = o.e;
      this.lastMode = o.mode;
      this.begin(MODES[o.mode], o.seed, o.roster, 1, (o.map || 'random') as MapId);
      return;
    }
  }

  private onNetEvent(e: NetEvent) {
    if (!this.online || this.state === 'lobby' || this.state === 'menu') return;
    const b = (id: number) => this.babos[id];
    switch (e.k) {
      case 'hit': { const v = b(e.v); if (v && v.local) this.applyDamage(v, e.d, e.a, e.x, e.z, e.y); break; }
      case 'die': { const v = b(e.v); if (v && !v.local) this.onDeath(v, e.by); break; }
      case 'nade': if (b(e.o) && !b(e.o).local) this.addNade(e.o, e.x, e.y, e.z, e.vx, e.vy, e.vz, true); break;
      case 'boom': {
        if (b(e.o)?.local) break;
        let bi = -1, bd = 1e9;
        this.shots.forEach((s, i) => { if (s.owner === e.o && s.mesh) { const d = Math.hypot(s.x - e.x, s.z - e.z); if (d < bd) { bd = d; bi = i; } } });
        if (bi >= 0) { const s = this.shots[bi]; if (s.mesh) this.r.scene.remove(s.mesh); this.shots.splice(bi, 1); }
        this.explode(e.x, e.z, e.o, e.r, 0, 0, false, e.y ?? 0);
        break;
      }
      case 'pick': this.takePickup(e.i); break;
    }
  }

  private snapshot() {
    const ents: number[][] = [];
    for (const b of this.babos) {
      if (!b.local) continue;
      ents.push([b.id, Math.round(b.x * 100), Math.round(b.z * 100), Math.round(b.vx * 10), Math.round(b.vz * 10), Math.round(b.y * 100),
        Math.round(Math.atan2(b.aimZ, b.aimX) * 100), Math.max(0, Math.round(b.hp)), b.alive ? 1 : 0, WIDS.indexOf(b.weapon),
        b.fire && b.alive ? 1 : 0, b.reloadT > 0 || b.ammo <= 0 ? 1 : 0, AIDS.indexOf(b.ability), Math.round(Math.max(0, b.abT) * 100), b.abCount, b.spawnShield > 0 ? 1 : 0]);
    }
    return { t: Math.round(performance.now()), e: this.epoch, b: ents };
  }

  private onSnapshot(from: string, s: any, offset: number) {
    if (!this.online || s.e !== this.epoch || from !== this.partner) return;
    this.peerOffset.set(from, offset);
    for (const a of s.b as number[][]) {
      const b = this.babos[a[0]]; if (!b || b.local) continue;
      const alive = a[8] === 1;
      const sample = { t: s.t, x: a[1] / 100, z: a[2] / 100, vx: a[3] / 10, vz: a[4] / 10, y: a[5] / 100, aim: a[6] / 100 };
      if (alive && !b.alive) {
        // (re)spawned: snap there
        b.net = []; b.x = sample.x; b.z = sample.z; b.alive = true; b.root.visible = true; b.hp = a[7];
        if (this.state === 'playing') this.spawnFx(b);
      } else if (!alive && b.alive) { b.alive = false; b.root.visible = false; }
      if (b.net.length && s.t <= b.net[b.net.length - 1].t) continue;
      b.net.push(sample); if (b.net.length > 30) b.net.shift();
      b.hp = a[7];
      const w = WIDS[a[9]]; if (w && w !== b.weapon) setWeapon(b, w);
      b.netFire = a[10] === 1; b.netReload = a[11] === 1;
      const ab = AIDS[a[12]]; if (ab) b.ability = ab;
      b.abT = a[13] / 100; b.spawnShield = a[15] ? 0.5 : 0;
      if (a[14] !== b.abCount) { const first = b.abCount === 0 && a[14] > 1; b.abCount = a[14]; if (!first) this.abilityFx(b); }
    }
  }

  private onHostState(from: string, h: HostState) {
    if (!this.online || this.host || from !== this.partner || h.e !== this.epoch) return;
    this.matchT = h.t;
    h.k.forEach((k, i) => { if (this.babos[i]) this.babos[i].kills = k; });
    h.d.forEach((d, i) => { if (this.babos[i]) this.babos[i].deaths = d; });
    if (this.mode.gun && h.g) h.g.forEach((g, i) => {
      const b = this.babos[i]; if (!b) return;
      if (g === 99) { b.won = true; return; }
      const tier = Math.floor(g / 10); b.tierKills = g % 10;
      if (tier !== b.tier) { const up = tier > b.tier; b.tier = tier; if (b.local && b.alive) setWeapon(b, LADDER[tier]); if (up && b.isPlayer) this.onLevelUp(b); }
    });
    if (h.st === 'p' && this.state === 'countdown') this.go();
    if (h.st === 'o' && this.state !== 'over') this.end();
  }

  /** Place remote balls on their interpolated path, ~110 ms behind their clock. */
  private interpolateRemotes() {
    const now = performance.now();
    for (const b of this.babos) {
      if (b.local || !b.alive || !b.net.length) continue;
      const off = this.peerOffset.get(this.partner) ?? 0;
      const rt = now - off - INTERP_MS;
      const S = b.net;
      let x: number, z: number, vx: number, vz: number, y: number, aim: number;
      if (rt >= S[S.length - 1].t) {
        const l = S[S.length - 1], ex = Math.min(0.15, (rt - l.t) / 1000);
        x = l.x + l.vx * ex; z = l.z + l.vz * ex; vx = l.vx; vz = l.vz; y = l.y; aim = l.aim;
      } else if (rt <= S[0].t) { const f = S[0]; x = f.x; z = f.z; vx = f.vx; vz = f.vz; y = f.y; aim = f.aim; }
      else {
        let i = S.length - 2; while (i > 0 && S[i].t > rt) i--;
        const a = S[i], c = S[i + 1], k = (rt - a.t) / Math.max(1, c.t - a.t);
        x = a.x + (c.x - a.x) * k; z = a.z + (c.z - a.z) * k; vx = a.vx + (c.vx - a.vx) * k; vz = a.vz + (c.vz - a.vz) * k; y = a.y + (c.y - a.y) * k;
        let da = c.aim - a.aim; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; aim = a.aim + da * k;
      }
      b.x = x; b.z = z; b.vx = vx; b.vz = vz; b.gy = this.arena.floorAt(x, z); b.y = Math.max(b.gy, y); b.aimX = Math.cos(aim); b.aimZ = Math.sin(aim);
    }
  }

  private flushNet(force = false) {
    const h: HostState | null = this.host ? {
      e: this.epoch, st: this.state === 'countdown' ? 'c' : this.state === 'over' ? 'o' : 'p', t: Math.round(this.matchT * 10) / 10,
      k: this.babos.map(b => b.kills), d: this.babos.map(b => b.deaths),
      ...(this.mode.gun ? { g: this.babos.map(b => b.won ? 99 : b.tier * 10 + b.tierKills) } : {}),
    } : null;
    this.net.flush(this.snapshot(), h);
    void force;
  }

  /** Result screen: play the same mode again straight away (the friend's page follows the new offer). */
  rematch() {
    if (!this.online) { this.startSolo(); return; }
    if (!this.partnerHere) { this.hud.toast('Your friend left. Back to the lobby.'); this.backToLobby(); return; }
    for (const b of this.babos) b.root.visible = false;
    this.hostMatch(this.lastMode);
  }

  backToLobby() {
    this.net.set({ start: null, s: null, h: null, ev: null });
    this.offer = null; this.epoch = 0;
    for (const b of this.babos) b.root.visible = false;
    this.openLobby();
  }

  /** The friend dropped: keep the invite open so they can come back. */
  get partnerHere() { return this.net.others().some(p => p.peer === this.partner); }

  // ---------- frame ----------
  frame(now: number) {
    const real = (now - this.last) / 1000;
    const raw = Math.min(0.1, real); this.last = now;
    this.tick(raw);
    this.stats.frame(real, this.tSim, this.tRender, this.tHud);
    requestAnimationFrame(this.frame);
  }

  tick(raw: number, draw = true) {
    const t0 = performance.now();
    const inMatch = this.state === 'countdown' || this.state === 'playing' || this.state === 'over';
    // online matches keep running while the pause menu is open
    const simulate = inMatch && (!this.paused || this.online);
    if (simulate) {
      if (this.online) this.interpolateRemotes();
      this.acc += raw;
      const STEP = 1 / 120; let n = 0;
      while (this.acc >= STEP && n < 12) { this.step(STEP); this.acc -= STEP; n++; }
      if (n === 12) this.acc = 0;
      if (this.online) { this.netT -= raw; if (this.netT <= 0) { this.netT = 0.05; this.flushNet(); } }
    } else if (!inMatch) {
      this.clock += raw; this.menuCam();
    }
    const dt = simulate ? raw : 0;
    for (const b of this.babos) if (b.alive) updateBaboVisual(b, dt);
    this.fx.update(dt);
    this.drawTracers();
    if (!inMatch) for (const p of this.pickups) { const item = p.mesh.userData.item as THREE.Object3D; item.rotation.y += raw * 2; item.visible = true; }
    this.arena.flushPaint(this.r.renderer, raw);
    if (inMatch && this.player) {
      const p = this.player;
      this.input.aimWorld(this.aimPoint);
      this.r.follow(p.x, p.z, this.aimPoint.x, this.aimPoint.z, raw);
      this.audio.listener.x = p.x; this.audio.listener.z = p.z;
    }
    const t1 = performance.now();
    if (draw) this.r.render();
    const t2 = performance.now();
    this.hud.update(raw);
    const t3 = performance.now();
    this.tSim = t1 - t0; this.tRender = t2 - t1; this.tHud = t3 - t2;
    this.adaptQuality(raw);
  }

  private menuCam() {
    const a = this.clock * 0.08, r = this.arena.half * 1.3;
    this.r.camera.position.set(Math.cos(a) * r, 22, Math.sin(a) * r);
    this.r.camera.lookAt(0, 0, 0);
  }

  private drawTracers() {
    let n = 0;
    for (const sh of this.shots) {
      if (sh.mesh || n >= 400) continue;
      const w = WEAPONS[sh.w]; const sp = Math.hypot(sh.vx, sh.vz);
      const blob = w.kind === 'bounce';
      const len = blob ? 0.28 : Math.min(1.4, sp * 0.03);
      _q.setFromAxisAngle(_up, Math.atan2(sh.vx, sh.vz) + Math.PI);
      if (blob) _s.set(3.2, 3.2, len); else _s.set(1, 1, len);
      _p.set(sh.x, sh.y ?? 0.55, sh.z);
      _m.compose(_p, _q, _s); this.tracer.setMatrixAt(n, _m); this.tracer.setColorAt(n, _c.set(w.color).multiplyScalar(3)); n++;
    }
    this.tracer.count = n; this.tracer.instanceMatrix.needsUpdate = true; if (this.tracer.instanceColor) this.tracer.instanceColor.needsUpdate = true;
  }

  private adaptQuality(dt: number) {
    if (this.saved.quality !== 'auto' || this.state !== 'playing' || this.paused || document.hidden || dt > 0.2) return;
    const p = this.perf; p.t += dt; p.frames++;
    if (p.t < 4) return;
    const fps = p.frames / p.t; p.t = 0; p.frames = 0;
    if (fps < 45) {
      const order: Quality[] = ['ultra', 'high', 'medium', 'low'];
      const next = order[order.indexOf(this.r.quality) + 1] ?? null;
      if (next) { this.r.setQuality(next); this.hud.toast(`Running at ${Math.round(fps)} fps, switched to ${next} quality`); }
    }
  }

  setMuted(m: boolean) { this.saved.muted = m; this.audio.setMuted(m); this.save(); }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- pickups: one merged, vertex-coloured mesh each (was ~10 draw calls) ----------
function colored(geo: THREE.BufferGeometry, hex: number, x = 0, y = 0, z = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo; g.translate(x, y, z);
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const pickupGeoCache = new Map<PickKind, THREE.BufferGeometry>();
function pickupItemGeo(kind: PickKind) {
  const hit = pickupGeoCache.get(kind); if (hit) return hit;
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'health' || kind === 'mega') {
    const s = kind === 'mega' ? 1.35 : 1;
    parts.push(colored(new THREE.BoxGeometry(0.5 * s, 0.5 * s, 0.5 * s), kind === 'mega' ? 0xffd84a : 0xffffff));
    for (const [w, h] of [[0.12, 0.34], [0.34, 0.12]]) for (const zz of [1, -1]) {
      parts.push(colored(new THREE.BoxGeometry(w * s, h * s, 0.03), 0xff3b4e, 0, 0, zz * 0.255 * s));
      parts.push(colored(new THREE.BoxGeometry(0.03, h * s, w * s), 0xff3b4e, zz * 0.255 * s, 0, 0));
    }
  } else {
    for (const dx of [-0.17, 0.17]) {
      parts.push(colored(new THREE.SphereGeometry(0.18, 14, 10), 0x3b8f4a, dx, 0, 0));
      parts.push(colored(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), 0xcfd3dc, dx, 0.2, 0));
    }
  }
  const g = mergeGeometries(parts)!; pickupGeoCache.set(kind, g); return g;
}
const pickupMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 });
const megaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: 0xffa000, emissiveIntensity: 0.35 });
const baseGeo = new THREE.CylinderGeometry(0.62, 0.7, 0.08, 28);
const baseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
const ringGeo = new THREE.TorusGeometry(0.56, 0.05, 8, 32);
const ringMats: Record<PickKind, THREE.Material> = {
  health: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a5a).multiplyScalar(1.6), toneMapped: false }),
  nades: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3ee08f).multiplyScalar(1.6), toneMapped: false }),
  mega: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc83a).multiplyScalar(1.6), toneMapped: false }),
};

function pickupMesh(kind: PickKind) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(baseGeo, baseMat); base.position.y = 0.04; base.receiveShadow = true; g.add(base);
  const ring = new THREE.Mesh(ringGeo, ringMats[kind]); ring.rotation.x = Math.PI / 2; ring.position.y = 0.09; g.add(ring);
  const item = new THREE.Mesh(pickupItemGeo(kind), kind === 'mega' ? megaMat : pickupMat); item.castShadow = true;
  item.position.y = 0.75; g.add(item); g.userData.item = item;
  return g;
}
