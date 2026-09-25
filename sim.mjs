import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERR ' + e.message + e.stack));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('file://' + process.cwd() + '/dist/ballistic.html');
await p.waitForTimeout(1500);
await p.click('#play');
const res = await p.evaluate(() => {
  const g = window.__game; g.paused = true; // stop rAF sim; drive manually
  const out = []; let shots = 0, nades = 0;
  // make the player a bot-like dummy: just stand still and shoot randomly
  for (let i = 0; i < 120 * 90; i++) {
    g.state === 'over' ? 0 : g.step(1/120);
    shots = Math.max(shots, g.shots.length); nades = Math.max(nades, g.nades.length);
    if (i % (120*15) === 0) out.push(`${(i/120)|0}s ` + g.babos.map(b => b.name[0]+b.kills+'/'+b.deaths).join(' '));
  }
  // bounds sanity
  const H = 20;
  const oob = g.babos.filter(b => Math.abs(b.x) > H || Math.abs(b.z) > H).map(b => b.name);
  const inWall = g.babos.filter(b => b.alive && g.arena.solidAt(b.x, b.z)).map(b => b.name);
  return { out, shots, nades, oob, inWall, state: g.state, fx: g.fx.bits?.length };
});
console.log(JSON.stringify(res, null, 1));
console.log(errs.slice(0,10).join('\n'));
await b.close();
