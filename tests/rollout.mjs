// Rollout: plays a few waves with a scripted player (aims at the nearest minion, backs off from the closest),
// goes through level-ups and the shop, buys turrets, jumps to the wave-10 boss, and screenshots it all.
import { chromium } from 'playwright-core';
const shots = process.env.SHOTS || '.';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1200, height: 760 } });
const errs = []; p.on('pageerror', e => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]));
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

await p.evaluate(() => {
  const g = window.__game; g.hud.setPerf(false); g.r.setQuality('low');
  g.saved.soloMode = 'run'; g.saved.ball = 'classic'; g.saved.theme = 'toy'; g.saved.difficulty = 'normal'; g.hud.toMenu?.();
  g.startSolo();
  { const inc = g.run.incoming.bind(g.run); g.run.incoming = (d) => { inc(d); return 0; }; }   // survive (but count the damage), so the whole run can be walked through
  // scripted player
  window.__auto = true;
  g.input.apply = (me) => {
    const r = g.run; let best = null, bd = 1e9, close = null, cd = 1e9;
    for (const m of r.minions) { const d = Math.hypot(m.x - me.x, m.z - me.z); if (d < bd && g.arena.raycast(me.x, me.z, m.x, m.z, 0.55) < 0) { bd = d; best = m; } if (d < cd) { cd = d; close = m; } }
    for (const o of g.babos) if (!o.human && o.alive) { const d = Math.hypot(o.x - me.x, o.z - me.z); if (d < bd) { bd = d; best = o; } }
    if (best) { const d = Math.hypot(best.x - me.x, best.z - me.z) || 1; me.aimX = (best.x - me.x) / d; me.aimZ = (best.z - me.z) / d; me.fire = bd < 11; } else me.fire = false;
    me.semiLock = false;
    if (close && cd < 4.5) { me.moveX = (me.x - close.x) / cd; me.moveZ = (me.z - close.z) / cd; if (Math.hypot(me.x, me.z) > g.arena.half - 3) { me.moveX -= me.x * 0.1; me.moveZ -= me.z * 0.1; } }
    else {
      // safe: go and hoover up coins
      let c = null, bc = 1e9; for (const k of r.coins) { const d = Math.hypot(k.x - me.x, k.z - me.z); if (d < bc) { bc = d; c = k; } }
      if (c) { me.moveX = (c.x - me.x) / bc; me.moveZ = (c.z - me.z) / bc; } else { me.moveX = -me.x * 0.05; me.moveZ = -me.z * 0.05; }
    }
    if (me.ammo <= 0 && me.reloadT <= 0) g.reload(me);
  };
});
const sim = (sec) => p.evaluate((sec) => { const g = window.__game; for (let i = 0; i < sec * 120; i++) { g.step(1 / 120); if (g.run.phase !== 'wave' || g.state !== 'playing' && g.state !== 'countdown') break; } g.tick(0, false); g.hud.update(0.1); }, sec);
const st = () => p.evaluate(() => { const g = window.__game, r = g.run, me = g.player; return { dmgTaken: Math.round(r.waveDmgTaken), state: g.state, phase: r.phase, wave: r.n, t: +r.t.toFixed(1), minions: r.minions.length, kinds: [...new Set(r.minions.map(m => m.kind))].join(','), coinsFloor: r.coinsOnFloor, mats: r.mats, lvl: r.lvl, pending: r.pending, hp: Math.round(me.hp) + '/' + me.maxHp, pops: r.pops, turrets: r.turrets.map(t => t.def.name + ' T' + (t.tier + 1)).join(', '), gun: me.weapon + ' T' + (r.mainTier + 1), piggy: r.piggy, elites: g.babos.filter(x => !x.human && x.alive).length }; });

await sim(4);   // countdown
await sim(10);
console.log('wave 1 mid:', JSON.stringify(await st()));
await p.screenshot({ path: `${shots}/rollout-wave1.png` });
await sim(20);
console.log('after wave 1:', JSON.stringify(await st()));
await p.waitForTimeout(400);
await p.screenshot({ path: `${shots}/rollout-levelup.png` });
// pick level-ups by pressing 1, until the shop
for (let i = 0; i < 8; i++) { const ph = await p.evaluate(() => window.__game.run.phase); if (ph !== 'levelup' && ph !== 'crate') break; await p.keyboard.press('1'); }
console.log('shop:', JSON.stringify(await p.evaluate(() => { const r = window.__game.run; return { phase: r.phase, offers: r.offers.map(o => `${o.kind}:${o.kind === 'item' ? o.item.name : o.kind === 'turret' ? o.turret.name : o.w} T${o.tier + 1} $${o.price}`), reroll: r.rerollCost, mats: r.mats }; })));
await p.waitForTimeout(300);
await p.screenshot({ path: `${shots}/rollout-shop.png` });
// buy the turret (first shops always have one)
console.log('buy turret:', await p.evaluate(() => { const r = window.__game.run; r.mats += 40; const i = r.offers.findIndex(o => o.kind === 'turret'); const m = r.buy(i); window.__game.hud.runUi.render(); return m ?? `ok, turrets: ${r.turrets.map(t => t.def.name).join(', ')}`; }));
await p.click('[data-a="next"]');
for (let w = 2; w <= 5; w++) {
  await sim(70);
  const s = await st();
  console.log(`after wave ${w}:`, JSON.stringify(s));
  if (s.state !== 'playing') break;
  await p.evaluate(() => { const g = window.__game, r = g.run; while (r.phase === 'crate' || r.phase === 'levelup') { if (r.phase === 'crate') r.openCrate(0); else r.pickLevel(0); } r.mats += 60;
    // buy the cheapest turret or item each shop
    let best = -1, bp = 1e9; r.offers.forEach((o, i) => { if (!o.sold && o.price < bp && (o.kind !== 'turret' || r.turrets.length < 4)) { bp = o.price; best = i; } });
    if (best >= 0) r.buy(best); r.nextWave(); });
}
await p.evaluate(() => { const g = window.__game; g.tick(1 / 60, false); });
await sim(8);
await p.screenshot({ path: `${shots}/rollout-wave5.png` });
// jump to the wave-10 boss
const boss = await p.evaluate(() => { const g = window.__game, r = g.run; for (const m of r.minions) m.dead = true; r.minions.length = 0; r.phase = 'shop'; r.n = 9; g.player.hp = g.player.maxHp; r.nextWave();
  const bs = g.babos[r.bossId]; return { bossWave: r.bossWave, boss: bs ? `${bs.name} hp ${bs.hp} r ${bs.rad.toFixed(2)} ${bs.weapon}` : 'none', banner: document.getElementById('banner').textContent }; });
console.log('boss wave:', JSON.stringify(boss));
await sim(5);
await p.screenshot({ path: `${shots}/rollout-boss.png` });
const end = await p.evaluate(() => { const g = window.__game, r = g.run, bs = g.babos[r.bossId]; if (bs) g.applyDamage(bs, 1e5, g.player.id, 0, 0); for (let i = 0; i < 60; i++) g.step(1 / 120); return { phase: r.phase, wave: r.n, state: g.state }; });
console.log('after boss:', JSON.stringify(end));
// die: the run ends with a results screen
const dead = await p.evaluate(async () => { const g = window.__game, r = g.run; delete r.incoming; while (r.phase === 'crate' || r.phase === 'levelup') { if (r.phase === 'crate') r.openCrate(0); else r.pickLevel(0); } r.nextWave(); g.applyDamage(g.player, 1e5, -1, 0, 0, 0, 0, 'swarm'); for (let i = 0; i < 240; i++) g.step(1 / 120); await new Promise(res => setTimeout(res, 1200)); return { state: g.state, title: document.getElementById('result-title').textContent, sub: document.getElementById('result-sub').textContent, best: g.saved.runBest }; });
console.log('death:', JSON.stringify(dead));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
