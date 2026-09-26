# Ballistic

Rolling toy balls with guns. A top-down arena shooter in the spirit of Babo Violent 2, built with Three.js.

- **Solo:** free-for-all against 7 bots (first to 20 pops), or Gun Game.
- **With a friend:** 1v1 (first to 10), the two of you against 5 bots (first team to 30), or Gun Game 1v1, joined with an invite link. Rematch goes straight back in without the lobby.
- Six guns (shotgun, chaingun, rockets, railgun, bouncer, pistol), grenades, and a Spacebar ability (dash, spikes, bubble, shockwave).
- **Arenas:** a fresh random arena each match, or two hand-made ones with raised floors: **Fort** (a keep with ramps and battlements, the default for 2 vs bots) and **Towers** (two raised corner towers).

### Gun Game

Every pop moves you one weapon up the ladder: rockets, railgun, chaingun, bouncer, shotgun, pistol, unlimited grenades, then spikes. Pop someone with spikes to win. One pop per level against bots, two in the 1v1. Getting spiked (or popping yourself) drops you a level. The spikes ability and grenade pickups are off in this mode.

Shots skim up onto raised floors on their own (there's no vertical aim), so only walls and battlements give cover.

Everything is generated in code: no image, model or audio files. Sounds are synthesised with Web Audio.

## Controls

| Action | Keys |
| --- | --- |
| Roll | W A S D |
| Aim / shoot | Mouse / left click |
| Grenade | Right click, G or Q |
| Ability | Space or Shift |
| Reload | R |
| Switch gun (next respawn) | 1 to 6 |
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
| `src/hud.ts` | Menus, lobby, HUD, performance panel |
| `src/config.ts` | Weapons, abilities, modes and other tunables |

## Tests

`tests/solo.mjs` fast-forwards bot-only matches (Gun Game on Fort and Towers, free-for-all) and checks for errors. `tests/gg.mjs` plays online Gun Game 1v1 through the local servers, checks the ladder syncs, and tests the rematch.

`tests/p2p.mjs` runs two headless browsers against a local PeerJS server, creates an invite, joins it, plays a duel and checks that kills and disconnects sync:

```bash
node tests/peersrv.cjs &          # local PeerJS server on 127.0.0.1:9000
npm run build && npm run preview & # serves site/ on 8766
CHROME_PATH=/path/to/chrome npm run test:p2p
```
