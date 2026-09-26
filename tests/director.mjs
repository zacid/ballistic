// The wave director: a "strong" defender (topped up, never dies) should push the threat up;
// a "weak" one (keeps getting chipped and popped) should bring it down. Also a plain AI run.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const errs = [];
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
p.on('pageerror', e => errs.push('PAGEERR ' + e.message + e.stack));
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
console.log('default difficulty:', await p.evaluate(() => window.__game.saved.difficulty));
for (const style of ['strong', 'plain', 'weak']) {
  const r = await p.evaluate(async (style) => {
    const g = window.__game; g.r.setQuality('low'); g.r.flags.shadows = false; g.r.applyFlags();
    g.saved.soloMode = 'waves'; g.saved.difficulty = 'adaptive'; g.startSolo(); g.go();
    const rows = []; let n = 0, chip = 0;
    for (let i = 0; i < 300 * 120 && g.state === 'playing' && g.wv.n <= 10; i++) {
      const me = g.player; me.isPlayer = false;
      if (style === 'strong' && me.alive) me.hp = Math.max(me.hp, 150);
      if (style === 'weak' && me.alive && g.wv.breakT <= 0) { chip += 1 / 120; if (chip > 2.5) { chip = 0; me.spawnShield = 0; g.applyDamage(me, 34, 1, 0, 0, 0); } }
      g.step(1 / 120);
      if (g.wv.n !== n) { const d = g.director; rows.push(`w${g.wv.n}: skill ${d.skill.toFixed(2)} threat ${d.threat(g.wv.n)} bots ${g.wv.total} lives ${g.wv.lives} react ${d.aim(g.wv.n).react.toFixed(2)} guns ${d.guns(g.wv.n).length}`); n = g.wv.n; }
    }
    g.player.isPlayer = true;
    const res = { style, end: g.state, wave: g.wv.n, rows };
    if (g.state !== 'over') g.end();
    return res;
  }, style);
  console.log(`\n${r.style}: ended ${r.end} at wave ${r.wave}\n  ` + r.rows.join('\n  '));
  await p.waitForTimeout(800);
}
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await b.close();
