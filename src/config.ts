// Tunables for the whole game. Units: metres, seconds.

export type WeaponId = 'shotgun' | 'chaingun' | 'rocket' | 'railgun' | 'bouncer' | 'flamethrower' | 'gravity' | 'lightning' | 'pistol' | 'grenade' | 'spikes';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  blurb: string;
  icon: string;
  kind: 'bullet' | 'rocket' | 'rail' | 'bounce' | 'flame' | 'grav' | 'zap' | 'lob' | 'melee';
  hidden?: boolean;    // Gun Game only, not in the loadout picker
  semi?: boolean;      // one shot per click for players
  bounces?: number;    // wall bounces before a projectile dies
  range?: number;      // hitscan / bot engagement range when speed*life doesn't apply
  ammo?: number;       // power weapons: total rounds when picked up (clip included); empty = back to the pistol
  linger?: { t: number; damage: number };   // railgun: the beam hangs in the air and hurts anyone rolling through
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
  // Balance targets (damage per second if every shot lands): pistol ~70, shotgun ~130 point blank
  // falling to ~45 at its edge, chaingun ~115 close and ~60 at range, bouncer ~58, rockets ~66 plus
  // splash, railgun ~52 but instant and piercing. Rockets and the railgun are power weapons: limited ammo.
  shotgun: {
    id: 'shotgun', name: 'Shotgun', blurb: 'Ten pellets. Brutal up close, useless past a few metres.', icon: 'SG',
    kind: 'bullet', rate: 1.2, clip: 6, reload: 1.5, pellets: 10, spread: 0.42, speed: 40, life: 0.18,
    damage: 11, falloff: 0.65, knock: 1.7, recoil: 2.2, color: 0xffb43a, preferred: 2.8,
    stats: { power: 1, range: 0.2, rate: 0.3 },
  },
  chaingun: {
    id: 'chaingun', name: 'Chaingun', blurb: 'A hose of lead. Hits hardest up close.', icon: 'CG',
    kind: 'bullet', rate: 13, clip: 50, reload: 1.8, pellets: 1, spread: 0.05, speed: 52, life: 0.42,
    damage: 9, falloff: 0.5, knock: 0.6, recoil: 0.18, color: 0xfff27a, preferred: 6,
    stats: { power: 0.65, range: 0.65, rate: 1 },
  },
  rocket: {
    id: 'rocket', name: 'Rockets', blurb: 'Splash damage. Power weapon: 8 rockets.', icon: 'RL', ammo: 8,
    kind: 'rocket', rate: 0.95, clip: 4, reload: 2.3, pellets: 1, spread: 0.02, speed: 17, life: 2.5,
    damage: 25, knock: 2, recoil: 3, splash: { radius: 2.8, damage: 45, knock: 15 }, color: 0xff6a3d, preferred: 7.5,
    stats: { power: 0.8, range: 0.7, rate: 0.24 },
  },
  railgun: {
    id: 'railgun', name: 'Railgun', blurb: 'Piercing beam that lingers. Power weapon: 6 shots.', icon: 'RG', ammo: 6,
    kind: 'rail', rate: 0.75, clip: 3, reload: 2.2, pellets: 1, spread: 0, speed: 0, life: 0, range: 40,
    damage: 70, knock: 9, recoil: 3.5, color: 0xb38cff, preferred: 11, linger: { t: 0.7, damage: 30 },
    stats: { power: 0.9, range: 1, rate: 0.15 },
  },
  bouncer: {
    id: 'bouncer', name: 'Bouncer', blurb: 'Glowing balls that ricochet off walls three times.', icon: 'BN',
    kind: 'bounce', rate: 3.2, clip: 12, reload: 1.8, pellets: 1, spread: 0.06, speed: 26, life: 1.4, bounces: 3,
    damage: 18, knock: 2.2, recoil: 0.6, color: 0x5cffb0, preferred: 6,
    stats: { power: 0.55, range: 0.6, rate: 0.5 },
  },
  flamethrower: {
    id: 'flamethrower', name: 'Flamethrower', blurb: 'Melts anything point blank. Sets balls alight; the floor burns too.', icon: 'FT',
    kind: 'flame', rate: 18, clip: 90, reload: 2, pellets: 1, spread: 0.32, speed: 11, life: 0.45,
    damage: 9, falloff: 0.72, knock: 0.15, recoil: 0, color: 0xff7a2a, preferred: 2.4,
    stats: { power: 0.8, range: 0.25, rate: 1 },
  },
  gravity: {
    id: 'gravity', name: 'Gravity Gun', blurb: 'Hold to drag balls in, let go to fling them. Walls hurt.', icon: 'GG', hidden: true,   // retired: swapped for the lightning gun
    kind: 'grav', rate: 1.4, clip: 1, reload: 0.1, pellets: 1, spread: 0, speed: 0, life: 0, range: 9,
    damage: 8, knock: 25, recoil: 2, color: 0x6ad0ff, preferred: 5,
    stats: { power: 0.7, range: 0.45, rate: 0.35 },
  },
  lightning: {
    id: 'lightning', name: 'Lightning Gun', blurb: 'Locks onto the nearest ball in front of you and chains to two more. Close enough counts.', icon: 'LG',
    kind: 'zap', rate: 8, clip: 40, reload: 1.8, pellets: 1, spread: 0.45, speed: 0, life: 0, range: 7.5,
    damage: 9, knock: 0.8, recoil: 0.1, color: 0x8fd4ff, preferred: 5,
    stats: { power: 0.6, range: 0.4, rate: 0.85 },
  },
  pistol: {
    id: 'pistol', name: 'Pistol', blurb: 'What everyone starts with. Accurate, one shot per click.', icon: 'PS',
    kind: 'bullet', rate: 5, clip: 12, reload: 1.2, pellets: 1, spread: 0.025, speed: 60, life: 0.42, semi: true,
    damage: 14, falloff: 0.3, knock: 0.9, recoil: 0.5, color: 0xcfe8ff, preferred: 7,
    stats: { power: 0.4, range: 0.75, rate: 0.55 },
  },
  grenade: {
    id: 'grenade', name: 'Grenades', blurb: 'Unlimited grenades. Click to throw.', icon: 'GR', hidden: true,
    kind: 'lob', rate: 1.4, clip: 99, reload: 0.1, pellets: 1, spread: 0, speed: 0, life: 0, range: 12,
    damage: 0, knock: 0, recoil: 0, color: 0x7ad48a, preferred: 7,
    stats: { power: 0.8, range: 0.6, rate: 0.3 },
  },
  spikes: {
    id: 'spikes', name: 'Spikes', blurb: 'No gun. Ram someone to pop them.', icon: 'SP', hidden: true,
    kind: 'melee', rate: 1, clip: 1, reload: 0.1, pellets: 1, spread: 0, speed: 0, life: 0, range: 1.5,
    damage: 0, knock: 0, recoil: 0, color: 0xe8ecf5, preferred: 0,
    stats: { power: 1, range: 0, rate: 1 },
  },
};
/** Everyone spawns with this; the rest are picked up around the arena. */
export const START_WEAPON: WeaponId = 'pistol';
/** Guns that lie around the map, most contested spots first. */
export const MAP_GUNS: WeaponId[] = ['rocket', 'railgun', 'lightning', 'flamethrower', 'shotgun', 'chaingun', 'bouncer', 'lightning'];
/** Lightning chains from the first ball to up to two more nearby, each for a share of the damage. */
export const ZAP = { chains: 2, hop: 3.6, falloff: 0.6 };
/** Flamethrower afterburn and the gravity gun's pull / wall-slam numbers. */
export const BURN = { t: 2.2, dps: 12, patchT: 1.6, patchR: 0.75, patchDps: 22 };
export const GRAV = { pull: 62, hold: 1.7, maxHold: 2.5, flingR: 3.2, slamSpeed: 6, slamDmg: 4, slamMax: 50 };
export const GUN_RESPAWN = { normal: 12, power: 22, dropLife: 12, maxDrops: 10 };
/** Guns you can pick in the loadout (Gun Game adds the hidden ones). */
export const PICKABLE = (Object.keys(WEAPONS) as WeaponId[]).filter(w => !WEAPONS[w].hidden);
/** Gun Game ladder: strongest first, the spikes finale is the "knife". */
export const LADDER: WeaponId[] = ['rocket', 'railgun', 'chaingun', 'flamethrower', 'bouncer', 'shotgun', 'lightning', 'pistol', 'grenade', 'spikes'];

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

export type ModeId = 'solo' | 'duel' | 'coop' | 'gungame' | 'ggduel' | 'waves' | 'practice';
export interface ModeDef { id: ModeId; name: string; blurb: string; bots: number; limit: number; time: number; teams: boolean; size: number; online: boolean; gun?: boolean; perTier?: number; map?: 'fort' | 'towers' | 'random'; waves?: boolean; practice?: boolean }
export const MODES: Record<ModeId, ModeDef> = {
  solo: { id: 'solo', name: 'Free-for-all', blurb: 'You and 7 bots. First to 20 pops.', bots: 7, limit: 20, time: 240, teams: false, size: 32, online: false },
  duel: { id: 'duel', name: '1v1', blurb: 'You against your friend. First to 10 pops.', bots: 0, limit: 10, time: 300, teams: false, size: 22, online: true },
  coop: { id: 'coop', name: '2 vs bots', blurb: 'You and your friend against 5 bots. First team to 30.', bots: 5, limit: 30, time: 300, teams: true, size: 30, online: true, map: 'fort' },
  gungame: { id: 'gungame', name: 'Gun Game', blurb: 'Every pop moves you up a weapon. Win with a spikes kill.', bots: 7, limit: 8, time: 480, teams: false, size: 32, online: false, gun: true, perTier: 1 },
  waves: { id: 'waves', name: 'Hold the Fort', blurb: 'Defend the keep against waves of bots. A boss every 5th wave.', bots: 8, limit: 0, time: 0, teams: true, size: 30, online: true, map: 'fort', waves: true },
  practice: { id: 'practice', name: 'Practice range', blurb: 'Pop 20 target balls as fast as you can. They never shoot back.', bots: 6, limit: 20, time: 0, teams: false, size: 22, online: false, practice: true },
  ggduel: { id: 'ggduel', name: 'Gun Game 1v1', blurb: 'Climb the weapon ladder: 2 pops per weapon, win with spikes.', bots: 0, limit: 8, time: 480, teams: false, size: 22, online: true, gun: true, perTier: 2 },
};
export const MAPS = {
  random: { name: 'Random', blurb: 'A freshly generated layout every match' },
  fort: { name: 'Fort', blurb: 'A raised keep with ramps and battlements' },
  towers: { name: 'Towers', blurb: 'Two raised towers in opposite corners' },
} as const;
export type MapChoice = keyof typeof MAPS;
/** Looks and weather. Snow has icy patches you slide on; the city has rain and the odd thunderclap. */
export const THEMES = {
  toy: { name: 'Toy room', blurb: 'Bright blocks on a tiled floor' },
  snow: { name: 'Snow', blurb: 'Snowfall, and icy patches you slide across' },
  city: { name: 'City', blurb: 'Rain on wet streets, and the odd thunderclap' },
  any: { name: 'Any', blurb: 'A different look every match' },
} as const;
export type ThemeChoice = keyof typeof THEMES;
export type ThemeId = Exclude<ThemeChoice, 'any'>;
/** On ice: how much grip is left for steering and for rolling to a stop. */
export const ICE = { grip: 0.28, coast: 0.1 };
/** Size of a random arena, in cells (1.25 m each). The hand-made maps have fixed sizes. */
export const ARENA_SIZES = { small: { name: 'Small', n: 22 }, medium: { name: 'Medium', n: 28 }, large: { name: 'Large', n: 34 } } as const;
export type ArenaSize = keyof typeof ARENA_SIZES;
/** Hold the Fort. Lives are shared by the defenders; a death with none left sits you out until the next wave. */
export const WAVES = {
  lives: 3, livesDuo: 5, maxLives: 9, breakT: 6, firstBreak: 3,
};   // wave size, pace, guns and bot skill come from the director (src/director.ts)
export const BOSS = { hp: 450, every: 5, speed: 0.8, knock: 0.3, miniAt: 3, miniScale: 1.35, miniHp: 0.5 };
export const MATCH = { fragLimit: 20, timeLimit: 240, bots: 7 };

export type AbilityId = 'dash' | 'spikes' | 'bubble' | 'shockwave' | 'mine' | 'nuke';
export interface AbilityDef { id: AbilityId; name: string; blurb: string; cooldown: number; dur: number }
export const ABILITIES: Record<AbilityId, AbilityDef> = {
  dash: { id: 'dash', name: 'Dash', blurb: 'Burst forward at triple speed. Ignores knockback while dashing.', cooldown: 3.5, dur: 0.28 },
  spikes: { id: 'spikes', name: 'Spikes', blurb: 'Spikes for 1.6s. Ram a ball for 45 damage and a big shove.', cooldown: 8, dur: 1.6 },
  bubble: { id: 'bubble', name: 'Bubble', blurb: 'A shield that soaks 70% of damage and knockback for 2s.', cooldown: 10, dur: 2 },
  mine: { id: 'mine', name: 'Mine', blurb: 'Drop a proximity mine (3 at a time). Arms after a second.', cooldown: 5, dur: 0 },
  shockwave: { id: 'shockwave', name: 'Shockwave', blurb: 'Blast everyone within 4m away for 20 damage.', cooldown: 7, dur: 0.3 },
  nuke: { id: 'nuke', name: 'Nuke Bot', blurb: 'Drop a beeping bot. 3s later it blows up everything within 6m, you included. Run!', cooldown: 12, dur: 0 },
};
export const SPIKES = { damage: 45, knock: 13 };
export const MINE = { max: 3, arm: 1, trigger: 1.3, radius: 2.7, damage: 65, knock: 15, life: 45 };
/** Nuke Bot (from Babo Violent 2): sits where you drop it, beeps faster and faster, then a huge blast. Walls block it. */
export const NUKE = { fuse: 3, radius: 6, damage: 150, knock: 24 };
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

export type Difficulty = 'easy' | 'normal' | 'hard' | 'adaptive';
export const DIFFICULTY: Record<Difficulty, { react: number; aimErr: number; lead: number; nade: number; label: string }> = {
  easy: { react: 0.55, aimErr: 0.22, lead: 0.3, nade: 0.25, label: 'Easy' },
  normal: { react: 0.32, aimErr: 0.12, lead: 0.7, nade: 0.6, label: 'Normal' },
  hard: { react: 0.18, aimErr: 0.06, lead: 0.95, nade: 1, label: 'Hard' },
  // Hold the Fort sizes every wave to you (src/director.ts); elsewhere it plays like Normal
  adaptive: { react: 0.32, aimErr: 0.12, lead: 0.7, nade: 0.6, label: 'Adaptive' },
};

/** Where the hosted (GitHub Pages) build lives; shown in the claude.ai artifact's lobby. */
export const ONLINE_URL = 'https://zacid.github.io/ballistic/';

/** WebSocket relay (relay/ folder, a Cloudflare Worker). Empty = direct WebRTC via PeerJS. */
export const RELAY_URL = 'https://ballistic-relay.zac156.workers.dev';
