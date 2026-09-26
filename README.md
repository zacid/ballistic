# Ballistic

Rolling toy balls with guns. A top-down arena shooter in the spirit of Babo Violent 2, built with Three.js.

- **Solo:** free-for-all against 3, 5 or 7 bots (first to 20 pops), Gun Game, or Hold the Fort.
- **With a friend:** 1v1 (first to 10), the two of you against 5 bots (first team to 30), Gun Game 1v1, or Hold the Fort together, joined with an invite link. Rematch goes straight back in without the lobby.
- Eight guns and grenades. Everyone starts with a pistol; the shotgun, chaingun, bouncer, flamethrower and lightning gun lie around the arena, and the rockets and railgun are power weapons with limited ammo in the most contested spots. Stand on a gun and press E (or tap Swap on a phone) to swap to it; rolling over the gun you already hold tops up its ammo. Guns are dropped when their owner pops. Plus a Spacebar ability (dash, spikes, bubble, shockwave, mine).
- **Flamethrower:** short range, sets balls alight (afterburn) and leaves fire on the floor for a moment.
- **Lightning gun:** locks onto the best target in a cone in front of you (no precise aim needed) and chains to up to two more balls nearby for 60% and 36% damage. Short range. (It replaced the gravity gun, which is retired but still in the code.)
- **Practice range:** Practice Range on the menu: you and six target balls that never shoot back. Nothing can hurt you, 1-8 swap guns instantly, and the targets speed up as you go. Pop 20 as fast as you can; your best time is saved.
- **Mine (ability):** Space drops a proximity mine behind you; three at a time, arms after a second.
- **Arenas:** **Random** (a freshly generated layout every match, small, medium or large), or two hand-made maps with raised floors: **Fort** (a keep with ramps and battlements; Hold the Fort always plays here) and **Towers** (two raised corner towers).

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

**While playing:** a red arc at the screen edge points at whoever just hit you; when you're popped, the camera follows your killer until you respawn ("Popped by X with the Y"); gun pads near you are labelled, and power weapons show when they're back. The results screen shows your pops, accuracy, damage, best streak and top gun, with personal bests starred. Settings has separate sound-effect and music volume.

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
| `src/fx.ts` | Particles, smoke, flashes, shockwave rings |
| `src/audio.ts` | Synthesised sound effects |
| `src/music.ts` | Procedural soundtrack sequencer |
| `src/hud.ts` | Menus, lobby, HUD, performance panel |
| `src/config.ts` | Weapons, abilities, modes and other tunables |

## Tests

`tests/solo.mjs` fast-forwards bot-only matches (Gun Game on Fort and Towers, free-for-all) and checks for errors. `tests/waves.mjs` and `tests/waves-duo.mjs` cover Hold the Fort solo and online; `tests/boss-stuck.mjs` measures how long bosses spend wedged (before vs after the wide-ball pathing); `tests/qol.mjs` covers the hit arcs, killcam, pad labels, results stats, volume sliders, shadow modes and memory; `tests/newguns.mjs` and `tests/weapons-duo.mjs` cover the flamethrower, gravity gun and mines offline and online; `tests/guns.mjs` checks gun pickups, power-weapon ammo and the lingering railgun beam; `tests/adaptive-ffa.mjs` and `tests/adaptive-coop.mjs` check the Free-for-all and online versions; `tests/director.mjs` checks the difficulty climbs for a strong player and falls for a weak one. `tests/gg.mjs` plays online Gun Game 1v1 through the local servers, checks the ladder syncs, and tests the rematch.

`tests/p2p.mjs` runs two headless browsers against a local PeerJS server, creates an invite, joins it, plays a duel and checks that kills and disconnects sync:

```bash
node tests/peersrv.cjs &          # local PeerJS server on 127.0.0.1:9000
npm run build && npm run preview & # serves site/ on 8766
CHROME_PATH=/path/to/chrome npm run test:p2p
```
