import * as THREE from 'three';
import { BALL, GRENADE, WEAPONS, WeaponId } from './config';

const texCache = new Map<number, THREE.CanvasTexture>();

/** Toy-ball skin: base colour, two white rings and polka dots so the roll reads clearly. */
function skin(color: number) {
  const hit = texCache.get(color); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const base = new THREE.Color(color);
  g.fillStyle = '#' + base.getHexString(); g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 70, 512, 16); g.fillRect(0, 170, 512, 16);
  const light = base.clone().lerp(new THREE.Color(0xffffff), 0.45);
  g.fillStyle = '#' + light.getHexString();
  for (let i = 0; i < 4; i++) {
    const x = 64 + i * 128;
    g.beginPath(); g.ellipse(x, 128, 22, 26, 0, 0, Math.PI * 2); g.fill();
  }
  const dark = base.clone().multiplyScalar(0.55);
  g.fillStyle = '#' + dark.getHexString();
  g.fillRect(0, 0, 512, 22); g.fillRect(0, 234, 512, 22);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texCache.set(color, t); return t;
}

const gunMat = new THREE.MeshStandardMaterial({ color: 0x3a3f55, roughness: 0.45, metalness: 0.3 });
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function buildGun(id: WeaponId, accent: number) {
  const g = new THREE.Group();
  const acc = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  };
  if (id === 'shotgun') {
    add(box(0.2, 0.2, 0.5), acc, 0, 0, 0.05);
    const b1 = add(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10), gunMat, -0.055, 0.03, 0.45); b1.rotation.x = Math.PI / 2;
    const b2 = add(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10), gunMat, 0.055, 0.03, 0.45); b2.rotation.x = Math.PI / 2;
    add(box(0.16, 0.1, 0.25), gunMat, 0, -0.08, 0.35);
  } else if (id === 'chaingun') {
    add(box(0.26, 0.22, 0.4), acc, 0, 0, -0.02);
    const spin = new THREE.Group(); spin.position.set(0, 0.02, 0.45); g.add(spin);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), gunMat);
      b.rotation.x = Math.PI / 2; b.position.set(Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0); b.castShadow = true; spin.add(b);
    }
    g.userData.spin = spin;
  } else {
    const tube = add(new THREE.CylinderGeometry(0.13, 0.13, 0.95, 14), acc, 0, 0.02, 0.2); tube.rotation.x = Math.PI / 2;
    const mouth = add(new THREE.CylinderGeometry(0.16, 0.13, 0.12, 14), gunMat, 0, 0.02, 0.7); mouth.rotation.x = Math.PI / 2;
    add(box(0.12, 0.18, 0.14), gunMat, 0, -0.12, 0.05);
  }
  return g;
}

export interface Babo {
  id: number;
  name: string;
  color: number;
  isPlayer: boolean;
  x: number; z: number; vx: number; vz: number;
  y: number; vy: number;           // small hop from explosions
  hp: number;
  alive: boolean;
  respawnT: number;
  weapon: WeaponId;
  ammo: number;
  reloadT: number;
  cool: number;
  nades: number;
  nadeCool: number;
  aimX: number; aimZ: number;       // aim direction (unit)
  moveX: number; moveZ: number;     // input direction
  fire: boolean;
  kills: number; deaths: number;
  streak: number;
  lastHitBy: number; lastHitT: number;
  hurtT: number;
  spawnShield: number;
  // visuals
  root: THREE.Group; ball: THREE.Mesh; gun: THREE.Group; ring: THREE.Mesh; mat: THREE.MeshPhysicalMaterial;
  recoilZ: number;
  // bot brain (opaque to the core)
  brain?: any;
}

export function makeBabo(id: number, name: string, color: number, weapon: WeaponId, isPlayer: boolean): Babo {
  const root = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({ map: skin(color), roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 32, 20), mat);
  ball.castShadow = true; ball.receiveShadow = true;
  root.add(ball);
  const gun = buildGun(weapon, color);
  root.add(gun);
  const ring = new THREE.Mesh(new THREE.RingGeometry(BALL.radius * 1.15, BALL.radius * 1.4, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: isPlayer ? 0xffffff : color, transparent: true, opacity: isPlayer ? 0.85 : 0.35, depthWrite: false }));
  ring.position.y = -BALL.radius + 0.03;
  root.add(ring);
  return {
    id, name, color, isPlayer,
    x: 0, z: 0, vx: 0, vz: 0, y: 0, vy: 0,
    hp: BALL.hp, alive: false, respawnT: 0,
    weapon, ammo: WEAPONS[weapon].clip, reloadT: 0, cool: 0, nades: GRENADE.start, nadeCool: 0,
    aimX: 1, aimZ: 0, moveX: 0, moveZ: 0, fire: false,
    kills: 0, deaths: 0, streak: 0, lastHitBy: -1, lastHitT: 0, hurtT: 0, spawnShield: 0,
    root, ball, gun, ring, mat, recoilZ: 0,
  };
}

export function setWeapon(b: Babo, w: WeaponId) {
  b.weapon = w; b.ammo = WEAPONS[w].clip; b.reloadT = 0;
  b.root.remove(b.gun);
  b.gun = buildGun(w, b.color);
  b.root.add(b.gun);
}

const _axis = new THREE.Vector3(), _q = new THREE.Quaternion();

export function updateBaboVisual(b: Babo, dt: number) {
  b.root.position.set(b.x, BALL.radius + b.y, b.z);
  const sp = Math.hypot(b.vx, b.vz);
  if (sp > 0.01) {
    _axis.set(b.vz, 0, -b.vx).normalize();
    _q.setFromAxisAngle(_axis, (sp * dt) / BALL.radius);
    b.ball.quaternion.premultiply(_q);
  }
  const yaw = Math.atan2(b.aimX, b.aimZ);
  b.gun.rotation.y = yaw;
  b.recoilZ *= Math.exp(-dt * 14);
  const off = BALL.radius + 0.12 - b.recoilZ;
  b.gun.position.set(b.aimX * off * 0.55, 0.05, b.aimZ * off * 0.55);
  const spin = b.gun.userData.spin as THREE.Group | undefined;
  if (spin) spin.rotation.z += dt * (b.fire && b.reloadT <= 0 ? 40 : 3);
  b.ring.rotation.y = 0;
  b.ring.position.y = -BALL.radius - b.y + 0.03;
  b.hurtT = Math.max(0, b.hurtT - dt);
  b.mat.emissiveIntensity = b.hurtT > 0 ? b.hurtT * 5 : b.spawnShield > 0 ? 0.25 + 0.2 * Math.sin(performance.now() / 60) : 0;
}
