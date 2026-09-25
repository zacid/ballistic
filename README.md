# Ballistic

Rolling toy balls with guns. A top-down arena shooter in the spirit of Babo Violent 2, built with Three.js.

- **Solo:** free-for-all against 7 bots, first to 20 pops.
- **With a friend:** 1v1 (first to 10) or the two of you against 5 bots (first team to 30), joined with an invite link.
- Three guns (shotgun, chaingun, rockets), grenades, and a Spacebar ability (dash, spikes, bubble, shockwave).

Everything is generated in code: no image, model or audio files. Sounds are synthesised with Web Audio.

## Controls

| Action | Keys |
| --- | --- |
| Roll | W A S D |
| Aim / shoot | Mouse / left click |
| Grenade | Right click, G or Q |
| Ability | Space or Shift |
| Reload | R |
| Switch gun (next respawn) | 1 2 3 |
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

Two transports, chosen by `RELAY_URL` in `src/config.ts`:

- **Relay (recommended).** Both browsers open a WebSocket to a tiny Cloudflare Worker (`relay/`), which forwards messages between them. It works on any network that can load a website: no port forwarding, NAT or firewall rules. Cloudflare runs it close to the players (there are data centres in Johannesburg and Cape Town).
- **Direct WebRTC via PeerJS** (used when `RELAY_URL` is empty). No server of your own, but strict routers, VPNs and privacy settings can block it.

You can try a different relay without rebuilding with `?relay=wss://...` in the page URL.

### Deploy the relay (one time, free)

```bash
cd relay
npm install
npx wrangler deploy
```

The first deploy opens a browser to log in to Cloudflare (a free account is enough) and may ask you to pick a `workers.dev` subdomain. It prints the relay's address, something like `https://ballistic-relay.<you>.workers.dev`. Put that in `RELAY_URL` in `src/config.ts`, commit and push.

Check it's up by opening `https://ballistic-relay.<you>.workers.dev/health` (it says `ballistic relay ok`).

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
| `src/arena.ts` | Seeded arena generation, collision, A*, floor paint |
| `src/render.ts` | Renderer, shadows, GTAO, bloom, quality presets, GPU timing |
| `src/fx.ts` | Particles, smoke, flashes, shockwave rings |
| `src/audio.ts` | Synthesised sound effects |
| `src/hud.ts` | Menus, lobby, HUD, performance panel |
| `src/config.ts` | Weapons, abilities, modes and other tunables |

## Tests

`tests/p2p.mjs` runs two headless browsers against a local PeerJS server, creates an invite, joins it, plays a duel and checks that kills and disconnects sync:

```bash
node tests/peersrv.cjs &          # local PeerJS server on 127.0.0.1:9000
npm run build && npm run preview & # serves site/ on 8766
CHROME_PATH=/path/to/chrome npm run test:p2p
```
