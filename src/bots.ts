import type { Game } from './game';
import { CLIMB } from './arena';
import type { Babo } from './babo';
import { BALL, GRENADE, START_WEAPON, WEAPONS } from './config';

interface Brain {
  target: number;          // babo id or -1
  seen: number;            // seconds target has been visible
  lastSeenX: number; lastSeenZ: number; lastSeenT: number;
  path: { x: number; z: number }[];
  repath: number;
  goalX: number; goalZ: number;
  strafe: number; strafeT: number;
  think: number;
  aimA: number;            // current aim angle
  err: number; errT: number;
  stuckT: number;
  nadeT: number;
  burstT: number;
}

function brain(b: Babo): Brain {
  if (!b.brain) b.brain = {
    target: -1, seen: 0, lastSeenX: 0, lastSeenZ: 0, lastSeenT: -99, path: [], repath: 0, goalX: b.x, goalZ: b.z,
    strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 1, think: Math.random() * 0.2, aimA: Math.atan2(b.aimZ, b.aimX),
    err: 0, errT: 0, stuckT: 0, nadeT: 2 + Math.random() * 3, burstT: 0,
  } as Brain;
  return b.brain as Brain;
}

export function thinkBot(g: Game, b: Babo, dt: number, diff: { react: number; aimErr: number; lead: number; nade: number; strafe?: number; ability?: number }) {
  const br = brain(b);
  const w = WEAPONS[b.weapon];
  br.think -= dt; br.repath -= dt; br.strafeT -= dt; br.errT -= dt; br.nadeT -= dt;

  // --- choose target a few times a second
  if (br.think <= 0) {
    br.think = 0.2 + Math.random() * 0.1;
    let best = -1, bestScore = Infinity;
    for (const o of g.babos) {
      if (o === b || !o.alive || !g.canDamage(b, o)) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      const far = g.mode.waves ? 80 : 20;   // wave bots always hunt the defenders
      if (d > far) continue;
      const vis = g.arena.raycast(b.x, b.z, o.x, o.z, b.y + 0.55, true, CLIMB) < 0;
      if (!vis && d > (g.mode.waves ? 80 : 9)) continue;
      const lead = g.mode.waves && o.id === g.waveLeader ? 2.5 : 0;
      const bias = g.ffa.targetBias(o.id);   // adaptive: go easier on (or harder after) each human
      let s = d - lead + bias + (vis ? 0 : 8) - (o.id === br.target ? 3 : 0) - (o.hp < 40 ? 2.5 : 0) - (o.id === b.lastHitBy ? 3 : 0) + (o.spawnShield > 0 ? 6 : 0);
      if (s < bestScore) { bestScore = s; best = o.id; }
    }
    if (best !== br.target) br.seen = 0;
    br.target = best;
  }
  const t = br.target >= 0 ? g.babos[br.target] : null;
  const tAlive = t && t.alive;
  if (t) diff = g.ffa.aim(t.id, diff);   // adaptive only changes how bots treat the humans
  let visible = false, dist = 99;
  if (tAlive) {
    dist = Math.hypot(t.x - b.x, t.z - b.z);
    visible = g.arena.raycast(b.x, b.z, t.x, t.z, b.y + 0.55, true, CLIMB) < 0;
    if (visible) { br.seen += dt; br.lastSeenX = t.x; br.lastSeenZ = t.z; br.lastSeenT = g.clock; } else br.seen = 0;
  } else br.seen = 0;

  // --- movement goal
  let mx = 0, mz = 0;
  const wantHealth = b.hp < 45;
  // a gun lying close by is worth breaking off a pistol duel for
  const grab = b.weapon === START_WEAPON && !g.mode.gun && !g.mode.waves && dist > 3.5 && !!nearestPickup(g, b, ['weapon'], 8);
  // big balls only charge straight at you when they actually fit through the gap; otherwise they path round
  const fits = b.rad <= 0.6 || !tAlive || g.arena.clearPath(b.x, b.z, t.x, t.z, b.rad * 0.95, b.y);
  if (tAlive && visible && !wantHealth && !grab && fits) {
    const dx = (t.x - b.x) / dist, dz = (t.z - b.z) / dist;
    const pref = w.kind === 'melee' ? 0 : w.preferred;
    let fwd = dist > pref + 1.2 ? 1 : dist < pref - 1.2 ? -0.8 : 0;
    if (br.strafeT <= 0) { br.strafe = Math.random() < 0.55 ? -br.strafe : br.strafe; br.strafeT = 0.5 + Math.random() * 1.1; }
    const sf = w.kind === 'melee' ? 0.25 : 0.85;   // spikes: go straight for them
    const sfx = sf * (diff.strafe ?? 1);   // gentle bots dodge less
    mx = dx * fwd + -dz * br.strafe * sfx;
    mz = dz * fwd + dx * br.strafe * sfx;
    br.path = [];
  } else {
    // pick a destination: health, last known enemy, or a random roam point
    if (br.repath <= 0 || br.path.length === 0) {
      br.repath = 0.9 + Math.random() * 0.4;
      let gx: number, gz: number;
      const hp = wantHealth ? nearestPickup(g, b, ['health', 'mega']) : null;
      const nd = b.nades < 2 && Math.random() < 0.3 ? nearestPickup(g, b, ['nades']) : null;
      // stuck with the starting pistol: go and get a real gun
      const gun = b.weapon === START_WEAPON && !g.mode.gun && !g.mode.waves ? nearestPickup(g, b, ['weapon'], 22) : null;
      if (hp) { gx = hp.x; gz = hp.z; }
      else if (gun) { gx = gun.x; gz = gun.z; }
      else if (tAlive && g.clock - br.lastSeenT < 4) { gx = br.lastSeenX; gz = br.lastSeenZ; }
      else if (tAlive) { gx = t.x; gz = t.z; }
      else if (nd) { gx = nd.x; gz = nd.z; }
      else {
        if (Math.hypot(br.goalX - b.x, br.goalZ - b.z) < 2 || Math.random() < 0.15) {
          const s = g.arena.spawns[(Math.random() * g.arena.spawns.length) | 0]; br.goalX = s.x; br.goalZ = s.z;
        }
        gx = br.goalX; gz = br.goalZ;
      }
      br.path = g.arena.path(b.x, b.z, gx, gz, b.rad);
    }
    while (br.path.length && Math.hypot(br.path[0].x - b.x, br.path[0].z - b.z) < 0.7) br.path.shift();
    const wp = br.path[0];
    if (wp) {
      const d = Math.hypot(wp.x - b.x, wp.z - b.z) || 1;
      mx = (wp.x - b.x) / d; mz = (wp.z - b.z) / d;
      // brake early before sharp turns so momentum doesn't carry us into walls
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 1) { const along = (b.vx * mx + b.vz * mz) / sp; if (along < 0.5) { mx -= b.vx / sp * 0.5; mz -= b.vz / sp * 0.5; } }
    }
    // retreating while hurt and still in sight: strafe too
    if (tAlive && visible && wantHealth) { const dx = (t.x - b.x) / dist, dz = (t.z - b.z) / dist; mx += -dz * br.strafe * 0.5; mz += dx * br.strafe * 0.5; }
  }

  // avoid walls just ahead of our current motion
  const ml = Math.hypot(mx, mz);
  if (ml > 0.01) {
    mx /= ml; mz /= ml;
    const look = 1.1;
    if (!g.arena.clearPath(b.x, b.z, b.x + mx * look, b.z + mz * look, b.rad * 0.9, b.y)) {
      let found = false;
      for (const a of [0.7, -0.7, 1.4, -1.4, 2.1, -2.1]) {
        const ca = Math.cos(a), sa = Math.sin(a);
        const rx = mx * ca - mz * sa, rz = mx * sa + mz * ca;
        if (g.arena.clearPath(b.x, b.z, b.x + rx * look, b.z + rz * look, b.rad * 0.9, b.y)) { mx = rx; mz = rz; found = true; break; }
      }
      if (!found) { mx = -mx; mz = -mz; br.strafe = -br.strafe; }
    }
    // dodge nearby grenades
    for (const n of g.nades) {
      const d = Math.hypot(n.x - b.x, n.z - b.z);
      if (d < GRENADE.radius + 0.5 && n.fuse < 1.2) { mx += (b.x - n.x) / (d || 1) * 1.5; mz += (b.z - n.z) / (d || 1) * 1.5; }
    }
  }
  // stuck detection
  const sp = Math.hypot(b.vx, b.vz);
  if (ml > 0.01 && sp < 0.8) br.stuckT += dt; else br.stuckT = Math.max(0, br.stuckT - dt);
  if (br.stuckT > 0.8) {
    br.stuckT = 0; br.path = []; br.repath = 0;
    const open = b.rad > 0.6 ? g.arena.openSpot(b.x, b.z) : null;
    if (open) { br.path = [open]; br.repath = 0.8; }   // big ball wedged: back out to somewhere it fits first
    else { const a = Math.random() * Math.PI * 2; b.vx += Math.cos(a) * 3; b.vz += Math.sin(a) * 3; }
  }
  b.moveX = mx; b.moveZ = mz;

  // --- aim
  let desired = br.aimA;
  if (tAlive && visible) {
    const flight = w.speed > 0 ? dist / w.speed : 0;
    const px = t.x + t.vx * flight * diff.lead, pz = t.z + t.vz * flight * diff.lead;
    if (br.errT <= 0) { br.errT = 0.25 + Math.random() * 0.3; br.err = (Math.random() - 0.5) * 2 * diff.aimErr; }
    desired = Math.atan2(pz - b.z, px - b.x) + br.err;
  } else if (sp > 0.5) desired = Math.atan2(b.vz, b.vx);
  let da = desired - br.aimA; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
  const turn = (tAlive && visible ? 9 : 5) * dt;
  br.aimA += Math.max(-turn, Math.min(turn, da));
  b.aimX = Math.cos(br.aimA); b.aimZ = Math.sin(br.aimA);

  // --- trigger
  const range = (w.range ?? w.speed * w.life) * (w.kind === 'rocket' ? 0.6 : 0.95);
  b.aimDist = tAlive ? dist : 8;
  const aimed = Math.abs(da) < (w.pellets > 1 ? 0.35 : 0.2);
  b.fire = !!(tAlive && visible && br.seen > diff.react && aimed && dist < range && !(w.kind === 'rocket' && dist < 2.6) && !(w.kind === 'lob' && dist < 3.2) && w.kind !== 'melee' && t.spawnShield <= 0);
  // gravity gun: reel them in, let go once they're close (or it's been a while)
  if (w.kind === 'grav') b.fire = !!(tAlive && visible && br.seen > diff.react && dist < 8.5 && Math.abs(da) < 0.4 && !(b.gravT > 0.45 && dist < 2.6) && b.gravT < 1.8);
  if (b.fire && w.kind === 'rocket') {
    // don't blast a wall right next to us
    if (g.arena.raycast(b.x, b.z, b.x + b.aimX * 2.2, b.z + b.aimZ * 2.2, b.y + 0.55, false, CLIMB) >= 0) b.fire = false;
  }
  if (b.ammo <= 0 || (!visible && b.ammo < WEAPONS[b.weapon].clip * 0.5)) g.reload(b);

  // --- grenades: flush out hiding targets, or lob into close fights
  if (tAlive && b.nades > 0 && br.nadeT <= 0 && Math.random() < diff.nade) {
    const hidden = !visible && g.clock - br.lastSeenT < 2.5;
    const hx = hidden ? br.lastSeenX : t.x + t.vx * 0.8, hz = hidden ? br.lastSeenZ : t.z + t.vz * 0.8;
    const d = Math.hypot(hx - b.x, hz - b.z);
    if ((hidden || (visible && dist > 4 && Math.random() < 0.35)) && d > 3.5 && d < GRENADE.maxThrow) {
      g.throwNade(b, hx, hz); br.nadeT = 3 + Math.random() * 4;
    } else br.nadeT = 0.8;
  } else if (br.nadeT <= 0) br.nadeT = 1;

  // --- ability
  if (b.abCool <= 0 && tAlive && Math.random() < dt * 6 * (0.4 + diff.nade) * (diff.ability ?? 1)) {
    const recentlyHit = g.clock - b.lastHitT < 0.4;
    switch (b.ability) {
      case 'dash': b.wantAbility = (visible && dist < 5 && b.hp < 40) || br.stuckT > 0.4 || (visible && w.preferred < 4 && dist > 4 && dist < 8); break;
      case 'spikes': b.wantAbility = visible && dist < 2.4; if (b.wantAbility) { b.moveX = (t.x - b.x) / dist; b.moveZ = (t.z - b.z) / dist; } break;
      case 'bubble': b.wantAbility = recentlyHit && b.hp < 75; break;
      case 'shockwave': b.wantAbility = visible && dist < 3.4; break;
      case 'mine': b.wantAbility = (visible && dist > 2.5 && dist < 7 && Math.random() < 0.3) || (recentlyHit && b.hp < 50); break;
    }
  }
  // keep ramming while the spikes are out
  if (((b.abT > 0 && b.ability === 'spikes') || w.kind === 'melee') && tAlive && visible && dist < 6) { b.moveX = (t.x - b.x) / dist; b.moveZ = (t.z - b.z) / dist; }
}

function nearestPickup(g: Game, b: Babo, kinds: string[], range = 16) {
  let best: { x: number; z: number } | null = null, bd = range;
  for (const p of g.pickups) {
    if (p.t > 0 || !kinds.includes(p.kind)) continue;
    const d = Math.hypot(p.x - b.x, p.z - b.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
