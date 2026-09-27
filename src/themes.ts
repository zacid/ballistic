// How each arena theme looks: block colours, the painted floor, sky and light, and its weather.
import type { ThemeId } from './config';

export interface ThemeLook {
  /** Wall colours by the arena's colour index (index 4 is the outer wall). */
  blocks: number[];
  /** Top cube of every wall gets lightened towards white by this much (snow caps). */
  cap: number;
  plat: [number, number];     // raised-floor checker
  ramp: number;
  floor: { bg: string; a: string; b: string; grout: string; ring: string; rough: number; lanes?: string };
  far: number;
  sky: number; fog: [number, number];
  hemi: [number, number, number];   // sky colour, ground colour, intensity
  sun: [number, number];             // colour, intensity
  fill: number;
  weather: 'none' | 'rain' | 'snow';
}

export const LOOKS: Record<ThemeId, ThemeLook> = {
  toy: {
    blocks: [0xff5a4e, 0x2f8cff, 0xffc83a, 0x34c77b, 0xf6efe2, 0x9b6bff], cap: 0,
    plat: [0xe6d3b3, 0xdcc7a4], ramp: 0xd2bd98,
    floor: { bg: '#9fbbd2', a: '#e9eff7', b: '#d2deec', grout: 'rgba(80,110,150,0.10)', ring: 'rgba(255,120,90,0.35)', rough: 0.85 },
    far: 0x8fb1c9, sky: 0x9cc9ea, fog: [38, 75],
    hemi: [0xdff0ff, 0x8a7a6a, 1.25], sun: [0xfff0d8, 2.6], fill: 0.55, weather: 'none',
  },
  snow: {
    // pine, ice, cabin red, snow, timber, slate
    blocks: [0x2f6e52, 0x7fb8ea, 0xd2524a, 0xf1f5fb, 0x9a6a47, 0x8ea3bd], cap: 0.62,
    plat: [0xe9eff7, 0xdfe7f1], ramp: 0xcdd8e6,
    floor: { bg: '#b5c7da', a: '#f6f9fd', b: '#e9f0f7', grout: 'rgba(120,150,190,0.10)', ring: 'rgba(80,150,240,0.30)', rough: 0.95 },
    far: 0xe3ebf4, sky: 0xc6d4e3, fog: [30, 62],
    hemi: [0xeef6ff, 0x9aa9bd, 1.4], sun: [0xf4f7ff, 2.0], fill: 0.6, weather: 'snow',
  },
  city: {
    // brick, slate, taxi yellow, bottle green, concrete, violet
    blocks: [0xa04a3a, 0x5b6b7c, 0xe0a93a, 0x4a7a5a, 0xb9b5ae, 0x77598c], cap: 0,
    plat: [0x8e9095, 0x86888d], ramp: 0x73767b,
    floor: { bg: '#23272d', a: '#3b4048', b: '#373c44', grout: 'rgba(0,0,0,0.28)', ring: 'rgba(255,205,70,0.55)', rough: 0.42, lanes: 'rgba(255,205,70,0.5)' },
    far: 0x2c3036, sky: 0x5a6878, fog: [28, 66],
    hemi: [0xb4c3d4, 0x383a42, 1.05], sun: [0xd4dde9, 1.55], fill: 0.5, weather: 'rain',
  },
};

export const THEME_IDS: ThemeId[] = ['toy', 'snow', 'city'];
