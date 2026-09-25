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
  knock: number;       // impulse per pellet on hit
  recoil: number;      // impulse on shooter
  splash?: { radius: number; damage: number; knock: number };
  color: number;
  preferred: number;   // bot preferred range
  stats: { power: number; range: number; rate: number };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  shotgun: {
    id: 'shotgun', name: 'Shotgun', blurb: 'Eight pellets. Shoves babos across the room.', icon: 'SG',
    kind: 'bullet', rate: 1.25, clip: 6, reload: 1.5, pellets: 8, spread: 0.42, speed: 40, life: 0.32,
    damage: 10, knock: 1.6, recoil: 2.2, color: 0xffb43a, preferred: 3.2,
    stats: { power: 0.95, range: 0.35, rate: 0.3 },
  },
  chaingun: {
    id: 'chaingun', name: 'Chaingun', blurb: 'A hose of lead. Keep your aim on them.', icon: 'CG',
    kind: 'bullet', rate: 13, clip: 45, reload: 1.8, pellets: 1, spread: 0.07, speed: 52, life: 0.5,
    damage: 7, knock: 0.45, recoil: 0.18, color: 0xfff27a, preferred: 7,
    stats: { power: 0.55, range: 0.8, rate: 1 },
  },
  rocket: {
    id: 'rocket', name: 'Rockets', blurb: 'Slow, loud, splash damage. Rocket-jump off walls.', icon: 'RL',
    kind: 'rocket', rate: 1.15, clip: 4, reload: 2.0, pellets: 1, spread: 0.02, speed: 19, life: 2.5,
    damage: 40, knock: 2, recoil: 3, splash: { radius: 3.2, damage: 62, knock: 16 }, color: 0xff6a3d, preferred: 7.5,
    stats: { power: 1, range: 0.7, rate: 0.28 },
  },
};

export const GRENADE = { fuse: 1.5, radius: 3.6, damage: 85, knock: 19, maxThrow: 12, start: 2, max: 4, cooldown: 0.6 };

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

export const MATCH = { fragLimit: 20, timeLimit: 240, bots: 7 };

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
