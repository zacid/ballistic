import * as THREE from 'three';

// Rain and snow: a box of falling particles that follows the camera, one instanced draw each.
// Rain drops land with a little splash ring; flakes drift and sway.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
const BOX_X = 17, BOX_Z0 = -15, BOX_Z1 = 19, TOP = 11;

export class Weather {
  kind: 'none' | 'rain' | 'snow' = 'none';
  private mesh: THREE.InstancedMesh | null = null;
  private splash: THREE.InstancedMesh | null = null;
  private p = new Float32Array(0);      // x, y, z, speed, phase per particle
  private n = 0;
  private splashes: { x: number; y: number; z: number; t: number }[] = [];
  floorAt: (x: number, z: number) => number = () => 0;
  wind = 0;

  constructor(private scene: THREE.Scene) {}

  set(kind: 'none' | 'rain' | 'snow', lowQuality = false) {
    if (kind === this.kind && this.mesh) { this.setCount(lowQuality); return; }
    this.dispose();
    this.kind = kind;
    if (kind === 'none') return;
    const max = kind === 'rain' ? 1100 : 750;
    const geo = kind === 'rain' ? new THREE.BoxGeometry(0.012, 0.5, 0.012) : new THREE.IcosahedronGeometry(0.055, 0);
    const mat = new THREE.MeshBasicMaterial({ color: kind === 'rain' ? 0xb9cde3 : 0xffffff, transparent: true, opacity: kind === 'rain' ? 0.3 : 0.92, depthWrite: false, toneMapped: kind !== 'snow' });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    this.scene.add(this.mesh);
    this.p = new Float32Array(max * 5);
    for (let i = 0; i < max; i++) this.reset(i, Math.random() * TOP, 0, 0);
    if (kind === 'rain') {
      const rg = new THREE.RingGeometry(0.6, 1, 12); rg.rotateX(-Math.PI / 2);
      this.splash = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ color: 0xcfe0f2, transparent: true, opacity: 0.22, depthWrite: false }), 90);
      this.splash.frustumCulled = false; this.splash.count = 0; this.scene.add(this.splash);
    }
    this.setCount(lowQuality);
  }

  private setCount(low: boolean) { if (this.mesh) this.n = Math.floor(this.mesh.instanceMatrix.count * (low ? 0.5 : 1)); }

  private reset(i: number, y: number, cx: number, cz: number) {
    const o = i * 5;
    this.p[o] = cx + (Math.random() * 2 - 1) * BOX_X;
    this.p[o + 1] = y;
    this.p[o + 2] = cz + BOX_Z0 + Math.random() * (BOX_Z1 - BOX_Z0);
    this.p[o + 3] = this.kind === 'rain' ? 19 + Math.random() * 6 : 1.1 + Math.random() * 1.1;
    this.p[o + 4] = Math.random() * Math.PI * 2;
  }

  update(dt: number, cx: number, cz: number, t: number) {
    const m = this.mesh; if (!m) return;
    const rain = this.kind === 'rain', W = BOX_X * 2, D = BOX_Z1 - BOX_Z0;
    const drift = rain ? 2.2 + this.wind : 0.5 + this.wind * 0.5;
    if (rain) _q.setFromEuler(_e.set(0, 0, -Math.atan2(drift, 22)));
    for (let i = 0; i < this.n; i++) {
      const o = i * 5, p = this.p;
      p[o + 1] -= p[o + 3] * dt;
      p[o] += (drift + (rain ? 0 : Math.sin(t * 1.3 + p[o + 4]) * 0.6)) * dt;
      if (!rain) p[o + 2] += Math.cos(t * 1.1 + p[o + 4]) * 0.3 * dt;
      // keep every particle inside the box around the camera (wrap, don't respawn, so nothing pops)
      if (p[o] - cx > BOX_X) p[o] -= W; else if (p[o] - cx < -BOX_X) p[o] += W;
      if (p[o + 2] - cz > BOX_Z1) p[o + 2] -= D; else if (p[o + 2] - cz < BOX_Z0) p[o + 2] += D;
      const fy = p[o + 1] < 3 ? this.floorAt(p[o], p[o + 2]) : 0;
      if (p[o + 1] <= fy) {
        if (rain && this.splash && Math.random() < 0.25) this.addSplash(p[o], fy, p[o + 2]);
        this.reset(i, TOP + Math.random() * 2, cx, cz);
      }
      _p.set(p[o], p[o + 1], p[o + 2]);
      if (rain) _s.set(1, 1, 1); else { _q.identity(); const k = 0.7 + 0.6 * ((i * 7919) % 100) / 100; _s.set(k, k, k); }
      _m.compose(_p, _q, _s); m.setMatrixAt(i, _m);
    }
    m.count = this.n; m.instanceMatrix.needsUpdate = true;
    if (this.splash) {
      let k = 0;
      for (let i = this.splashes.length - 1; i >= 0; i--) {
        const s = this.splashes[i]; s.t += dt;
        if (s.t > 0.28) { this.splashes.splice(i, 1); continue; }
        const r = 0.03 + s.t * 0.42; _p.set(s.x, s.y + 0.02, s.z); _q.identity(); _s.set(r, 1, r);
        _m.compose(_p, _q, _s); this.splash.setMatrixAt(k++, _m);
      }
      this.splash.count = k; this.splash.instanceMatrix.needsUpdate = true;
    }
  }

  private addSplash(x: number, y: number, z: number) {
    if (this.splashes.length >= 90) this.splashes.shift();
    this.splashes.push({ x, y, z, t: 0 });
  }

  dispose() {
    for (const m of [this.mesh, this.splash]) if (m) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose(); }
    this.mesh = this.splash = null; this.splashes.length = 0; this.kind = 'none'; this.n = 0;
  }
}
