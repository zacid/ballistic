import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, 1);
const _e = new THREE.Euler();

/** A spent cartridge: flies out of the gun, clinks on the floor and lies there for a few seconds. */
interface Casing { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; roll: number; spin: number; life: number; size: number; color: number; landed: boolean }
const CASING_LIFE = 6, MAXC = 260;

interface Bit { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; color: number; grav: number; spin: number; bounce: boolean }
interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; grow: number }

/** Chunky particles (gibs, sparks, confetti) + smoke puffs + light flashes + shockwave rings. */
export class Fx {
  group = new THREE.Group();
  private bits: Bit[] = [];
  private puffs: Puff[] = [];
  private bitMesh: THREE.InstancedMesh;
  private puffMesh: THREE.InstancedMesh;
  private glowMesh: THREE.InstancedMesh;
  private glows: Bit[] = [];
  private lights: { l: THREE.PointLight; life: number; max: number; power: number }[] = [];
  private rings: { m: THREE.Mesh; life: number; max: number; size: number }[] = [];
  private beams: { m: THREE.Mesh; life: number; max: number }[] = [];
  floorAt: (x: number, z: number) => number = () => 0;
  /** Called when a casing first hits the floor (for the clink). */
  onClink: (x: number, z: number) => void = () => {};
  private casings: Casing[] = [];
  private casingMesh: THREE.InstancedMesh;
  private MAXB = 900; private MAXP = 260; private MAXG = 650;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.bitMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.4, flatShading: true }), this.MAXB);
    this.bitMesh.castShadow = true; this.bitMesh.frustumCulled = false; this.bitMesh.count = 0;
    this.bitMesh.setColorAt(0, _c.set(0xffffff));
    this.puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xf2eef8, roughness: 1, flatShading: true }), this.MAXP);
    this.puffMesh.frustumCulled = false; this.puffMesh.count = 0; this.puffMesh.castShadow = true;
    this.glowMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), this.MAXG);
    this.glowMesh.frustumCulled = false; this.glowMesh.count = 0;
    this.glowMesh.setColorAt(0, _c.set(0xffffff));
    const cg = new THREE.CylinderGeometry(0.032, 0.032, 0.11, 7); cg.rotateZ(Math.PI / 2);   // lies along x
    this.casingMesh = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.7 }), MAXC);
    this.casingMesh.frustumCulled = false; this.casingMesh.count = 0; this.casingMesh.setColorAt(0, _c.set(0xffffff));
    this.group.add(this.bitMesh, this.puffMesh, this.glowMesh, this.casingMesh);
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 9, 1.6); // always visible: toggling would recompile shaders
      this.group.add(l); this.lights.push({ l, life: 0, max: 1, power: 0 });
    }
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true); beamGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      m.visible = false; m.frustumCulled = false; this.group.add(m); this.beams.push({ m, life: 0, max: 1 });
    }
    const ringGeo = new THREE.RingGeometry(0.8, 1, 40); ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false }));
      m.visible = false; this.group.add(m); this.rings.push({ m, life: 0, max: 1, size: 1 });
    }
  }

  bit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, color: number, life = 1.2, grav = 22, bounce = true) {
    if (this.bits.length >= this.MAXB) this.bits.shift();
    this.bits.push({ x, y, z, vx, vy, vz, life, max: life, size, color, grav, spin: Math.random() * 10, bounce });
  }
  glow(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, color: number, life = 0.3, grav = 0) {
    if (this.glows.length >= this.MAXG) this.glows.shift();
    this.glows.push({ x, y, z, vx, vy, vz, life, max: life, size, color, grav, spin: 0, bounce: false });
  }
  puff(x: number, y: number, z: number, size: number, life = 0.9, vx = 0, vy = 1.2, vz = 0, grow = 1.6) {
    if (this.puffs.length >= this.MAXP) this.puffs.shift();
    this.puffs.push({ x, y, z, vx, vy, vz, life, max: life, size, grow });
  }
  flash(x: number, y: number, z: number, color: number, power: number, dur: number) {
    let best = this.lights[0];
    for (const s of this.lights) if (s.life <= 0) { best = s; break; } else if (s.life < best.life) best = s;
    best.l.position.set(x, y, z); best.l.color.set(color); best.life = dur; best.max = dur; best.power = power;
  }
  ring(x: number, z: number, size: number, color: number, dur = 0.35, y = 0) {
    let best = this.rings[0];
    for (const r of this.rings) if (r.life <= 0) { best = r; break; }
    best.m.position.set(x, 0.06 + y, z); (best.m.material as THREE.MeshBasicMaterial).color.set(color);
    best.life = dur; best.max = dur; best.size = size; best.m.visible = true;
  }

  casing(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, size = 1) {
    if (this.casings.length >= MAXC) this.casings.shift();
    this.casings.push({ x, y, z, vx, vy, vz, yaw: Math.random() * 6.3, roll: 0, spin: 12 + Math.random() * 14, life: CASING_LIFE, size, color, landed: false });
  }

  /** Nuke Bot blast: the normal explosion plus a second shockwave ring, a rising mushroom and a big flash. */
  nuke(x: number, z: number, radius: number, y = 0) {
    this.explosion(x, z, radius * 0.6, y);
    this.flash(x, 3 + y, z, 0xfff0c0, 140, 0.6);
    this.ring(x, z, radius, 0xffffff, 0.55, y);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, s = 8 + Math.random() * 10;
      this.glow(x, 0.5 + y, z, Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s, 0.12 + Math.random() * 0.12, Math.random() < 0.5 ? 0xffe27a : 0xff8a3a, 0.35 + Math.random() * 0.3, 4);
    }
    // the column and cap of the mushroom cloud
    for (let i = 0; i < 12; i++) this.puff(x + (Math.random() - 0.5) * 0.8, 0.6 + y + i * 0.25, z + (Math.random() - 0.5) * 0.8, 0.45 + Math.random() * 0.2, 1.4 + Math.random() * 0.5, 0, 2.6 + i * 0.25, 0, 1.3);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; this.puff(x + Math.cos(a) * 0.6, 3.6 + y, z + Math.sin(a) * 0.6, 0.6 + Math.random() * 0.3, 1.8, Math.cos(a) * 2.2, 1.2, Math.sin(a) * 2.2, 1.8); }
    for (let i = 0; i < 20; i++) { const a = Math.random() * Math.PI * 2; this.puff(x + Math.cos(a) * radius * 0.4, 0.3 + y, z + Math.sin(a) * radius * 0.4, 0.35, 0.9, Math.cos(a) * 9, 0.3, Math.sin(a) * 9, 1.4); }
  }

  /** Railgun beam from a to b, fading out. */
  beam(x0: number, y: number, z0: number, x1: number, z1: number, color: number, dur = 0.35) {
    let best = this.beams[0];
    for (const b of this.beams) if (b.life <= 0) { best = b; break; } else if (b.life < best.life) best = b;
    const len = Math.hypot(x1 - x0, z1 - z0) || 0.01;
    best.m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    best.m.rotation.set(0, Math.atan2(x1 - x0, z1 - z0), 0);
    best.m.scale.set(0.09, 0.09, len);
    (best.m.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(2.5);
    best.life = best.max = dur; best.m.visible = true;
    // sparkles along the beam
    const n = Math.min(30, Math.floor(len * 1.5));
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      this.glow(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, (Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5, 0.05 + Math.random() * 0.04, color, 0.3 + Math.random() * 0.3, 2);
    }
    this.flash(x0, y + 0.4, z0, color, 12, 0.12);
  }

  explosion(x: number, z: number, radius: number, y = 0) {
    this.flash(x, 1.4 + y, z, 0xffa040, 60, 0.35);
    this.ring(x, z, radius * 1.1, 0xffd08a, 0.32, y);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 9;
      this.glow(x, 0.6 + y, z, Math.cos(a) * s, 2 + Math.random() * 6, Math.sin(a) * s, 0.09 + Math.random() * 0.1, Math.random() < 0.5 ? 0xffd25a : 0xff7a2a, 0.25 + Math.random() * 0.3, 12);
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * radius * 0.6;
      this.puff(x + Math.cos(a) * s, 0.4 + y + Math.random() * 0.6, z + Math.sin(a) * s, 0.3 + Math.random() * 0.35, 0.55 + Math.random() * 0.5, Math.cos(a) * 3, 1 + Math.random() * 2, Math.sin(a) * 3, 1.6);
    }
    // fireball core
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 2;
      this.glow(x, 0.7 + y, z, Math.cos(a) * s, 1 + Math.random() * 2, Math.sin(a) * s, 0.55 + Math.random() * 0.4, i % 2 ? 0xffb347 : 0xfff1a8, 0.16 + Math.random() * 0.1, 0);
    }
  }

  // ---------- lightning: jagged additive segments, one instanced draw ----------
  private boltMesh: THREE.InstancedMesh | null = null;
  private bolts: { ax: number; ay: number; az: number; bx: number; by: number; bz: number; life: number; max: number; w: number; color: number }[] = [];
  /** A crackling bolt from a to b: a few jittered segments plus a thin bright core. */
  bolt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number, width = 1) {
    if (!this.boltMesh) {
      const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0, 0.5);
      this.boltMesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 160);
      this.boltMesh.frustumCulled = false; this.boltMesh.count = 0; this.boltMesh.setColorAt(0, new THREE.Color());
      this.group.add(this.boltMesh);
    }
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 0.01, px = -dz / len, pz = dx / len;
    const n = Math.max(3, Math.min(8, Math.round(len / 0.9)));
    let x0 = ax, y0 = ay, z0 = az;
    for (let i = 1; i <= n; i++) {
      const t = i / n, j = i === n ? 0 : (Math.random() - 0.5) * Math.min(0.9, len * 0.18);
      const x1 = ax + dx * t + px * j, z1 = az + dz * t + pz * j, y1 = ay + (by - ay) * t + (i === n ? 0 : (Math.random() - 0.5) * 0.25);
      if (this.bolts.length >= 160) this.bolts.shift();
      this.bolts.push({ ax: x0, ay: y0, az: z0, bx: x1, by: y1, bz: z1, life: 0.11, max: 0.11, w: width, color });
      if (Math.random() < 0.6) this.glow(x1, y1, z1, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.08 + Math.random() * 0.06, color, 0.14, 0);
      x0 = x1; y0 = y1; z0 = z1;
    }
  }

  update(dt: number) {
    if (this.boltMesh) {
      let n = 0;
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const b = this.bolts[i]; b.life -= dt;
        if (b.life <= 0) { this.bolts.splice(i, 1); continue; }
        const k = b.life / b.max, len = Math.hypot(b.bx - b.ax, b.by - b.ay, b.bz - b.az) || 0.01;
        _p.set(b.ax, b.ay, b.az); _s.set(b.bx - b.ax, b.by - b.ay, b.bz - b.az).normalize();
        _q.setFromUnitVectors(_fwd, _s);
        const w = (0.07 + 0.1 * k) * b.w; _s.set(w, w, len);
        _m.compose(_p, _q, _s); this.boltMesh.setMatrixAt(n, _m); this.boltMesh.setColorAt(n, _c.set(b.color).multiplyScalar(1.5 + 2.5 * k)); n++;
      }
      this.boltMesh.count = n; this.boltMesh.instanceMatrix.needsUpdate = true; if (this.boltMesh.instanceColor) this.boltMesh.instanceColor.needsUpdate = true;
    }
    // casings
    let n = 0;
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i]; c.life -= dt;
      if (c.life <= 0) { this.casings.splice(i, 1); continue; }
      if (c.landed && Math.abs(c.vx) + Math.abs(c.vz) + Math.abs(c.vy) < 0.05) continue;
      c.vy -= 24 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.roll += c.spin * dt;
      const fy = this.floorAt(c.x, c.z) + 0.03 * c.size;
      if (c.y < fy) {
        c.y = fy;
        if (!c.landed && c.vy < -2) this.onClink(c.x, c.z);
        c.landed = true; c.vy = Math.abs(c.vy) * 0.28; c.vx *= 0.55; c.vz *= 0.55; c.spin *= 0.4;
        if (c.vy < 0.4) { c.vy = 0; c.roll = Math.round(c.roll / Math.PI) * Math.PI; }
      }
    }
    for (const c of this.casings) {
      const k = c.size * Math.min(1, c.life / 0.5);
      _q.setFromEuler(_e.set(0, c.yaw, c.roll, 'YXZ')); _s.setScalar(k); _p.set(c.x, c.y, c.z);
      _m.compose(_p, _q, _s); this.casingMesh.setMatrixAt(n, _m); this.casingMesh.setColorAt(n, _c.set(c.color)); n++;
    }
    this.casingMesh.count = n; this.casingMesh.instanceMatrix.needsUpdate = true; if (this.casingMesh.instanceColor) this.casingMesh.instanceColor.needsUpdate = true;

    // bits
    n = 0;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i]; b.life -= dt;
      if (b.life <= 0) { this.bits.splice(i, 1); continue; }
      b.vy -= b.grav * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      const fy = b.bounce ? this.floorAt(b.x, b.z) : 0; if (b.bounce && b.y < fy + b.size) { b.y = fy + b.size; b.vy = Math.abs(b.vy) * 0.35; b.vx *= 0.7; b.vz *= 0.7; b.spin *= 0.6; }
      b.spin += dt * 4;
    }
    for (const b of this.bits) {
      const k = Math.min(1, b.life / Math.min(0.35, b.max));
      _q.setFromAxisAngle(UP, b.spin); _s.setScalar(b.size * k); _p.set(b.x, b.y, b.z);
      _m.compose(_p, _q, _s); this.bitMesh.setMatrixAt(n, _m); this.bitMesh.setColorAt(n, _c.set(b.color)); n++;
    }
    this.bitMesh.count = n; this.bitMesh.instanceMatrix.needsUpdate = true; if (this.bitMesh.instanceColor) this.bitMesh.instanceColor.needsUpdate = true;

    n = 0;
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const b = this.glows[i]; b.life -= dt;
      if (b.life <= 0) { this.glows.splice(i, 1); continue; }
      b.vy -= b.grav * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; if (b.y < 0.05) { b.y = 0.05; b.vy *= -0.3; }
      b.vx *= 1 - dt * 3; b.vz *= 1 - dt * 3;
    }
    for (const b of this.glows) {
      const k = b.life / b.max;
      _q.identity(); _s.setScalar(b.size * (0.3 + 0.7 * k)); _p.set(b.x, b.y, b.z);
      _m.compose(_p, _q, _s); this.glowMesh.setMatrixAt(n, _m); this.glowMesh.setColorAt(n, _c.set(b.color).multiplyScalar(1.5 + 2.5 * k)); n++;
    }
    this.glowMesh.count = n; this.glowMesh.instanceMatrix.needsUpdate = true; if (this.glowMesh.instanceColor) this.glowMesh.instanceColor.needsUpdate = true;

    n = 0;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]; p.life -= dt;
      if (p.life <= 0) { this.puffs.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= 1 - dt * 2.5; p.vz *= 1 - dt * 2.5; p.vy *= 1 - dt * 1.5;
    }
    for (const p of this.puffs) {
      const t = 1 - p.life / p.max; const s = p.size * (1 + t * p.grow) * (t > 0.6 ? (1 - t) / 0.4 : 1);
      _q.identity(); _s.setScalar(Math.max(0.001, s)); _p.set(p.x, p.y, p.z);
      _m.compose(_p, _q, _s); this.puffMesh.setMatrixAt(n++, _m);
    }
    this.puffMesh.count = n; this.puffMesh.instanceMatrix.needsUpdate = true;

    for (const s of this.lights) {
      if (s.life <= 0) { s.l.intensity = 0; continue; }
      s.life -= dt; const k = Math.max(0, s.life / s.max); s.l.intensity = s.power * k * k;
    }
    for (const b of this.beams) {
      if (b.life <= 0) { b.m.visible = false; continue; }
      b.life -= dt; const k = Math.max(0, b.life / b.max);
      (b.m.material as THREE.MeshBasicMaterial).opacity = k;
      b.m.scale.x = b.m.scale.y = 0.02 + 0.09 * Math.sqrt(k);
    }
    for (const r of this.rings) {
      if (r.life <= 0) { r.m.visible = false; continue; }
      r.life -= dt; const t = 1 - Math.max(0, r.life / r.max);
      const s = r.size * (0.2 + 0.8 * Math.sqrt(t)); r.m.scale.set(s, 1, s);
      (r.m.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
    }
  }

  clear() { this.casings.length = 0; this.bits.length = 0; this.puffs.length = 0; this.glows.length = 0; this.bolts.length = 0; }
}
