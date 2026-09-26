// Bosses are wider than a cell: they should path through gaps they fit and not get wedged.
// Spawn a big boss at random points on every map and let it chase a parked player for 20 s;
// count how long it spends stuck (trying to move but barely moving).
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
for (const old of [true, false]) for (const map of ['fort', 'towers', 'random']) {
  const r = await p.evaluate(([map, old]) => {
    const g = window.__game; g.saved.soloMode = 'solo'; g.saved.map = map; g.saved.arenaSize = 'medium'; g.saved.botCount = 3; g.startSolo(); g.go();
    const me = g.player; me.spawnShield = 99;
    if (old) { const P = g.arena.path.bind(g.arena); g.arena.path = (a, b2, c, d) => P(a, b2, c, d, 0.5); g.arena.openSpot = () => null; }
    const boss = g.babos[1]; for (const x of g.babos.slice(2)) { x.alive = false; x.root.visible = false; x.respawnT = 1e9; }
    let stuck = 0, reached = 0, trials = 0;
    for (let trial = 0; trial < 6; trial++) {
      trials++;
      const sp = g.arena.spawns[(trial * 7919) % g.arena.spawns.length], tp = g.arena.spawns[(trial * 104729 + 13) % g.arena.spawns.length];
      boss.boss = true; boss.rad = 0.85; boss.maxHp = 9999; boss.root.scale.setScalar(1.7);
      g.spawn(boss); boss.spawnShield = 0; boss.hp = 9999;
      me.x = tp.x; me.z = tp.z; me.y = me.gy = g.arena.floorAt(tp.x, tp.z);
      g.input.apply = (bb) => { bb.moveX = bb.moveZ = 0; bb.fire = false; };
      let slow = 0, got = false;
      for (let i = 0; i < 20 * 120; i++) {
        boss.fire = false; g.step(1 / 120); me.hp = 100; boss.hp = 9999;
        const sp2 = Math.hypot(boss.vx, boss.vz), want = Math.hypot(boss.moveX, boss.moveZ);
        if (want > 0.3 && sp2 < 0.6) slow += 1 / 120;
        if (Math.hypot(boss.x - me.x, boss.z - me.z) < 2.2) { got = true; break; }
      }
      stuck += slow; if (got) reached++;
    }
    return `${old ? 'before' : 'after '} ${map}: boss reached the player in ${reached}/${trials} runs, total time wedged ${stuck.toFixed(1)} s`;
  }, [map, old]);
  console.log(r);
}
console.log('errors:', errs.length ? errs : 'none');
await b.close();
