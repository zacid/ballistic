// Online 2 vs bots with Adaptive: the host rates both humans, bots adapt to each, and the guest mirrors its own rating.
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
await A.evaluate(() => { window.__game.saved.difficulty = 'adaptive'; });
await A.click('#lobby-coop');
await B.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
const st = p => p.evaluate(() => { const g = window.__game; return `${g.state} mode=${g.mode.id} map=${g.map} n=${g.arena.n} e=${g.epoch} ` + g.babos.map(b => `${b.name}${b.local ? 'L' : 'R'}:L${b.tier + 1}.${b.tierKills}${b.won ? '*' : ''}/${b.weapon}`).join(' '); });
console.log('start A:', await st(A)); console.log('start B:', await st(B));
const rate = (P) => P.evaluate(() => { const g = window.__game; return `active ${g.ffa.active} shown ${g.ffa.showsFor(g.player.id)} host-view [${[0, 1].map(i => g.ffa.skillOf(i)?.toFixed(2)).join(', ')}] meter ${!!document.querySelector('#race .threat')} saved ${g.saved.ffaSkill}`; });
await A.waitForTimeout(2500);
console.log('A:', await rate(A)); console.log('B:', await rate(B));
// Kevin (B) keeps getting popped by a bot: the host should ease the bots off him, not Zac
for (let i = 0; i < 4; i++) {
  await B.evaluate(() => { const g = window.__game, me = g.player; me.spawnShield = 0; g.applyDamage(me, 999, 3, 0, 0, 0); });
  await B.waitForFunction(() => window.__game.player.alive, null, { timeout: 30000 });
}
await A.waitForTimeout(1200);
console.log('after Kevin popped 4x, A:', await rate(A)); console.log('B:', await rate(B));
console.log('bots vs Kevin now:', await A.evaluate(() => { const g = window.__game, f = g.ffa; return `hits x${f.damage(1).toFixed(2)} react ${f.aim(1, { react: 0, aimErr: 0, lead: 0, nade: 0 }).react.toFixed(2)} | vs Zac hits x${f.damage(0).toFixed(2)}`; }));
console.log('errors:', errs.length ? errs.slice(0, 8) : 'none');
await b.close();
