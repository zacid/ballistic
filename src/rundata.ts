// Rollout (the Brotato-style run): the numbers. Stats you build up, what the shop sells, the turrets
// that bolt onto your ball, the ball types, and the minions.
import type { WeaponId } from './config';

export const RUN = {
  waves: 20,
  bossWaves: [10, 20],
  /** Wave length in seconds: short at first, a minute by the end. */
  waveTime: (n: number) => Math.min(60, 20 + n * 2),
  /** XP to reach the next level from `lvl` (Brotato's curve). */
  xpFor: (lvl: number) => (lvl + 3) * (lvl + 3),
  turretSlots: 4,
  maxAlive: 110,
  iframes: 0.45,          // after a minion bumps you, the others can't for a moment
  startHp: 100,
};

/** Rarity tiers, Brotato colours: grey, blue, purple, red. */
export const TIERS = [
  { name: 'Common', color: 0xc9ced9 },
  { name: 'Uncommon', color: 0x4aa8ff },
  { name: 'Rare', color: 0xb46bff },
  { name: 'Legendary', color: 0xff5353 },
];
/** Weapon tiers multiply damage (and fire a touch faster). */
export const TIER_DMG = [1, 1.6, 2.4, 3.5];
export const TIER_RATE = [1, 1.1, 1.2, 1.3];

// ---------- stats ----------
export type StatId = 'maxHp' | 'regen' | 'lifesteal' | 'damage' | 'rate' | 'range' | 'armor' | 'dodge' | 'speed' | 'luck' | 'harvest' | 'pickup' | 'cooldown' | 'knock' | 'turretDmg' | 'turretRate' | 'thorns';
export type Stats = Record<StatId, number>;
export const blankStats = (): Stats => ({ maxHp: 0, regen: 0, lifesteal: 0, damage: 0, rate: 0, range: 0, armor: 0, dodge: 0, speed: 0, luck: 0, harvest: 0, pickup: 0, cooldown: 0, knock: 0, turretDmg: 0, turretRate: 0, thorns: 0 });

export const STAT_INFO: Record<StatId, { name: string; unit: string; hint: string }> = {
  maxHp: { name: 'Max HP', unit: '', hint: 'More health' },
  regen: { name: 'HP Regen', unit: '', hint: 'Heal half a point per second for each point' },
  lifesteal: { name: 'Life Steal', unit: '%', hint: 'Chance to heal 3 HP when you hit something' },
  damage: { name: 'Damage', unit: '%', hint: 'Everything you and your turrets deal' },
  rate: { name: 'Fire Rate', unit: '%', hint: 'Your main gun fires faster' },
  range: { name: 'Range', unit: '%', hint: 'Shots fly further; turrets see further' },
  armor: { name: 'Armour', unit: '', hint: 'Each point takes a bit off every hit' },
  dodge: { name: 'Dodge', unit: '%', hint: 'Chance to take no damage at all (max 60%)' },
  speed: { name: 'Speed', unit: '%', hint: 'Roll faster' },
  luck: { name: 'Luck', unit: '', hint: 'Better tiers in the shop and on level-ups' },
  harvest: { name: 'Harvesting', unit: '', hint: 'Free coins at the end of every wave (grows each wave)' },
  pickup: { name: 'Pickup Range', unit: '%', hint: 'Coins fly to you from further away' },
  cooldown: { name: 'Ability Haste', unit: '%', hint: 'Your Spacebar ability recharges faster' },
  knock: { name: 'Knockback', unit: '%', hint: 'Hits shove enemies further' },
  turretDmg: { name: 'Turret Damage', unit: '%', hint: 'Your turrets hit harder' },
  turretRate: { name: 'Turret Speed', unit: '%', hint: 'Your turrets fire faster' },
  thorns: { name: 'Thorns', unit: '', hint: 'Damage dealt to minions that bump into you' },
};

/** Level-up picks: each stat with its value at each tier. */
export const LEVEL_UPS: { stat: StatId; v: [number, number, number, number] }[] = [
  { stat: 'maxHp', v: [6, 10, 15, 20] },
  { stat: 'regen', v: [1, 2, 3, 4] },
  { stat: 'lifesteal', v: [1, 2, 3, 4] },
  { stat: 'damage', v: [5, 8, 12, 16] },
  { stat: 'rate', v: [5, 10, 15, 20] },
  { stat: 'range', v: [8, 12, 16, 20] },
  { stat: 'armor', v: [1, 2, 3, 4] },
  { stat: 'dodge', v: [3, 5, 7, 9] },
  { stat: 'speed', v: [3, 5, 7, 9] },
  { stat: 'luck', v: [5, 10, 15, 20] },
  { stat: 'harvest', v: [4, 6, 8, 10] },
  { stat: 'turretDmg', v: [6, 10, 14, 18] },
  { stat: 'turretRate', v: [5, 8, 12, 16] },
];

// ---------- items ----------
export interface ItemDef { id: string; name: string; tier: 0 | 1 | 2 | 3; mods: Partial<Stats>; note?: string; max?: number }
export const ITEMS: ItemDef[] = [
  { id: 'sharp', name: 'Sharp Edges', tier: 0, mods: { damage: 8 } },
  { id: 'bubble', name: 'Bubble Wrap', tier: 0, mods: { maxHp: 10, armor: 1, speed: -3 } },
  { id: 'batteries', name: 'Spare Batteries', tier: 0, mods: { rate: 12, damage: -4 } },
  { id: 'lens', name: 'Magnifying Glass', tier: 0, mods: { range: 20, rate: -4 } },
  { id: 'magnet', name: 'Fridge Magnet', tier: 0, mods: { pickup: 40 } },
  { id: 'bandaid', name: 'Plasters', tier: 0, mods: { regen: 2 } },
  { id: 'dice', name: 'Lucky Dice', tier: 0, mods: { luck: 12 } },
  { id: 'wheels', name: 'Turbo Wheels', tier: 0, mods: { speed: 12, armor: -1 } },
  { id: 'piggy', name: 'Piggy Bank', tier: 0, mods: { harvest: 8 } },
  { id: 'oil', name: 'Turret Oil', tier: 0, mods: { turretRate: 12 } },
  { id: 'lead', name: 'Lead Core', tier: 1, mods: { knock: 35, armor: 3, speed: -6 } },
  { id: 'rubber', name: 'Rubber Skin', tier: 1, mods: { dodge: 8, maxHp: -5 } },
  { id: 'teeth', name: 'Vampire Teeth', tier: 1, mods: { lifesteal: 4 } },
  { id: 'energy', name: 'Energy Drink', tier: 1, mods: { cooldown: 20, speed: 5 } },
  { id: 'spiky', name: 'Spiky Shell', tier: 1, mods: { thorns: 12, armor: 1 } },
  { id: 'toolbox', name: 'Toolbox', tier: 1, mods: { turretDmg: 18, damage: -3 } },
  { id: 'glass', name: 'Glass Cannon', tier: 2, mods: { damage: 25, maxHp: -15 } },
  { id: 'helmet', name: 'Crash Helmet', tier: 2, mods: { armor: 5, maxHp: 10, dodge: -3 } },
  { id: 'clover', name: 'Four-leaf Clover', tier: 2, mods: { luck: 25, harvest: 6 } },
  { id: 'overclock', name: 'Overclock', tier: 2, mods: { rate: 20, turretRate: 15, armor: -2 } },
  { id: 'crown', name: 'Paper Crown', tier: 3, mods: { damage: 20, rate: 10, speed: 6, maxHp: 10 }, max: 1 },
  { id: 'heart', name: 'Spare Heart', tier: 3, mods: { maxHp: 40, regen: 3 }, max: 1 },
  { id: 'gearbox', name: 'Gearbox', tier: 3, mods: { turretDmg: 35, turretRate: 25 }, max: 1 },
];
export const ITEM_PRICE = [14, 28, 50, 90];

// ---------- turrets ----------
/** A bolt-on gun: fires by itself at the nearest enemy in range. Damage and rate are at tier 1. */
export interface TurretDef { w: WeaponId; name: string; rate: number; dmg: number; range: number; price: number; pellets?: number; spread?: number; speed?: number; splash?: number }
export const TURRETS: TurretDef[] = [
  { w: 'pistol', name: 'Pea Turret', rate: 2.2, dmg: 8, range: 8, price: 18 },
  { w: 'chaingun', name: 'Buzz Turret', rate: 6, dmg: 3.5, range: 7, price: 24, spread: 0.14 },
  { w: 'shotgun', name: 'Scatter Turret', rate: 0.8, dmg: 5, range: 4.2, price: 24, pellets: 6, spread: 0.5 },
  { w: 'bouncer', name: 'Pinball Turret', rate: 1.4, dmg: 9, range: 7, price: 26 },
  { w: 'flamethrower', name: 'Torch Turret', rate: 10, dmg: 2.5, range: 3.4, price: 28 },
  { w: 'lightning', name: 'Zap Turret', rate: 1.8, dmg: 7, range: 5.5, price: 32 },
  { w: 'rocket', name: 'Rocket Pod', rate: 0.45, dmg: 10, range: 9, price: 38, splash: 22 },
];
/** Main guns you can buy (the one you aim). */
export const MAIN_GUNS: { w: WeaponId; price: number }[] = [
  { w: 'pistol', price: 14 }, { w: 'shotgun', price: 24 }, { w: 'chaingun', price: 26 }, { w: 'bouncer', price: 24 },
  { w: 'flamethrower', price: 28 }, { w: 'lightning', price: 30 }, { w: 'rocket', price: 40 }, { w: 'railgun', price: 44 },
];

// ---------- ball types ----------
export interface BallType { id: string; name: string; blurb: string; mods: Partial<Stats>; turret?: WeaponId }
export const BALLS: BallType[] = [
  { id: 'classic', name: 'Classic', blurb: 'No strings attached.', mods: {} },
  { id: 'bowling', name: 'Bowling Ball', blurb: '+20 HP, +4 armour, +40% knockback, 15 thorns. 12% slower.', mods: { maxHp: 20, armor: 4, knock: 40, thorns: 15, speed: -12 } },
  { id: 'pingpong', name: 'Ping-pong', blurb: '+20% speed, +10% dodge, +10% fire rate. 30 less HP.', mods: { speed: 20, dodge: 10, rate: 10, maxHp: -30 } },
  { id: 'magnet', name: 'Magnet', blurb: 'Coins come from twice as far, +10 harvesting. 10% less damage.', mods: { pickup: 100, harvest: 10, damage: -10 } },
  { id: 'gear', name: 'Gearball', blurb: 'Starts with a Pea Turret. Turrets +25% damage, your gun -20%.', mods: { turretDmg: 25, damage: -20 }, turret: 'pistol' },
];

// ---------- minions ----------
export type MinionKind = 'roller' | 'dasher' | 'spitter' | 'tank' | 'splitter' | 'mini';
export interface MinionDef { hp: number; speed: number; dmg: number; r: number; color: number; coins: number; from: number; weight: number; mass: number }
export const MINIONS: Record<MinionKind, MinionDef> = {
  roller: { hp: 10, speed: 3.1, dmg: 8, r: 0.32, color: 0xff5a6e, coins: 1, from: 1, weight: 10, mass: 1 },
  dasher: { hp: 8, speed: 2.4, dmg: 10, r: 0.3, color: 0xff9a2a, coins: 1, from: 3, weight: 4, mass: 0.8 },
  spitter: { hp: 12, speed: 2.4, dmg: 8, r: 0.34, color: 0xa66bff, coins: 1, from: 5, weight: 3, mass: 1 },
  tank: { hp: 48, speed: 1.9, dmg: 15, r: 0.58, color: 0x3f9d6a, coins: 3, from: 7, weight: 2, mass: 4 },
  splitter: { hp: 18, speed: 2.8, dmg: 9, r: 0.42, color: 0xffd23a, coins: 1, from: 9, weight: 3, mass: 1.5 },
  mini: { hp: 4, speed: 4.4, dmg: 5, r: 0.2, color: 0xffe98a, coins: 0, from: 99, weight: 0, mass: 0.5 },
};
