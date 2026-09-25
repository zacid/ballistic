import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const errs=[]; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type()==='error'||m.type()==='warning') errs.push(m.text()); });
await p.goto('file://' + process.cwd() + '/dist/ballistic.html');
await p.waitForTimeout(1500);
await p.click('#play');
await p.evaluate(() => {
  const g = window.__game;
  // fast-forward the match without rendering so there's paint and action on screen
  const f = g.frame; g.frame = () => {};
  for (let i = 0; i < 60 * 20; i++) g.tick(1/60, false);
  const P = g.player; if (!P.alive) g.spawn(P);
  const t = g.babos.find(b => !b.isPlayer && b.alive); P.x = t.x + 2; P.z = t.z + 1.5;
  g.arena.splat(P.x + 1.5, P.z, 1.3, 0xff5fa8); // must appear right beside the player
  g.frame = f; requestAnimationFrame(g.frame);
});
await p.waitForTimeout(6000);
await p.screenshot({ path: 'shots/perf.png' });
const info = await p.evaluate(() => { const g = window.__game; return { info: g.r.info, gpu: g.r.gpuMs, s: g.stats.summary(), sim: g.stats.sim, rend: g.stats.render, up: g.arena.uploads, upPx: g.arena.uploadPx }; });
console.log(JSON.stringify(info));
console.log(errs.slice(0,8).join('\n'));
await b.close();
