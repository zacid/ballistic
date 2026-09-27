// Babo Violent 2 touches: kill feed names the weapon, hit markers, casings, the Nuke Bot, themes + weather + ice.
import { chromium } from 'playwright-core';
const shots = process.env.SHOTS || '/tmp/claude-0/-home-claude/b925039c-8605-52de-97a0-ed481168beeb/scratchpad';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 700 } });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://127.0.0.1:8766/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

// ---- kill feed + hit marker + casings
const feed = await p.evaluate(() => {
  const g = window.__game; g.saved.soloMode = 'solo'; g.saved.map = 'random'; g.saved.theme = 'toy'; g.startSolo(); g.go();
  const me = g.player, bot = g.babos[1];
  for (const x of g.babos) if (!x.human && x !== bot) { x.alive = false; x.root.visible = false; x.respawnT = 1e9; }
  g.input.apply = (bb) => { bb.moveX = bb.moveZ = 0; bb.fire = false; };
  bot.x = me.x + 3; bot.z = me.z; bot.hp = 10; bot.spawnShield = 0;
  const cross = document.getElementById('cross');
  g.hit(me, bot, 4, 0, 0); const hitCls = cross.className;
  g.hit(me, bot, 30, 0, 0, 0, 0, 'shotgun'); const killCls = cross.className;
  const first = document.querySelector('#feed div').innerText.replace(/\s+/g, ' ').trim();
  const img = !!document.querySelector('#feed div .how img');
  // a bot popped by a grenade
  const other = g.babos[2]; other.alive = true; other.hp = 5; other.spawnShield = 0; other.x = bot.x; other.z = bot.z + 2;
  g.hit(bot, other, 20, 0, 0, 0, 0, 'grenade');
  const second = document.querySelector('#feed div').innerText.replace(/\s+/g, ' ').trim();
  // casings from the chaingun
  const { setWeapon } = window.__babo ?? {}; void setWeapon;
  me.weapon = 'chaingun'; me.ammo = 50; me.cool = 0;
  let n = 0; for (let i = 0; i < 20; i++) { me.fire = true; g.fire(me); me.cool = 0; n++; }
  const casings = g.fx.casings.length;
  for (let i = 0; i < 120; i++) g.step(1 / 120); g.fx.update(1);
  const landed = g.fx.casings.filter(c => c.landed).length;
  return { hitCls, killCls, first, img, second, casings, landed };
});
console.log('feed:', JSON.stringify(feed));

// ---- Nuke Bot
const nuke = await p.evaluate(() => {
  const g = window.__game, me = g.player, bot = g.babos[1];
  bot.alive = true; bot.root.visible = true; bot.hp = 100; bot.spawnShield = 0; bot.local = true;
  me.hp = 100; me.spawnShield = 0; me.ability = 'nuke'; me.abCool = 0;
  me.x = 0; me.z = 0; bot.x = 2.5; bot.z = 0; me.vx = me.vz = bot.vx = bot.vz = 0;
  g.useAbility(me);
  const placed = g.nukes.length, ring = g.nukes[0]?.warn.scale.x;
  // walk away 8 m before it goes off; the bot is frozen in place (no brain)
  me.x = 9; const brainless = bot.brain; bot.brain = undefined;
  const think = window.__thinkOff = true; void think;
  for (let i = 0; i < 120 * 2.9; i++) { bot.x = 2.5; bot.z = 0; bot.vx = bot.vz = 0; g.step(1 / 120); }
  const before = { nukes: g.nukes.length, botHp: Math.round(bot.hp) };
  for (let i = 0; i < 30; i++) g.step(1 / 120);
  void brainless;
  const lastFeed = document.querySelector('#feed div')?.innerText.replace(/\s+/g, ' ').trim();
  return { placed, ring, before, after: { nukes: g.nukes.length, botAlive: bot.alive, botHp: Math.round(bot.hp), meHp: Math.round(me.hp) }, lastFeed, cooldown: me.abCool.toFixed(1) };
});
console.log('nuke:', JSON.stringify(nuke));

// bots run from a ticking nuke
const flee = await p.evaluate(() => {
  const g = window.__game, me = g.player, bot = g.babos[1];
  g.state = 'playing';
  if (!bot.alive) { g.spawn(bot); }
  bot.hp = 100; bot.x = 1; bot.z = 0; bot.vx = bot.vz = 0; bot.ability = 'dash'; bot.abCool = 99;
  me.x = 12; me.z = 12; me.abCool = 0; me.ability = 'nuke';
  const sx = me.x, sz = me.z; me.x = 0.2; me.z = 0; g.useAbility(me); me.x = sx; me.z = sz;
  const d0 = Math.hypot(bot.x - g.nukes[0].x, bot.z - g.nukes[0].z);
  for (let i = 0; i < 120 * 2.5; i++) g.step(1 / 120);
  const d1 = g.nukes[0] ? Math.hypot(bot.x - g.nukes[0].x, bot.z - g.nukes[0].z) : -1;
  for (let i = 0; i < 120; i++) g.step(1 / 120);
  return { startDist: d0.toFixed(1), distAfter2_5s: d1.toFixed(1), botAlive: bot.alive, botHp: Math.round(bot.hp) };
});
console.log('bot flees nuke:', JSON.stringify(flee));

// guest side: a remote nuke is cosmetic and goes off on the owner's 'boom'
const remote = await p.evaluate(() => {
  const g = window.__game, bot = g.babos[3]; bot.local = false; bot.alive = true; bot.ability = 'nuke'; bot.x = -5; bot.z = -5;
  g.abilityFx(bot); const n = g.nukes[g.nukes.length - 1];
  const hpBefore = g.player.hp;
  g.online = true; g.onNetEvent({ k: 'boom', o: 3, x: n.x, z: n.z, r: 6, y: 0, m: 2 }); g.online = false;
  return { cosmetic: n.cosmetic, goneAfterBoom: !g.nukes.includes(n), noDamageHere: g.player.hp === hpBefore };
});
console.log('remote nuke:', JSON.stringify(remote));

// ---- themes
for (const th of ['snow', 'city', 'toy']) {
  const r = await p.evaluate(async (th) => {
    const g = window.__game; g.saved.theme = th; g.saved.map = th === 'snow' ? 'fort' : 'random'; g.startSolo(); g.go();
    for (let i = 0; i < 60; i++) g.tick(1 / 60, false);
    return { theme: g.theme, weather: g.weather.kind, drops: g.weather.n, ice: g.arena.hasIce, iceCells: g.arena.ice.reduce((a, v) => a + v, 0), sky: g.r.scene.background.getHexString() };
  }, th);
  await p.evaluate(() => { const g = window.__game; g.hud.update(0.1); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${shots}/theme-${th}.png` });
  console.log('theme', th, JSON.stringify(r));
}

// ---- ice: a ball coasting on ice slides much further than on the floor
const ice = await p.evaluate(() => {
  const g = window.__game; g.saved.theme = 'snow'; g.saved.map = 'random'; g.saved.arenaSize = 'large'; g.startSolo(); g.go();
  const A = g.arena, me = g.player;
  for (const x of g.babos) if (!x.human) { x.alive = false; x.root.visible = false; x.respawnT = 1e9; }
  g.input.apply = (bb) => { bb.moveX = bb.moveZ = 0; bb.fire = false; };
  // find an ice cell and a plain one
  let ic = -1, pc = -1;
  for (let k = 0; k < A.n * A.n; k++) { const i = k % A.n, j = (k / A.n) | 0; if (A.h[k] || A.fl[k]) continue; if (A.ice[k] && ic < 0) ic = k; if (!A.ice[k] && pc < 0 && i > 3 && j > 3) pc = k; }
  const slide = (k) => { const i = k % A.n, j = (k / A.n) | 0; me.x = A.center(i); me.z = A.center(j); me.y = me.gy = 0; me.vx = 4; me.vz = 0; for (let s = 0; s < 30; s++) g.physics(me, 1 / 120); return Math.hypot(me.vx, me.vz); };
  return { speedAfterQuarterSecondOnIce: slide(ic).toFixed(2), onFloor: slide(pc).toFixed(2) };
});
console.log('ice:', JSON.stringify(ice));

// ---- menu: theme buttons + preview
const menu = await p.evaluate(() => {
  const g = window.__game; g.hud.toMenu();
  const btns = [...document.querySelectorAll('#theme-seg button')].map(b => b.textContent);
  document.querySelectorAll('#theme-seg button')[2].click();
  return { btns, saved: g.saved.theme, previewTheme: g.theme, lobbyBtns: document.querySelectorAll('#lobby-theme-seg button').length, abilities: [...document.querySelectorAll('#abilities button')].map(b => b.textContent) };
});
console.log('menu:', JSON.stringify(menu));
for (let i = 0; i < 20; i++) await p.evaluate(() => window.__game.tick(1 / 30, false));
await p.screenshot({ path: `${shots}/menu-city.png` });
console.log('errors:', errs.length ? errs : 'none');
await b.close();
