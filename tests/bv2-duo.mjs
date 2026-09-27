// Online: the theme reaches the guest, a Nuke Bot shows up on the guest's screen and pops them, and both kill feeds say how.
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


await A.evaluate(() => { const g = window.__game; g.saved.theme = 'snow'; g.saved.map = 'random'; });
await A.click('#lobby-duel');
await B.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 30000 });
const th = p => p.evaluate(() => { const g = window.__game; return `${g.theme} weather=${g.weather.kind} ice=${g.arena.ice.reduce((a, v) => a + v, 0)}`; });
console.log('theme A:', await th(A), '| B:', await th(B));
// A drops a nuke right next to B, then leaves
const s = await A.evaluate(() => { const g = window.__game, A = g.arena; return A.spawns.find(s => A.raycast(s.x, s.z, s.x + 3, s.z, 0.55) < 0 && A.floorAt(s.x, s.z) === 0); });
await A.evaluate((s) => { const g = window.__game, me = g.player; me.x = s.x; me.z = s.z; me.vx = me.vz = 0; me.spawnShield = 0; g.input.apply = (b) => { b.moveX = b.moveZ = 0; b.fire = false; }; }, s);
await B.evaluate((s) => { const g = window.__game, me = g.player; me.x = s.x + 2; me.z = s.z; me.vx = me.vz = 0; me.hp = 100; me.spawnShield = 0; g.input.apply = (b) => { b.moveX = b.moveZ = 0; b.fire = false; }; }, s);
await A.waitForTimeout(600);
await A.evaluate(() => { const g = window.__game, me = g.player; me.ability = 'nuke'; me.abCool = 0; me.wantAbility = true; g.useAbility(me); });
await A.waitForTimeout(400);
await A.evaluate(() => { const g = window.__game, me = g.player; me.x += 9; });
const seen = await B.waitForFunction(() => window.__game.nukes.length > 0, null, { timeout: 5000 }).then(() => true, () => false);
console.log('B sees the nuke ticking:', seen, await B.evaluate(() => JSON.stringify(window.__game.nukes.map(n => ({ cosmetic: n.cosmetic, t: n.t.toFixed(1) })))));
await A.waitForFunction(() => window.__game.nukes.length === 0, null, { timeout: 60000 });
await B.waitForFunction(() => window.__game.nukes.length === 0, null, { timeout: 30000 });
await B.waitForTimeout(1500);
const feed = p => p.evaluate(() => [...document.querySelectorAll('#feed div')].map(d => d.innerText.replace(/\s+/g, ' ').trim()));
console.log('B alive after blast:', await B.evaluate(() => window.__game.player.alive), '| nukes left A/B', await A.evaluate(() => window.__game.nukes.length), await B.evaluate(() => window.__game.nukes.length));
console.log('feed A:', JSON.stringify(await feed(A)), '| feed B:', JSON.stringify(await feed(B)));
console.log('B death screen:', await B.evaluate(() => document.getElementById('dead-by').innerText));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
