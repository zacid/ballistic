import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ThemeId } from './config';
import { LOOKS } from './themes';

export const N = 32;          // cells per side
export const CELL = 1.25;     // metres per cell
export const HALF = (N * CELL) / 2;
const FLOOR_MARGIN = 7;       // floor extends past the walls

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOY = LOOKS.toy.blocks;

export interface Spot { x: number; z: number }
export type MapId = 'random' | 'fort' | 'towers' | 'open';
/** How far above a shot a bare platform floor can be and still be skimmed onto. */
export const CLIMB = 1.4;
export const STEP = 0.35;           // how high a ball can roll up without a ramp

/** Up-slope direction of a ramp cell: 0 +x, 1 -x, 2 +z, 3 -z. */
type RampDir = 0 | 1 | 2 | 3;

export class Arena {
  h: Uint8Array;       // wall height in cubes above the floor, 0 = open
  col: Int8Array;
  fl: Uint8Array;      // floor level in cubes (1 = raised platform)
  ramp: Int8Array;     // -1, or the up-slope direction
  rampBase: Float32Array; // ramp height at its low edge, in cubes
  ice: Uint8Array;     // snow theme: slippery floor cells
  hasIce = false;
  spawns: Spot[] = [];
  homeSpawns: Spot[] = [];   // hand-made maps: where the humans start in co-op
  pickupKinds: ('health' | 'nades' | 'mega')[] = [];
  pickups: Spot[] = [];
  group = new THREE.Group();
  floorCanvas!: HTMLCanvasElement;
  floorCtx!: CanvasRenderingContext2D;
  floorTex!: THREE.CanvasTexture;
  floorDirty = false;
  private dirty = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
  private fullUpload = true;
  private flushT = 0;
  uploads = 0; uploadPx = 0;
  private floorBase!: HTMLCanvasElement;
  floorPx = 2048;
  floorSize: number;

  n: number;
  half: number;

  constructor(public seed: number, size = N, public map: MapId = 'random', public theme: ThemeId = 'toy') {
    if (map === 'fort') size = 30;
    if (map === 'towers') size = 22;
    if (map === 'open') size = 30;
    this.n = size; this.half = (size * CELL) / 2;
    this.h = new Uint8Array(size * size); this.col = new Int8Array(size * size).fill(-1);
    this.fl = new Uint8Array(size * size); this.ramp = new Int8Array(size * size).fill(-1); this.rampBase = new Float32Array(size * size);
    this.ice = new Uint8Array(size * size);
    this.floorSize = size * CELL + FLOOR_MARGIN * 2;
    if (map === 'fort') this.buildFort();
    else if (map === 'towers') this.buildTowers();
    else if (map === 'open') this.buildOpen();
    else this.generate();
    if (theme === 'snow') this.freeze();
    this.build();
  }

  // ---------- heights ----------
  /** Height (m) of whatever stands in a cell: platform plus walls. Ramps never block. */
  top(i: number, j: number) {
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 99;
    const k = j * this.n + i;
    if (this.ramp[k] >= 0) return -1;
    return (this.fl[k] + this.h[k]) * CELL;
  }
  /** Ground height (m) under a point, following ramps. */
  floorAt(x: number, z: number) {
    const i = this.cellOf(x), j = this.cellOf(z);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 0;
    const k = j * this.n + i, d = this.ramp[k];
    if (d < 0) return this.fl[k] * CELL;
    const fx = (x + this.half) / CELL - i, fz = (z + this.half) / CELL - j;
    const t = d === 0 ? fx : d === 1 ? 1 - fx : d === 2 ? fz : 1 - fz;
    return (this.rampBase[k] + 0.5 * Math.max(0, Math.min(1, t))) * CELL;
  }
  /** Floor height at a cell centre (for pathfinding). */
  private level(i: number, j: number) { const k = j * this.n + i; return (this.ramp[k] >= 0 ? this.rampBase[k] + 0.25 : this.fl[k]) * CELL; }

  idx(i: number, j: number) { return j * this.n + i; }
  /** A cell a ball standing at height y can't roll into. Default y: ground level. */
  solidCell(i: number, j: number, y = 0) { return this.top(i, j) > y + STEP; }
  cellOf(x: number) { return Math.floor((x + this.half) / CELL); }
  center(i: number) { return i * CELL - this.half + CELL / 2; }
  solidAt(x: number, z: number, y = 0) { return this.solidCell(this.cellOf(x), this.cellOf(z), y); }

  private generate() {
    const r = rng(this.seed);
    const Q = this.n / 2;
    const q = new Uint8Array(Q * Q); const qc = new Int8Array(Q * Q).fill(-1);
    const free = (i: number, j: number, w: number, d: number) => {
      for (let y = j - 1; y <= j + d; y++) for (let x = i - 1; x <= i + w; x++) {
        if (x < 0 || y < 0 || x >= Q || y >= Q) continue;
        if (q[y * Q + x]) return false;
      }
      return true;
    };
    const place = (i: number, j: number, w: number, d: number, hgt: number, c: number) => {
      for (let y = j; y < j + d; y++) for (let x = i; x < i + w; x++) {
        if (x < 0 || y < 0 || x >= Q || y >= Q) continue;
        q[y * Q + x] = hgt; qc[y * Q + x] = c;
      }
    };
    // Quadrant covers the top-left; index Q-1 touches the centre line.
    let tries = 0, placed = 0;
    const target = Math.round((9 + Math.floor(r() * 4)) * (Q * Q) / 256) + 1;
    while (placed < target && tries++ < 400) {
      const shape = r();
      let w: number, d: number;
      if (shape < 0.3) { w = 1; d = 1; }                       // pillar
      else if (shape < 0.65) { w = 1 + Math.floor(r() * 3); d = 1; if (r() < 0.5) [w, d] = [d, w]; }  // bar
      else { w = 2 + Math.floor(r() * 2); d = 2; }              // block
      const i = 2 + Math.floor(r() * (Q - 2 - w));
      const j = 2 + Math.floor(r() * (Q - 2 - d));
      // keep a clear plaza around the middle of the map
      if (i + w > Q - 3 && j + d > Q - 3) continue;
      if (!free(i, j, w, d)) continue;
      const hgt = shape < 0.3 ? 2 + Math.floor(r() * 2) : r() < 0.35 ? 1 : 2;
      place(i, j, w, d, hgt, Math.floor(r() * TOY.length));
      // occasional L-shape
      if (shape >= 0.3 && shape < 0.65 && r() < 0.35) {
        const li = w > 1 ? i : i + 1, lj = w > 1 ? j + 1 : j;
        if (li < Q - 1 && lj < Q - 1 && q[lj * Q + li] === 0) { q[lj * Q + li] = hgt; qc[lj * Q + li] = qc[j * Q + i]; }
      }
      placed++;
    }
    // central feature: four short pillars around the plaza
    const cp = Q - 3;
    place(cp, cp, 1, 1, 1, 4);

    // mirror into full map
    for (let j = 0; j < Q; j++) for (let i = 0; i < Q; i++) {
      const v = q[j * Q + i], c = qc[j * Q + i];
      const pts = [[i, j], [this.n - 1 - i, j], [i, this.n - 1 - j], [this.n - 1 - i, this.n - 1 - j]];
      for (const [x, y] of pts) { this.h[this.idx(x, y)] = v; this.col[this.idx(x, y)] = c; }
    }
    // outer wall
    for (let k = 0; k < this.n; k++) {
      for (const [x, y] of [[k, 0], [k, this.n - 1], [0, k], [this.n - 1, k]]) { this.h[this.idx(x, y)] = 2; this.col[this.idx(x, y)] = 4; }
    }
    // fill unreachable pockets
    const seen = new Uint8Array(this.n * this.n);
    const start = this.idx(this.n / 2, this.n / 2);
    const stack = [start]; seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!; const x = k % this.n, y = (k / this.n) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= this.n || ny >= this.n) continue;
        const nk = this.idx(nx, ny); if (seen[nk] || this.h[nk]) continue; seen[nk] = 1; stack.push(nk);
      }
    }
    for (let k = 0; k < this.n * this.n; k++) if (!this.h[k] && !seen[k]) { this.h[k] = 1; this.col[k] = 4; }

    // spawn candidates: open cells with open neighbourhood
    for (let j = 2; j < this.n - 2; j++) for (let i = 2; i < this.n - 2; i++) {
      let ok = true;
      for (let y = -1; y <= 1 && ok; y++) for (let x = -1; x <= 1; x++) if (this.solidCell(i + x, j + y)) { ok = false; break; }
      if (ok) this.spawns.push({ x: this.center(i), z: this.center(j) });
    }
    // pickups: a few symmetric spots
    const pr = rng(this.seed * 7 + 3);
    const chosen: Spot[] = [];
    for (let t = 0; t < 200 && chosen.length < 3; t++) {
      const s = this.spawns[Math.floor(pr() * this.spawns.length)];
      if (s.x > -1 || s.z > -1) continue; // top-left quadrant only, then mirror
      if (chosen.some(c => Math.hypot(c.x - s.x, c.z - s.z) < 6)) continue;
      chosen.push(s);
    }
    for (const c of chosen) for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) this.pickups.push({ x: c.x * sx, z: c.z * sz });
    this.pickups.push({ x: 0, z: 0 });
  }

  /**
   * Snow: a few frozen puddles on open ground, mirrored like the rest of the layout so neither side is
   * favoured. Built from the seed, so both players get the same ice.
   */
  private freeze() {
    const r = rng(this.seed * 13 + 5), n = this.n, Q = Math.ceil(n / 2);
    const open = (i: number, j: number) => i > 0 && j > 0 && i < n - 1 && j < n - 1 && !this.h[this.idx(i, j)] && !this.fl[this.idx(i, j)] && this.ramp[this.idx(i, j)] < 0;
    const patches = Math.max(2, Math.round((n * n) / 260));
    for (let p = 0; p < patches; p++) {
      let ci = 2 + Math.floor(r() * (Q - 2)), cj = 2 + Math.floor(r() * (Q - 2));
      if (!open(ci, cj)) continue;
      const size = 4 + Math.floor(r() * 7);
      for (let k = 0; k < size * 3 && size > 0; k++) {
        if (open(ci, cj)) this.mirror4(ci, cj, (a, b) => { if (open(a, b)) this.ice[this.idx(a, b)] = 1; });
        const d = Math.floor(r() * 4);
        const ni = ci + (d === 0 ? 1 : d === 1 ? -1 : 0), nj = cj + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (open(ni, nj) && ni < Q && nj < Q) { ci = ni; cj = nj; }
      }
    }
    // keep pickups and spawn points grippy
    for (const s of [...this.pickups, ...this.spawns.filter((_, i) => i % 3 === 0)]) { const i = this.cellOf(s.x), j = this.cellOf(s.z); if (i >= 0 && j >= 0 && i < n && j < n) this.ice[this.idx(i, j)] = 0; }
    this.hasIce = this.ice.some(v => v === 1);
  }
  /** Is the floor under this point ice? */
  iceAt(x: number, z: number) {
    if (!this.hasIce) return false;
    const i = this.cellOf(x), j = this.cellOf(z);
    return i >= 0 && j >= 0 && i < this.n && j < this.n && this.ice[this.idx(i, j)] === 1;
  }

  // ---------- hand-made maps ----------
  private wall(i: number, j: number, h: number, c: number) { const k = this.idx(i, j); this.h[k] = h; this.col[k] = c; }
  private plat(i: number, j: number) { this.fl[this.idx(i, j)] = 1; }
  private rampAt(i: number, j: number, dir: RampDir, base: number) { const k = this.idx(i, j); this.ramp[k] = dir; this.rampBase[k] = base; }
  /** Apply f at a cell and its three mirror images (left-right, top-bottom, both). */
  private mirror4(i: number, j: number, f: (i: number, j: number) => void) {
    const n = this.n - 1, pts = new Set([`${i},${j}`, `${n - i},${j}`, `${i},${n - j}`, `${n - i},${n - j}`]);
    for (const p of pts) { const [a, b] = p.split(',').map(Number); f(a, b); }
  }
  private outerWall() {
    for (let k = 0; k < this.n; k++) for (const [x, y] of [[k, 0], [k, this.n - 1], [0, k], [this.n - 1, k]]) this.wall(x, y, 2, 4);
  }
  private at(i: number) { return this.center(i); }
  /** Spawn points: open 3x3 patches, on whatever level they sit. */
  private findSpawns(filter: (i: number, j: number) => boolean = () => true) {
    const out: Spot[] = [];
    for (let j = 2; j < this.n - 2; j++) for (let i = 2; i < this.n - 2; i++) {
      if (!filter(i, j)) continue;
      const k = this.idx(i, j); if (this.h[k] || this.ramp[k] >= 0) continue;
      const lv = this.fl[k]; let ok = true;
      for (let y = -1; y <= 1 && ok; y++) for (let x = -1; x <= 1; x++) {
        const kk = this.idx(i + x, j + y);
        if (this.h[kk] || this.ramp[kk] >= 0 || this.fl[kk] !== lv) { ok = false; break; }
      }
      if (ok) out.push({ x: this.center(i), z: this.center(j) });
    }
    return out;
  }

  /** "Fort": a raised 10x10 keep with battlements, a ramp up each side, open ground around it. */
  private buildFort() {
    const n = this.n; // 30
    this.outerWall();
    const STONE = 4;
    for (let j = 10; j <= 19; j++) for (let i = 10; i <= 19; i++) this.plat(i, j);
    // battlements: gaps at the ramp mouths (14, 15) and two firing slots per side (12, 17)
    const solid = new Set([10, 11, 13, 16, 18, 19]);
    for (const k of solid) { this.wall(k, 10, 1, STONE); this.wall(k, 19, 1, STONE); this.wall(10, k, 1, STONE); this.wall(19, k, 1, STONE); }
    // two-cell ramps up to each gate
    for (const k of [14, 15]) {
      this.rampAt(k, 8, 2, 0); this.rampAt(k, 9, 2, 0.5);     // north, climbing +z
      this.rampAt(k, 21, 3, 0); this.rampAt(k, 20, 3, 0.5);   // south, climbing -z
      this.rampAt(8, k, 0, 0); this.rampAt(9, k, 0, 0.5);     // west, climbing +x
      this.rampAt(21, k, 1, 0); this.rampAt(20, k, 1, 0.5);   // east, climbing -x
    }
    // crates on the keep to hide behind
    this.mirror4(12, 12, (i, j) => this.wall(i, j, 1, 2));
    // outside: corner L-walls, pillars near the keep, low bars in front of each gate
    for (const [i, j] of [[4, 4], [5, 4], [6, 4], [4, 5], [4, 6]]) this.mirror4(i, j, (a, b) => this.wall(a, b, 2, 1));
    for (const [i, j] of [[7, 9], [9, 7]]) this.mirror4(i, j, (a, b) => this.wall(a, b, 3, 5));
    for (const k of [13, 16]) { this.wall(k, 4, 1, 3); this.wall(k, n - 5, 1, 3); this.wall(4, k, 1, 3); this.wall(n - 5, k, 1, 3); }
    for (const [i, j] of [[8, 3], [3, 8]]) this.mirror4(i, j, (a, b) => this.wall(a, b, 2, 0));
    // pickups: mega in the keep, health in the keep's corners, grenades out in the field
    this.pickups = [{ x: 0, z: 0 }]; this.pickupKinds = ['mega'];
    this.mirror4(11, 11, (i, j) => { this.pickups.push({ x: this.at(i), z: this.at(j) }); this.pickupKinds.push('health'); });
    this.mirror4(6, 6, (i, j) => { this.pickups.push({ x: this.at(i), z: this.at(j) }); this.pickupKinds.push('nades'); });
    // health in front of each gate
    for (const [x, z] of [[0, this.at(3)], [0, this.at(n - 4)], [this.at(3), 0], [this.at(n - 4), 0]]) { this.pickups.push({ x, z }); this.pickupKinds.push('health'); }
    this.homeSpawns = this.findSpawns((i, j) => this.fl[this.idx(i, j)] === 1);
    this.spawns = [...this.findSpawns((i, j) => this.fl[this.idx(i, j)] === 0 && Math.max(Math.abs(i - 14.5), Math.abs(j - 14.5)) > 9), ...this.homeSpawns];
  }

  /** "Open" (Rollout): a big clear floor for kiting swarms, with a scatter of pillars and low blocks to weave round. */
  private buildOpen() {
    this.outerWall();
    const r = rng(this.seed);
    const spots: [number, number, number][] = [[7, 7, 2], [6, 13, 1], [11, 5, 1], [11, 11, 3]];
    for (const [i, j, h] of spots) {
      const di = Math.floor(r() * 2), dj = Math.floor(r() * 2);
      this.mirror4(i + di, j + dj, (a, b) => this.wall(a, b, h, Math.floor(r() * 6)));
      if (h === 1 && r() < 0.6) this.mirror4(i + di + 1, j + dj, (a, b) => this.wall(a, b, 1, 3));
    }
    this.spawns = this.findSpawns();
    this.homeSpawns = [];
    this.pickups = []; this.pickupKinds = [];
  }

  /** "Towers": a 1v1 map with two raised towers in opposite corners and cover in the middle. */
  private buildTowers() {
    const n = this.n; // 22
    this.outerWall();
    const pt = (i: number, j: number, f: (i: number, j: number) => void) => { f(i, j); f(n - 1 - i, n - 1 - j); };   // point symmetry
    for (let j = 2; j <= 6; j++) for (let i = 2; i <= 6; i++) pt(i, j, (a, b) => this.plat(a, b));
    // tower walls on the outer and inner-corner sides, open towards the ramp
    for (const [i, j] of [[2, 6], [3, 6], [6, 2], [6, 3], [6, 6]]) pt(i, j, (a, b) => this.wall(a, b, 1, 4));
    pt(7, 4, (a, b) => this.rampAt(a, b, a < n / 2 ? 1 : 0, 0.5));
    pt(8, 4, (a, b) => this.rampAt(a, b, a < n / 2 ? 1 : 0, 0));
    pt(7, 5, (a, b) => this.rampAt(a, b, a < n / 2 ? 1 : 0, 0.5));
    pt(8, 5, (a, b) => this.rampAt(a, b, a < n / 2 ? 1 : 0, 0));
    // the other two corners: ground-level bunkers
    for (const [i, j] of [[3, 15], [4, 15], [5, 15], [3, 16], [3, 17]]) pt(i, j, (a, b) => this.wall(a, b, 2, 1));
    // middle: four L-walls around a small plaza, and pillars on the lanes
    for (const [i, j] of [[8, 8], [9, 8], [8, 9]]) this.mirror4(i, j, (a, b) => this.wall(a, b, 1, 2));
    pt(11, 4, (a, b) => this.wall(a, b, 2, 3)); pt(11, 5, (a, b) => this.wall(a, b, 2, 3));
    pt(4, 10, (a, b) => this.wall(a, b, 3, 5)); pt(16, 10, (a, b) => this.wall(a, b, 3, 5));
    this.pickups = [{ x: 0, z: 0 }]; this.pickupKinds = ['mega'];
    pt(4, 4, (i, j) => { this.pickups.push({ x: this.at(i), z: this.at(j) }); this.pickupKinds.push('health'); });
    pt(4, 17, (i, j) => { this.pickups.push({ x: this.at(i), z: this.at(j) }); this.pickupKinds.push('nades'); });
    pt(13, 10, (i, j) => { this.pickups.push({ x: this.at(i), z: this.at(j) }); this.pickupKinds.push('health'); });
    this.spawns = this.findSpawns();
    this.homeSpawns = this.spawns;
  }

  /** Free the GPU memory this arena holds (geometry, materials, the painted floor). */
  dispose() {
    const seen = new Set<unknown>();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry && !seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.dispose(); }
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mt of mats) { if (seen.has(mt)) continue; seen.add(mt); (mt as THREE.MeshStandardMaterial).map?.dispose(); mt.dispose(); }
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.floorTex?.dispose();
  }

  private build() {
    // Blocks: one rounded cube per stacked unit, instanced.
    let count = 0;
    for (let k = 0; k < this.n * this.n; k++) count += this.h[k] + this.fl[k];
    const geo = new RoundedBoxGeometry(CELL * 0.98, CELL * 0.98, CELL * 0.98, 2, 0.14);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.0 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = false; inst.receiveShadow = true;
    // Shadows come from a plain-box proxy (12 tris vs 300 per cube). It draws nothing
    // in the main pass (no colour, no depth); the shadow pass only needs its depth.
    const proxy = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL * 0.98, CELL * 0.98, CELL * 0.98), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), count);
    proxy.castShadow = true; proxy.layers.enable(1);
    const m = new THREE.Matrix4(); const c = new THREE.Color(); const r = rng(this.seed + 11);
    const L = LOOKS[this.theme], white = new THREE.Color(0xffffff);
    let n = 0;
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const k = this.idx(i, j), hh = this.h[k], f = this.fl[k];
      for (let y = 0; y < f + hh; y++) {
        m.makeTranslation(this.center(i), CELL * (y + 0.49), this.center(j));
        inst.setMatrixAt(n, m); proxy.setMatrixAt(n, m);
        // raised floors are a checker; walls take the theme's colours (snow tops them with a white cap)
        if (y < f) { c.setHex(L.plat[(i + j) & 1]); c.offsetHSL(0, 0, (r() - 0.5) * 0.03); }
        else {
          c.setHex(L.blocks[Math.max(0, this.col[k])]); c.offsetHSL(0, 0, (r() - 0.5) * 0.06 + (y % 2 ? 0.025 : 0));
          if (L.cap && y === f + hh - 1) c.lerp(white, L.cap);
        }
        inst.setColorAt(n, c); n++;
      }
    }
    this.group.add(inst, proxy);

    // Ramps: wedges, merged into one mesh
    const wedges: THREE.BufferGeometry[] = [];
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const k = this.idx(i, j), d = this.ramp[k]; if (d < 0) continue;
      const lo = this.rampBase[k] * CELL, hi = (this.rampBase[k] + 0.5) * CELL, w = CELL / 2;
      // corners in local x/z; height depends on position along the slope
      const hAt = (x: number, z: number) => { const t = d === 0 ? (x + w) / CELL : d === 1 ? (w - x) / CELL : d === 2 ? (z + w) / CELL : (w - z) / CELL; return lo + (hi - lo) * t; };
      const g = new THREE.BoxGeometry(CELL * 0.99, 1, CELL * 0.99);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v), z = pos.getZ(v);
        pos.setY(v, pos.getY(v) > 0 ? hAt(x, z) : 0);
      }
      g.computeVertexNormals(); g.translate(this.center(i), 0, this.center(j));
      wedges.push(g);
    }
    if (wedges.length) {
      const rm = new THREE.Mesh(mergeGeometries(wedges)!, new THREE.MeshStandardMaterial({ color: L.ramp, roughness: 0.7 }));
      rm.castShadow = true; rm.receiveShadow = true; rm.layers.enable(1); this.group.add(rm);
    }

    // Floor: a painted canvas so splats can be drawn onto it permanently.
    this.floorBase = document.createElement('canvas');
    this.floorBase.width = this.floorBase.height = this.floorPx;
    const b = this.floorBase.getContext('2d')!;
    const px = this.floorPx / this.floorSize;
    const F = L.floor;
    b.fillStyle = F.bg; b.fillRect(0, 0, this.floorPx, this.floorPx);
    const o = FLOOR_MARGIN * px;
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const alt = ((i >> 1) + (j >> 1)) % 2 === 0;
      b.fillStyle = alt ? F.a : F.b;
      b.fillRect(o + i * CELL * px, o + j * CELL * px, CELL * px + 1, CELL * px + 1);
    }
    if (this.theme === 'city') {
      // tarmac grit and a few oil stains
      const gr = rng(this.seed + 21);
      for (let k = 0; k < 5000; k++) { b.fillStyle = gr() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)'; b.fillRect(o + gr() * this.n * CELL * px, o + gr() * this.n * CELL * px, 2, 2); }
      for (let k = 0; k < 14; k++) { const x = o + gr() * this.n * CELL * px, y = o + gr() * this.n * CELL * px, rr = (0.4 + gr() * 0.9) * px; const g = b.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(10,12,18,0.35)'); g.addColorStop(1, 'rgba(10,12,18,0)'); b.fillStyle = g; b.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    }
    if (this.theme === 'snow') {
      // soft drifts
      const gr = rng(this.seed + 21);
      for (let k = 0; k < 40; k++) { const x = o + gr() * this.n * CELL * px, y = o + gr() * this.n * CELL * px, rr = (1 + gr() * 2.5) * px; const g = b.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); b.fillStyle = g; b.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    }
    // soft grout lines
    b.strokeStyle = F.grout; b.lineWidth = 2;
    for (let k = 0; k <= this.n; k += 2) {
      b.beginPath(); b.moveTo(o + k * CELL * px, o); b.lineTo(o + k * CELL * px, o + this.n * CELL * px); b.stroke();
      b.beginPath(); b.moveTo(o, o + k * CELL * px); b.lineTo(o + this.n * CELL * px, o + k * CELL * px); b.stroke();
    }
    // centre ring
    b.strokeStyle = F.ring; b.lineWidth = 10;
    b.beginPath(); b.arc(this.floorPx / 2, this.floorPx / 2, 3.2 * px, 0, Math.PI * 2); b.stroke();
    if (F.lanes) {
      // dashed road markings along the two centre lines
      b.strokeStyle = F.lanes; b.lineWidth = 7; b.setLineDash([1.1 * px, 0.9 * px]);
      const mid = this.floorPx / 2, e0 = o + CELL * px, e1 = o + (this.n - 1) * CELL * px;
      for (const [x0, y0, x1, y1] of [[e0, mid, mid - 3.4 * px, mid], [mid + 3.4 * px, mid, e1, mid], [mid, e0, mid, mid - 3.4 * px], [mid, mid + 3.4 * px, mid, e1]]) { b.beginPath(); b.moveTo(x0, y0); b.lineTo(x1, y1); b.stroke(); }
      b.setLineDash([]);
    }

    this.floorCanvas = document.createElement('canvas');
    this.floorCanvas.width = this.floorCanvas.height = this.floorPx;
    this.floorCtx = this.floorCanvas.getContext('2d')!;
    this.floorCtx.drawImage(this.floorBase, 0, 0);
    this.floorTex = new THREE.CanvasTexture(this.floorCanvas);
    this.floorTex.colorSpace = THREE.SRGBColorSpace;
    this.floorTex.anisotropy = 8;
    // rows stored top-down so partial uploads map 1:1 to canvas pixels
    this.floorTex.flipY = false; this.floorTex.repeat.set(1, -1); this.floorTex.offset.set(0, 1);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.floorSize, this.floorSize),
      new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: F.rough }),
    );
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.group.add(floor);

    // Ice: glossy, see-through sheets over the frozen cells (paint splats show through, frozen in)
    if (this.hasIce) {
      const sheets: THREE.BufferGeometry[] = [];
      for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
        if (!this.ice[this.idx(i, j)]) continue;
        const g = new THREE.PlaneGeometry(CELL * 1.001, CELL * 1.001); g.rotateX(-Math.PI / 2); g.translate(this.center(i), 0.012, this.center(j)); sheets.push(g);
      }
      const ice = new THREE.Mesh(mergeGeometries(sheets)!, new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.62, depthWrite: false }));
      ice.receiveShadow = true; ice.renderOrder = 1; this.group.add(ice);
      // a frosty rim and a few cracks painted on the floor underneath
      b.save();
      for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
        if (!this.ice[this.idx(i, j)]) continue;
        const x = o + i * CELL * px, y = o + j * CELL * px, w = CELL * px;
        b.fillStyle = '#9fd0f2'; b.fillRect(x, y, w + 1, w + 1);
        const nb = (a: number, c: number) => a >= 0 && c >= 0 && a < this.n && c < this.n && this.ice[this.idx(a, c)] === 1;
        b.fillStyle = 'rgba(255,255,255,0.8)';
        if (!nb(i - 1, j)) b.fillRect(x, y, 5, w); if (!nb(i + 1, j)) b.fillRect(x + w - 5, y, 5, w);
        if (!nb(i, j - 1)) b.fillRect(x, y, w, 5); if (!nb(i, j + 1)) b.fillRect(x, y + w - 5, w, 5);
      }
      const cr = rng(this.seed + 31); b.strokeStyle = 'rgba(255,255,255,0.7)'; b.lineWidth = 2;
      for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
        if (!this.ice[this.idx(i, j)] || cr() < 0.5) continue;
        let x = o + (i + cr()) * CELL * px, y = o + (j + cr()) * CELL * px; b.beginPath(); b.moveTo(x, y);
        for (let k = 0; k < 3; k++) { x += (cr() - 0.5) * 40; y += (cr() - 0.5) * 40; b.lineTo(x, y); } b.stroke();
      }
      b.restore();
      this.floorCtx.drawImage(this.floorBase, 0, 0);
    }

    // Far ground so the edge of the floor never shows.
    const far = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: L.far, roughness: 1 }));
    far.rotation.x = -Math.PI / 2; far.position.y = -0.02; far.receiveShadow = true;
    this.group.add(far);
  }

  resetPaint() { this.floorCtx.drawImage(this.floorBase, 0, 0); this.fullUpload = true; this.floorDirty = true; }

  private markDirty(cx: number, cy: number, r: number) {
    const d = this.dirty;
    d.x0 = Math.min(d.x0, cx - r); d.y0 = Math.min(d.y0, cy - r); d.x1 = Math.max(d.x1, cx + r); d.y1 = Math.max(d.y1, cy + r);
    this.floorDirty = true;
  }

  /** Paint a cartoony splat onto the floor. */
  splat(x: number, z: number, size: number, color: number, rand = Math.random) {
    const px = this.floorPx / this.floorSize;
    const cx = (x + this.floorSize / 2) * px, cy = (z + this.floorSize / 2) * px;
    const ctx = this.floorCtx;
    const c = new THREE.Color(color);
    const dark = c.clone().multiplyScalar(0.8);
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#' + dark.getHexString();
    const blob = (bx: number, by: number, rad: number) => {
      ctx.beginPath();
      const k = 9;
      for (let a = 0; a <= k; a++) {
        const t = (a / k) * Math.PI * 2; const rr = rad * (0.8 + rand() * 0.35);
        const px2 = bx + Math.cos(t) * rr, py2 = by + Math.sin(t) * rr;
        a === 0 ? ctx.moveTo(px2, py2) : ctx.lineTo(px2, py2);
      }
      ctx.closePath(); ctx.fill();
    };
    blob(cx, cy, size * px);
    const drops = 5 + Math.floor(rand() * 6);
    for (let d = 0; d < drops; d++) {
      const a = rand() * Math.PI * 2, dist = size * px * (1 + rand() * 1.4);
      blob(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, size * px * (0.12 + rand() * 0.25));
    }
    ctx.fillStyle = '#' + c.getHexString(); ctx.globalAlpha = 0.9;
    blob(cx - size * px * 0.1, cy - size * px * 0.1, size * px * 0.62);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    blob(cx - size * px * 0.28, cy - size * px * 0.3, size * px * 0.16);
    ctx.restore();
    this.markDirty(cx, cy, size * px * 2.6 + 4);
  }

  scorch(x: number, z: number, size: number) {
    const px = this.floorPx / this.floorSize;
    const cx = (x + this.floorSize / 2) * px, cy = (z + this.floorSize / 2) * px;
    const g = this.floorCtx.createRadialGradient(cx, cy, 0, cx, cy, size * px);
    g.addColorStop(0, 'rgba(40,30,50,0.45)'); g.addColorStop(1, 'rgba(40,30,50,0)');
    this.floorCtx.fillStyle = g; this.floorCtx.fillRect(cx - size * px, cy - size * px, size * px * 2, size * px * 2);
    this.markDirty(cx, cy, size * px + 2);
  }

  /**
   * First blocking cell along a segment (fraction 0..1), or -1. Amanatides–Woo DDA.
   * y: height of the ray (a cell blocks when it stands taller). ignoreEnd: don't count the
   * destination cell, for line-of-sight to something standing on a raised cell.
   */
  raycast(x0: number, z0: number, x1: number, z1: number, y = 0.55, ignoreEnd = false, climb = 0): number {
    const dx = x1 - x0, dz = z1 - z0;
    let i = this.cellOf(x0), j = this.cellOf(z0);
    if (this.blocks(i, j, y, climb)) return 0;
    const ei = this.cellOf(x1), ej = this.cellOf(z1);
    const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
    const bx = (i + (si > 0 ? 1 : 0)) * CELL - this.half, bz = (j + (sj > 0 ? 1 : 0)) * CELL - this.half;
    let tMaxX = dx !== 0 ? (bx - x0) / dx : Infinity, tMaxZ = dz !== 0 ? (bz - z0) / dz : Infinity;
    const tdx = dx !== 0 ? CELL / Math.abs(dx) : Infinity, tdz = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
    for (let steps = 0; steps < 200; steps++) {
      if (i === ei && j === ej) return -1;
      let t: number;
      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tdx; i += si; } else { t = tMaxZ; tMaxZ += tdz; j += sj; }
      if (t > 1) return -1;
      if (ignoreEnd && i === ei && j === ej) return -1;
      if (this.blocks(i, j, y, climb)) return t;
    }
    return -1;
  }
  /** Does a cell stop a ray at height y? climb: bare raised floor this much higher still lets it through
   *  (shots and sight lines skim up onto platforms; only walls give cover). */
  blocks(i: number, j: number, y: number, climb = 0) {
    const tp = this.top(i, j);
    if (tp <= y) return false;
    if (climb > 0 && tp < 90 && this.h[j * this.n + i] === 0) return tp > y + climb;
    return true;
  }

  /** Push a circle out of walls. Returns collision normal (or null) and mutates p. */
  collide(p: { x: number; z: number }, r: number, y = 0): { nx: number; nz: number } | null {
    let hit: { nx: number; nz: number } | null = null;
    const ci = this.cellOf(p.x), cj = this.cellOf(p.z);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
        if (!this.solidCell(i, j, y)) continue;
        const minx = i * CELL - this.half, minz = j * CELL - this.half;
        const qx = Math.max(minx, Math.min(p.x, minx + CELL));
        const qz = Math.max(minz, Math.min(p.z, minz + CELL));
        let dx = p.x - qx, dz = p.z - qz; const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-5) { // centre inside the cell: push out along shortest axis
          const l = p.x - minx, rr = minx + CELL - p.x, t = p.z - minz, b = minz + CELL - p.z;
          const mn = Math.min(l, rr, t, b);
          dx = mn === l ? -1 : mn === rr ? 1 : 0; dz = mn === t ? -1 : mn === b ? 1 : 0; d = 0;
          p.x += dx * (mn + r); p.z += dz * (mn + r);
        } else {
          dx /= d; dz /= d; p.x += dx * (r - d); p.z += dz * (r - d);
        }
        hit = hit ? { nx: hit.nx + dx, nz: hit.nz + dz } : { nx: dx, nz: dz };
      }
    }
    if (hit) { const l = Math.hypot(hit.nx, hit.nz) || 1; hit.nx /= l; hit.nz /= l; }
    return hit;
  }

  /** A* over the grid, returns world waypoints (excluding start). */
  /** Can a ball roll from cell a to its neighbour b (up a ramp or step, or drop off an edge)? */
  private walkable(ai: number, aj: number, bi: number, bj: number) {
    if (bi < 0 || bj < 0 || bi >= this.n || bj >= this.n) return false;
    return this.top(bi, bj) <= this.level(ai, aj) + 0.7;
  }

  /**
   * Big balls (the wave bosses) are wider than a cell, so they can't use one-cell gaps. They path over
   * 2x2 blocks instead: a block is usable when all four cells are floor you can roll between, and the
   * waypoints are the block centres (the shared corner of the four cells).
   */
  private blockOk(i: number, j: number) {
    if (i < 0 || j < 0 || i + 1 >= this.n || j + 1 >= this.n) return false;
    for (const [a, b] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) if (this.h[this.idx(a, b)]) return false;
    return this.walkable(i, j, i + 1, j) && this.walkable(i + 1, j, i, j) && this.walkable(i, j, i, j + 1) && this.walkable(i, j + 1, i, j)
      && this.walkable(i + 1, j, i + 1, j + 1) && this.walkable(i + 1, j + 1, i + 1, j) && this.walkable(i, j + 1, i + 1, j + 1) && this.walkable(i + 1, j + 1, i, j + 1);
  }
  private corner(i: number) { return this.center(i) + CELL / 2; }
  /** Nearest usable 2x2 block to a point (searching a few cells out). */
  private nearBlock(x: number, z: number, reach = 3): number {
    const ci = Math.round((x + this.half) / CELL) - 1, cj = Math.round((z + this.half) / CELL) - 1;
    let best = -1, bd = 1e9;
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const i = ci + di, j = cj + dj; if (!this.blockOk(i, j)) continue;
      const d = Math.hypot(this.corner(i) - x, this.corner(j) - z); if (d < bd) { bd = d; best = this.idx(i, j); }
    }
    return best;
  }
  /** Centre of the nearest spot a big ball fits in (for getting a stuck boss free). */
  openSpot(x: number, z: number): Spot | null {
    const k = this.nearBlock(x, z, 4); return k < 0 ? null : { x: this.corner(k % this.n), z: this.corner((k / this.n) | 0) };
  }

  /** Is there room for a ball of radius r at this point? */
  roomy(x: number, z: number, r: number, y = 0) {
    for (let a = 0; a < 8; a++) { const t = (a / 8) * Math.PI * 2; if (this.solidAt(x + Math.cos(t) * r, z + Math.sin(t) * r, y)) return false; }
    return !this.solidAt(x, z, y);
  }
  private widePath(x0: number, z0: number, x1: number, z1: number, rad: number): Spot[] {
    const start = this.nearBlock(x0, z0), goal = this.nearBlock(x1, z1, 4);
    if (start < 0 || goal < 0) return [];
    const N = this.n * this.n, g = new Float32Array(N).fill(Infinity), f = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N), inOpen = new Uint8Array(N), open: number[] = [start];
    const ti = goal % this.n, tj = (goal / this.n) | 0;
    g[start] = 0; f[start] = Math.hypot(ti - (start % this.n), tj - ((start / this.n) | 0)); inOpen[start] = 1;
    let guard = 0;
    while (open.length && guard++ < 3000) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop(); inOpen[cur] = 0;
      if (cur === goal) break;
      closed[cur] = 1;
      const cx = cur % this.n, cy = (cur / this.n) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.blockOk(nx, ny)) continue;
        if (dx && dy && (!this.blockOk(cx + dx, cy) || !this.blockOk(cx, cy + dy))) continue;
        const nk = this.idx(nx, ny); if (closed[nk]) continue;
        const ng = g[cur] + (dx && dy ? 1.414 : 1);
        if (ng < g[nk]) { g[nk] = ng; f[nk] = ng + Math.hypot(ti - nx, tj - ny); from[nk] = cur; if (!inOpen[nk]) { open.push(nk); inOpen[nk] = 1; } }
      }
    }
    if (from[goal] < 0 && goal !== start) return [];
    const out: Spot[] = []; let k = goal;
    while (k !== start && k >= 0) { out.push({ x: this.corner(k % this.n), z: this.corner((k / this.n) | 0) }); k = from[k]; }
    out.reverse();
    const smooth: Spot[] = []; let ax = x0, az = z0;
    for (let n = 0; n < out.length; n++) {
      const nxt = out[n + 1];
      if (nxt && this.floorAt(nxt.x, nxt.z) === this.floorAt(ax, az) && this.clearPath(ax, az, nxt.x, nxt.z, rad, this.floorAt(ax, az))) continue;
      smooth.push(out[n]); ax = out[n].x; az = out[n].z;
    }
    return smooth;
  }

  path(x0: number, z0: number, x1: number, z1: number, rad = 0.5): Spot[] {
    if (rad > 0.6) return this.widePath(x0, z0, x1, z1, rad);
    const si = this.cellOf(x0), sj = this.cellOf(z0), ti = this.cellOf(x1), tj = this.cellOf(z1);
    if (ti < 0 || tj < 0 || ti >= this.n || tj >= this.n || si < 0 || sj < 0 || si >= this.n || sj >= this.n) return [];
    if (this.h[this.idx(ti, tj)]) return [];
    const start = this.idx(si, sj), goal = this.idx(ti, tj);
    const g = new Float32Array(this.n * this.n).fill(Infinity), from = new Int32Array(this.n * this.n).fill(-1);
    const open: number[] = [start]; const f = new Float32Array(this.n * this.n).fill(Infinity);
    g[start] = 0; f[start] = Math.hypot(ti - si, tj - sj);
    const closed = new Uint8Array(this.n * this.n); const inOpen = new Uint8Array(this.n * this.n); inOpen[start] = 1;
    let guard = 0;
    while (open.length && guard++ < 3000) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop(); inOpen[cur] = 0;
      if (cur === goal) break;
      closed[cur] = 1;
      const cx = cur % this.n, cy = (cur / this.n) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.walkable(cx, cy, nx, ny)) continue;
        if (dx && dy && (!this.walkable(cx, cy, cx + dx, cy) || !this.walkable(cx, cy, cx, cy + dy))) continue;
        const nk = this.idx(nx, ny); if (closed[nk]) continue;
        const ng = g[cur] + (dx && dy ? 1.414 : 1);
        if (ng < g[nk]) { g[nk] = ng; f[nk] = ng + Math.hypot(ti - nx, tj - ny); from[nk] = cur; if (!inOpen[nk]) { open.push(nk); inOpen[nk] = 1; } }
      }
    }
    if (from[goal] < 0 && goal !== start) return [];
    const out: Spot[] = []; let k = goal;
    while (k !== start && k >= 0) { out.push({ x: this.center(k % this.n), z: this.center((k / this.n) | 0) }); k = from[k]; }
    out.reverse();
    // string-pull: skip waypoints we can see past
    const smooth: Spot[] = []; let ax = x0, az = z0;
    for (let n = 0; n < out.length; n++) {
      const nxt = out[n + 1];
      if (nxt && this.floorAt(nxt.x, nxt.z) === this.floorAt(ax, az) && this.clearPath(ax, az, nxt.x, nxt.z, 0.45, this.floorAt(ax, az))) continue;
      smooth.push(out[n]); ax = out[n].x; az = out[n].z;
    }
    return smooth;
  }

  /** Line of travel clear for a ball of radius r (samples three parallel rays). */
  clearPath(x0: number, z0: number, x1: number, z1: number, r: number, y = 0) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
    const ox = (-dz / l) * r, oz = (dx / l) * r, ry = y + STEP;
    return this.raycast(x0, z0, x1, z1, ry) < 0 && this.raycast(x0 + ox, z0 + oz, x1 + ox, z1 + oz, ry) < 0 && this.raycast(x0 - ox, z0 - oz, x1 - ox, z1 - oz, ry) < 0;
  }

  /**
   * Push painted pixels to the GPU. Only the dirty rectangle is uploaded
   * (texSubImage2D from the canvas), at most ~12 times a second, instead of
   * re-uploading the whole 2048x2048 texture on every splat.
   */
  flushPaint(renderer: THREE.WebGLRenderer, dt: number) {
    this.flushT -= dt;
    if (!this.floorDirty || this.flushT > 0) return;
    const props = renderer.properties.get(this.floorTex) as any;
    const tex: WebGLTexture | undefined = props.__webglTexture;
    const gl = renderer.getContext();
    if (this.fullUpload || !tex || !(gl instanceof WebGL2RenderingContext)) {
      this.floorTex.needsUpdate = true; this.fullUpload = false;
      this.uploads++; this.uploadPx += this.floorPx * this.floorPx;
    } else {
      const d = this.dirty, P = this.floorPx;
      const x0 = Math.max(0, Math.floor(d.x0)), y0 = Math.max(0, Math.floor(d.y0));
      const x1 = Math.min(P, Math.ceil(d.x1)), y1 = Math.min(P, Math.ceil(d.y1));
      if (x1 > x0 && y1 > y0) {
        renderer.state.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, P);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, this.floorCanvas);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
        gl.generateMipmap(gl.TEXTURE_2D);
        this.uploads++; this.uploadPx += (x1 - x0) * (y1 - y0);
      }
    }
    this.dirty = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
    this.floorDirty = false; this.flushT = 0.08;
  }
}
