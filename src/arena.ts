import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

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

const TOY = [0xff5a4e, 0x2f8cff, 0xffc83a, 0x34c77b, 0xf6efe2, 0x9b6bff];

export interface Spot { x: number; z: number }

export class Arena {
  h: Uint8Array;       // block height in cubes, 0 = open
  col: Int8Array;
  spawns: Spot[] = [];
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

  constructor(public seed: number, size = N) {
    this.n = size; this.half = (size * CELL) / 2;
    this.h = new Uint8Array(size * size); this.col = new Int8Array(size * size).fill(-1);
    this.floorSize = size * CELL + FLOOR_MARGIN * 2;
    this.generate();
    this.build();
  }

  idx(i: number, j: number) { return j * this.n + i; }
  solidCell(i: number, j: number) {
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return true;
    return this.h[j * this.n + i] > 0;
  }
  cellOf(x: number) { return Math.floor((x + this.half) / CELL); }
  center(i: number) { return i * CELL - this.half + CELL / 2; }
  solidAt(x: number, z: number) { return this.solidCell(this.cellOf(x), this.cellOf(z)); }

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

  private build() {
    // Blocks: one rounded cube per stacked unit, instanced.
    let count = 0;
    for (let k = 0; k < this.n * this.n; k++) count += this.h[k];
    const geo = new RoundedBoxGeometry(CELL * 0.98, CELL * 0.98, CELL * 0.98, 2, 0.14);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.0 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = false; inst.receiveShadow = true;
    // Shadows come from a plain-box proxy (12 tris vs 300 per cube). It draws nothing
    // in the main pass (no colour, no depth); the shadow pass only needs its depth.
    const proxy = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL * 0.98, CELL * 0.98, CELL * 0.98), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), count);
    proxy.castShadow = true;
    const m = new THREE.Matrix4(); const c = new THREE.Color(); const r = rng(this.seed + 11);
    let n = 0;
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const hh = this.h[this.idx(i, j)];
      for (let y = 0; y < hh; y++) {
        m.makeTranslation(this.center(i), CELL * (y + 0.49), this.center(j));
        inst.setMatrixAt(n, m); proxy.setMatrixAt(n, m);
        c.setHex(TOY[Math.max(0, this.col[this.idx(i, j)])]);
        c.offsetHSL(0, 0, (r() - 0.5) * 0.06 + (y % 2 ? 0.025 : 0));
        inst.setColorAt(n, c); n++;
      }
    }
    this.group.add(inst, proxy);

    // Floor: a painted canvas so splats can be drawn onto it permanently.
    this.floorBase = document.createElement('canvas');
    this.floorBase.width = this.floorBase.height = this.floorPx;
    const b = this.floorBase.getContext('2d')!;
    const px = this.floorPx / this.floorSize;
    b.fillStyle = '#9fbbd2'; b.fillRect(0, 0, this.floorPx, this.floorPx);
    const o = FLOOR_MARGIN * px;
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const alt = ((i >> 1) + (j >> 1)) % 2 === 0;
      b.fillStyle = alt ? '#e9eff7' : '#d2deec';
      b.fillRect(o + i * CELL * px, o + j * CELL * px, CELL * px + 1, CELL * px + 1);
    }
    // soft grout lines
    b.strokeStyle = 'rgba(80,110,150,0.10)'; b.lineWidth = 2;
    for (let k = 0; k <= this.n; k += 2) {
      b.beginPath(); b.moveTo(o + k * CELL * px, o); b.lineTo(o + k * CELL * px, o + this.n * CELL * px); b.stroke();
      b.beginPath(); b.moveTo(o, o + k * CELL * px); b.lineTo(o + this.n * CELL * px, o + k * CELL * px); b.stroke();
    }
    // centre ring
    b.strokeStyle = 'rgba(255,120,90,0.35)'; b.lineWidth = 10;
    b.beginPath(); b.arc(this.floorPx / 2, this.floorPx / 2, 3.2 * px, 0, Math.PI * 2); b.stroke();

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
      new THREE.MeshStandardMaterial({ map: this.floorTex, roughness: 0.85 }),
    );
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.group.add(floor);

    // Far ground so the edge of the floor never shows.
    const far = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x8fb1c9, roughness: 1 }));
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

  /** First wall hit along a segment (fraction 0..1), or -1. Amanatides–Woo DDA. */
  raycast(x0: number, z0: number, x1: number, z1: number): number {
    const dx = x1 - x0, dz = z1 - z0;
    let i = this.cellOf(x0), j = this.cellOf(z0);
    if (this.solidCell(i, j)) return 0;
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
      if (this.solidCell(i, j)) return t;
    }
    return -1;
  }

  /** Push a circle out of walls. Returns collision normal (or null) and mutates p. */
  collide(p: { x: number; z: number }, r: number): { nx: number; nz: number } | null {
    let hit: { nx: number; nz: number } | null = null;
    const ci = this.cellOf(p.x), cj = this.cellOf(p.z);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
        if (!this.solidCell(i, j)) continue;
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
  path(x0: number, z0: number, x1: number, z1: number): Spot[] {
    const si = this.cellOf(x0), sj = this.cellOf(z0), ti = this.cellOf(x1), tj = this.cellOf(z1);
    if (this.solidCell(ti, tj)) return [];
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
        if (this.solidCell(nx, ny)) continue;
        if (dx && dy && (this.solidCell(cx + dx, cy) || this.solidCell(cx, cy + dy))) continue;
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
      if (nxt && this.clearPath(ax, az, nxt.x, nxt.z, 0.45)) continue;
      smooth.push(out[n]); ax = out[n].x; az = out[n].z;
    }
    return smooth;
  }

  /** Line of travel clear for a ball of radius r (samples three parallel rays). */
  clearPath(x0: number, z0: number, x1: number, z1: number, r: number) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
    const ox = (-dz / l) * r, oz = (dx / l) * r;
    return this.raycast(x0, z0, x1, z1) < 0 && this.raycast(x0 + ox, z0 + oz, x1 + ox, z1 + oz) < 0 && this.raycast(x0 - ox, z0 - oz, x1 - ox, z1 - oz) < 0;
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
