import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
p.on('pageerror', e => console.log('PAGEERR ' + e.message));
await p.goto('file://' + process.cwd() + '/dist/ballistic.html');
await p.waitForTimeout(1500);
await p.click('#play');
await p.evaluate(() => {
  const g = window.__game; g.frame = () => {}; // stop the rAF loop; drive manually
  const T = (s) => { for (let i = 0; i < s * 60; i++) g.tick(1/60, false); };
  T(20);
  const P = g.player; const bots = g.babos.filter(b => !b.isPlayer && b.alive);
  if (!P.alive) g.spawn(P); P.spawnShield = 99; P.hp = 100;
  const t = bots[0]; P.x = t.x + 2.2; P.z = t.z + 1.5;
  g.throwNade(bots[1], P.x - 1.5, P.z - 1);
  g.input.mouseDown = true; g.input.mouse.set(0.05, 0.1);
  T(1.55);
  g.tick(1/60, true);
});
await p.waitForTimeout(100);
await p.screenshot({ path: 'shots/combat.png' });
await b.close();
