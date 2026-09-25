import * as THREE from 'three';
import { Arena, HALF, CELL, N } from './arena';
import { Audio } from './audio';
import { Babo, makeBabo, setWeapon, updateBaboVisual } from './babo';
import { BALL, BOT_NAMES, COLORS, DIFFICULTY, Difficulty, GRENADE, MATCH, WEAPONS, WeaponId } from './config';
import { Fx } from './fx';
import { Renderer, Quality } from './render';
import { Hud } from './hud';
import { Input } from './input';
import { thinkBot } from './bots';

interface Shot { owner: number; x: number; z: number; vx: number; vz: number; life: number; w: WeaponId; mesh?: THREE.Object3D; trailT: number }
interface Nade { owner: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; mesh: THREE.Mesh; bounces: number }
type PickKind = 'health' | 'nades' | 'mega';
interface Pickup { kind: PickKind; x: number; z: number; t: number; mesh: THREE.Group }

const RESPAWN: Record<PickKind, number> = { health: 11, nades: 13, mega: 30 };
const G = 24;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const STORE = 'ballistic.v1';
export interface Saved { weapon: WeaponId; color: number; difficulty: Difficulty; quality: Quality | 'auto'; muted: boolean; best?: number }
function load(): Saved {
  let s: Partial<Saved> = {};
  try { s = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { s = {}; }
  return { weapon: s.weapon ?? 'shotgun', color: s.color ?? 0, difficulty: s.difficulty ?? 'normal', quality: s.quality ?? 'auto', muted: !!s.muted, best: s.best };
}

export class Game {
  r: Renderer;
  arena!: Arena;
  fx: Fx;
  audio = new Audio();
  hud: Hud;
  input: Input;
  saved = load();
  babos: Babo[] = [];
  shots: Shot[] = [];
  nades: Nade[] = [];
  pickups: Pickup[] = [];
  state: 'menu' | 'countdown' | 'playing' | 'over' = 'menu';
  paused = false;
  clock = 0;
  matchT = 0;
  countT = 0;
  player!: Babo;
  pendingWeapon: WeaponId;
  private tracer: THREE.InstancedMesh;
  private last = performance.now();
  private acc = 0;
  private perf = { t: 0, frames: 0, low: 0 };
  private rocketGeo = new THREE.CapsuleGeometry(0.1, 0.35, 4, 8).rotateX(Math.PI / 2);
  private rocketMat = new THREE.MeshStandardMaterial({ color: 0xf4f0ea, roughness: 0.4, emissive: 0xff5a2a, emissiveIntensity: 0.2 });
  private nadeGeo = new THREE.SphereGeometry(0.17, 14, 10);
  private nadeMat = new THREE.MeshStandardMaterial({ color: 0x3b8f4a, roughness: 0.5 });
  private aimPoint = new THREE.Vector3();
  seed = (Math.random() * 1e9) | 0;

  constructor(canvas: HTMLCanvasElement) {
    this.r = new Renderer(canvas);
    this.fx = new Fx(this.r.scene);
    this.audio.setMuted(this.saved.muted);
    this.pendingWeapon = this.saved.weapon;
    const tg = new THREE.BoxGeometry(0.07, 0.07, 1); tg.translate(0, 0, -0.5);
    this.tracer = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ toneMapped: false }), 400);
    this.tracer.frustumCulled = false; this.tracer.count = 0;
    this.tracer.setColorAt(0, new THREE.Color(1, 1, 1));
    this.r.scene.add(this.tracer);
    this.hud = new Hud(this);
    this.input = new Input(this, canvas);
    this.newArena();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  save() { try { localStorage.setItem(STORE, JSON.stringify(this.saved)); } catch { /* storage unavailable */ } }

  newArena() {
    if (this.arena) { this.r.scene.remove(this.arena.group); }
    this.arena = new Arena(this.seed);
    this.r.scene.add(this.arena.group);
    for (const p of this.pickups) this.r.scene.remove(p.mesh);
    this.pickups = this.arena.pickups.map((s, i) => {
      const kind: PickKind = i === this.arena.pickups.length - 1 ? 'mega' : Math.floor(i / 4) === 1 ? 'nades' : 'health';
      const mesh = pickupMesh(kind); mesh.position.set(s.x, 0, s.z); this.r.scene.add(mesh);
      return { kind, x: s.x, z: s.z, t: 0, mesh };
    });
  }

  // ---------- match flow ----------
  start() {
    this.audio.unlock();
    for (const b of this.babos) this.r.scene.remove(b.root);
    for (const s of this.shots) if (s.mesh) this.r.scene.remove(s.mesh);
    for (const n of this.nades) this.r.scene.remove(n.mesh);
    this.babos = []; this.shots = []; this.nades = [];
    this.seed = (Math.random() * 1e9) | 0;
    this.newArena();
    this.fx.clear();
    const pc = COLORS[this.saved.color % COLORS.length];
    this.player = makeBabo(0, 'You', pc.hex, this.saved.weapon, true);
    this.babos.push(this.player);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const cols = COLORS.filter((_, i) => i !== this.saved.color % COLORS.length);
    const wids = Object.keys(WEAPONS) as WeaponId[];
    for (let i = 0; i < MATCH.bots; i++) {
      const b = makeBabo(i + 1, names[i], cols[i % cols.length].hex, wids[i % wids.length], false);
      this.babos.push(b);
    }
    for (const b of this.babos) { this.r.scene.add(b.root); this.spawn(b, true); }
    this.matchT = MATCH.timeLimit; this.countT = 3.2; this.state = 'countdown';
    this.paused = false;
    this.hud.onStart();
    this.r.follow(this.player.x, this.player.z, this.player.x, this.player.z, 0, true);
  }

  end() {
    this.state = 'over';
    const ranked = [...this.babos].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const place = ranked.indexOf(this.player) + 1;
    if (!this.saved.best || place < this.saved.best) { this.saved.best = place; this.save(); }
    this.audio.play(place === 1 ? 'win' : 'lose');
    this.hud.showResult(ranked, place);
  }

  spawn(b: Babo, initial = false) {
    // pick the spawn furthest from living opponents
    let best = this.arena.spawns[0], bestScore = -1;
    for (let k = 0; k < 40; k++) {
      const s = this.arena.spawns[(Math.random() * this.arena.spawns.length) | 0];
      let near = 1e9;
      for (const o of this.babos) if (o !== b && o.alive) near = Math.min(near, Math.hypot(o.x - s.x, o.z - s.z));
      if (near > bestScore) { bestScore = near; best = s; }
    }
    if (!b.isPlayer) setWeapon(b, (Object.keys(WEAPONS) as WeaponId[])[(Math.random() * 3) | 0]);
    else if (b.weapon !== this.pendingWeapon) setWeapon(b, this.pendingWeapon); else { b.ammo = WEAPONS[b.weapon].clip; b.reloadT = 0; }
    b.x = best.x; b.z = best.z; b.vx = b.vz = 0; b.y = 0; b.vy = 0;
    b.hp = BALL.hp; b.alive = true; b.root.visible = true; b.nades = GRENADE.start; b.cool = 0.3; b.streak = 0;
    b.spawnShield = initial ? 0 : 1.3; b.lastHitBy = -1; b.brain = undefined;
    if (!initial) {
      this.audio.play('spawn', b.x, b.z, 0.8);
      this.fx.ring(b.x, b.z, 1.6, b.color, 0.45);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; this.fx.glow(b.x, 0.3, b.z, Math.cos(a) * 3, 3, Math.sin(a) * 3, 0.08, b.color, 0.4, 4); }
    }
  }

  // ---------- combat ----------
  fire(b: Babo) {
    const w = WEAPONS[b.weapon];
    if (b.reloadT > 0 || b.cool > 0) return;
    if (b.ammo <= 0) { this.reload(b); return; }
    b.ammo--; b.cool = 1 / w.rate; b.spawnShield = 0;
    const base = Math.atan2(b.aimZ, b.aimX);
    let mx = b.x + b.aimX * 0.85, mz = b.z + b.aimZ * 0.85;
    if (this.arena.raycast(b.x, b.z, mx, mz) >= 0) { mx = b.x; mz = b.z; }
    for (let i = 0; i < w.pellets; i++) {
      const a = base + (w.pellets > 1 ? ((i + Math.random()) / w.pellets - 0.5) * w.spread : (Math.random() - 0.5) * w.spread);
      const sp = w.speed * (w.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1);
      const s: Shot = { owner: b.id, x: mx, z: mz, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, life: w.life * (w.pellets > 1 ? 0.8 + Math.random() * 0.4 : 1), w: w.id, trailT: 0 };
      if (w.kind === 'rocket') { const m = new THREE.Mesh(this.rocketGeo, this.rocketMat); m.castShadow = true; m.position.set(mx, 0.55, mz); m.rotation.y = Math.atan2(s.vx, s.vz); this.r.scene.add(m); s.mesh = m; }
      this.shots.push(s);
    }
    b.vx -= b.aimX * w.recoil; b.vz -= b.aimZ * w.recoil; b.recoilZ = w.kind === 'rocket' ? 0.25 : w.pellets > 1 ? 0.2 : 0.06;
    // muzzle
    const fx = b.x + b.aimX * 1.1, fz = b.z + b.aimZ * 1.1;
    this.fx.flash(fx, 0.9, fz, w.color, w.pellets > 1 ? 14 : w.kind === 'rocket' ? 10 : 5, 0.07);
    const n = w.pellets > 1 ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() - 0.5) * (w.pellets > 1 ? 0.8 : 0.5), s = 4 + Math.random() * 6;
      this.fx.glow(fx, 0.55, fz, Math.cos(a) * s, Math.random() * 2, Math.sin(a) * s, 0.06 + Math.random() * 0.06, w.color, 0.08 + Math.random() * 0.06);
    }
    if (w.pellets > 1) this.fx.puff(fx, 0.55, fz, 0.18, 0.4, b.aimX * 3, 0.6, b.aimZ * 3, 1.5);
    this.audio.play(w.id, b.x, b.z, b.isPlayer ? 1 : 0.75);
    if (b.isPlayer) this.r.addShake(w.kind === 'rocket' ? 0.25 : w.pellets > 1 ? 0.3 : 0.05);
    if (b.ammo <= 0) this.reload(b);
  }

  reload(b: Babo) {
    const w = WEAPONS[b.weapon];
    if (b.reloadT > 0 || b.ammo >= w.clip) return;
    b.reloadT = w.reload;
    if (b.isPlayer) this.audio.play('reload');
  }

  throwNade(b: Babo, tx: number, tz: number) {
    if (b.nades <= 0 || b.nadeCool > 0 || !b.alive) return;
    b.nades--; b.nadeCool = GRENADE.cooldown; b.spawnShield = 0;
    let dx = tx - b.x, dz = tz - b.z; let d = Math.hypot(dx, dz);
    if (d > GRENADE.maxThrow) { dx *= GRENADE.maxThrow / d; dz *= GRENADE.maxThrow / d; d = GRENADE.maxThrow; }
    const T = 0.45 + d * 0.035;
    const m = new THREE.Mesh(this.nadeGeo, this.nadeMat); m.castShadow = true; this.r.scene.add(m);
    const sx = b.x + (dx / (d || 1)) * 0.6, sz = b.z + (dz / (d || 1)) * 0.6;
    this.nades.push({ owner: b.id, x: sx, y: 0.9, z: sz, vx: dx / T + b.vx * 0.3, vy: (G * T) / 2 - 0.9 / T, vz: dz / T + b.vz * 0.3, fuse: GRENADE.fuse, mesh: m, bounces: 0 });
    this.audio.play('throw', b.x, b.z);
  }

  damage(v: Babo, dmg: number, by: number, kx: number, kz: number) {
    if (!v.alive) return;
    v.vx += kx; v.vz += kz;
    if (v.spawnShield > 0) return;
    v.hp -= dmg; v.hurtT = 0.12;
    if (by !== v.id) { v.lastHitBy = by; v.lastHitT = this.clock; }
    const att = this.babos[by];
    if (att?.isPlayer && by !== v.id) { this.hud.floater(v.x, v.z, Math.round(dmg)); this.audio.play('hit', undefined, undefined, 0.8); }
    if (v.isPlayer) { this.hud.hurt(Math.min(1, dmg / 40)); this.r.addShake(Math.min(0.5, dmg / 60)); this.audio.play('hurt'); }
    if (v.hp <= 0) this.kill(v, by);
  }

  kill(v: Babo, by: number) {
    v.alive = false; v.root.visible = false; v.respawnT = BALL.respawn; v.deaths++; v.streak = 0;
    // credit the last attacker for environmental/self deaths within 3s
    let killer = by;
    if ((by === v.id || by < 0) && v.lastHitBy >= 0 && this.clock - v.lastHitT < 3) killer = v.lastHitBy;
    const k = this.babos[killer];
    if (k && k !== v) { k.kills++; k.streak++; } else if (k === v) { v.kills = Math.max(0, v.kills - 1); }
    this.hud.feed(k && k !== v ? k : null, v);
    if (k?.isPlayer && k !== v) {
      this.audio.play('kill');
      const msgs: Record<number, string> = { 2: 'DOUBLE!', 3: 'TRIPLE!', 4: 'RAMPAGE!', 5: 'UNSTOPPABLE!' };
      this.hud.banner(msgs[Math.min(5, k.streak)] ?? `POPPED ${v.name.toUpperCase()}`, !msgs[Math.min(5, k.streak)]);
    }
    if (v.isPlayer) this.hud.onPlayerDeath(k && k !== v ? k : null);
    // burst
    this.arena.splat(v.x, v.z, 1.1 + Math.random() * 0.4, v.color);
    this.audio.play('pop', v.x, v.z);
    this.fx.flash(v.x, 1, v.z, v.color, 18, 0.25);
    this.fx.ring(v.x, v.z, 2.4, v.color, 0.3);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 8;
      this.fx.bit(v.x, 0.6, v.z, Math.cos(a) * s + v.vx * 0.4, 3 + Math.random() * 7, Math.sin(a) * s + v.vz * 0.4, 0.07 + Math.random() * 0.12, i % 5 === 0 ? 0xffffff : v.color, 1.2 + Math.random() * 1.2);
    }
    for (let i = 0; i < 6; i++) this.fx.puff(v.x + (Math.random() - 0.5), 0.5, v.z + (Math.random() - 0.5), 0.35, 0.6);
    if (this.babos.some(b => b.kills >= MATCH.fragLimit)) setTimeout(() => { if (this.state === 'playing') this.end(); }, 900);
  }

  explode(x: number, z: number, owner: number, r: number, dmg: number, knock: number) {
    this.fx.explosion(x, z, r);
    this.arena.scorch(x, z, r * 0.7);
    this.audio.play('boom', x, z);
    const pd = Math.hypot(this.player.x - x, this.player.z - z);
    if (!reducedMotion) this.r.addShake(Math.max(0, 0.7 - pd / 20));
    for (const b of this.babos) {
      if (!b.alive) continue;
      const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
      if (d > r + BALL.radius) continue;
      if (d > 0.3 && this.arena.raycast(x - (dx / d) * 0.05, z - (dz / d) * 0.05, b.x, b.z) >= 0) continue;
      const k = Math.max(0, 1 - Math.max(0, d - BALL.radius) / r);
      const nx = d > 0.01 ? dx / d : Math.random() - 0.5, nz = d > 0.01 ? dz / d : Math.random() - 0.5;
      b.vy += 6 * k;
      this.damage(b, dmg * Math.pow(k, 0.7) * (b.id === owner ? 0.45 : 1), owner, nx * knock * k, nz * knock * k);
    }
    // chain other grenades
    for (const n of this.nades) if (Math.hypot(n.x - x, n.z - z) < r * 0.6) n.fuse = Math.min(n.fuse, 0.08);
  }

  // ---------- simulation ----------
  step(dt: number) {
    this.clock += dt;
    const live = this.state === 'playing';
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countT); this.countT -= dt; const after = Math.ceil(this.countT);
      if (after !== before && after > 0) { this.audio.play('count'); this.hud.banner(String(after), false, 0.7); }
      if (this.countT <= 0) { this.state = 'playing'; this.audio.play('go'); this.hud.banner('ROLL!', false, 0.9); }
    }
    if (live) { this.matchT -= dt; if (this.matchT <= 0) { this.matchT = 0; this.end(); } }

    const diff = DIFFICULTY[this.saved.difficulty];
    for (const b of this.babos) {
      if (!b.alive) {
        if (this.state === 'playing' || this.state === 'countdown') { b.respawnT -= dt; if (b.respawnT <= 0) this.spawn(b); }
        continue;
      }
      b.cool -= dt; b.nadeCool -= dt; b.spawnShield = Math.max(0, b.spawnShield - dt);
      if (b.reloadT > 0) { b.reloadT -= dt; if (b.reloadT <= 0) { b.ammo = WEAPONS[b.weapon].clip; if (b.isPlayer) this.audio.play('reload'); } }
      if (b.hp > BALL.hp) b.hp = Math.max(BALL.hp, b.hp - dt * 3);
      if (this.state === 'countdown') { b.moveX = b.moveZ = 0; b.fire = false; }
      else if (b.isPlayer) this.input.apply(b);
      else if (this.state === 'playing') thinkBot(this, b, dt, diff);
      else { b.moveX = b.moveZ = 0; b.fire = false; }
      if (b.fire && live) this.fire(b);
      this.physics(b, dt);
    }
    // babo vs babo
    for (let i = 0; i < this.babos.length; i++) for (let j = i + 1; j < this.babos.length; j++) {
      const a = this.babos[i], c = this.babos[j]; if (!a.alive || !c.alive) continue;
      const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz), min = BALL.radius * 2;
      if (d >= min || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, push = (min - d) / 2;
      a.x -= nx * push; a.z -= nz * push; c.x += nx * push; c.z += nz * push;
      const rel = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz;
      if (rel < 0) {
        const imp = -(1 + BALL.ballBounce) * rel / 2;
        a.vx -= nx * imp; a.vz -= nz * imp; c.vx += nx * imp; c.vz += nz * imp;
        if (-rel > 4) this.audio.play('bonk', a.x, a.z, Math.min(1, -rel / 10));
      }
    }
    this.stepShots(dt);
    this.stepNades(dt);
    this.stepPickups(dt);
  }

  physics(b: Babo, dt: number) {
    const ml = Math.hypot(b.moveX, b.moveZ);
    const sp = Math.hypot(b.vx, b.vz);
    if (ml > 0.01) {
      const mx = b.moveX / Math.max(1, ml), mz = b.moveZ / Math.max(1, ml);
      const tx = mx * BALL.maxSpeed, tz = mz * BALL.maxSpeed;
      let dx = tx - b.vx, dz = tz - b.vz; const dl = Math.hypot(dx, dz);
      // when flying faster than max (knockback), only steer, don't brake hard
      const lim = BALL.accel * dt * (sp > BALL.maxSpeed * 1.1 ? 0.35 : 1);
      if (dl > lim) { dx *= lim / dl; dz *= lim / dl; }
      b.vx += dx; b.vz += dz;
    } else {
      const k = Math.exp(-BALL.coast * dt); b.vx *= k; b.vz *= k;
    }
    if (sp > BALL.maxSpeed) { const k = Math.exp(-1.6 * dt); b.vx *= k; b.vz *= k; }
    b.x += b.vx * dt; b.z += b.vz * dt;
    b.vy -= 28 * dt; b.y += b.vy * dt; if (b.y < 0) { if (b.vy < -6) this.audio.play('bounce', b.x, b.z, 0.5); b.y = 0; b.vy = b.vy < -5 ? -b.vy * 0.3 : 0; }
    const hit = this.arena.collide(b, BALL.radius);
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
      let t = this.arena.raycast(s.x, s.z, nx, nz);
      let victim: Babo | null = null;
      const sdx = nx - s.x, sdz = nz - s.z, l2 = sdx * sdx + sdz * sdz;
      for (const b of this.babos) {
        if (!b.alive || b.id === s.owner) continue;
        // segment vs circle
        const fx = s.x - b.x, fz = s.z - b.z;
        const bq = fx * sdx + fz * sdz, c = fx * fx + fz * fz - (BALL.radius + 0.08) ** 2;
        let tt: number;
        if (c <= 0) tt = 0; else { const disc = bq * bq - l2 * c; if (disc < 0) continue; tt = (-bq - Math.sqrt(disc)) / l2; }
        if (tt < 0 || tt > 1) continue;
        if (t < 0 || tt < t) { t = tt; victim = b; }
      }
      const ended = t >= 0 || s.life <= 0;
      const hx = t >= 0 ? s.x + sdx * t : nx, hz = t >= 0 ? s.z + sdz * t : nz;
      if (w.kind === 'rocket') {
        s.trailT -= dt;
        if (s.trailT <= 0) { s.trailT = 0.03; this.fx.puff(s.x, 0.55, s.z, 0.13, 0.32, 0, 0.6, 0, 1.3); this.fx.glow(s.x, 0.55, s.z, 0, 0, 0, 0.14, 0xffa040, 0.08); }
        if (s.mesh) s.mesh.position.set(hx, 0.55, hz);
        if (ended) {
          if (victim) this.damage(victim, w.damage, s.owner, (s.vx / w.speed) * w.knock, (s.vz / w.speed) * w.knock);
          // step back from the wall so LOS checks start in open space
          const back = t >= 0 && !victim ? 0.15 : 0; const l = Math.hypot(s.vx, s.vz);
          this.explode(hx - (s.vx / l) * back, hz - (s.vz / l) * back, s.owner, w.splash!.radius, w.splash!.damage, w.splash!.knock);
          if (s.mesh) this.r.scene.remove(s.mesh);
          this.shots.splice(i, 1); continue;
        }
      } else if (ended) {
        if (victim) {
          const l = Math.hypot(s.vx, s.vz);
          this.damage(victim, w.damage, s.owner, (s.vx / l) * w.knock, (s.vz / l) * w.knock);
          for (let k = 0; k < 3; k++) this.fx.bit(hx, 0.5, hz, s.vx * 0.12 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, s.vz * 0.12 + (Math.random() - 0.5) * 4, 0.06, victim.color, 0.6);
          if (Math.random() < 0.25) this.arena.splat(hx + s.vx * 0.02, hz + s.vz * 0.02, 0.18 + Math.random() * 0.15, victim.color);
        } else if (t >= 0) {
          for (let k = 0; k < 2; k++) this.fx.glow(hx, 0.5, hz, -s.vx * 0.08 + (Math.random() - 0.5) * 5, 1 + Math.random() * 3, -s.vz * 0.08 + (Math.random() - 0.5) * 5, 0.05, 0xfff2a0, 0.18, 14);
          if (Math.random() < 0.3) this.audio.play('wall', hx, hz, 0.6);
        }
        this.shots.splice(i, 1); continue;
      }
      s.x = nx; s.z = nz;
    }
  }

  stepNades(dt: number) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.fuse -= dt;
      n.vy -= G * dt;
      const ox = n.x, oz = n.z;
      n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt;
      const ci = this.arena.cellOf(n.x), cj = this.arena.cellOf(n.z);
      const top = this.arena.solidCell(ci, cj) ? (ci >= 0 && cj >= 0 && ci < N && cj < N ? this.arena.h[cj * N + ci] : 3) * CELL : 0;
      if (n.y < top + 0.17 && this.arena.solidCell(ci, cj)) {
        // bounce off block side: find which axis crossed
        const oi = this.arena.cellOf(ox), oj = this.arena.cellOf(oz);
        if (oi !== ci) n.vx *= -0.5; if (oj !== cj) n.vz *= -0.5;
        if (oi === ci && oj === cj) { n.vy = Math.abs(n.vy) * 0.4; n.y = top + 0.17; } else { n.x = ox; n.z = oz; }
        this.audio.play('bounce', n.x, n.z, 0.6);
      }
      if (n.y < 0.17) {
        n.y = 0.17;
        if (n.vy < -2) { n.vy = -n.vy * 0.42; this.audio.play('bounce', n.x, n.z, 0.6); } else n.vy = 0;
        n.vx *= 0.72; n.vz *= 0.72; n.bounces++;
      }
      // roll friction
      if (n.y <= 0.18) { const k = Math.exp(-1.5 * dt); n.vx *= k; n.vz *= k; }
      n.mesh.position.set(n.x, n.y, n.z); n.mesh.rotation.x += n.vz * dt * 3; n.mesh.rotation.z -= n.vx * dt * 3;
      // blink as it's about to pop
      if (Math.random() < dt * 20) this.fx.glow(n.x, n.y + 0.2, n.z, 0, 0.5, 0, 0.05, n.fuse < 0.5 ? 0xff3030 : 0xffe070, 0.1);
      if (n.fuse <= 0) {
        this.r.scene.remove(n.mesh); this.nades.splice(i, 1);
        this.explode(n.x, n.z, n.owner, GRENADE.radius, GRENADE.damage, GRENADE.knock);
      }
    }
  }

  stepPickups(dt: number) {
    for (const p of this.pickups) {
      const item = p.mesh.userData.item as THREE.Object3D;
      if (p.t > 0) { p.t -= dt; item.visible = false; if (p.t <= 0) { this.fx.ring(p.x, p.z, 1, 0xffffff, 0.3); } continue; }
      item.visible = true;
      item.rotation.y += dt * 2; item.position.y = 0.75 + Math.sin(this.clock * 3 + p.x) * 0.12;
      for (const b of this.babos) {
        if (!b.alive || Math.hypot(b.x - p.x, b.z - p.z) > 0.95) continue;
        if (p.kind === 'health' && b.hp >= BALL.hp) continue;
        if (p.kind === 'nades' && b.nades >= GRENADE.max) continue;
        if (p.kind === 'health') b.hp = Math.min(BALL.hp, b.hp + 35);
        else if (p.kind === 'nades') b.nades = Math.min(GRENADE.max, b.nades + 2);
        else b.hp = Math.min(150, Math.max(b.hp, BALL.hp) + 50);
        p.t = RESPAWN[p.kind];
        this.audio.play(p.kind === 'nades' ? 'pickup' : 'heal', p.x, p.z);
        for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2; this.fx.glow(p.x, 0.8, p.z, Math.cos(a) * 2, 2 + Math.random() * 2, Math.sin(a) * 2, 0.07, p.kind === 'nades' ? 0x7dff9a : p.kind === 'mega' ? 0xffd84a : 0xff6a6a, 0.4, 3); }
        if (b.isPlayer) this.hud.toast(p.kind === 'health' ? '+35 health' : p.kind === 'nades' ? '+2 grenades' : 'MEGA HEALTH +50');
        break;
      }
    }
  }

  // ---------- frame ----------
  frame(now: number) {
    const raw = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.tick(raw);
    requestAnimationFrame(this.frame);
  }

  tick(raw: number, draw = true) {
    if (!this.paused && this.state !== 'menu') {
      this.acc += raw;
      const STEP = 1 / 120; let n = 0;
      while (this.acc >= STEP && n < 12) { this.step(STEP); this.acc -= STEP; n++; }
      if (n === 12) this.acc = 0;
    } else if (this.state === 'menu') {
      this.clock += raw; this.menuCam(raw);
    }
    const dt = this.paused ? 0 : raw;
    for (const b of this.babos) if (b.alive) updateBaboVisual(b, dt);
    this.fx.update(dt);
    this.drawTracers();
    for (const p of this.pickups) { const item = p.mesh.userData.item as THREE.Object3D; if (this.state === 'menu') { item.rotation.y += raw * 2; item.visible = true; } }
    this.arena.flushPaint();
    if (this.state !== 'menu' && this.player) {
      const p = this.player;
      this.input.aimWorld(this.aimPoint);
      this.r.follow(p.x, p.z, this.aimPoint.x, this.aimPoint.z, raw);
      this.audio.listener.x = p.x; this.audio.listener.z = p.z;
    }
    if (draw) this.r.render();
    this.hud.update(raw);
    this.adaptQuality(raw);
  }

  private menuCam(dt: number) {
    const a = this.clock * 0.08;
    this.r.camera.position.set(Math.cos(a) * 26, 22, Math.sin(a) * 26);
    this.r.camera.lookAt(0, 0, 0);
    void dt;
  }

  private drawTracers() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    let n = 0;
    for (const sh of this.shots) {
      if (sh.mesh || n >= 400) continue;
      const w = WEAPONS[sh.w]; const sp = Math.hypot(sh.vx, sh.vz);
      const len = Math.min(1.4, sp * 0.03);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(sh.vx, sh.vz) + Math.PI);
      s.set(1, 1, len); p.set(sh.x, 0.55, sh.z);
      m.compose(p, q, s); this.tracer.setMatrixAt(n, m); this.tracer.setColorAt(n, c.set(w.color).multiplyScalar(3)); n++;
    }
    this.tracer.count = n; this.tracer.instanceMatrix.needsUpdate = true; if (this.tracer.instanceColor) this.tracer.instanceColor.needsUpdate = true;
  }

  private adaptQuality(dt: number) {
    if (this.saved.quality !== 'auto' || this.state !== 'playing' || this.paused || document.hidden || dt > 0.2) return;
    const p = this.perf; p.t += dt; p.frames++;
    if (p.t < 4) return;
    const fps = p.frames / p.t; p.t = 0; p.frames = 0;
    if (fps < 45) {
      const next = this.r.quality === 'high' ? 'medium' : this.r.quality === 'medium' ? 'low' : null;
      if (next) { this.r.setQuality(next); this.hud.toast(`Running at ${Math.round(fps)} fps, switched to ${next} quality`); }
    }
  }

  setMuted(m: boolean) { this.saved.muted = m; this.audio.setMuted(m); this.save(); }
}

function pickupMesh(kind: PickKind) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.08, 28), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
  base.position.y = 0.04; base.receiveShadow = true; g.add(base);
  const glowCol = kind === 'health' ? 0xff4a5a : kind === 'nades' ? 0x3ee08f : 0xffc83a;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(glowCol).multiplyScalar(1.6), toneMapped: false }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.09; g.add(ring);
  const item = new THREE.Group(); g.add(item); g.userData.item = item;
  if (kind === 'health' || kind === 'mega') {
    const s = kind === 'mega' ? 1.35 : 1;
    const white = new THREE.MeshStandardMaterial({ color: kind === 'mega' ? 0xffd84a : 0xffffff, roughness: 0.3, emissive: kind === 'mega' ? 0xffa000 : 0, emissiveIntensity: 0.4 });
    const red = new THREE.MeshStandardMaterial({ color: 0xff3b4e, roughness: 0.35 });
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.5 * s, 0.5 * s), white); cube.castShadow = true; item.add(cube);
    for (const [w, h] of [[0.12, 0.34], [0.34, 0.12]]) for (const zz of [1, -1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(w * s, h * s, 0.03), red); c.position.z = zz * 0.255 * s; item.add(c);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, h * s, w * s), red); c2.position.x = zz * 0.255 * s; item.add(c2);
    }
  } else {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b8f4a, roughness: 0.45 });
    for (const dx of [-0.17, 0.17]) {
      const n = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), mat); n.position.x = dx; n.castShadow = true; item.add(n);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0xcfd3dc, metalness: 0.6, roughness: 0.3 }));
      pin.position.set(dx, 0.2, 0); item.add(pin);
    }
  }
  item.position.y = 0.75;
  return g;
}

export { HALF };
