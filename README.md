# Ballistic

Rolling toy balls with guns. A top-down arena shooter in the spirit of Babo Violent 2, built with Three.js.

- **Solo:** free-for-all against 3, 5 or 7 bots (first to 20 pops), Gun Game, or Hold the Fort.
- **With a friend:** 1v1 (first to 10), the two of you against 5 bots (first team to 30), Gun Game 1v1, or Hold the Fort together, joined with an invite link. Rematch goes straight back in without the lobby.
- Eight guns and grenades. Everyone starts with a pistol; the shotgun, chaingun, bouncer, flamethrower and lightning gun lie around the arena, and the rockets and railgun are power weapons with limited ammo in the most contested spots. Stand on a gun and press E (or tap Swap on a phone) to swap to it; rolling over the gun you already hold tops up its ammo. Guns are dropped when their owner pops. Plus a Spacebar ability (dash, spikes, bubble, shockwave, mine, Nuke Bot).
- **Flamethrower:** short range, sets balls alight (afterburn) and leaves fire on the floor for a moment.
- **Lightning gun:** locks onto the best target in a cone in front of you (no precise aim needed) and chains to up to two more balls nearby for 60% and 36% damage. Short range. (It replaced the gravity gun, which is retired but still in the code.)
- **Practice range:** Practice Range on the menu: you and six target balls that never shoot back. Nothing can hurt you, 1-8 swap guns instantly, and the targets speed up as you go. Pop 20 as fast as you can; your best time is saved.
- **Mine (ability):** Space drops a proximity mine behind you; three at a time, arms after a second.
- **Nuke Bot (ability, from Babo Violent 2):** Space drops a little domed robot that beeps faster and faster for 3 s, then blows up everything within 6 m (up to 150 damage, you included; walls block it). A red ring on the floor shows the danger zone, bots run from it, and it has a 12 s cooldown.
- **Themes:** **Toy room**, **Snow** (snowfall, snow-capped blocks, and frozen puddles that barely grip, so you slide), **City** (rain on wet tarmac with road markings, and the odd thunderclap), or **Any** for a different one each match. Works on every arena and mode, and the host's pick is used online.
- **Arenas:** **Random** (a freshly generated layout every match, small, medium or large), or two hand-made maps with raised floors: **Fort** (a keep with ramps and battlements; Hold the Fort always plays here) and **Towers** (two raised corner towers).

### Rollout (Brotato-style run, solo)

Twenty timed waves (22 s growing to a minute) in an open arena. Swarms of cheap minion balls come at you: rollers, dashers (they stop, flash, then charge), spitters (keep their distance and lob blobs), tanks, and splitters that burst into three minis. Red crosses on the floor show where the next group lands. Gun bots join as elites from wave 3, and waves 10 and 20 are boss waves that end when the boss pops. Your own blasts never hurt you here, and you only get one life.

- **Coins** drop from everything you pop; they're your money and your XP. Roll near them to hoover them up. Anything left on the floor when the wave ends goes into a piggy bank that pays out double on the next wave's coins.
- **Level-ups:** after each wave, pick one of four stat upgrades per level (tiers: common, uncommon, rare, legendary; luck improves the odds).
- **The shop:** four offers per wave. **Main guns** (the one you aim; buying the one you hold upgrades its tier), **turrets** that bolt onto your ball and fire on their own at the nearest enemy (up to 4; two of the same tier combine into the next), and **items** that trade stats (Glass Cannon: +25% damage, -15 HP). Lock offers to keep them, reroll for a rising price, sell turrets for 30%.
- **Ball types:** Classic, Bowling Ball (tough, heavy, thorny, slow), Ping-pong (fast, dodgy, fragile), Magnet (coins from twice as far, extra harvesting), Gearball (starts with a turret; turrets hit harder, your gun softer).
- **Co-op (Play with a friend → Rollout):** the host runs the wave and sends the guest a compact picture of it (minions, coins, spawn markers, spit) 20 times a second; each of you shoots your own gun and turrets on your own screen, and the guest's hits are batched back to the host. Every coin pays both of you; you each have your own build, level-ups and shop, and the next wave starts when you've both pressed Ready. Waves are about 60% bigger with tougher minions. A popped player leaves a ghost: their teammate rolling next to it for 3 s brings them back at half health (otherwise they're back next wave); the run ends when you're both down.
- **Winning and beyond:** clear wave 20 to win, then keep going into endless waves (a boss every 10th) or bank the win. Winning unlocks the next **danger level** (up to 5: tougher, faster, bigger swarms, more elites, dearer shop).
- **Shop help:** hover an offer or level-up to preview your stats changing; guns show damage per second before and after, turrets their damage per second, and hovering a turret shows its reach round your ball. Items can be sold back for 30%.
- **Results:** damage dealt by each gun, turret, grenade and ability, plus a wave-by-wave table (pops, coins, damage taken).
- **Settings:** auto-aim for Rollout (your gun aims at the nearest enemy and fires by itself; click to take over), and damage numbers on, big hits only, or off. Off-screen arrows point at elites, bosses and your teammate.
- **Weapon classes:** every gun and turret is Precision (pistol, railgun, bouncer), Spray (chaingun, shotgun), Explosive (rockets) or Elemental (flamethrower, lightning). Two or more of a class (main gun plus turrets) switch on a set bonus that grows at three and four: Precision hits harder and further, Spray fires faster, Explosive blasts are bigger, Elemental lightning chains further. The shop tags each gun with its class and shows your sets.
- **Special waves** on waves 4, 7, 12, 16 and 18 (and every third in endless): Horde (twice as many, half as tough), Gold Rush (double coins), Elite Rush (a pack of gun bots) or Bomber Night.
- **More minions:** bombers (roll up, fizz, explode; pop one early and it takes its neighbours with it), healers (hang back and heal those nearby) and shielders (block most of a hit from the front; flank them, burn them or blow them up).
- **Loot crates** drop from elites (a quarter of the time) and, very rarely, minions; bosses drop a normal crate plus a **golden crate**. Roll over one and open it after the wave. A crate holds an item, a turret or a main gun, never below Uncommon from wave 6 (Rare from wave 14); take it free or sell it for half its price. A golden crate offers three and you pick one.
- **Coins:** you start with 10, half of what's left on the floor is swept into your pocket when the wave ends (the rest is lost), and the first two shops have a starter turret at 30% off. Prices climb 15% a wave, rerolls get dearer each time within a shop, and Rare and Legendary offers are scarcer.
- **Late game:** minion health ramps up faster after wave 8, contact damage climbs 9% a wave, up to 150 minions can be alive by wave 15, healers arrive from wave 6 and shielders from wave 8.
- **Tuning panel** (<kbd>F2</kbd> or <kbd>`</kbd>, or Settings → Rollout tuning): sliders for minion health, the late-game ramp, damage to you, spawn size, max minions alive, prices, price climb, floor-coin sweep, sell-back and crate drops. Saved per browser; COPY NUMBERS copies the changes so they can be made the defaults. In co-op the host's minion settings are the ones used.
- **Stats page** (STATS on the menu): lifetime matches, pops, damage, time played, favourite guns, modes, records, and Rollout bests by ball type and danger level.
- The numbers live in `src/rundata.ts`; the run itself in `src/run.ts`, the between-wave screens in `src/runui.ts`.

### Gun Game

Every pop moves you one weapon up the ladder: rockets, railgun, chaingun, flamethrower, bouncer, shotgun, lightning gun, pistol, unlimited grenades, then spikes. Pop someone with spikes to win. One pop per level against bots, two in the 1v1. Getting spiked (or popping yourself) drops you a level. The spikes ability and grenade pickups are off in this mode.

### Hold the Fort

Defend the keep on the Fort map against waves of bots. Each wave brings more of them, with better guns and sharper aim, and every 5th wave has a boss: a big, slow, rocket-firing ball with 450 HP that shrugs off knockback. The defenders share a pool of lives (3 solo, 5 for two players). Clearing a wave or popping a boss gives one back, and you heal between waves. If you die with no lives left you sit out until the next wave; if everyone is out, the fort falls. Your best wave is saved.

### Getting help

- **Aim assist (vs bots):** on by default. If a bot you can see is within about 12 degrees of your crosshair, your aim is pulled most of the way onto it. It never applies against your friend in 1v1 modes. Toggle it in settings.
- **Tips:** the respawn screen shows one practical hint based on what just happened (the gun that got you, your ability, your grenades).
- **Big balls get about:** bosses are wider than a cell, so they path over 2x2 blocks (never through one-cell gaps), only charge straight at you when they fit, spawn where there's room, can climb ramps onto platforms, and back out to open space if they ever get wedged.
- **Mini boss:** Hold the Fort sends a smaller boss on wave 3 (and 8, 13...) as well as the big one every 5th wave. Defenders start with a chaingun.

### Adaptive difficulty

With the Bots setting on **Adaptive** (the default), Hold the Fort sizes each wave to how you played the last one (`src/director.ts`). After every wave it scores lives lost, damage taken per bot popped, health left and time taken against a target of "a bit of a scramble", and nudges a hidden rating: down fast when you're struggling, up slowly when you're cruising. The rating and the wave number set bot aim and reaction time, how many come and how many attack at once, how quickly they arrive, their guns, how hard their shots hit, and the boss's health. Mid-wave it only ever eases off: if everyone standing is badly hurt, or someone just lost a life, reinforcements hold back for a few seconds. In co-op, whoever is clearly carrying draws more of the fire. The bars next to your lives show the current threat level. Easy, Normal and Hard pin the rating instead.

In Free-for-all, Gun Game and 2 vs bots (online too), Adaptive works continuously instead (`FfaDirector` in the same file): every pop you land nudges a rating up a little, every time you're popped nudges it down more, and every 15 s the damage you dealt versus took nudges it too. It only changes how bots treat you (how fast and accurately they shoot at you, how hard their hits land, and how keen they are to target you), so bot-against-bot fights play normally. Below the old floor (about Easy) it keeps going: at the very bottom bots take a full second to react, aim with a ±25° wobble, barely strafe, rarely use abilities or grenades, hit you for 40% and prefer other targets. New players start near there, and three deaths in a row without a pop drops it a big step. Each human gets their own rating (online the host runs it, since the bots live there, and sends the numbers to the guest). The rating is saved between matches, and the threat bars sit in the scoreboard pill.

### Music

The soundtrack is generated live by a small step sequencer (`src/music.ts`): square-wave bass, a pulse arpeggio, a lead line that is new every match, and synth drums. It gets busier and faster in the last 30 seconds, when a boss is out, or when someone is close to winning. Toggle it in settings.

Shots skim up onto raised floors on their own (there's no vertical aim), so only walls and battlements give cover.

**While playing:** the kill feed says how each pop happened, Babo Violent 2 style ("Zac [picture of a shotgun] SHOTGUN Kevin", or GRENADE, MINE, NUKE BOT...); the crosshair flashes a white X when you land a hit and a red one when you pop someone; guns throw out spent casings (red shells from the shotgun) that clink on the floor and lie there for a few seconds; a red arc at the screen edge points at whoever just hit you; when you're popped, the camera follows your killer until you respawn ("Popped by X with the Y"); gun pads near you are labelled, and power weapons show when they're back. The results screen shows your pops, accuracy, damage, best streak and top gun, with personal bests starred. Settings has separate sound-effect and music volume.

Everything is generated in code: no image, model or audio files. Sounds are synthesised with Web Audio.

## Controls

| Action | Keys |
| --- | --- |
| Roll | W A S D |
| Aim / shoot | Mouse / left click |
| Grenade | Right click, G or Q |
| Ability | Space or Shift |
| Reload | R |
| Pick up the gun you're standing on | E |
| Scores | Tab |
| Performance panel | F |
| Pause / mute | P / M |

Phones get twin thumbsticks plus grenade, ability and reload buttons.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173 with hot reload
npm run build      # writes site/index.html (one self-contained file)
npm run preview    # serves site/ on http://localhost:8766
```

## Put it on GitHub Pages

1. Create a new repository on GitHub (for example `ballistic`) and push this folder to its `main` branch:
   ```bash
   git remote add origin https://github.com/<you>/ballistic.git
   git push -u origin main
   ```
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` builds and deploys on every push to `main`. The game ends up at `https://<you>.github.io/ballistic/`.

## Playing with a friend

1. Press **Play with a friend**, then **Create invite link**.
2. Send the link to your friend. When they open it they land straight in your lobby. No accounts needed.
3. When their name shows up, either of you picks **1v1** or **2 vs bots**.

### How the connection works

With `RELAY_URL` set in `src/config.ts` (the default), the game uses two paths at once:

1. **WebRTC through Cloudflare TURN (fast path).** The Worker hands out short-lived Cloudflare Realtime TURN credentials at `/ice`. TURN is anycast, so each player relays through their nearest Cloudflare data centre (Johannesburg or Cape Town for players in South Africa), and it runs over port 443, so strict firewalls and VPNs let it through. If both networks allow a plain direct connection, WebRTC uses that instead.
2. **WebSocket relay (fallback).** A Durable Object forwards messages between the two players. It works everywhere, but Durable Objects don't run in Africa, so from South Africa every message goes to Europe and back (about 170 ms round trip).

The host listens on both. The guest tries WebRTC for 8 seconds, then falls back to the relay. The grey line in the lobby shows which path is in use and its round-trip time.

For debugging you can force a path with `?transport=p2p` or `?transport=ws`, or point at another relay with `?relay=https://...`.

### Deploy the relay (one time, free)

```bash
cd relay
npm install
npx wrangler deploy
```

The first deploy opens a browser to log in to Cloudflare (a free account is enough) and may ask you to pick a `workers.dev` subdomain. It prints the relay's address, something like `https://ballistic-relay.<you>.workers.dev`. Put that in `RELAY_URL` in `src/config.ts`, commit and push.

Check it's up by opening `https://ballistic-relay.<you>.workers.dev/health` (it says `ballistic relay ok`).

### Turn on Cloudflare TURN (the fast path)

1. In the Cloudflare dashboard, open **Realtime → TURN Server** and create a TURN key. Copy its **Key ID** and **API token**.
2. From `relay/`:
   ```bash
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_KEY_API_TOKEN
   npx wrangler deploy
   ```
3. Check it from the game page: open the game, press F12, and in the Console run `await (await fetch("https://ballistic-relay.<you>.workers.dev/ice")).json()`. It should show `turn: true`. (Opening `/ice` directly in a tab returns "origin not allowed": only the pages listed in `ALLOWED_ORIGINS` in `relay/wrangler.toml` get credentials, and they expire after an hour. If you host the game somewhere else, add that address there and redeploy.)

The first 1,000 GB a month are free; a match uses well under 1 GB an hour.

The relay uses one SQLite-backed Durable Object per room with the WebSocket Hibernation API, which the Workers free plan covers. It holds a host and a guest per room code and only forwards bytes; game logic stays in the browsers.

### Netcode

- Each player simulates their own ball, so movement always feels instant. The other ball is shown about 110 ms in the past and smoothed.
- Whoever fires decides whether a shot hit (favour-the-shooter). The victim's browser applies the damage and reports deaths.
- The host (whoever created the link) runs the bots, the clock and the score.
- State travels as a small snapshot about 20 times a second, plus a rolling log of recent events so a dropped message is recovered by the next one.

## Performance notes

- On Medium and Low quality the arena's shadows are drawn into the shadow map once per match (walls never move) and balls get soft blob shadows, so the shadow pass no longer runs every frame. High and Ultra keep fully dynamic shadows.
- Each arena frees its GPU memory when the next one is built, and balls share their geometry, so memory stays flat from match to match.
- The per-step hot paths (wave director, target picking, pickups, mines) avoid building throwaway arrays, to keep garbage-collection hitches out of the frame times.

## Code map

| File | What it does |
| --- | --- |
| `src/game.ts` | Match flow, physics, weapons, abilities, damage, netcode glue |
| `src/net.ts` | Presence snapshots, event log, clock offsets |
| `src/wsroom.ts` | WebSocket transport to the relay |
| `src/peerroom.ts` | Direct WebRTC transport (PeerJS) |
| `relay/src/index.ts` | The Cloudflare Worker relay |
| `src/bots.ts` | Bot AI: targeting, pathing, strafing, grenades, abilities |
| `src/arena.ts` | Random and hand-made arenas, raised floors and ramps, collision, A*, floor paint |
| `src/render.ts` | Renderer, shadows, GTAO, bloom, quality presets, GPU timing |
| `src/fx.ts` | Particles, smoke, flashes, shockwave rings, casings, the nuke blast |
| `src/run.ts`, `src/rundata.ts`, `src/runui.ts` | Rollout: waves, minion swarm, coins, turrets, stats, shop; its numbers; its screens |
| `src/themes.ts` | Colours, light and weather for each arena theme |
| `src/weather.ts` | Rain (with splashes) and snowfall that follow the camera |
| `src/audio.ts` | Synthesised sound effects |
| `src/music.ts` | Procedural soundtrack sequencer |
| `src/hud.ts` | Menus, lobby, HUD, performance panel |
| `src/config.ts` | Weapons, abilities, modes and other tunables |

## Tests

`tests/solo.mjs` fast-forwards bot-only matches (Gun Game on Fort and Towers, free-for-all) and checks for errors. `tests/waves.mjs` and `tests/waves-duo.mjs` cover Hold the Fort solo and online; `tests/boss-stuck.mjs` measures how long bosses spend wedged (before vs after the wide-ball pathing); `tests/qol.mjs` covers the hit arcs, killcam, pad labels, results stats, volume sliders, shadow modes and memory; `tests/newguns.mjs` and `tests/weapons-duo.mjs` cover the flamethrower, gravity gun and mines offline and online; `tests/guns.mjs` checks gun pickups, power-weapon ammo and the lingering railgun beam; `tests/adaptive-ffa.mjs` and `tests/adaptive-coop.mjs` check the Free-for-all and online versions; `tests/director.mjs` checks the difficulty climbs for a strong player and falls for a weak one. `tests/rollout-extras.mjs` checks set bonuses, bombers, healers, shielders, crates (including golden ones and minimum tiers), the tuning numbers and panel, special waves and the stats page. `tests/rollout-duo.mjs` plays Rollout co-op between two browsers (minion sync, guest kills, shared coins, ready-up, revive, both down). `tests/rollout.mjs` plays Rollout with a scripted player through waves, level-ups, the shop, the wave-10 boss and a death. `tests/rain-audio.mjs` renders 12 s of the City rain ambience to a WAV so you can listen to it. `tests/bv2.mjs` covers the kill feed, hit markers, casings, the Nuke Bot (damage, bots fleeing, the guest's copy), the three themes, ice sliding and the theme picker; `tests/bv2-duo.mjs` checks the theme and a nuke kill sync between two browsers. `tests/gg.mjs` plays online Gun Game 1v1 through the local servers, checks the ladder syncs, and tests the rematch.

`tests/p2p.mjs` runs two headless browsers against a local PeerJS server, creates an invite, joins it, plays a duel and checks that kills and disconnects sync:

```bash
node tests/peersrv.cjs &          # local PeerJS server on 127.0.0.1:9000
npm run build && npm run preview & # serves site/ on 8766
CHROME_PATH=/path/to/chrome npm run test:p2p
```
