// Gun pickups need E: standing on a pad shows a prompt and does nothing until you press E.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
const onPad = () => p.evaluate(() => {
  const g = window.__game, me = g.player, pk = g.pickups.find(q => q.kind === 'weapon' && q.t <= 0 && q.w !== me.weapon);
  me.x = pk.x + 0.3; me.z = pk.z; me.y = me.gy = g.arena.floorAt(pk.x, pk.z); me.vx = me.vz = 0;
  g.input.apply = (bb) => { bb.moveX = bb.moveZ = 0; bb.fire = false; };
  for (let i = 0; i < 60; i++) g.step(1 / 120);
  g.hud.update(0.3);
  return { pad: pk.w, holding: me.weapon, prompt: document.getElementById('pickhint').hidden ? 'hidden' : document.getElementById('pickhint').textContent.trim() };
});
await p.evaluate(() => { const g = window.__game; g.saved.soloMode = 'solo'; g.saved.map = 'fort'; g.startSolo(); g.go(); for (const x of g.babos) if (!x.human) { x.alive = false; x.root.visible = false; x.respawnT = 1e9; } });
console.log('standing on a pad:', JSON.stringify(await onPad()));
await p.keyboard.press('e');
console.log('after E:', await p.evaluate(() => { const g = window.__game; for (let i = 0; i < 10; i++) g.step(1 / 120); g.hud.update(0.3); return g.player.weapon + ' | prompt ' + (document.getElementById('pickhint').hidden ? 'hidden' : 'shown'); }));
console.log('bots still grab by rolling over:', await p.evaluate(() => {
  const g = window.__game, bot = g.babos[1], pk = g.pickups.find(q => q.kind === 'weapon' && q.t <= 0 && q.w !== 'pistol');
  bot.alive = true; bot.root.visible = true; bot.weapon = 'pistol'; bot.x = pk.x; bot.z = pk.z; bot.y = bot.gy = g.arena.floorAt(pk.x, pk.z);
  g.step(1 / 120); return `${pk.w} -> bot has ${bot.weapon}`;
}));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
