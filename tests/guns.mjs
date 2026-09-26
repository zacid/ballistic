// Gun pickups, drops, power-weapon ammo, lingering railgun beam, shotgun range, chaingun falloff.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const errs = [];
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
p.on('pageerror', e => errs.push('PAGEERR ' + e.message + e.stack));
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
await p.screenshot({ path: 'shots/menu-guns.png' });
const r = await p.evaluate(() => {
  const g = window.__game; g.r.setQuality('low'); g.r.applyFlags();
  g.saved.soloMode = 'solo'; g.saved.map = 'fort'; g.startSolo(); g.go();
  const out = {};
  const guns = g.pickups.filter(p => p.kind === 'weapon');
  out.spots = guns.map(p => `${p.w}@${p.x.toFixed(0)},${p.z.toFixed(0)}`).join(' ');
  out.start = g.player.weapon;
  const me = g.player, bots = g.babos.filter(b => !b.isPlayer);
  for (const b of bots) { b.alive = false; b.root.visible = false; b.respawnT = 1e9; }
  // roll onto the rocket spot
  const rk = guns.find(p => p.w === 'rocket'); me.x = rk.x; me.z = rk.z; me.y = me.gy = g.arena.floorAt(rk.x, rk.z); me.vx = me.vz = 0; g.step(1 / 120);
  out.afterPickup = `${me.weapon} clip ${me.ammo} +${me.reserve}; spot respawn ${rk.t.toFixed(0)}s`;
  // empty it: 8 rockets then back to the pistol
  let shots = 0;
  for (let i = 0; i < 120 * 30 && me.weapon === 'rocket'; i++) { me.isPlayer = false; me.fire = true; me.aimX = 0; me.aimZ = 1; if (me.cool <= 0 && me.reloadT <= 0 && me.ammo > 0) shots++; g.fire(me); g.step(1 / 120); me.hp = 100; }
  me.isPlayer = true;
  out.rocketsFired = shots; out.afterEmpty = me.weapon;
  // railgun linger: fire into empty space, then put a bot in the beam 0.3 s later
  const v = bots[0]; setTimeout(() => {}, 0);
  me.x = 0; me.z = 0; me.y = me.gy = g.arena.floorAt(0, 0);
  const W = window.__game; W.player.weapon = 'railgun';
  return out;
});
console.log(JSON.stringify(r, null, 1));
const rail = await p.evaluate(() => {
  const g = window.__game, me = g.player, v = g.babos.find(b => !b.isPlayer);
  // stand in open ground outside the keep
  const s = g.arena.spawns.find(s => g.arena.floorAt(s.x, s.z) === 0 && g.arena.raycast(s.x, s.z, s.x + 8, s.z, 0.55) < 0);
  me.x = s.x; me.z = s.z; me.y = me.gy = 0; me.vx = me.vz = 0;
  g.fx.clear();
  // spawn helpers are private; use the weapon setter the pickups use
  const pk = g.pickups.find(p => p.w === 'railgun'); me.x = pk.x; me.z = pk.z; me.y = me.gy = g.arena.floorAt(pk.x, pk.z); g.step(1 / 120); me.x = s.x; me.z = s.z; me.y = me.gy = 0;
  me.aimX = 1; me.aimZ = 0; me.cool = 0; me.reloadT = 0; me.spawnShield = 0;
  g.fire(me);
  for (let i = 0; i < 36; i++) g.step(1 / 120);   // 0.3 s later
  v.alive = true; v.root.visible = true; v.hp = 100; v.spawnShield = 0; v.x = s.x + 5; v.z = s.z; v.y = v.gy = 0; v.vx = 0; v.vz = 0; v.respawnT = 1e9;
  for (let i = 0; i < 5; i++) g.step(1 / 120);
  const hpInBeam = v.hp;
  v.hp = 100; for (let i = 0; i < 80; i++) g.step(1 / 120);   // beam gone by now
  return { weapon: me.weapon, rails: g.rails.length, hpAfterRollingIn: Math.round(hpInBeam), hpLater: Math.round(v.hp) };
});
console.log('railgun linger:', JSON.stringify(rail));
await p.evaluate(() => { const g = window.__game, me = g.player; const pk = g.pickups.find(p => p.w === 'shotgun'); me.x = pk.x + 0.3; me.z = pk.z; me.vx = me.vz = 0; for (let i = 0; i < 90; i++) g.step(1 / 120); for (const b of g.babos) if (!b.isPlayer) { b.alive = true; b.root.visible = true; b.x = pk.x + 3 + b.id * 0.9; b.z = pk.z + 2; b.y = 0; b.respawnT = 1e9; b.brain = undefined; } });
await p.waitForTimeout(1500);
await p.screenshot({ path: 'shots/guns-field.png' });
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await b.close();
