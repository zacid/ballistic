import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const srv = { kill() {} };
await new Promise(r => setTimeout(r, 800));
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 640, height: 400 } });
await ctx.addInitScript({ path: 'tests/mockroom.js' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const errs = [];
const mk = async (name) => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ' PAGEERR ' + e.message + '\n' + e.stack)); p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_')) errs.push(name + ' ' + m.text()); }); await p.goto('http://127.0.0.1:8765/ballistic.html', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200); await p.evaluate(() => { const g = window.__game; g.r.setQuality('low'); g.r.flags.shadows = false; g.r.flags.res = 0.5; g.r.applyFlags(); g.saved.quality = 'low'; }); return p; };
const A = await mk('A'), B = await mk('B');
const mode = process.argv[2] || 'duel';
await A.evaluate(() => { window.__game.saved.weapon = 'chaingun'; window.__game.pendingWeapon = 'chaingun'; });
await A.click('#play-online'); await B.click('#play-online');
await A.fill('#nick', 'Zac'); await B.fill('#nick', 'Friend');
await A.waitForTimeout(1500);
console.log('A lobby:', await A.textContent('#lobby-status'));
console.log('B lobby:', await B.textContent('#lobby-status'));
await A.waitForFunction(() => window.__game.net.others().length > 0);
await A.click('#lobby-' + mode);
await A.waitForTimeout(1500);
const st = p => p.evaluate(() => { const g = window.__game; return { state: g.state, host: g.host, online: g.online, me: g.player?.id, ents: g.babos.map(b => `${b.id}:${b.name}${b.local ? 'L' : 'R'}${b.alive ? '' : '(dead)'} ${b.x.toFixed(1)},${b.z.toFixed(1)} hp${Math.round(b.hp)} k${b.kills}/d${b.deaths}`) }; });
console.log('A', JSON.stringify(await st(A))); console.log('B', JSON.stringify(await st(B)));
// wait for countdown to finish (slow headless frames)
const t0 = Date.now(); for (let i = 0; i < 60; i++) { const s = await B.evaluate(() => window.__game.state); if (s === 'playing') break; await B.waitForTimeout(500); } console.log('countdown took', Date.now() - t0, 'ms real; fps A', await A.evaluate(() => window.__game.stats.summary().fps.toFixed(1)));
if (mode === 'coop') { await A.evaluate(() => { window.__game.input.mouseDown = false; }); await A.waitForTimeout(14000); }
else {
// put A next to B and open fire
await A.evaluate(() => { const g = window.__game; const me = g.player; const foe = g.babos.find(b => b.id !== me.id && b.human); me.x = foe.x + 3; me.z = foe.z; me.vx = me.vz = 0; g.pendingWeapon = 'chaingun'; });
for (let i = 0; i < 20; i++) {
  await A.evaluate(() => {
    const g = window.__game; const me = g.player; const foe = g.babos.find(b => b.id !== me.id && b.human);
    if (Math.hypot(me.x - foe.x, me.z - foe.z) > 4 || g.arena.raycast(me.x, me.z, foe.x, foe.z) >= 0) { for (let a = 0; a < 6.28; a += 0.4) { const x = foe.x + Math.cos(a) * 3, z = foe.z + Math.sin(a) * 3; if (!g.arena.solidAt(x, z) && g.arena.raycast(x, z, foe.x, foe.z) < 0) { me.x = x; me.z = z; break; } } me.vx = me.vz = 0; }
    const v = me.root.position.clone().set(foe.x, 0.55, foe.z).project(g.r.camera);
    g.input.mouse.set(v.x, v.y); g.input.mouseDown = true; g.input.keys.clear();
    
  }).catch(e => console.log(e.message));
  await A.waitForTimeout(500);
}
}
console.log('--- after 10s of A attacking');
console.log('A dbg', JSON.stringify(await A.evaluate(() => { const g = window.__game, me = g.player; return { fire: me.fire, ammo: me.ammo, reload: me.reloadT, aim: [me.aimX.toFixed(2), me.aimZ.toFixed(2)], shots: g.shots.length, md: g.input.mouseDown, touch: g.input.touch, paused: g.paused, log: g.net.log?.length }; })));
console.log('A', JSON.stringify(await st(A))); console.log('B', JSON.stringify(await st(B)));
await A.screenshot({ path: 'shots/mpA.png' }); await B.screenshot({ path: 'shots/mpB.png' });
// B leaves
await B.evaluate(() => window.__mockLeave()); await B.close();
await A.waitForTimeout(1500);
console.log('A after leave', await A.evaluate(() => [window.__game.state, window.__game.endReason]));
console.log(errs.slice(0, 10).join('\n'));
await b.close(); srv.kill();
