// Rollout co-op between two browsers through the local relay: the guest sees the host's minions, the
// guest's hits kill them on the host, coins pay both, the next wave waits for both to be ready, a downed
// player is revived by their teammate, and the run ends when both are down.
import { chromium } from 'playwright-core';
const shots = process.env.SHOTS || '.';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errs = [];
const mk = async (name, url) => {
  const ctx = await b.newContext({ viewport: { width: 800, height: 520 } });
  await ctx.addInitScript(() => { window.__RELAY = 'ws://127.0.0.1:8787'; window.__PEER_OPTS = { host: '127.0.0.1', port: 9000, path: '/', secure: false }; });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(name + ' PAGEERR ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_')) errs.push(name + ' ' + m.text()); });
  await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
  await p.evaluate(() => { const g = window.__game; g.r.setQuality('low'); g.r.flags.shadows = false; g.r.flags.res = 0.5; g.r.applyFlags(); g.hud.setPerf(false); });
  return p;
};
const A = await mk('A', 'http://127.0.0.1:8766/');
await A.click('#play-online'); await A.fill('#nick', 'Zac'); await A.click('#invite-btn');
await A.waitForFunction(() => !document.getElementById('invite-row').hidden, null, { timeout: 15000 });
const B = await mk('B', await A.inputValue('#invite-link'));
await B.evaluate(() => { window.__game.setNick('Kevin'); window.__game.saved.ball = 'gear'; });
await A.waitForFunction(() => window.__game.net.others().length > 0, null, { timeout: 40000 });
await A.waitForTimeout(800);
await A.click('#lobby-run');
await B.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
await A.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });

// both players: invulnerable for now, and scripted to shoot the nearest minion from where they stand
const script = (p) => p.evaluate(() => {
  const g = window.__game, r = g.run;
  const inc = r.incoming.bind(r); r.incoming = (d) => { if (window.__mortal) return inc(d); inc(d); return 0; };
  g.input.apply = (me) => {
    let best = null, bd = 1e9; for (const m of r.minions) { const d = Math.hypot(m.x - me.x, m.z - me.z); if (d < bd) { bd = d; best = m; } }
    if (best && bd < 10) { me.aimX = (best.x - me.x) / bd; me.aimZ = (best.z - me.z) / bd; me.fire = true; } else me.fire = false;
    me.semiLock = false; me.moveX = me.moveZ = 0; if (window.__goto) { const t = window.__goto, d = Math.hypot(t.x - me.x, t.z - me.z); if (d > 0.3) { me.moveX = (t.x - me.x) / d; me.moveZ = (t.z - me.z) / d; } }
    if (me.ammo <= 0 && me.reloadT <= 0) g.reload(me);
  };
});
await script(A); await script(B);
const st = (p) => p.evaluate(() => { const g = window.__game, r = g.run; return { host: g.host, phase: r.phase, n: r.n, t: r.t, minions: r.minions.length, coins: r.coins.length, mats: r.mats, earned: r.earned, lvl: r.lvl, turrets: r.turrets.length, remoteTurrets: r.remoteTurrets.length, kills: g.babos.map(b => b.kills).slice(0, 2), alive: g.babos.slice(0, 2).map(b => b.alive) }; });
await A.waitForTimeout(9000);
const a1 = await st(A), b1 = await st(B);
console.log('mid wave 1 A:', JSON.stringify(a1)); console.log('mid wave 1 B:', JSON.stringify(b1));
await A.screenshot({ path: `${shots}/duo-host.png` }); await B.screenshot({ path: `${shots}/duo-guest.png` });
// hurry the wave along
await A.evaluate(() => { window.__game.run.t = 2; });
await A.waitForFunction(() => window.__game.run.phase !== 'wave', null, { timeout: 30000 });
await B.waitForFunction(() => window.__game.run.phase !== 'wave', null, { timeout: 30000 });
console.log('break A:', JSON.stringify(await st(A))); console.log('break B:', JSON.stringify(await st(B)));
// pick level-ups, then A readies first: the wave must wait for B
for (const p of [A, B]) await p.evaluate(() => { const r = window.__game.run; while (r.phase === 'levelup') r.pickLevel(0); window.__game.hud.runUi.render(); });
await A.evaluate(() => window.__game.run.nextWave());
await A.waitForTimeout(1500);
console.log('A ready, B shopping: A', await A.evaluate(() => `${window.__game.run.phase} n${window.__game.run.n} btn "${document.querySelector('#runui .big-btn')?.textContent}"`), '| B sees', await B.evaluate(() => `${window.__game.run.partnerReady} "${document.querySelector('#runui .ru-mate')?.textContent}"`));
await B.evaluate(() => window.__game.run.nextWave());
await A.waitForFunction(() => window.__game.run.phase === 'wave' && window.__game.run.n === 2, null, { timeout: 20000 });
await B.waitForFunction(() => window.__game.run.phase === 'wave' && window.__game.run.n === 2, null, { timeout: 20000 });
console.log('wave 2 started on both');
// coins: give both a huge pickup range so they hoover everything, then compare what each earned
const e0 = [await A.evaluate(() => window.__game.run.earned), await B.evaluate(() => window.__game.run.earned)];
await A.evaluate(() => { window.__game.run.stats.pickup = 3000; }); await B.evaluate(() => { window.__game.run.stats.pickup = 3000; });
await A.waitForTimeout(9000);
const e1 = [await A.evaluate(() => window.__game.run.earned), await B.evaluate(() => window.__game.run.earned)];
console.log('coin probe A:', await A.evaluate(() => { const g = window.__game, r = g.run; return JSON.stringify({ coins: r.coins.length, fly: r.coins.slice(0, 5).map(c => c.fly), pr: r.pickupR, partner: r.partnerPickup, p: [g.player.x.toFixed(1), g.player.z.toFixed(1), g.player.alive], minions: r.minions.length, pops: r.pops, kills: g.babos.slice(0, 2).map(b => b.kills) }); }));
console.log('coins earned this stretch: host', e1[0] - e0[0], '| guest', e1[1] - e0[1], '| guest level', await B.evaluate(() => window.__game.run.lvl));
// B goes down; A rolls onto the marker and revives them
await B.evaluate(() => { window.__mortal = true; const g = window.__game; g.applyDamage(g.player, 1e4, -1, 0, 0, 0, 0, 'swarm'); });
await A.waitForFunction(() => !window.__game.babos[1].alive, null, { timeout: 10000 });
const mark = await A.evaluate(() => { const g = window.__game; const m = g.run.markers?.get?.(1); return m ? { x: m.x, z: m.z } : null; });
console.log('B downed; marker on A:', JSON.stringify(mark), '| B overlay:', await B.evaluate(() => document.getElementById('dead-by').textContent + ' / ' + document.getElementById('dead-tip').textContent.slice(0, 40)));
await A.evaluate((m) => { window.__goto = m; }, mark);
await B.waitForFunction(() => window.__game.player.alive, null, { timeout: 40000 }).catch(() => {});
await A.waitForTimeout(1500);
console.log('revived:', await B.evaluate(() => `${window.__game.player.alive} hp ${Math.round(window.__game.player.hp)}/${window.__game.player.maxHp}`), '| A sees B alive', await A.evaluate(() => window.__game.babos[1].alive));
await A.evaluate(() => { window.__goto = null; });
// both down: the run ends for both
await B.evaluate(() => { const g = window.__game; g.applyDamage(g.player, 1e4, -1, 0, 0, 0, 0, 'swarm'); });
await A.evaluate(() => { window.__mortal = true; const g = window.__game; g.applyDamage(g.player, 1e4, -1, 0, 0, 0, 0, 'swarm'); });
await A.waitForFunction(() => window.__game.state === 'over', null, { timeout: 20000 });
await B.waitForFunction(() => window.__game.state === 'over', null, { timeout: 20000 });
await A.waitForTimeout(1200);
console.log('over A:', await A.evaluate(() => document.getElementById('result-title').textContent), '| B:', await B.evaluate(() => document.getElementById('result-title').textContent));
await A.screenshot({ path: `${shots}/duo-result.png` });
console.log('errors:', errs.length ? errs : 'none');
await b.close();
