// Quality-of-life batch: hit-direction arcs, killcam, gun pad labels, end-of-match stats, volume
// sliders, baked shadows on Medium/Low, and no GPU memory creep from match to match.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
const errs = []; p.on('pageerror', e => errs.push(e.message + e.stack));
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
// memory across matches
const mem = await p.evaluate(() => {
  const g = window.__game, out = [];
  for (let i = 0; i < 12; i++) { g.saved.soloMode = 'solo'; g.saved.map = ['random', 'fort', 'towers'][i % 3]; g.startSolo(); g.tick(0.016, true); out.push(g.r.renderer.info.memory.geometries + 'g/' + g.r.renderer.info.memory.textures + 't'); g.end(); }
  return out.join(' ');
});
console.log('GPU memory after each of 12 matches:', mem);
// arcs, killcam, labels
await p.evaluate(() => {
  const g = window.__game; g.hud.setPerf(false); g.saved.soloMode = 'solo'; g.saved.map = 'random'; g.saved.arenaSize = 'small'; g.startSolo(); g.go();
  const me = g.player, gun = g.pickups.find(q => q.kind === 'weapon'); me.x = gun.x - 2.5; me.z = gun.z; me.y = me.gy = 0;
  const att = g.babos[2]; att.x = me.x + 4; att.z = me.z + 3; att.spawnShield = 0;
  for (let i = 0; i < 60; i++) g.tick(1 / 60, false);
  me.spawnShield = 0; g.applyDamage(me, 20, att.id, 0, 0, 0);
  g.tick(1 / 60, true); g.hud.update(0.016);
});
await p.waitForTimeout(150);
await p.screenshot({ path: 'shots/qol-hit.png' });
console.log('arc:', await p.evaluate(() => { const a = document.querySelector('.dmgarc'); return a ? a.style.transform + ' opacity ' + a.style.opacity : 'none'; }), '| pad labels:', await p.evaluate(() => [...document.querySelectorAll('.padlbl')].filter(e => e.style.display !== 'none').map(e => e.textContent).join(', ')));
await p.evaluate(() => { const g = window.__game, me = g.player; g.applyDamage(me, 999, 2, 0, 0, 0); for (let i = 0; i < 30; i++) g.tick(1 / 60, false); g.tick(1 / 60, true); g.hud.update(0.016); });
await p.waitForTimeout(150);
await p.screenshot({ path: 'shots/qol-killcam.png' });
console.log('killcam:', await p.evaluate(() => [window.__game.killCam, document.getElementById('dead').className, document.getElementById('dead-by').textContent]));
// stats: play a stretch as a bot-driven "you", then end
const st = await p.evaluate(() => {
  const g = window.__game; g.saved.soloMode = 'solo'; g.startSolo(); g.go();
  for (let i = 0; i < 60 * 120 && g.state === 'playing'; i++) { g.player.isPlayer = false; g.step(1 / 120); }
  g.player.isPlayer = true; g.end();
  return JSON.stringify(g.ms);
});
await p.waitForTimeout(1200);
console.log('match stats:', st, '| tiles:', await p.evaluate(() => [...document.querySelectorAll('#result-stats .st')].map(e => e.textContent).join(' | ')));
await p.screenshot({ path: 'shots/qol-result.png' });
// settings sliders and shadow modes
console.log('sliders:', await p.evaluate(() => { const g = window.__game; document.getElementById('gear').click(); return [document.getElementById('vol-sfx').value, document.getElementById('vol-music').value, g.saved.sfxVol, g.saved.musicVol]; }));
console.log('shadow modes:', await p.evaluate(() => { const r = window.__game.r, out = []; for (const q of ['ultra', 'high', 'medium', 'low']) { r.setQuality(q); out.push(`${q}:${r.dynShadows ? 'live' : 'baked'}`); } return out.join(' '); }));
await p.evaluate(() => { const g = window.__game; document.getElementById('gear').click(); g.r.setQuality('medium'); g.saved.soloMode = 'solo'; g.saved.map = 'fort'; g.startSolo(); g.go(); for (let i = 0; i < 90; i++) g.tick(1 / 60, false); g.tick(1 / 60, true); });
await p.screenshot({ path: 'shots/qol-baked.png' });
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await b.close();
