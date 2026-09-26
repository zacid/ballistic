// Online Hold the Fort: the guest mirrors waves, lives and the boss; a guest with no lives sits out.
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

await A.click('#lobby-waves');
await B.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
const st = p => p.evaluate(() => { const g = window.__game; return `${g.state} mode=${g.mode.id} map=${g.map} e=${g.epoch} ` + g.babos.map(b => `${b.name}${b.local ? 'L' : 'R'}:L${b.tier + 1}.${b.tierKills}${b.won ? '*' : ''}/${b.weapon}`).join(' '); });
console.log('start A:', await st(A)); console.log('start B:', await st(B));
const ws = p => p.evaluate(() => { const g = window.__game, w = g.wv; return `wave ${w.n} lives ${w.lives} break ${w.breakT.toFixed(1)} boss ${w.boss} out [${[...w.out]}] | clock "${document.getElementById('clock').textContent}" race "${document.getElementById('race').textContent}" | bots alive ${g.babos.filter(b => !b.human && b.alive).length} | music ${g.audio.music.track}/${g.audio.music.intensity}`; });
await A.waitForTimeout(6000);
console.log('A:', await ws(A)); console.log('B:', await ws(B));
// jump the host to the end of wave 4 so wave 5 (boss) comes next
await A.evaluate(() => { const g = window.__game; g.wv.n = 4; g.wv.queue = 0; for (const b of g.babos) if (!b.human && b.alive) { b.spawnShield = 0; g.applyDamage(b, 9999, 0, 0, 0); } });
await A.waitForFunction(() => window.__game.wv.boss >= 0, null, { timeout: 30000 });
await A.waitForTimeout(1500);
console.log('boss A:', await ws(A), await A.evaluate(() => { const b = window.__game.babos[window.__game.wv.boss]; return `${b.name} rad ${b.rad} hp ${Math.round(b.hp)}/${b.maxHp} ${b.weapon}`; }));
console.log('boss B:', await ws(B), await B.evaluate(() => { const b = window.__game.babos[window.__game.wv.boss]; return b ? `${b.name} rad ${b.rad} scale ${b.root.scale.x} hp ${Math.round(b.hp)} alive ${b.alive}` : 'none'; }));
await B.setViewportSize({ width: 1100, height: 700 });
await B.evaluate(() => { const g = window.__game, b = g.babos[g.wv.boss]; if (b) { g.player.x = b.x - 4; g.player.z = b.z; } g.player.hp = 9999; });
await B.waitForTimeout(1200); await B.screenshot({ path: 'shots/waves-boss.png' });
await B.evaluate(() => { window.__game.player.hp = 100; });
// no lives left: the guest sits out
await A.evaluate(() => { window.__game.wv.lives = 0; });
await A.waitForTimeout(300);
await B.evaluate(() => { const g = window.__game; g.player.spawnShield = 0; g.applyDamage(g.player, 9999, 2, 0, 0, 0); });
await B.waitForTimeout(4500);
console.log('guest out, A:', await ws(A)); console.log('guest out, B:', await ws(B), '| B alive', await B.evaluate(() => window.__game.player.alive), '|', await B.textContent('#dead-t'));
// host goes down too with nothing left: the fort falls for both
await A.evaluate(() => { const g = window.__game; g.player.spawnShield = 0; g.applyDamage(g.player, 9999, 2, 0, 0, 0); });
await B.waitForFunction(() => window.__game.state === 'over', null, { timeout: 10000 });
await B.waitForTimeout(1000);
console.log('B result:', await B.textContent('#result-title'), '|', await B.textContent('#result-sub'));
console.log('errors:', errs.length ? errs.slice(0, 8) : 'none');
await b.close();
