// Tunables for the whole game. Units: metres, seconds.

export type WeaponId = 'shotgun' | 'chaingun' | 'rocket';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  blurb: string;
  icon: string;
  kind: 'bullet' | 'rocket';
  rate: number;        // shots per second
  clip: number;
  reload: number;      // seconds
  pellets: number;
  spread: number;      // radians, full cone
  speed: number;       // projectile speed
  life: number;        // projectile lifetime
  damage: number;      // per pellet / direct hit
  falloff?: number;    // fraction of damage lost at max range (pellets)
  knock: number;       // impulse per pellet on hit
  recoil: number;      // impulse on shooter
  splash?: { radius: number; damage: number; knock: number };
  color: number;
  preferred: number;   // bot preferred range
  stats: { power: number; range: number; rate: number };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  shotgun: {
    id: 'shotgun', name: 'Shotgun', blurb: 'Nine pellets. Brutal up close, weak at range.', icon: 'SG',
    kind: 'bullet', rate: 1.2, clip: 6, reload: 1.5, pellets: 9, spread: 0.34, speed: 42, life: 0.26,
    damage: 12, falloff: 0.55, knock: 1.7, recoil: 2.2, color: 0xffb43a, preferred: 3,
    stats: { power: 1, range: 0.3, rate: 0.3 },
  },
  chaingun: {
    id: 'chaingun', name: 'Chaingun', blurb: 'A hose of lead. Keep your aim on them.', icon: 'CG',
    kind: 'bullet', rate: 13, clip: 45, reload: 1.8, pellets: 1, spread: 0.07, speed: 52, life: 0.5,
    damage: 7, knock: 0.45, recoil: 0.18, color: 0xfff27a, preferred: 7,
    stats: { power: 0.55, range: 0.8, rate: 1 },
  },
  rocket: {
    id: 'rocket', name: 'Rockets', blurb: 'Slow, loud, splash damage. Rocket-jump off walls.', icon: 'RL',
    kind: 'rocket', rate: 0.95, clip: 4, reload: 2.3, pellets: 1, spread: 0.02, speed: 17, life: 2.5,
    damage: 25, knock: 2, recoil: 3, splash: { radius: 2.8, damage: 45, knock: 15 }, color: 0xff6a3d, preferred: 7.5,
    stats: { power: 0.75, range: 0.7, rate: 0.24 },
  },
};

export const GRENADE = { fuse: 1.5, radius: 3.4, damage: 75, knock: 18, maxThrow: 12, start: 2, max: 4, cooldown: 0.6 };

export const BALL = {
  radius: 0.5,
  accel: 30,
  maxSpeed: 7.2,
  drag: 1.9,        // exponential damping per second while pushing
  coast: 2.6,       // damping when no input (rolling friction)
  wallBounce: 0.55,
  ballBounce: 0.8,
  hp: 100,
  respawn: 2.2,
};

export type ModeId = 'solo' | 'duel' | 'coop';
export interface ModeDef { id: ModeId; name: string; blurb: string; bots: number; limit: number; time: number; teams: boolean; size: number; online: boolean }
export const MODES: Record<ModeId, ModeDef> = {
  solo: { id: 'solo', name: 'Free-for-all', blurb: 'You and 7 bots. First to 20 pops.', bots: 7, limit: 20, time: 240, teams: false, size: 32, online: false },
  duel: { id: 'duel', name: '1v1', blurb: 'You against your friend. First to 10 pops.', bots: 0, limit: 10, time: 300, teams: false, size: 22, online: true },
  coop: { id: 'coop', name: '2 vs bots', blurb: 'You and your friend against 5 bots. First team to 30.', bots: 5, limit: 30, time: 300, teams: true, size: 30, online: true },
};
export const MATCH = { fragLimit: 20, timeLimit: 240, bots: 7 };

export type AbilityId = 'dash' | 'spikes' | 'bubble' | 'shockwave';
export interface AbilityDef { id: AbilityId; name: string; blurb: string; cooldown: number; dur: number }
export const ABILITIES: Record<AbilityId, AbilityDef> = {
  dash: { id: 'dash', name: 'Dash', blurb: 'Burst forward at triple speed. Ignores knockback while dashing.', cooldown: 3.5, dur: 0.28 },
  spikes: { id: 'spikes', name: 'Spikes', blurb: 'Spikes for 1.6s. Ram a ball for 45 damage and a big shove.', cooldown: 8, dur: 1.6 },
  bubble: { id: 'bubble', name: 'Bubble', blurb: 'A shield that soaks 70% of damage and knockback for 2s.', cooldown: 10, dur: 2 },
  shockwave: { id: 'shockwave', name: 'Shockwave', blurb: 'Blast everyone within 4m away for 20 damage.', cooldown: 7, dur: 0.3 },
};
export const SPIKES = { damage: 45, knock: 13 };
export const WAVE = { radius: 4, damage: 20, knock: 17 };
export const DASH = { speed: 19 };

export const COLORS = [
  { name: 'Mint', hex: 0x3ee08f },
  { name: 'Sky', hex: 0x3fa9ff },
  { name: 'Tangerine', hex: 0xff8a2a },
  { name: 'Bubblegum', hex: 0xff5fa8 },
  { name: 'Lemon', hex: 0xffd83a },
  { name: 'Grape', hex: 0x9b6bff },
  { name: 'Cherry', hex: 0xff4a4a },
  { name: 'Teal', hex: 0x22c7c7 },
];

export const BOT_NAMES = ['Pip', 'Bonk', 'Marble', 'Gumball', 'Rolo', 'Pebble', 'Nugget', 'Dot', 'Jawbreaker', 'Bouncer', 'Knuckles', 'Orbit'];

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY: Record<Difficulty, { react: number; aimErr: number; lead: number; nade: number; label: string }> = {
  easy: { react: 0.55, aimErr: 0.22, lead: 0.3, nade: 0.25, label: 'Easy' },
  normal: { react: 0.32, aimErr: 0.12, lead: 0.7, nade: 0.6, label: 'Normal' },
  hard: { react: 0.18, aimErr: 0.06, lead: 0.95, nade: 1, label: 'Hard' },
};

/** Where the hosted (GitHub Pages) build lives; shown in the claude.ai artifact's lobby. */
export const ONLINE_URL = 'https://zacid.github.io/ballistic/';

/** WebSocket relay (relay/ folder, a Cloudflare Worker). Empty = direct WebRTC via PeerJS. */
export const RELAY_URL = '';
