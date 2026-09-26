import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CLIMB, Arena, CELL } from './arena';
import { Audio } from './audio';
import { Babo, buildGun, makeBabo, setBlobShadows, setBoss, setTeamRing, setWeapon, updateBaboVisual } from './babo';
import {
  ABILITIES, AbilityId, BALL, BOSS, BOT_NAMES, BURN, GRAV, MINE, GUN_RESPAWN, MAP_GUNS, START_WEAPON, COLORS, DASH, DIFFICULTY, Difficulty, GRENADE, LADDER, MapChoice, ArenaSize, ARENA_SIZES, MAPS, MODES, ModeDef, ModeId,
  PICKABLE, SPIKES, WAVE, WAVES, WEAPONS, WeaponId,
} from './config';
import type { MapId } from './arena';
import { Fx } from './fx';
import { Renderer, Quality } from './render';
import { Hud } from './hud';
import { Input } from './input';
import { thinkBot } from './bots';
import { Director, FfaDirector } from './director';
import { Stats } from './stats';
import { Net, NetEvent, RosterEntry, StartOffer, HostState } from './net';
import { PeerRoom, newCode } from './peerroom';
import { WsRoom } from './wsroom';
import { DuoRoom } from './duoroom';
import { RELAY_URL } from './config';

interface Shot { owner: number; x: number; y: number; z: number; vx: number; vz: number; life: number; dist: number; w: WeaponId; mesh?: THREE.Object3D; trailT: number; cosmetic: boolean; bounces: number }
interface Nade { owner: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; mesh: THREE.Mesh; cosmetic: boolean }
type PickKind = 'health' | 'nades' | 'mega';
interface Pickup { kind: PickKind | 'weapon'; x: number; z: number; t: number; mesh: THREE.Group; w?: WeaponId; drop?: string; ttl?: number }
interface Mine { owner: number; x: number; z: number; y: number; arm: number; life: number; mesh: THREE.Group; cosmetic: boolean }
interface Fire { owner: number; x: number; z: number; y: number; t: number }
interface Rail { owner: number; x0: number; z0: number; x1: number; z1: number; y: number; t: number; hit: Set<number> }

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
  soloMode: 'solo' | 'gungame' | 'waves'; map: MapChoice; arenaSize: ArenaSize; botCount: number; coopBots: number; ffaSkill?: number; bestWave?: number; music?: boolean; sfxVol: number; musicVol: number; records?: { streak?: number; dmg?: number; acc?: number }; v2?: boolean;
}
function load(): Saved {
  let s: Partial<Saved> = {};
  try { s = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { s = {}; }
  return {
    // v2: Adaptive became the default (once), since it's the one that suits Hold the Fort
    weapon: s.weapon ?? 'shotgun', ability: s.ability ?? 'dash', color: s.color ?? 0, difficulty: (s as any).v2 ? s.difficulty ?? 'adaptive' : 'adaptive',
    quality: s.quality ?? 'auto', muted: !!s.muted, best: s.best, perf: s.perf, nick: s.nick ?? '',
    soloMode: s.soloMode ?? 'solo', map: s.map && s.map in MAPS ? s.map : 'random', arenaSize: s.arenaSize ?? 'medium', botCount: s.botCount ?? 7, coopBots: s.coopBots ?? 5, bestWave: s.bestWave, music: s.music ?? true, sfxVol: s.sfxVol ?? 1, musicVol: s.musicVol ?? (s.music === false ? 0 : 0.8), v2: true,
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
  rails: Rail[] = [];
  mines: Mine[] = [];
  fires: Fire[] = [];
  private gravImp = new Map<string, { x: number; z: number }>();
  private gravSendT = 0;
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
  /** Hold the Fort state (the host runs it; guests mirror it from the host state). */
  wv = { n: 0, lives: 0, breakT: 0, queue: 0, total: 0, spawnT: 0, boss: -1, out: new Set<number>(), cleared: false };
  director = new Director();
  /** Your numbers this match, for the results screen. */
  ms = { shots: 0, hits: 0, dmg: 0, streak: 0, gunPops: {} as Record<string, number> };
  /** While you're dead the camera watches whoever popped you. */
  killCam = -1;
  ffa = new FfaDirector();
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
    this.r.onShadowMode = dyn => setBlobShadows(!dyn);
    this.fx = new Fx(this.r.scene);
    this.audio.setMuted(this.saved.muted);
    this.audio.setSfxVolume(this.saved.sfxVol); this.audio.music.setVolume(this.saved.musicVol);
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
    if (this.arena) { this.r.scene.remove(this.arena.group); this.arena.dispose(); }
    this.arena = new Arena(this.seed, size, map);
    this.r.scene.add(this.arena.group);
    this.r.bakeShadows();
    this.fx.floorAt = (x, z) => this.arena.floorAt(x, z);
    for (const p of this.pickups) this.r.scene.remove(p.mesh);
    this.pickups = this.arena.pickups.map((s, i) => {
      let kind: PickKind = this.arena.pickupKinds[i] ?? (i === this.arena.pickups.length - 1 ? 'mega' : Math.floor(i / 4) === 1 ? 'nades' : 'health');
      if (this.mode?.gun && kind === 'nades') kind = 'health';   // no spare grenades in Gun Game
      const mesh = pickupMesh(kind); mesh.position.set(s.x, this.arena.floorAt(s.x, s.z), s.z); this.r.scene.add(mesh);
      return { kind, x: s.x, z: s.z, t: 0, mesh } as Pickup;
    });
    if (!this.mode?.gun) this.placeGuns();
  }

  /** Guns lying around the arena: spread-out spots (same on both clients), power weapons nearest the middle. */
  private placeGuns() {
    const a = this.arena, want = a.n >= 28 ? 7 : 5;
    const taken = this.pickups.map(p => ({ x: p.x, z: p.z }));
    const cand = a.spawns.filter(s => taken.every(t => Math.hypot(t.x - s.x, t.z - s.z) > 2.5));
    if (!cand.length) return;
    const chosen: { x: number; z: number }[] = [];
    let first = cand[0]; for (const c of cand) if (Math.hypot(c.x, c.z) > 2 && Math.hypot(c.x, c.z) < Math.hypot(first.x, first.z)) first = c;
    chosen.push(first);
    while (chosen.length < want) {
      let best = cand[0], bd = -1;
      for (const c of cand) { const d = Math.min(...chosen.map(o => Math.hypot(o.x - c.x, o.z - c.z)), ...taken.map(o => Math.hypot(o.x - c.x, o.z - c.z) + 3)); if (d > bd) { bd = d; best = c; } }
      if (bd < 3) break; chosen.push(best);
    }
    chosen.sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
    chosen.forEach((s, i) => this.addGun(MAP_GUNS[i % MAP_GUNS.length], s.x, s.z));
  }

  private addGun(w: WeaponId, x: number, z: number, drop?: string) {
    const mesh = gunPickupMesh(w); mesh.position.set(x, this.arena.floorAt(x, z), z); this.r.scene.add(mesh);
    const p: Pickup = { kind: 'weapon', w, x, z, t: 0, mesh, drop, ttl: drop ? GUN_RESPAWN.dropLife : undefined };
    this.pickups.push(p);
    return p;
  }

  /** Which arena a mode plays on, given the player's map choice. */
  resolveMap(mode: ModeDef, choice: MapChoice = this.saved.map): MapId {
    if (mode.waves) return 'fort';   // Hold the Fort is built around the keep
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
    const roster: RosterEntry[] = [{ id: 0, name: 'You', color: COLORS[pc].hex, team: 0, human: true, sk: this.saved.ffaSkill }];
    const cols = COLORS.filter((_, i) => i !== pc);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const nBots = mode.waves ? mode.bots : this.saved.botCount;   // wave slots are fixed; the director decides how many come
    for (let i = 0; i < nBots; i++) roster.push({ id: i + 1, name: names[i % names.length], color: cols[i % cols.length].hex, team: mode.teams ? 1 : i + 1, human: false });
    this.begin(mode, (Math.random() * 1e9) | 0, roster, 0, this.resolveMap(mode), this.arenaN);
  }

  start() {
    if (this.online) { this.hud.toLobby(); return; }
    this.startSolo();
  }

  /** Cells across for a random arena, from the size picker. */
  get arenaN() { return ARENA_SIZES[this.saved.arenaSize]?.n ?? 28; }

  private begin(mode: ModeDef, seed: number, roster: RosterEntry[], myId: number, map: MapId = 'random', size = mode.size) {
    this.audio.unlock();
    for (const b of this.babos) this.r.scene.remove(b.root);
    for (const s of this.shots) if (s.mesh) this.r.scene.remove(s.mesh);
    for (const n of this.nades) this.r.scene.remove(n.mesh);
    for (const m of this.mines) this.r.scene.remove(m.mesh);
    this.babos = []; this.shots = []; this.nades = []; this.rails = []; this.mines = []; this.fires = [];
    this.mode = mode; this.seed = seed; this.endReason = ''; this.map = map;
    this.newArena(size, map);
    this.fx.clear();
    const rnd = mulberry(seed ^ 0x5bd1e995);
    for (const e of roster) {
      const me = e.id === myId;
      const w = mode.gun ? LADDER[0] : START_WEAPON; void rnd;
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
    const humans = this.babos.filter(b => b.human).length;
    this.wv = { n: 0, lives: humans > 1 ? WAVES.livesDuo : WAVES.lives, breakT: WAVES.firstBreak, queue: 0, total: 0, spawnT: 0, boss: -1, out: new Set(), cleared: false };
    this.director.reset(this.saved.difficulty);
    this.ms = { shots: 0, hits: 0, dmg: 0, streak: 0, gunPops: {} }; this.killCam = -1;
    // solo matches against bots (not Hold the Fort, which has its own director): size bots to you
    // matches with bots (not Hold the Fort, which has its own director): size the bots to each human.
    // The host runs it (bots live there); a guest mirrors the numbers from the host state.
    const hasBots = roster.some(e => !e.human) && !mode.waves;
    this.ffa.start(hasBots && this.host && this.saved.difficulty === 'adaptive',
      roster.filter(e => e.human).map(e => ({ id: e.id, skill: e.id === myId ? this.saved.ffaSkill : e.sk, local: e.id === myId })));
    for (const b of this.babos) {
      this.r.scene.add(b.root);
      // Hold the Fort: the bots wait off-stage until their wave
      if (b.local && !(mode.waves && !b.human)) this.spawn(b, true); else { b.alive = false; b.root.visible = false; b.respawnT = 1e9; }
    }
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
    if (this.mode.waves) {
      won = !this.saved.bestWave || this.wv.n > this.saved.bestWave;
      if (!this.online && won) { this.saved.bestWave = this.wv.n; this.save(); }
    } else if (this.mode.teams) { const ts = this.teamScores(); won = ts[this.player.team] >= Math.max(...Object.values(ts)); }
    else won = ranked[0] === this.player;
    const place = ranked.indexOf(this.player) + 1;
    if (!this.online && !this.mode.waves && (!this.saved.best || place < this.saved.best)) { this.saved.best = place; this.save(); }
    this.audio.play(won ? 'win' : 'lose');
    if (this.online && this.host) this.flushNet(true);
    this.hud.showResult(ranked, place, won);
  }

  teamScores() {
    const t: Record<number, number> = {};
    for (const b of this.babos) t[b.team] = (t[b.team] ?? 0) + b.kills;
    return t;
  }

  // ---------- Hold the Fort ----------
  private get humansN() { return this.babos.filter(b => b.human).length; }

  /** Host only: breaks between waves, trickling bots in, clearing waves, and the fort falling. */
  private stepWaves(dt: number) {
    const w = this.wv;
    if (w.breakT > 0) { w.breakT -= dt; if (w.breakT <= 0) this.startWave(w.n + 1); return; }
    // this runs 120 times a second: count in place rather than building lists
    const humans = this.humansList, dir = this.director;
    let alive = 0, slot: Babo | null = null;
    for (const b of this.babos) if (!b.human) { if (b.alive) alive++; else if (!slot) slot = b; }
    dir.watch(dt, humans);
    w.spawnT -= dt;
    if (w.queue > 0 && w.spawnT <= 0 && alive < dir.maxAlive(w.n, humans.length)) {
      if (slot) {
        const bossWave = w.n % BOSS.every === 0;
        const makeBoss = bossWave && w.boss < 0 && w.queue === w.total;
        if (makeBoss) { setBoss(slot, true); slot.maxHp = dir.bossHp(humans.length); w.boss = slot.id; } else if (slot.boss) setBoss(slot, false);
        this.spawn(slot); w.queue--; w.spawnT = dir.spawnGap();
        if (makeBoss) { this.hud.banner(`${slot.name.toUpperCase()} THE BIG ONE`, true, 1.8); this.audio.play('boss'); }
      }
    }
    if (w.queue <= 0 && alive === 0) {
      w.breakT = WAVES.breakT; w.cleared = true;
      w.lives = Math.min(WAVES.maxLives, w.lives + 1);
      dir.endWave(humans.reduce((s, b) => s + (b.alive ? Math.min(1, b.hp / BALL.hp) : 0), 0) / humans.length);
      this.onWaveCleared();
    }
    // everyone is down with no lives left
    let standing = false; for (const b of humans) if (b.alive || !w.out.has(b.id)) { standing = true; break; }
    if (!standing) this.end(`The fort fell on wave ${w.n}`);
  }

  /** The humans in this match (fixed once it starts). */
  private humansCache: Babo[] = []; private humansFor: Babo[] | null = null;
  private get humansList() { if (this.humansFor !== this.babos) { this.humansFor = this.babos; this.humansCache = this.babos.filter(b => b.human); } return this.humansCache; }

  private startWave(n: number) {
    const w = this.wv;
    w.n = n; w.cleared = false; w.boss = -1; w.spawnT = 0.5;
    w.queue = w.total = this.director.count(n, this.humansN) + (n % BOSS.every === 0 ? 1 : 0);
    this.director.startWave(this.humansN, w.total);
    w.out.clear();
    for (const b of this.babos) if (!b.human) b.respawnT = 1e9;
    this.onWaveStart();
  }

  /** Every client: top up the defenders and announce the wave. */
  private onWaveStart() {
    const n = this.wv.n;
    for (const b of this.babos) if (b.local && b.human && b.alive) { b.hp = Math.max(b.hp, BALL.hp); b.nades = Math.max(b.nades, GRENADE.start); }
    const boss = n % BOSS.every === 0;
    this.hud.banner(boss ? `WAVE ${n}: BOSS` : `WAVE ${n}`, false, 1.6);
    this.audio.play(boss ? 'boss' : 'go');
  }

  private onWaveCleared() {
    this.hud.banner(`WAVE ${this.wv.n} CLEARED`, true, 1.8);
    const tr = this.director.trend, ad = this.director.adaptive;
    this.hud.toast(`+1 life.${ad && tr > 0 ? ' Too easy? The next wave is tougher' : ad && tr < 0 ? ' The next wave eases off a little' : ' Healing up for the next wave'}`);
    this.audio.play('kill');
  }

  /** Host only: a defender's death costs a shared life, or sits them out until the next wave. */
  private waveDeath(v: Babo) {
    const w = this.wv;
    if (v.boss) {
      if (this.host) { w.boss = -1; w.lives = Math.min(WAVES.maxLives, w.lives + 1); }
      this.hud.banner('BOSS POPPED! +1 LIFE', false, 1.6); this.r.addShake(0.6);
      this.explode(v.x, v.z, v.id, 3.5, 0, 0, false, v.gy);
    }
    if (!this.host) return;
    if (!v.human) { this.director.botPopped(); return; }
    this.director.lifeLost();
    if (w.lives > 0) w.lives--;
    else { w.out.add(v.id); if (v.isPlayer) this.hud.toast('No lives left. You are back next wave'); }
  }

  /** Remember my adaptive rating for next time. */
  private saveFfa() {
    const s = this.ffa.skillOf(this.player.id); if (s === undefined) return;
    this.saved.ffaSkill = Math.round(s * 100) / 100; this.save();
  }

  /** Bots sharpen up as the waves go on, and to match the defenders. */
  private waveDiff() { return this.director.aim(this.wv.n); }

  /** Co-op: the defender who's carrying draws more of the fire. */
  get waveLeader(): number {
    // called for every bot's every target check: no sorting or lists, just the top two scores
    let a: Babo | null = null, b: Babo | null = null;
    const sc = (x: Babo) => x.kills - x.deaths * 2;
    for (const h of this.humansList) {
      if (!h.alive) continue;
      if (!a || sc(h) > sc(a)) { b = a; a = h; } else if (!b || sc(h) > sc(b)) b = h;
    }
    return a && b && sc(a) - sc(b) >= 4 ? a.id : -1;
  }

  private checkLimit() {
    if (!this.host || this.state !== 'playing') return;
    if (this.mode.waves) return;
    if (this.mode.gun) { if (this.babos.some(b => b.won)) setTimeout(() => { if (this.state === 'playing') this.end(); }, 900); return; }
    const hit = this.mode.teams ? Object.values(this.teamScores()).some(v => v >= this.mode.limit) : this.babos.some(b => b.kills >= this.mode.limit);
    if (hit) setTimeout(() => { if (this.state === 'playing') this.end(); }, 900);
  }

  spawn(b: Babo, initial = false) {
    // co-op on a hand-made map: the humans start and respawn inside their base
    const home = this.arena.homeSpawns;
    const pool = this.mode.teams && b.human && this.map !== 'random' && home.length ? home
      : this.mode.waves && !b.human && home.length ? this.arena.spawns.filter(s => !home.includes(s))
      : this.arena.spawns;
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
    } else if (!b.human && this.mode.waves) {
      const pool = this.director.guns(this.wv.n);
      setWeapon(b, b.boss ? 'rocket' : pool[(Math.random() * pool.length) | 0]);
      b.reserve = -1;   // wave bots bring their own ammo
      b.ability = b.boss ? 'shockwave' : AIDS[(Math.random() * AIDS.length) | 0];
    } else if (!b.human) { setWeapon(b, START_WEAPON); b.ability = AIDS[(Math.random() * AIDS.length) | 0]; }
    else if (b.isPlayer) {
      setWeapon(b, START_WEAPON);
      if (b.ability !== this.pendingAbility) { b.ability = this.pendingAbility; b.abCool = 0; }
    }
    b.x = best.x; b.z = best.z; b.vx = b.vz = 0; b.y = b.gy = this.arena.floorAt(best.x, best.z); b.vy = 0;
    if (b === this.player) this.killCam = -1;
    b.hp = b.maxHp; b.alive = true; b.root.visible = true; b.nades = this.mode.gun ? 0 : GRENADE.start; b.cool = 0.3; b.streak = 0; b.abT = 0;
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
    if (w.kind === 'melee' || w.kind === 'grav') return;
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
    if (b === this.player) this.ms.shots += w.kind === 'rail' ? 1 : w.pellets;
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
    this.fx.flash(fx, 0.9 + b.y, fz, w.color, w.pellets > 1 ? 14 : w.kind === 'rocket' ? 10 : w.kind === 'flame' ? 3 : 5, 0.07);
    const n = w.pellets > 1 ? 7 : w.kind === 'flame' ? 0 : 3;
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
    this.fx.beam(x0, y, z0, ex, ez, w.color, w.linger ? w.linger.t : 0.35);
    for (let k = 0; k < 4; k++) this.fx.glow(ex, y, ez, (Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6, 0.07, w.color, 0.3, 10);
    if (!b.local) return;
    const sdx = ex - x0, sdz = ez - z0, l2 = sdx * sdx + sdz * sdz || 1;
    const hitSet = new Set<number>();
    if (w.linger) this.rails.push({ owner: b.id, x0, z0, x1: ex, z1: ez, y, t: w.linger.t, hit: hitSet });
    for (const v of this.babos) {
      if (v === b || !v.alive || !this.canDamage(b, v)) continue;
      const u = ((v.x - x0) * sdx + (v.z - z0) * sdz) / l2; if (u < 0 || u > 1) continue;
      const px = x0 + sdx * u, pz = z0 + sdz * u;
      if (Math.hypot(v.x - px, v.z - pz) > v.rad + 0.1) continue;
      if (b === this.player && !hitSet.size) this.ms.hits++;
      this.hit(b, v, w.damage, b.aimX * w.knock, b.aimZ * w.knock, 2); hitSet.add(v.id);
      for (let k = 0; k < 6; k++) this.fx.bit(v.x, v.y + 0.5, v.z, b.aimX * 6 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, b.aimZ * 6 + (Math.random() - 0.5) * 4, 0.07, v.color, 0.7);
    }
  }

  // ---------- gravity gun ----------
  /** Hold: drag balls in the cone towards a point in front of the gun. Release: fling whatever is close. */
  private stepGrav(b: Babo, dt: number) {
    const w = WEAPONS.gravity;
    if (b.fire && b.cool <= 0 && b.gravT < GRAV.maxHold) {
      if (b.gravT === 0) this.audio.play('gravity', b.x, b.z);
      b.gravT += dt; b.spawnShield = 0;
      const hx = b.x + b.aimX * GRAV.hold, hz = b.z + b.aimZ * GRAV.hold;
      for (const v of this.babos) {
        if (v === b || !v.alive || !this.canDamage(b, v) || Math.abs(v.y - b.y) > 1.3) continue;
        const dx = v.x - b.x, dz = v.z - b.z, d = Math.hypot(dx, dz);
        if (d > w.range! || d < 0.01) continue;
        if ((dx * b.aimX + dz * b.aimZ) / d < Math.cos(0.5) && d > 2.2) continue;
        if (this.arena.raycast(b.x, b.z, v.x, v.z, b.y + 0.55, true, CLIMB) >= 0) continue;
        const px = hx - v.x, pz = hz - v.z, pd = Math.hypot(px, pz) || 1;
        const k = GRAV.pull * Math.min(1, Math.max(0.2, pd / 1.5)) * dt * (v.boss ? 0.35 : 1);
        let ix = (px / pd) * k, iz = (pz / pd) * k;
        if (v.local) { v.vx += ix; v.vz += iz; v.vx *= Math.exp(-2.5 * dt); v.vz *= Math.exp(-2.5 * dt); }
        else {
          // remote balls: batch the pull into a few small shoves a second
          const key = `${b.id}:${v.id}`, acc = this.gravImp.get(key) ?? { x: 0, z: 0 };
          acc.x += ix; acc.z += iz; this.gravImp.set(key, acc);
        }
        if (Math.random() < dt * 30) this.fx.glow(v.x, v.y + 0.5, v.z, px * 0.5, 0.3, pz * 0.5, 0.07, w.color, 0.25, 0);
        void ix; void iz;
      }
      this.gravFx(b, dt);
      return;
    }
    if (b.gravT > 0) {
      // let go (or held too long): fling
      b.gravT = 0; b.cool = 1 / w.rate;
      for (const v of this.babos) {
        if (v === b || !v.alive || !this.canDamage(b, v) || Math.abs(v.y - b.y) > 1.3) continue;
        const dx = v.x - b.x, dz = v.z - b.z, d = Math.hypot(dx, dz);
        if (d > GRAV.flingR || (d > 1.2 && (dx * b.aimX + dz * b.aimZ) / d < 0.3)) continue;
        this.hit(b, v, w.damage, b.aimX * w.knock, b.aimZ * w.knock, 5, 2);
      }
      b.vx -= b.aimX * w.recoil; b.vz -= b.aimZ * w.recoil;
      this.flingFx(b);
    }
  }

  /** Send the batched gravity-gun pull on remote balls (20 times a second). */
  private flushGrav(dt: number) {
    this.gravSendT -= dt; if (this.gravSendT > 0 || !this.gravImp.size) return;
    this.gravSendT = 0.05;
    for (const [key, acc] of this.gravImp) {
      const [a, v] = key.split(':').map(Number);
      const att = this.babos[a], vic = this.babos[v];
      if (att && vic) this.hit(att, vic, 0, acc.x, acc.z, 0);
    }
    this.gravImp.clear();
  }

  gravFx(b: Babo, dt: number) {
    const w = WEAPONS.gravity;
    const mx = b.x + b.aimX * 0.8, mz = b.z + b.aimZ * 0.8, hx = b.x + b.aimX * GRAV.hold, hz = b.z + b.aimZ * GRAV.hold;
    if (Math.random() < dt * 50) {
      const t = Math.random(), sw = Math.sin(this.clock * 20 + t * 9) * 0.25;
      this.fx.glow(mx + (hx - mx) * t - b.aimZ * sw, b.y + 0.55, mz + (hz - mz) * t + b.aimX * sw, -b.aimX * 2, 0, -b.aimZ * 2, 0.06 + Math.random() * 0.05, w.color, 0.2, 0);
    }
    if (Math.random() < dt * 25) {
      const a = Math.random() * Math.PI * 2, r = 1.2;
      this.fx.glow(hx + Math.cos(a) * r, b.y + 0.55, hz + Math.sin(a) * r, -Math.cos(a) * 5, 0, -Math.sin(a) * 5, 0.05, 0xd4f4ff, 0.22, 0);
    }
  }

  flingFx(b: Babo) {
    const w = WEAPONS.gravity;
    this.audio.play('fling', b.x, b.z);
    const fx = b.x + b.aimX * 1.6, fz = b.z + b.aimZ * 1.6;
    this.fx.ring(fx, fz, GRAV.flingR, w.color, 0.25, b.gy);
    this.fx.flash(fx, b.y + 0.6, fz, w.color, 20, 0.15);
    for (let i = 0; i < 14; i++) { const a = Math.atan2(b.aimZ, b.aimX) + (Math.random() - 0.5) * 1.2, s = 6 + Math.random() * 8; this.fx.glow(fx, b.y + 0.55, fz, Math.cos(a) * s, 0.5, Math.sin(a) * s, 0.07, w.color, 0.3, 0); }
    b.recoilZ = 0.3;
  }

  // ---------- fire ----------
  /** Burning balls and flames on the floor. The attacker's owner deals the damage. */
  private stepBurn(dt: number) {
    for (const v of this.babos) {
      if (v.burnT <= 0 || !v.alive) continue;
      const before = v.burnT; v.burnT -= dt;
      if (Math.random() < dt * 30) this.fx.glow(v.x + (Math.random() - 0.5) * 0.6, v.y + 0.5 + Math.random() * 0.4, v.z + (Math.random() - 0.5) * 0.6, 0, 1.6, 0, 0.1 + Math.random() * 0.12, Math.random() < 0.5 ? 0xff8a2a : 0xffd35a, 0.3, 0);
      const att = this.babos[v.burnBy];
      // a quarter-second tick of afterburn
      if (att?.local && Math.floor(before * 4) !== Math.floor(Math.max(0, v.burnT) * 4)) this.hit(att, v, BURN.dps / 4, 0, 0, 0);
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i]; f.t -= dt;
      if (f.t <= 0) { this.fires.splice(i, 1); continue; }
      if (Math.random() < dt * 14) this.fx.glow(f.x + (Math.random() - 0.5) * 0.9, f.y + 0.15, f.z + (Math.random() - 0.5) * 0.9, 0, 1.4 + Math.random(), 0, 0.12 + Math.random() * 0.12, Math.random() < 0.5 ? 0xff7a2a : 0xffc94a, 0.35, 0);
      const att = this.babos[f.owner]; if (!att?.local) continue;
      const tick = Math.floor((f.t + dt) * 4) !== Math.floor(f.t * 4);   // four times a second
      for (const v of this.babos) {
        if (v === att || !v.alive || !this.canDamage(att, v)) continue;
        if (Math.hypot(v.x - f.x, v.z - f.z) > BURN.patchR || Math.abs(v.y - f.y) > 0.6) continue;
        // standing in the fire hurts on top of the afterburn
        if (tick) this.hit(att, v, BURN.patchDps / 4, 0, 0, 0, v.burnT > BURN.t - 0.4 ? 0 : 1);
      }
    }
  }

  // ---------- mines ----------
  private addMine(b: Babo) {
    const own = this.mines.filter(m => m.owner === b.id);
    if (own.length >= MINE.max) this.removeMine(own[0], true);
    const x = b.x - b.aimX * 0.2, z = b.z - b.aimZ * 0.2, y = this.arena.floorAt(x, z);
    const mesh = mineMesh(b.color); mesh.position.set(x, y, z); this.r.scene.add(mesh);
    this.mines.push({ owner: b.id, x, z, y, arm: MINE.arm, life: MINE.life, mesh, cosmetic: !b.local });
    this.audio.play('mine', x, z);
  }

  private removeMine(m: Mine, fizzle = false) {
    const i = this.mines.indexOf(m); if (i < 0) return;
    this.r.scene.remove(m.mesh); this.mines.splice(i, 1);
    if (fizzle) this.fx.puff(m.x, m.y + 0.2, m.z, 0.3, 0.5);
  }

  private removeMineNear(owner: number, x: number, z: number) {
    let best: Mine | null = null, bd = 3;
    for (const m of this.mines) if (m.owner === owner) { const d = Math.hypot(m.x - x, m.z - z); if (d < bd) { bd = d; best = m; } }
    if (best) this.removeMine(best);
  }

  private stepMines(dt: number) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.arm -= dt; m.life -= dt;
      const light = m.mesh.userData.light as THREE.Mesh;
      light.visible = m.arm > 0 ? Math.sin(this.clock * 30) > 0 : Math.sin(this.clock * 6) > 0.6;
      if (m.life <= 0) { this.removeMine(m, true); continue; }
      if (m.cosmetic || m.arm > 0) continue;
      const att = this.babos[m.owner]; if (!att) continue;
      const trip = this.babos.some(v => v !== att && v.alive && this.canDamage(att, v) && Math.abs(v.y - m.y) < 1 && Math.hypot(v.x - m.x, v.z - m.z) < MINE.trigger + v.rad - BALL.radius);
      if (!trip) continue;
      this.removeMine(m);
      this.explode(m.x, m.z, m.owner, MINE.radius, MINE.damage, MINE.knock, true, m.y);
      if (this.online) this.net.send({ k: 'boom', o: m.owner, x: r2(m.x), z: r2(m.z), r: MINE.radius, y: r2(m.y), m: 1 });
    }
  }

  /** Lingering railgun beams: anyone rolling into one takes a smaller hit (once per beam). Owner decides. */
  private stepRails(dt: number) {
    for (let i = this.rails.length - 1; i >= 0; i--) {
      const r = this.rails[i]; r.t -= dt;
      if (r.t <= 0) { this.rails.splice(i, 1); continue; }
      const att = this.babos[r.owner]; if (!att || !att.local) continue;
      const sdx = r.x1 - r.x0, sdz = r.z1 - r.z0, l2 = sdx * sdx + sdz * sdz || 1;
      for (const v of this.babos) {
        if (v === att || !v.alive || r.hit.has(v.id) || !this.canDamage(att, v)) continue;
        if (Math.abs(v.y + 0.55 - r.y) > 1.35) continue;
        const u = ((v.x - r.x0) * sdx + (v.z - r.z0) * sdz) / l2; if (u < 0 || u > 1) continue;
        if (Math.hypot(v.x - (r.x0 + sdx * u), v.z - (r.z0 + sdz * u)) > v.rad + 0.05) continue;
        r.hit.add(v.id);
        const l = Math.sqrt(l2), lw = WEAPONS.railgun.linger!;
        this.hit(att, v, lw.damage, (sdx / l) * 3, (sdz / l) * 3, 1);
        this.fx.flash(v.x, v.y + 0.6, v.z, WEAPONS.railgun.color, 8, 0.12);
        this.audio.play('stab', v.x, v.z, 0.6);
      }
    }
  }

  reload(b: Babo) {
    const w = WEAPONS[b.weapon];
    if (b.reloadT > 0 || b.ammo >= w.clip) return;
    if (b.reserve === 0) {
      if (b.ammo > 0) return;
      // power weapon run dry: back to the pistol
      if (b.isPlayer) this.hud.toast(`Out of ${w.name.toLowerCase()}`);
      setWeapon(b, START_WEAPON); b.cool = 0.3; return;
    }
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
  /** flag: 1 sets them alight (flamethrower), 2 marks them as flung (gravity gun wall slams). */
  hit(att: Babo, v: Babo, dmg: number, kx: number, kz: number, vy = 0, flag = 0) {
    if (!att.local || !v.alive || !this.canDamage(att, v)) return;
    if (this.mode.waves && !att.human && v.human) dmg *= this.director.botDamage(this.wv.n);
    if (att === this.player && v !== att && v.spawnShield <= 0) this.ms.dmg += dmg * (v.abT > 0 && v.ability === 'bubble' ? 0.3 : 1);
    if (this.ffa.has(v.id) && !att.human) { dmg *= this.ffa.damage(v.id); if (v.spawnShield <= 0) this.ffa.tookDamage(v.id, dmg); }
    if (this.ffa.has(att.id) && v !== att && v.spawnShield <= 0 && !v.human) this.ffa.dealtDamage(att.id, dmg);
    if (flag & 1) { v.burnT = BURN.t; v.burnBy = att.id; }
    if (flag & 2) { v.flungT = 1; v.flungBy = att.id; }
    if (att.isPlayer && v !== att && v.spawnShield <= 0 && dmg >= 1) { this.hud.floater(v.x, v.z, Math.round(dmg * (v.abT > 0 && v.ability === 'bubble' ? 0.3 : 1))); this.audio.play('hit', undefined, undefined, 0.8); }
    if (v.local) this.applyDamage(v, dmg, att.id, kx, kz, vy, flag);
    else {
      v.hurtT = 0.12;
      this.net.send({ k: 'hit', v: v.id, a: att.id, d: r2(dmg), x: r2(kx), z: r2(kz), y: r2(vy), ...(flag ? { f: flag } : {}) });
    }
  }

  applyDamage(v: Babo, dmg: number, by: number, kx: number, kz: number, vy = 0, flag = 0) {
    if (!v.alive) return;
    if (flag & 1) { v.burnT = BURN.t; v.burnBy = by; }
    if (flag & 2) { v.flungT = 1; v.flungBy = by; }
    if (v.abT > 0 && v.ability === 'bubble') { dmg *= 0.3; kx *= 0.3; kz *= 0.3; vy *= 0.3; }
    if (v.abT > 0 && v.ability === 'dash') { kx = kz = vy = 0; }
    if (v.boss) { kx *= BOSS.knock; kz *= BOSS.knock; vy *= BOSS.knock; }
    v.vx += kx; v.vz += kz; v.vy += vy;
    if (v.spawnShield > 0) return;
    v.hp -= dmg; if (dmg >= 1) v.hurtT = 0.12;
    if (by !== v.id) { v.lastHitBy = by; v.lastHitT = this.clock; }
    if (v.isPlayer && by >= 0 && by !== v.id && dmg >= 1 && this.babos[by]) this.hud.damageFrom(this.babos[by]);
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
    v.alive = false; v.root.visible = false; v.deaths++; v.streak = 0; v.abT = 0; v.burnT = 0; v.flungT = 0; v.gravT = 0;
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
    if (this.mode.waves) this.waveDeath(v);
    if (this.ffa.active) {
      if (this.ffa.has(v.id)) this.ffa.died(v.id);
      else if (k && this.ffa.has(k.id)) this.ffa.popped(k.id, k.streak);
      this.saveFfa();
    }
    // drop the gun: anyone can grab it for a few seconds (runs on every client, so no message needed)
    if (!this.mode.gun && v.weapon !== START_WEAPON && WEAPONS[v.weapon].kind !== 'melee' && (this.state === 'playing')) {
      const drops = this.pickups.filter(p => p.drop);
      if (drops.length >= GUN_RESPAWN.maxDrops) this.removePickup(drops[0]);
      this.addGun(v.weapon, v.x, v.z, `${v.id}:${v.deaths}`);
    }
    if (k === this.player && k !== v) { this.ms.gunPops[k.weapon] = (this.ms.gunPops[k.weapon] ?? 0) + 1; this.ms.streak = Math.max(this.ms.streak, k.streak); }
    if (v === this.player) this.killCam = k && k !== v ? k.id : -1;
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
  explode(x: number, z: number, owner: number, r: number, dmg: number, knock: number, authoritative: boolean, y = this.arena.floorAt(x, z)): number {
    this.fx.explosion(x, z, r, y);
    if (y < 0.1) this.arena.scorch(x, z, r * 0.7);
    this.audio.play('boom', x, z);
    const pd = Math.hypot(this.player.x - x, this.player.z - z);
    if (!reducedMotion) this.r.addShake(Math.max(0, 0.7 - pd / 20));
    for (const n of this.nades) if (Math.hypot(n.x - x, n.z - z) < r * 0.6) n.fuse = Math.min(n.fuse, 0.08);
    const att = this.babos[owner];
    if (!authoritative || !att) return 0;
    let hits = 0;
    for (const b of this.babos) {
      if (!b.alive) continue;
      const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
      if (d > r + b.rad) continue;
      if (Math.abs((b.y + 0.5) - (y + 0.5)) > r) continue;
      if (d > 0.3 && this.arena.raycast(x - (dx / d) * 0.05, z - (dz / d) * 0.05, b.x, b.z, Math.max(y, b.y) + 0.5, true) >= 0) continue;
      const k = Math.max(0, 1 - Math.max(0, d - b.rad) / r);
      const nx = d > 0.01 ? dx / d : Math.random() - 0.5, nz = d > 0.01 ? dz / d : Math.random() - 0.5;
      if (b !== att && this.canDamage(att, b)) hits++;
      this.hit(att, b, dmg * Math.pow(k, 0.7) * (b.id === owner ? 0.45 : 1), nx * knock * k, nz * knock * k, 6 * k);
    }
    return hits;
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
        if (d > WAVE.radius + v.rad) continue;
        if (this.arena.raycast(b.x, b.z, v.x, v.z, b.y + 0.5, true) >= 0) continue;
        const k = 1 - Math.max(0, d - b.rad - v.rad) / WAVE.radius;
        this.hit(b, v, WAVE.damage * (0.5 + 0.5 * k), (dx / (d || 1)) * WAVE.knock * (0.5 + 0.5 * k), (dz / (d || 1)) * WAVE.knock * (0.5 + 0.5 * k), 4);
      }
    }
  }

  /** Effects only; also used when a remote ball's ability counter changes. */
  abilityFx(b: Babo) {
    if (b.ability === 'mine') { this.addMine(b); return; }
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
        if (d > b.rad + v.rad + 0.32 || Math.abs(v.y - b.y) > 0.8) continue;
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
    if (this.mode.waves) { if (live) this.matchT += dt; if (live && this.host) this.stepWaves(dt); }
    if (live) this.ffa.step(dt);
    else if (live && this.host) { this.matchT -= dt; if (this.matchT <= 0) { this.matchT = 0; this.end(); } }
    else if (live) this.matchT = Math.max(0, this.matchT - dt);

    const diff = this.mode.waves ? this.waveDiff() : DIFFICULTY[this.saved.difficulty];
    for (const b of this.babos) {
      if (!b.local) { this.stepRemote(b, dt); continue; }
      if (!b.alive) {
        if ((this.state === 'playing' || this.state === 'countdown') && !(this.mode.waves && (!b.human || this.wv.out.has(b.id)))) { b.respawnT -= dt; if (b.respawnT <= 0) this.spawn(b); }
        continue;
      }
      b.cool -= dt; b.nadeCool -= dt; b.spawnShield = Math.max(0, b.spawnShield - dt);
      if (b.reloadT > 0) {
        b.reloadT -= dt;
        if (b.reloadT <= 0) {
          const need = WEAPONS[b.weapon].clip - b.ammo, take = b.reserve < 0 ? need : Math.min(need, b.reserve);
          b.ammo += take; if (b.reserve > 0) b.reserve -= take;
          if (b.isPlayer) this.audio.play('reload');
        }
      }
      if (b.hp > b.maxHp) b.hp = Math.max(b.maxHp, b.hp - dt * 3);
      if (this.state === 'countdown') { b.moveX = b.moveZ = 0; b.fire = false; b.wantAbility = false; }
      else if (b.isPlayer) this.input.apply(b);
      else if (this.state === 'playing') thinkBot(this, b, dt, diff);
      else { b.moveX = b.moveZ = 0; b.fire = false; b.wantAbility = false; }
      if (b.wantAbility && live) this.useAbility(b);
      b.wantAbility = false;
      if (!b.fire) b.semiLock = false;
      if (b.fire && live) this.fire(b);
      if (live && WEAPONS[b.weapon].kind === 'grav') this.stepGrav(b, dt);
      b.flungT = Math.max(0, b.flungT - dt);
      this.stepAbility(b, dt);
      this.physics(b, dt);
    }
    // ball vs ball: remote balls are immovable obstacles for the local ones
    for (let i = 0; i < this.babos.length; i++) for (let j = i + 1; j < this.babos.length; j++) {
      const a = this.babos[i], c = this.babos[j]; if (!a.alive || !c.alive || (!a.local && !c.local)) continue;
      const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz), min = a.rad + c.rad;
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
    this.stepRails(dt);
    this.stepBurn(dt);
    this.stepMines(dt);
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
    if (kind === 'grav' && b.alive) {
      if (b.netFire) { b.gravT += dt; this.gravFx(b, dt); }
      else if (b.gravT > 0) { this.flingFx(b); b.gravT = 0; }
    }
    if (b.alive && b.netFire && !b.netReload && b.cool <= 0 && this.state === 'playing' && kind !== 'lob' && kind !== 'melee' && kind !== 'grav') {
      b.cool = 1 / WEAPONS[b.weapon].rate; this.spawnShots(b);
    }
    if (b.abT > 0 && b.ability === 'dash' && Math.random() < dt * 40) this.fx.glow(b.x, 0.4 + b.y, b.z, -b.vx * 0.1, 0.5, -b.vz * 0.1, 0.12, b.color, 0.25);
  }

  physics(b: Babo, dt: number) {
    const dashing = b.abT > 0 && b.ability === 'dash';
    const ml = Math.hypot(b.moveX, b.moveZ);
    const sp = Math.hypot(b.vx, b.vz);
    const flung = b.flungT > 0.45;   // just flung by a gravity gun: no steering, barely any friction
    if (dashing) { /* keep the burst */ }
    else if (flung) { const k = Math.exp(-0.7 * dt); b.vx *= k; b.vz *= k; }
    else if (ml > 0.01) {
      const mx = b.moveX / Math.max(1, ml), mz = b.moveZ / Math.max(1, ml);
      const vmax = BALL.maxSpeed * (b.weapon === 'spikes' ? 1.15 : 1) * (b.boss ? BOSS.speed : 1);   // the Gun Game finale is a bit quicker
      const tx = mx * vmax, tz = mz * vmax;
      let dx = tx - b.vx, dz = tz - b.vz; const dl = Math.hypot(dx, dz);
      const lim = BALL.accel * dt * (sp > BALL.maxSpeed * 1.1 ? 0.35 : 1);
      if (dl > lim) { dx *= lim / dl; dz *= lim / dl; }
      b.vx += dx; b.vz += dz;
    } else {
      const k = Math.exp(-BALL.coast * dt); b.vx *= k; b.vz *= k;
    }
    if (!dashing && !flung && sp > BALL.maxSpeed) { const k = Math.exp(-1.6 * dt); b.vx *= k; b.vz *= k; }
    b.x += b.vx * dt; b.z += b.vz * dt;
    const hit = this.arena.collide(b, b.rad, b.y);
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
        // flung into a wall by a gravity gun: that hurts
        if (b.flungT > 0 && -vn > GRAV.slamSpeed && b.local) {
          const dmg = Math.min(GRAV.slamMax, 10 + (-vn - GRAV.slamSpeed) * GRAV.slamDmg);
          b.flungT = 0;
          this.fx.flash(b.x - hit.nx * 0.5, b.y + 0.5, b.z - hit.nz * 0.5, 0xffffff, 14, 0.15);
          for (let i = 0; i < 8; i++) this.fx.puff(b.x - hit.nx * 0.5, 0.4 + b.y, b.z - hit.nz * 0.5, 0.25, 0.5, hit.nx * 3 + (Math.random() - 0.5) * 3, 1, hit.nz * 3 + (Math.random() - 0.5) * 3, 1);
          this.r.addShake(b.isPlayer ? 0.5 : 0.15); this.audio.play('slam', b.x, b.z);
          this.applyDamage(b, dmg, b.flungBy, 0, 0, 2);
        }
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
        const bq = fx * sdx + fz * sdz, c = fx * fx + fz * fz - (b.rad + 0.08) ** 2;
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
            const blasted = this.explode(ex, ez, s.owner, w.splash!.radius, w.splash!.damage, w.splash!.knock, true, s.y - 0.55);
            if (s.owner === this.player.id && (victim || blasted)) this.ms.hits++;
            if (this.online) this.net.send({ k: 'boom', o: s.owner, x: r2(ex), z: r2(ez), r: w.splash!.radius, y: r2(s.y - 0.55) });
          }
          if (s.mesh) this.r.scene.remove(s.mesh);
          this.shots.splice(i, 1); continue;
        }
      } else if (ended) {
        if (victim) {
          if (!s.cosmetic && s.owner === this.player.id) this.ms.hits++;
          if (!s.cosmetic && shooter) {
            const travelled = s.dist + Math.sqrt(l2) * t;
            const range = w.speed * w.life;
            const dmg = w.damage * (1 - (w.falloff ?? 0) * Math.min(1, travelled / range));
            this.hit(shooter, victim, dmg, (s.vx / l) * w.knock, (s.vz / l) * w.knock, 0, w.kind === 'flame' ? 1 : 0);
          }
          for (let k = 0; k < 3; k++) this.fx.bit(hx, s.y, hz, s.vx * 0.12 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, s.vz * 0.12 + (Math.random() - 0.5) * 4, 0.06, victim.color, 0.6);
          if (Math.random() < 0.25 && victim.gy < 0.1) this.arena.splat(hx + s.vx * 0.02, hz + s.vz * 0.02, 0.18 + Math.random() * 0.15, victim.color);
        } else if (w.kind === 'flame') {
          if (Math.random() < 0.14) this.fires.push({ owner: s.owner, x: hx, z: hz, y: this.arena.floorAt(hx, hz), t: BURN.patchT * (0.7 + Math.random() * 0.6) });
        } else if (t >= 0) {
          for (let k = 0; k < 2; k++) this.fx.glow(hx, s.y, hz, -s.vx * 0.08 + (Math.random() - 0.5) * 5, 1 + Math.random() * 3, -s.vz * 0.08 + (Math.random() - 0.5) * 5, 0.05, 0xfff2a0, 0.18, 14);
          if (Math.random() < 0.3) this.audio.play('wall', hx, hz, 0.6);
        }
        this.shots.splice(i, 1); continue;
      }
      if (w.kind === 'flame') {
        const age = 1 - s.life / w.life;
        if (Math.random() < dt * 95) this.fx.glow(nx + (Math.random() - 0.5) * 0.2, s.y - 0.1 + age * 0.35, nz + (Math.random() - 0.5) * 0.2, s.vx * 0.3, 0.8 + age * 1.5, s.vz * 0.3, 0.22 + age * 0.5, age < 0.3 ? 0xfff0a0 : age < 0.65 ? 0xff9a30 : 0xe0481c, 0.16 + Math.random() * 0.08, 0);
        if (age > 0.7 && Math.random() < dt * 8) this.fx.puff(nx, s.y + 0.2, nz, 0.14, 0.5, s.vx * 0.1, 1.2, s.vz * 0.1, 1.8);
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
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.ttl !== undefined) {
        p.ttl -= dt;
        if (p.ttl <= 0) { this.removePickup(p); continue; }
        p.mesh.visible = p.ttl > 3 || Math.sin(p.ttl * 18) > -0.2;   // blink before vanishing
      }
    }
    this.pickups.forEach((p, idx) => {
      const item = p.mesh.userData.item as THREE.Object3D;
      if (p.t > 0) { p.t -= dt; item.visible = false; if (p.t <= 0) { this.fx.ring(p.x, p.z, 1, 0xffffff, 0.3); } return; }
      item.visible = true;
      item.rotation.y += dt * 2; item.position.y = 0.75 + Math.sin(this.clock * 3 + p.x) * 0.12;
      for (const b of this.babos) {
        if (!b.local || !b.alive || Math.hypot(b.x - p.x, b.z - p.z) > 0.95) continue;
        if (p.kind === 'weapon') {
          if (this.mode.waves && !b.human) continue;   // wave bots keep the guns they came with
          const w = WEAPONS[p.w!];
          if (b.weapon === p.w) {
            const full = b.ammo >= w.clip && (b.reserve < 0 || b.reserve >= (w.ammo ?? 0) - w.clip);
            if (full) continue;
            b.ammo = w.clip; b.reloadT = 0; if (w.ammo !== undefined) b.reserve = w.ammo - w.clip;
          } else { setWeapon(b, p.w!); b.cool = 0.2; }
          this.takePickup(idx);
          if (this.online) this.net.send(p.drop ? { k: 'pick', i: -1, d: p.drop } : { k: 'pick', i: idx });
          if (b.isPlayer) this.hud.toast(`${w.name}${w.ammo ? ` (${w.ammo} shots)` : ''}`);
          break;
        }
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
    if (p.kind === 'weapon') {
      const w = WEAPONS[p.w!];
      this.audio.play('reload', p.x, p.z); this.audio.play('pickup', p.x, p.z, 0.6);
      for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2; this.fx.glow(p.x, 0.8 + p.mesh.position.y, p.z, Math.cos(a) * 2, 2 + Math.random() * 2, Math.sin(a) * 2, 0.07, w.color, 0.4, 3); }
      if (p.drop) this.removePickup(p); else p.t = w.ammo ? GUN_RESPAWN.power : GUN_RESPAWN.normal;
      return;
    }
    p.t = RESPAWN[p.kind];
    this.audio.play(p.kind === 'nades' ? 'pickup' : 'heal', p.x, p.z);
    for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2; this.fx.glow(p.x, 0.8, p.z, Math.cos(a) * 2, 2 + Math.random() * 2, Math.sin(a) * 2, 0.07, p.kind === 'nades' ? 0x7dff9a : p.kind === 'mega' ? 0xffd84a : 0xff6a6a, 0.4, 3); }
  }

  private removePickup(p: Pickup) {
    const i = this.pickups.indexOf(p); if (i < 0) return;
    this.r.scene.remove(p.mesh); this.pickups.splice(i, 1);
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
    this.net.set({ n: this.saved.nick || 'Player', c: this.saved.color, sk: this.saved.ffaSkill ?? null, lob: 1, start: null, s: null, ev: null, h: null });
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
      { id: 1, name: String(friend.presence.n || 'Friend').slice(0, 16), color: COLORS[theirC].hex, team: mode.teams ? 0 : 1, human: true, peer: friend.peer, sk: typeof friend.presence.sk === 'number' ? friend.presence.sk : undefined },
    ];
    const cols = COLORS.filter((_, i) => i !== myC && i !== theirC);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const nBots = modeId === 'coop' ? this.saved.coopBots : mode.bots;
    for (let i = 0; i < nBots; i++) roster.push({ id: i + 2, name: names[i], color: cols[i % cols.length].hex, team: mode.teams ? 1 : i + 2, human: false });
    const offer: StartOffer = { e: (Math.random() * 1e9) | 0, mode: modeId, seed: (Math.random() * 1e9) | 0, guest: friend.peer, roster, diff: this.saved.difficulty, map: this.resolveMap(mode), n: this.arenaN };
    this.offer = offer; this.lastMode = modeId;
    this.net.clearMatch();
    this.net.set({ start: offer });
    this.online = true; this.host = true; this.partner = friend.peer; this.epoch = offer.e;
    this.begin(mode, offer.seed, roster, 0, offer.map as MapId, offer.n);
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
      this.begin(MODES[o.mode], o.seed, o.roster, 1, (o.map || 'random') as MapId, o.n ?? MODES[o.mode].size);
      return;
    }
  }

  private onNetEvent(e: NetEvent) {
    if (!this.online || this.state === 'lobby' || this.state === 'menu') return;
    const b = (id: number) => this.babos[id];
    switch (e.k) {
      case 'hit': { const v = b(e.v); if (v && v.local) this.applyDamage(v, e.d, e.a, e.x, e.z, e.y, e.f ?? 0); break; }
      case 'die': { const v = b(e.v); if (v && !v.local) this.onDeath(v, e.by); break; }
      case 'nade': if (b(e.o) && !b(e.o).local) this.addNade(e.o, e.x, e.y, e.z, e.vx, e.vy, e.vz, true); break;
      case 'boom': {
        if (b(e.o)?.local) break;
        if (e.m) { this.removeMineNear(e.o, e.x, e.z); this.explode(e.x, e.z, e.o, e.r, 0, 0, false, e.y ?? 0); break; }
        let bi = -1, bd = 1e9;
        this.shots.forEach((s, i) => { if (s.owner === e.o && s.mesh) { const d = Math.hypot(s.x - e.x, s.z - e.z); if (d < bd) { bd = d; bi = i; } } });
        if (bi >= 0) { const s = this.shots[bi]; if (s.mesh) this.r.scene.remove(s.mesh); this.shots.splice(bi, 1); }
        this.explode(e.x, e.z, e.o, e.r, 0, 0, false, e.y ?? 0);
        break;
      }
      case 'pick': if (e.d) { const i = this.pickups.findIndex(p => p.drop === e.d); if (i >= 0) this.takePickup(i); } else this.takePickup(e.i); break;
    }
  }

  private snapshot() {
    const ents: number[][] = [];
    for (const b of this.babos) {
      if (!b.local) continue;
      ents.push([b.id, Math.round(b.x * 100), Math.round(b.z * 100), Math.round(b.vx * 10), Math.round(b.vz * 10), Math.round(b.y * 100),
        Math.round(Math.atan2(b.aimZ, b.aimX) * 100), Math.max(0, Math.round(b.hp)), b.alive ? 1 : 0, WIDS.indexOf(b.weapon),
        b.fire && b.alive ? 1 : 0, b.reloadT > 0 || b.ammo <= 0 ? 1 : 0, AIDS.indexOf(b.ability), Math.round(Math.max(0, b.abT) * 100), b.abCount, b.spawnShield > 0 ? 1 : 0, b.burnT > 0 ? 1 : 0]);
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
      if (a[16] && b.burnT < 0.3) { b.burnT = 0.3; if (b.burnBy < 0) b.burnBy = -2; }
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
    if (this.mode.waves && h.w) this.mirrorWaves(h.w);
    if (h.f) { h.f.forEach((v, id) => { if (v > -999) this.ffa.mirror(id, v / 100); }); this.saveFfa(); }
    if (h.st === 'p' && this.state === 'countdown') this.go();
    if (h.st === 'o' && this.state !== 'over') this.end();
  }

  /** Guest: follow the host's wave state (and do the local side of wave starts). */
  private mirrorWaves(a: number[]) {
    const w = this.wv, [n, lives, br, left, boss, outMask, sk, ad, tr, bossHp] = a;
    const d = this.director; d.skill = (sk ?? 0) / 100; d.adaptive = ad === 1; d.trend = tr ?? 0;
    const newWave = n !== w.n && n > 0;
    const cleared = br > 0 && w.breakT <= 0 && n > 0;
    w.n = n; w.lives = lives; w.breakT = br / 10; w.queue = left; w.cleared = br > 0;
    w.out = new Set(this.babos.filter(b => outMask & (1 << b.id)).map(b => b.id));
    if (boss !== w.boss) {
      const old = this.babos[w.boss]; if (old?.boss) setBoss(old, false);
      const nb = this.babos[boss]; if (nb) { setBoss(nb, true); if (bossHp) nb.maxHp = bossHp; this.hud.banner(`${nb.name.toUpperCase()} THE BIG ONE`, true, 1.8); this.audio.play('boss'); }
      w.boss = boss;
    }
    if (newWave) this.onWaveStart(); else if (cleared) this.onWaveCleared();
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
      ...(this.ffa.active ? { f: this.ffa.ratings(this.babos.length) } : {}),
      ...(this.mode.gun ? { g: this.babos.map(b => b.won ? 99 : b.tier * 10 + b.tierKills) } : {}),
      ...(this.mode.waves ? { w: [this.wv.n, this.wv.lives, Math.round(this.wv.breakT * 10), this.wv.queue + this.babos.filter(b => !b.human && b.alive).length, this.wv.boss, [...this.wv.out].reduce((m, id) => m | (1 << id), 0), Math.round(this.director.skill * 100), this.director.adaptive ? 1 : 0, this.director.trend, this.babos[this.wv.boss]?.maxHp ?? 0] } : {}),
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
      this.flushGrav(raw);
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
      const kc = !p.alive && this.killCam >= 0 ? this.babos[this.killCam] : null;
      if (kc && kc.alive) this.r.follow(kc.x, kc.z, kc.x + kc.aimX * 2, kc.z + kc.aimZ * 2, raw);
      else { this.input.aimWorld(this.aimPoint); this.r.follow(p.x, p.z, this.aimPoint.x, this.aimPoint.z, raw); }
      this.audio.listener.x = p.x; this.audio.listener.z = p.z;
    }
    this.updateMusic();
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
      const w = WEAPONS[sh.w];
      if (w.kind === 'flame') continue; const sp = Math.hypot(sh.vx, sh.vz);
      const blob = w.kind === 'bounce';
      const len = blob ? 0.28 : Math.min(1.4, sp * 0.03);
      _q.setFromAxisAngle(_up, Math.atan2(sh.vx, sh.vz) + Math.PI);
      if (blob) _s.set(3.2, 3.2, len); else _s.set(1, 1, len);
      _p.set(sh.x, sh.y ?? 0.55, sh.z);
      _m.compose(_p, _q, _s); this.tracer.setMatrixAt(n, _m); this.tracer.setColorAt(n, _c.set(w.color).multiplyScalar(3)); n++;
    }
    this.tracer.count = n; this.tracer.instanceMatrix.needsUpdate = true; if (this.tracer.instanceColor) this.tracer.instanceColor.needsUpdate = true;
  }

  /** Music follows the match: menu groove outside it, and the match track heats up near the end. */
  private updateMusic() {
    const m = this.audio.music;
    if (this.state === 'menu' || this.state === 'lobby') { m.set('menu'); return; }
    if (this.state === 'over') { m.set('off'); return; }
    if (this.state === 'countdown') { m.set('match', 0); return; }
    const mode = this.mode, bs = this.babos;
    let hot = false;
    if (mode.waves) hot = this.wv.boss >= 0 || (this.wv.lives <= 1 && this.wv.n > 1) || this.wv.n >= 8;
    else if (mode.gun) hot = bs.some(b => b.tier >= LADDER.length - 2);
    else if (mode.teams) hot = Math.max(...Object.values(this.teamScores())) >= mode.limit - 5;
    else hot = bs.some(b => b.kills >= mode.limit - 3);
    if (mode.time > 0 && this.matchT < 30) hot = true;
    const calm = mode.waves && this.wv.breakT > 0;
    m.set('match', calm ? 0 : hot ? 2 : 1);
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

const gunRingMats = new Map<number, THREE.Material>();
/** A gun lying on a pad, ringed in the gun's colour. Power weapons get a gold pad. */
function gunPickupMesh(w: WeaponId) {
  const def = WEAPONS[w], g = new THREE.Group();
  const base = new THREE.Mesh(baseGeo, def.ammo ? megaMat : baseMat); base.position.y = 0.04; base.receiveShadow = true; g.add(base);
  let rm = gunRingMats.get(def.color);
  if (!rm) { rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).multiplyScalar(1.8), toneMapped: false }); gunRingMats.set(def.color, rm); }
  const ring = new THREE.Mesh(ringGeo, rm); ring.rotation.x = Math.PI / 2; ring.position.y = 0.09; g.add(ring);
  const item = new THREE.Group(); const gun = buildGun(w, def.color); gun.scale.setScalar(1.6); gun.position.z = -0.25; item.add(gun);
  item.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  item.position.y = 0.75; g.add(item); g.userData.item = item;
  return g;
}

const mineBodyGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.12, 16);
const mineLightGeo = new THREE.SphereGeometry(0.07, 8, 6);
const mineRingGeo = new THREE.RingGeometry(0.34, 0.4, 20).rotateX(-Math.PI / 2);
const mineMat = new THREE.MeshStandardMaterial({ color: 0x3a3f55, roughness: 0.5, metalness: 0.3 });
const mineLightMats = new Map<number, THREE.Material>();
function mineMesh(color: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(mineBodyGeo, mineMat); body.position.y = 0.06; body.castShadow = true; g.add(body);
  let lm = mineLightMats.get(color);
  if (!lm) { lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), toneMapped: false }); mineLightMats.set(color, lm); }
  const light = new THREE.Mesh(mineLightGeo, lm); light.position.y = 0.14; g.add(light); g.userData.light = light;
  const ring = new THREE.Mesh(mineRingGeo, lm); ring.position.y = 0.02; g.add(ring);
  return g;
}

function pickupMesh(kind: PickKind) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(baseGeo, baseMat); base.position.y = 0.04; base.receiveShadow = true; g.add(base);
  const ring = new THREE.Mesh(ringGeo, ringMats[kind]); ring.rotation.x = Math.PI / 2; ring.position.y = 0.09; g.add(ring);
  const item = new THREE.Mesh(pickupItemGeo(kind), kind === 'mega' ? megaMat : pickupMat); item.castShadow = true;
  item.position.y = 0.75; g.add(item); g.userData.item = item;
  return g;
}
