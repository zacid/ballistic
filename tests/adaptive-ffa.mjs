// Adaptive Free-for-all: a player who keeps getting popped should see the bots ease off (slower, less
// accurate, softer hits, less focus on them); a dominant one should see them sharpen up. Bots vs bots unchanged.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message + e.stack));
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
for (const style of ['idle', 'strong', 'idle-again']) {
  const r = await p.evaluate((style) => {
    const g = window.__game; g.saved.soloMode = 'solo'; g.saved.map = 'random'; g.saved.arenaSize = 'medium'; g.saved.botCount = 7; g.saved.difficulty = 'adaptive';
    if (style === 'idle') g.saved.ffaSkill = undefined;
    g.startSolo(); g.go();
    const startSkill = g.ffa.skill; let tgt = 0, samples = 0;
    const idle = (bb) => { bb.moveX = bb.moveZ = 0; bb.fire = false; };
    for (let i = 0; i < 90 * 120 && g.state === 'playing'; i++) {
      if (style === 'strong') { g.player.isPlayer = false; if (g.player.alive) g.player.hp = Math.max(g.player.hp, 300); }
      else g.input.apply = idle;
      g.step(1 / 120);
      if (i % 30 === 0) for (const bt of g.babos) if (!bt.human && bt.alive && bt.brain?.target >= 0) { samples++; if (bt.brain.target === g.player.id) tgt++; }
    }
    g.player.isPlayer = true;
    g.tick(0.3, false); g.hud.update(0.3);
    const f = g.ffa, aim = f.aim({ react: 0, aimErr: 0, lead: 0, nade: 0 });
    const res = { style, active: f.active, skill: `${startSkill.toFixed(2)} -> ${f.skill.toFixed(2)}`, threat: f.threat(), botReact: aim.react.toFixed(2), botAimErr: aim.aimErr.toFixed(2), hitScale: f.damage().toFixed(2), playerDeaths: g.player.deaths, playerPops: g.player.kills, targetedPct: Math.round(100 * tgt / samples) + '%', saved: g.saved.ffaSkill, meter: !!document.querySelector('#race .threat') };
    g.end(); return res;
  }, style);
  console.log(JSON.stringify(r));
}
console.log('fixed Normal is inactive:', await p.evaluate(() => { const g = window.__game; g.saved.difficulty = 'normal'; g.startSolo(); const a = g.ffa.active; g.end(); g.saved.difficulty = 'adaptive'; return !a; }));
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await b.close();
