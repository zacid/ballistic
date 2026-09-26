// Practice range + lightning gun + the tidier menu.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1368, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message + e.stack));
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2000);
await p.evaluate(() => window.__game.hud.setPerf(false));
await p.screenshot({ path: 'shots/menu-tidy.png' });
console.log('menu scroll height:', await p.evaluate(() => document.getElementById('menu').scrollHeight), '| arsenal hidden:', await p.evaluate(() => document.getElementById('arsenal').hidden));
console.log('pickable guns:', await p.evaluate(() => [...document.querySelectorAll('.gun .nm')].map(e => e.textContent).join(', ')));
// lightning: lock on + chain
const zap = await p.evaluate(() => {
  const g = window.__game; g.saved.soloMode = 'solo'; g.saved.map = 'random'; g.saved.botCount = 3; g.startSolo(); g.go();
  const me = g.player, A = g.arena, [t1, t2, t3] = g.babos.slice(1);
  const s = A.spawns.find(s => A.raycast(s.x, s.z, s.x + 8, s.z, 0.55) < 0 && A.raycast(s.x, s.z + 1.5, s.x + 8, s.z + 1.5, 0.55) < 0);
  me.x = s.x; me.z = s.z; me.y = me.gy = 0;
  for (const [t, dx, dz] of [[t1, 5, 1.2], [t2, 7, 2.2], [t3, 7.5, -0.5]]) { t.alive = true; t.root.visible = true; t.x = s.x + dx; t.z = s.z + dz; t.y = t.gy = 0; t.hp = 100; t.spawnShield = 0; t.respawnT = 1e9; }
  const pk = g.pickups.find(q => q.w === 'lightning'); const ox = me.x; me.x = pk.x; me.z = pk.z; me.y = me.gy = g.arena.floorAt(pk.x, pk.z); g.step(1 / 120); me.x = ox; me.z = s.z; me.y = me.gy = 0;
  me.aimX = 1; me.aimZ = 0; me.cool = 0; me.reloadT = 0;
  const hp0 = [t1.hp, t2.hp, t3.hp];
  g.fire(me);
  return { weapon: me.weapon, angleOffFirst: (Math.atan2(1.2, 5) * 180 / Math.PI).toFixed(0) + '°', hp: [t1.hp, t2.hp, t3.hp].map((h, i) => Math.round(hp0[i] - h)).join('/') + ' dmg dealt' };
});
console.log('lightning (target 13° off the crosshair, two more nearby):', JSON.stringify(zap));
await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 20; i++) { g.player.cool = 0; g.fire(g.player); g.tick(1 / 60, false); } g.tick(0.001, true); });
await p.screenshot({ path: 'shots/lightning.png' });
// practice range: pop 20 targets
const pr = await p.evaluate(() => {
  const g = window.__game; g.startPractice(); g.go();
  const info = { mode: g.mode.id, targets: g.babos.length - 1, guns: g.pickups.filter(q => q.kind === 'weapon').length };
  g.practiceGun(2); info.swap = g.player.weapon;
  let pops = 0;
  for (let i = 0; i < 120 * 60 && g.state === 'playing'; i++) {
    g.step(1 / 120);
    if (i % 45 === 0 && g.player.kills < 20) { const t = g.babos.find(x => !x.human && x.alive && x.spawnShield <= 0); if (t) { g.hit(g.player, t, 999, 0, 0, 0); pops++; } }
    if (i === 600) { g.player.spawnShield = 0; g.applyDamage(g.player, 500, 1, 0, 0, 0); info.playerHpAfterHit = g.player.hp; }
  }
  info.state = g.state; info.time = g.matchT.toFixed(1); info.best = g.saved.practiceBest; info.targetsStillHarmless = g.babos.every(x => x.human || !x.fire);
  return info;
});
await p.waitForTimeout(1200);
console.log('practice:', JSON.stringify(pr), '| result:', await p.textContent('#result-title'), '/', await p.textContent('#result-sub'), '| again:', await p.textContent('#again'));
await p.screenshot({ path: 'shots/practice-result.png' });
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await b.close();
