// Online Gun Game 1v1 + rematch: tiers sync, the rematch skips the lobby on both sides, map choice travels with the offer.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errs = [];
const mk = async (name, url) => {
  const ctx = await b.newContext({ viewport: { width: 640, height: 400 } });
  await ctx.addInitScript(() => { window.__RELAY = 'ws://127.0.0.1:8787'; window.__PEER_OPTS = { host: '127.0.0.1', port: 9000, path: '/', secure: false }; });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(name + ' PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_')) errs.push(name + ' ' + m.text()); });
  await p.goto(url, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
  await p.evaluate(() => { const g = window.__game; g.r.setQuality('low'); g.r.flags.shadows = false; g.r.flags.res = 0.5; g.r.applyFlags(); });
  return p;
};
const A = await mk('A', 'http://127.0.0.1:8766/');
await A.click('#play-online'); await A.fill('#nick', 'Zac'); await A.click('#invite-btn');
await A.waitForFunction(() => !document.getElementById('invite-row').hidden, null, { timeout: 15000 });
const B = await mk('B', await A.inputValue('#invite-link'));
await A.waitForFunction(() => window.__game.net.others().length > 0, null, { timeout: 40000 });
await A.waitForTimeout(600);
await A.click('#lobby-map-seg button:nth-child(4)');   // Towers
await A.click('#lobby-ggduel');
await B.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
const st = p => p.evaluate(() => { const g = window.__game; return `${g.state} mode=${g.mode.id} map=${g.map} e=${g.epoch} ` + g.babos.map(b => `${b.name}${b.local ? 'L' : 'R'}:L${b.tier + 1}.${b.tierKills}${b.won ? '*' : ''}/${b.weapon}`).join(' '); });
console.log('start A:', await st(A)); console.log('start B:', await st(B));
// B gets popped by A four times: A should climb to level 3 (2 per tier)
for (let i = 0; i < 4; i++) {
  await B.evaluate(() => { const g = window.__game; const me = g.player; me.spawnShield = 0; g.applyDamage(me, 999, 0, 0, 0, 0); });
  await B.waitForTimeout(200); console.log(await B.evaluate(() => { const g = window.__game, p = g.player; return [p.alive, p.respawnT, p.hp, g.state, g.paused]; }));
  await B.waitForFunction(() => window.__game.player.alive, null, { timeout: 20000 });
  await B.waitForTimeout(300);
}
await A.waitForTimeout(800);
console.log('after 4 pops A:', await st(A)); console.log('after 4 pops B:', await st(B));
console.log('B race pill:', await B.textContent('#race'), '| A race pill:', await A.textContent('#race'));
// end the match on the host, then rematch from the guest's result screen
await A.evaluate(() => window.__game.end('test'));
await B.waitForFunction(() => window.__game.state === 'over', null, { timeout: 8000 });
await B.waitForTimeout(1000);
console.log('B result:', await B.textContent('#result-title'), '| buttons:', await B.textContent('#again'), await B.evaluate(() => document.getElementById('to-lobby').hidden));
const e0 = await A.evaluate(() => window.__game.epoch);
await B.click('#again');
await A.waitForFunction((e0) => window.__game.epoch !== e0 && (window.__game.state === 'countdown' || window.__game.state === 'playing'), e0, { timeout: 10000 });
await A.waitForTimeout(500);
console.log('rematch A:', await st(A)); console.log('rematch B:', await st(B));
console.log('errors:', errs.length ? errs.slice(0, 8) : 'none');
await b.close();
