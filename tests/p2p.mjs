import { chromium } from 'playwright-core';
const mode = process.argv[2] || 'duel';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errs = [];
const mk = async (name, url) => {
  const ctx = await b.newContext({ viewport: { width: 640, height: 400 } });   // separate contexts = two different people
  await ctx.addInitScript(() => { window.__PEER_OPTS = { host: '127.0.0.1', port: 9000, path: '/', secure: false, config: { iceServers: [] } }; });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(name + ' PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_')) errs.push(name + ' ' + m.text()); });
  await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
  await p.evaluate(() => { const g = window.__game; g.r.setQuality('low'); g.r.flags.shadows = false; g.r.flags.res = 0.5; g.r.applyFlags(); g.saved.quality = 'low'; });
  return p;
};
const A = await mk('A', 'http://127.0.0.1:8766/');
await A.evaluate(() => { window.__game.saved.weapon = 'chaingun'; window.__game.pendingWeapon = 'chaingun'; });
await A.click('#play-online'); await A.fill('#nick', 'Zac');
await A.click('#invite-btn');
await A.waitForFunction(() => !document.getElementById('invite-row').hidden, null, { timeout: 15000 });
const link = await A.inputValue('#invite-link');
console.log('invite link:', link, '|', await A.textContent('#lobby-status'));
const B = await mk('B', link);
await B.waitForTimeout(500);
await B.fill('#nick', 'Kevin');
await A.waitForFunction(() => window.__game.net.others().length > 0, null, { timeout: 20000 });
await A.waitForTimeout(800);
console.log('A:', await A.textContent('#lobby-status'), '|', await A.textContent('#lobby-diag'));
console.log('B:', await B.textContent('#lobby-status'), '|', await B.textContent('#lobby-diag'));
await A.click('#lobby-' + mode);
await B.waitForFunction(() => window.__game.state === 'countdown' || window.__game.state === 'playing', null, { timeout: 20000 });
const st = p => p.evaluate(() => { const g = window.__game; return { state: g.state, host: g.host, ents: g.babos.map(b => `${b.id}:${b.name}${b.local ? 'L' : 'R'}${b.alive ? '' : '(dead)'} ${b.x.toFixed(1)},${b.z.toFixed(1)} hp${Math.round(b.hp)} k${b.kills}/d${b.deaths}`) }; });
await B.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
if (mode === 'duel') {
  for (let i = 0; i < 20; i++) {
    await A.evaluate(() => {
      const g = window.__game; const me = g.player; const foe = g.babos.find(b => b.id !== me.id && b.human);
      if (!foe.alive) return;
      if (Math.hypot(me.x - foe.x, me.z - foe.z) > 4 || g.arena.raycast(me.x, me.z, foe.x, foe.z) >= 0) { for (let a = 0; a < 6.28; a += 0.4) { const x = foe.x + Math.cos(a) * 3, z = foe.z + Math.sin(a) * 3; if (!g.arena.solidAt(x, z) && g.arena.raycast(x, z, foe.x, foe.z) < 0) { me.x = x; me.z = z; break; } } me.vx = me.vz = 0; }
      const v = me.root.position.clone().set(foe.x, 0.55, foe.z).project(g.r.camera);
      g.input.mouse.set(v.x, v.y); g.input.mouseDown = true; g.input.keys.clear();
    });
    await A.waitForTimeout(500);
  }
} else await A.waitForTimeout(12000);
console.log('A', JSON.stringify(await st(A))); console.log('B', JSON.stringify(await st(B)));
await B.close();
await A.waitForTimeout(8000);
console.log('A after friend closed:', await A.evaluate(() => [window.__game.state, window.__game.endReason]));
console.log(errs.slice(0, 8).join('\n'));
await b.close();
