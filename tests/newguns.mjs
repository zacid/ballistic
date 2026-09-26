// Flamethrower (burn + floor fire), gravity gun (pull, fling, wall slam), mines (arm, trip, blast).
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const errs = [];
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
p.on('pageerror', e => errs.push('PAGEERR ' + e.message + e.stack));
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
const setup = () => p.evaluate(() => {
  const g = window.__game; g.r.setQuality('low'); g.r.applyFlags();
  g.saved.soloMode = 'solo'; g.saved.map = 'random'; g.startSolo(); g.go();
  for (const b of g.babos) if (!b.isPlayer) { b.alive = false; b.root.visible = false; b.respawnT = 1e9; }
  // a long open strip of floor for testing
  const A = g.arena;
  let best = null;
  for (const s of A.spawns) { if (A.raycast(s.x, s.z, s.x + 10, s.z, 0.55) < 0 && A.raycast(s.x, s.z, s.x - 3, s.z, 0.55) < 0) { best = s; break; } }
  window.__spot = best; return !!best;
});
const put = (b, x, z) => { b.x = x; b.z = z; b.vx = b.vz = 0; b.y = b.gy = 0; };
console.log('open spot:', await setup());
const flame = await p.evaluate(() => {
  const g = window.__game, me = g.player, v = g.babos[1], s = window.__spot;
  const setW = (b, w) => { const pk = g.pickups.find(p => p.w === w); b.x = pk.x; b.z = pk.z; b.y = b.gy = g.arena.floorAt(pk.x, pk.z); g.step(1 / 120); };
  setW(me, 'flamethrower');
  me.x = s.x; me.z = s.z; me.y = me.gy = 0; me.aimX = 1; me.aimZ = 0; me.isPlayer = false;
  v.alive = true; v.root.visible = true; v.hp = 100; v.spawnShield = 0; v.x = s.x + 3; v.z = s.z; v.y = v.gy = 0; v.moveX = v.moveZ = 0;
  for (let i = 0; i < 60; i++) { me.fire = true; me.moveX = me.moveZ = 0; g.fire(me); g.step(1 / 120); v.x = s.x + 3; v.z = s.z; v.vx = v.vz = 0; }
  const afterSpray = v.hp, burning = v.burnT > 0;
  v.x = s.x - 30; // move out of the stream; burn keeps going
  for (let i = 0; i < 240; i++) { me.fire = false; g.step(1 / 120); }
  me.isPlayer = true;
  return { weapon: me.weapon, hpAfterHalfSecondOfFlame: Math.round(afterSpray), burning, hpAfterBurnOut: Math.round(v.hp), firesOnFloor: g.fires.length };
});
console.log('flamethrower:', JSON.stringify(flame));
await setup();
const grav = await p.evaluate(() => {
  const g = window.__game, me = g.player, v = g.babos[1], s = window.__spot;
  const pk = g.pickups.find(p => p.w === 'gravity'); me.x = pk.x; me.z = pk.z; me.y = me.gy = g.arena.floorAt(pk.x, pk.z); g.step(1 / 120);
  me.x = s.x; me.z = s.z; me.y = me.gy = 0; me.aimX = 1; me.aimZ = 0; me.isPlayer = false; me.vx = me.vz = 0;
  v.alive = true; v.root.visible = true; v.hp = 100; v.spawnShield = 0; v.x = s.x + 7; v.z = s.z; v.y = v.gy = 0; v.vx = v.vz = 0;
  const d0 = v.x - me.x;
  for (let i = 0; i < 120; i++) { me.fire = true; me.moveX = me.moveZ = 0; v.moveX = v.moveZ = 0; g.step(1 / 120); me.x = s.x; me.z = s.z; }
  const d1 = Math.hypot(v.x - me.x, v.z - me.z);
  me.fire = false; g.step(1 / 120);
  const speed = Math.hypot(v.vx, v.vz), hpFling = v.hp;
  let slam = false; for (let i = 0; i < 240 && v.alive; i++) { v.moveX = v.moveZ = 0; g.step(1 / 120); if (v.hp < hpFling - 5) slam = true; }
  me.isPlayer = true;
  return { weapon: me.weapon, startDist: d0.toFixed(1), afterOneSecondPull: d1.toFixed(1), flingSpeed: speed.toFixed(1), hpAfterFling: Math.round(hpFling), wallSlamHurt: slam, hpEnd: Math.round(v.hp) };
});
console.log('gravity gun:', JSON.stringify(grav));
await setup();
const mine = await p.evaluate(() => {
  const g = window.__game, me = g.player, v = g.babos[1], s = window.__spot;
  me.ability = 'mine'; me.abCool = 0; me.x = s.x; me.z = s.z; me.y = me.gy = 0;
  g.useAbility(me);
  const placed = g.mines.length;
  me.x = s.x - 6;   // walk away
  v.alive = true; v.root.visible = true; v.hp = 100; v.spawnShield = 0; v.x = s.x + 0.6; v.z = s.z; v.y = v.gy = 0;
  g.step(1 / 120);
  const notArmedYet = g.mines.length === 1 && v.hp === 100;
  v.x = s.x + 4;
  for (let i = 0; i < 140; i++) g.step(1 / 120);   // arm
  v.x = s.x + 0.8; v.z = s.z; v.vx = v.vz = 0;
  for (let i = 0; i < 3; i++) g.step(1 / 120);
  return { placed, notArmedYet, minesLeft: g.mines.length, victimHp: Math.round(v.hp), alive: v.alive };
});
console.log('mine:', JSON.stringify(mine));
// screenshot: flames and a pull in action
await p.evaluate(() => { const g = window.__game; g.saved.soloMode = 'solo'; g.startSolo(); g.go(); const me = g.player; const pk = g.pickups.find(p => p.w === 'flamethrower'); me.x = pk.x; me.z = pk.z; me.y = me.gy = g.arena.floorAt(pk.x, pk.z); });
await p.waitForTimeout(300);
await p.evaluate(() => { const g = window.__game; const t = g.babos[1]; t.x = g.player.x + 3; t.z = g.player.z; t.y = 0; g.input.mouseDown = true; const v = new window.__game.r.camera.position.constructor(t.x, 0.55, t.z).project(g.r.camera); g.input.mouse.set(v.x, v.y); });
await p.waitForTimeout(900);
await p.screenshot({ path: 'shots/flamethrower.png' });
await p.evaluate(() => { window.__game.input.mouseDown = false; });
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await b.close();
