// Rollout extras: weapon-class set bonuses, bombers (blow up on you; popped ones take their neighbours),
// healers, shielders, loot crates, special waves, and the lifetime stats page.
import { chromium } from 'playwright-core';
const shots = process.env.SHOTS || '.';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; p.on('pageerror', e => errs.push(e.message + ' ' + (e.stack || '').split('\n')[1]));
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
await p.evaluate(() => {
  const g = window.__game; g.hud.setPerf(false); g.saved.soloMode = 'run'; g.saved.ball = 'classic'; g.saved.difficulty = 'normal';
  g.startSolo(); g.go();
  g.input.apply = (me) => { me.moveX = me.moveZ = 0; me.fire = false; };
  for (const x of g.babos) if (!x.human) { x.alive = false; x.root.visible = false; }
});
const T = (name, fn) => p.evaluate(fn).then(v => console.log(name + ':', JSON.stringify(v)));

await T('classes', () => {
  const g = window.__game, r = g.run, P = r.gunRate('pistol');
  const { setWeapon } = { setWeapon: (b, w) => { b.weapon = w; } }; void setWeapon;
  const out = {};
  g.player.weapon = 'chaingun'; r.turrets.forEach(t => r.removeTurret(t)); r.addTurret({ w: 'chaingun', name: 'Buzz Turret', rate: 6, dmg: 3.5, range: 7, price: 20 }, 0); r.recalc();
  out.spray = `${r.classCount.get('spray')} guns, rate x${(r.gunRate('chaingun') / r.rateMul).toFixed(2)}, bonus "${r.classBonus.get('spray')?.text}"`;
  g.player.weapon = 'rocket'; r.removeTurret(r.turrets[0]); r.addTurret({ w: 'rocket', name: 'Rocket Pod', rate: 0.45, dmg: 10, range: 9, price: 32 }, 0); r.recalc();
  out.explosive = `blast x${r.blastMul('rocket')}, turret blast x${r.blastMul('turret:Rocket Pod')}, dmg x${(r.outMul(g.player, 'rocket') / r.dmgMul).toFixed(2)}`;
  g.player.weapon = 'lightning'; r.removeTurret(r.turrets[0]); r.addTurret({ w: 'lightning', name: 'Zap Turret', rate: 1.8, dmg: 7, range: 5.5, price: 27 }, 0); r.addTurret({ w: 'flamethrower', name: 'Torch Turret', rate: 10, dmg: 2.5, range: 3.4, price: 24 }, 0); r.recalc();
  out.elemental = `${r.classCount.get('elemental')} guns, extra chains ${r.extraChains('lightning')}`;
  out.pistolAlone = `rate x${(P / r.rateMul).toFixed(2)}`;
  r.turrets.slice().forEach(t => r.removeTurret(t)); g.player.weapon = 'pistol'; r.recalc();
  return out;
});

await T('bomber on you', () => {
  const g = window.__game, r = g.run, me = g.player; r.n = 7; me.hp = me.maxHp; me.spawnShield = 0;
  const m = r.addMinion('bomber', me.x + 1.2, me.z); let fuse = false;
  for (let i = 0; i < 240; i++) { g.step(1 / 120); if (m.st === 1) fuse = true; if (m.dead) break; }
  return { litFuse: fuse, blewUp: m.dead, hpAfter: Math.round(me.hp) + '/' + me.maxHp };
});
await T('bomber chain', () => {
  const g = window.__game, r = g.run, me = g.player; me.hp = me.maxHp;
  const x = me.x + 8, z = me.z;
  const bm = r.addMinion('bomber', x, z), others = [r.addMinion('roller', x + 1, z), r.addMinion('roller', x - 1, z + 0.5), r.addMinion('bomber', x + 0.5, z + 1.2)];
  g.step(1 / 120);
  r.damage(me, bm, 999, 0, 0, 'pistol');
  for (let i = 0; i < 5; i++) g.step(1 / 120);
  return { popped: bm.dead, neighboursGone: others.filter(o => o.dead).length + '/3', breakdown: [...r.dmgBy.keys()].join(', ') };
});
await T('healer', () => {
  const g = window.__game, r = g.run, me = g.player;
  r.minions.forEach(m => m.dead = true); g.step(1 / 120);
  const h = r.addMinion('healer', me.x + 9, me.z + 3), hurt = r.addMinion('tank', me.x + 9.5, me.z + 3.5); hurt.hp = hurt.max * 0.3;
  h.shootT = 0.05; const before = hurt.hp / hurt.max;
  for (let i = 0; i < 30; i++) g.step(1 / 120);
  return { before: before.toFixed(2), after: (hurt.hp / hurt.max).toFixed(2) };
});
await T('shielder', () => {
  const g = window.__game, r = g.run, me = g.player;
  const s = r.addMinion('shielder', me.x + 5, me.z); s.face = Math.atan2(-1, 0);   // facing the player (towards -x)
  const hp0 = s.hp; r.damage(me, s, 20, 3, 0, 'pistol'); const front = hp0 - s.hp;   // shot travelling +x hits its front
  const hp1 = s.hp; r.damage(me, s, 20, -3, 0, 'pistol'); const back = hp1 - s.hp;
  const hp2 = s.hp; r.damage(me, s, 20, 3, 0, 'grenade'); const blast = hp2 - s.hp;
  return { front: front.toFixed(1), back: back.toFixed(1), grenadeFromFront: blast.toFixed(1) };
});
await T('crate', () => {
  const g = window.__game, r = g.run, me = g.player;
  r.dropCrate(me.x + 0.4, me.z);
  for (let i = 0; i < 5; i++) g.step(1 / 120);
  const got = r.cratesPending;
  r.minions.forEach(m => m.dead = true); r.t = 0.001; g.step(1 / 120);
  const phase = r.phase, item = r.crateItem?.name, val = r.crateValue();
  const items0 = [...r.items.values()].reduce((a, v) => a + v, 0);
  r.openCrate(true);
  return { pending: got, phase, item, sellValue: val, itemsAfter: [...r.items.values()].reduce((a, v) => a + v, 0) - items0, next: r.phase };
});
await p.waitForTimeout(100);
await T('special waves', () => {
  const g = window.__game, r = g.run, seen = new Set();
  for (let k = 0; k < 12; k++) { while (r.phase === 'crate' || r.phase === 'levelup') { if (r.phase === 'crate') r.openCrate(true); else r.pickLevel(0); } r.phase = 'shop'; r.n = 6; r.nextWave(); seen.add(r.special); r.minions.forEach(m => m.dead = true); r.phase = 'shop'; }
  r.phase = 'shop'; r.n = 3; r.nextWave();
  const banner = document.getElementById('banner').textContent;
  let horde = null;
  if (r.special) { for (let i = 0; i < 120 * 6; i++) g.step(1 / 120); horde = `${r.minions.length} minions after 6 s (${[...new Set(r.minions.map(m => m.kind))].join(',')})`; }
  return { wave7specials: [...seen].join(','), wave5: r.special, banner, spawned: horde };
});
await p.waitForTimeout(300); await p.screenshot({ path: `${shots}/x-special.png` });
// new minion looks
await p.evaluate(() => { const g = window.__game, r = g.run, me = g.player; r.minions.forEach(m => m.dead = true); g.step(1 / 120);
  ['bomber', 'healer', 'shielder', 'bomber', 'shielder'].forEach((k, i) => { const m = r.addMinion(k, me.x + 3 + i * 1.1, me.z + (i % 2 ? 1 : -1)); m.face = -Math.PI / 2; });
  r.dropCrate(me.x - 2, me.z + 1); r.special = null; for (let i = 0; i < 3; i++) g.tick(1 / 60, false); });
await p.waitForTimeout(200); await p.screenshot({ path: `${shots}/x-minions.png` });
// shop with sets panel
await p.evaluate(() => { const g = window.__game, r = g.run; g.player.weapon = 'chaingun'; r.addTurret({ w: 'shotgun', name: 'Scatter Turret', rate: 0.8, dmg: 5, range: 4.2, price: 20, pellets: 6, spread: 0.5 }, 0); r.recalc(); r.phase = 'shop'; r.n = 1; r.offers = []; r.rollShop(); g.hud.runUi.open(); });
await p.waitForTimeout(300); await p.screenshot({ path: `${shots}/x-shop.png` });
// crate screen
await p.evaluate(() => { const g = window.__game, r = g.run; r.cratesPending = 1; r.crateItem = null; r.phase = 'crate'; r.rollCrate(); g.hud.runUi.open(); });
await p.waitForTimeout(200); await p.screenshot({ path: `${shots}/x-crate.png` });
// end the run and open the stats page
await p.evaluate(async () => { const g = window.__game; g.hud.runUi.close(); g.run.phase = 'wave'; g.applyDamage(g.player, 1e5, -1, 0, 0, 0, 0, 'swarm'); await new Promise(r => setTimeout(r, 1500)); g.hud.toMenu(); g.hud.showLifeStats(); });
await p.waitForTimeout(300); await p.screenshot({ path: `${shots}/x-stats.png` });
console.log('life:', await p.evaluate(() => JSON.stringify({ runs: window.__game.saved.life.runs, pops: window.__game.saved.life.pops, byBall: window.__game.saved.life.bestByBall })));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
