// Solo smoke test: Gun Game on each hand-made arena, bots only (the player is parked), fast-forwarded.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const errs = [];
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
p.on('pageerror', e => errs.push('PAGEERR ' + e.message + e.stack));
p.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_')) errs.push(m.text()); });
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
await p.screenshot({ path: 'shots/menu.png' });
for (const [mode, map, diff] of [['gungame', 'fort', 'hard'], ['gungame', 'towers', 'normal'], ['solo', 'random', 'normal'], ['solo', 'fort', 'normal']]) {
  await p.evaluate(([mode, map, diff]) => { const g = window.__game; g.r.setQuality('low'); g.r.flags.shadows = false; g.r.applyFlags(); g.saved.soloMode = mode; g.saved.map = map; g.saved.difficulty = diff; g.saved.weapon = 'railgun'; g.pendingWeapon = 'railgun'; g.startSolo(); }, [mode, map, diff]);
  await p.waitForTimeout(4000);
  if (map === 'fort') await p.screenshot({ path: `shots/${mode}-${map}.png` });
  // fast-forward the sim: step 120 Hz for ~90 s of game time
  const r = await p.evaluate(async () => {
    const g = window.__game; if (g.state === 'countdown') g.go(); const t0 = performance.now(); const tiers = {};
    let maxY = 0, falls = 0;
    for (let i = 0; i < 90 * 120 && g.state === 'playing'; i++) {
      g.player.hp = 999; g.player.spawnShield = 1;
      g.step(1 / 120);
      for (const b of g.babos) { if (b.y > maxY) maxY = b.y; if (b.alive && (Number.isNaN(b.x) || Math.abs(b.x) > 40)) falls++; }
    }
    for (const b of g.babos) tiers[b.name] = `L${b.tier + 1}${b.won ? '*' : ''} ${b.weapon} k${b.kills} d${b.deaths} y${b.y.toFixed(2)}`;
    return { state: g.state, ms: Math.round(performance.now() - t0), maxY: maxY.toFixed(2), falls, tiers, map: g.map, race: document.getElementById('race').textContent };
  });
  console.log(mode, map, JSON.stringify(r));
  await p.waitForTimeout(1200);
  if (mode === 'gungame' && map === 'fort') await p.screenshot({ path: `shots/${mode}-${map}-late.png` });
  await p.evaluate(() => { const g = window.__game; if (g.state !== 'over') g.end(); });
  await p.waitForTimeout(1200);
  if (mode === 'gungame' && map === 'towers') await p.screenshot({ path: 'shots/result.png' });
}
console.log('errors:', errs.length ? errs.slice(0, 8) : 'none');
await b.close();
