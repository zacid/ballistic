// Hold the Fort, solo: the player is handed to the bot AI (and made tough) so the waves get fought,
// then popped repeatedly to check lives, sitting out, and the fort falling.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'] });
const errs = [];
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
p.on('pageerror', e => errs.push('PAGEERR ' + e.message + e.stack));
p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_')) errs.push(m.text()); });
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
await p.mouse.click(5, 5);   // a gesture, so the menu music starts
await p.waitForTimeout(600);
console.log('menu music:', await p.evaluate(() => { const m = window.__game.audio.music; return [m.track, m.intensity, window.__game.audio.ctx?.state]; }));
await p.evaluate(() => { const g = window.__game; g.r.setQuality('low'); g.r.flags.shadows = false; g.r.applyFlags(); g.saved.soloMode = 'waves'; g.saved.map = 'random'; g.saved.difficulty = 'normal'; g.startSolo(); });
await p.waitForTimeout(500);
const sim = (secs) => p.evaluate(async (secs) => {
  const g = window.__game; if (g.state === 'countdown') g.go();
  const log = []; let last = -1, bossSeen = false;
  for (let i = 0; i < secs * 120 && g.state === 'playing'; i++) {
    g.player.isPlayer = false; if (g.player.alive) g.player.hp = Math.max(g.player.hp, 400);
    g.step(1 / 120);
    if (g.wv.boss >= 0) bossSeen = true;
    if (g.wv.n !== last) { last = g.wv.n; log.push(`w${g.wv.n}@${Math.round(g.matchT)}s`); }
    if (i % 60 === 0) g.tick(0, false);   // let the HUD and music update now and then
  }
  g.player.isPlayer = true;
  const bots = g.babos.filter(b => !b.human);
  return { state: g.state, map: g.map, wave: g.wv.n, lives: g.wv.lives, queue: g.wv.queue, alive: bots.filter(b => b.alive).length, bossSeen, log: log.join(' '), clock: document.getElementById('clock').textContent, race: document.getElementById('race').textContent, music: [g.audio.music.track, g.audio.music.intensity], kills: g.player.kills, boss: bots.find(b => b.boss)?.maxHp };
}, secs);
console.log('after 60s:', JSON.stringify(await sim(60)));
await p.screenshot({ path: 'shots/waves-mid.png' });
console.log('after 180s more:', JSON.stringify(await sim(180)));
await p.screenshot({ path: 'shots/waves-late.png' });
// now let the defenders fall: pop the player until the lives run out
const fall = await p.evaluate(async () => {
  const g = window.__game; const out = [];
  for (let k = 0; k < 14 && g.state === 'playing'; k++) {
    for (let i = 0; i < 400 && !g.player.alive && g.state === 'playing'; i++) g.step(1 / 120);
    if (g.state !== 'playing') break;
    g.player.spawnShield = 0; g.applyDamage(g.player, 9999, 1, 0, 0, 0);
    out.push(`L${g.wv.lives}${g.wv.out.has(g.player.id) ? ' out' : ''}`);
    for (let i = 0; i < 60; i++) g.step(1 / 120);
  }
  return { state: g.state, trail: out.join(', '), reason: g.endReason };
});
console.log('falling:', JSON.stringify(fall));
await p.waitForTimeout(1500);
console.log('result:', await p.textContent('#result-title'), '|', await p.textContent('#result-sub'), '| music', await p.evaluate(() => window.__game.audio.music.track));
await p.screenshot({ path: 'shots/waves-result.png' });
console.log('errors:', errs.length ? errs.slice(0, 8) : 'none');
await b.close();
