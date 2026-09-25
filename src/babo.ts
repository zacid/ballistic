import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ABILITIES, AbilityId, BALL, GRENADE, WEAPONS, WeaponId } from './config';

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

// ---------- merged, vertex-coloured gun meshes (one draw call per gun) ----------
const GUNMETAL = new THREE.Color(0x3a3f55);
function tint(geo: THREE.BufferGeometry, color: THREE.Color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count; const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const part = (geo: THREE.BufferGeometry, color: THREE.Color, x: number, y: number, z: number, rx = 0) => {
  if (rx) geo.rotateX(rx);
  geo.translate(x, y, z);
  return tint(geo, color);
};
const gunCache = new Map<string, { body: THREE.BufferGeometry; spin?: THREE.BufferGeometry }>();
function gunGeo(id: WeaponId, accent: number) {
  const key = id + accent; const hit = gunCache.get(key); if (hit) return hit;
  const acc = new THREE.Color(accent);
  const H = Math.PI / 2;
  let out: { body: THREE.BufferGeometry; spin?: THREE.BufferGeometry };
  if (id === 'shotgun') {
    out = { body: mergeGeometries([
      part(new THREE.BoxGeometry(0.2, 0.2, 0.5), acc, 0, 0, 0.05),
      part(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10), GUNMETAL, -0.055, 0.03, 0.45, H),
      part(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10), GUNMETAL, 0.055, 0.03, 0.45, H),
      part(new THREE.BoxGeometry(0.16, 0.1, 0.25), GUNMETAL, 0, -0.08, 0.35),
    ])! };
  } else if (id === 'chaingun') {
    const barrels: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; barrels.push(part(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), GUNMETAL, Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0, H)); }
    out = { body: part(new THREE.BoxGeometry(0.26, 0.22, 0.4), acc, 0, 0, -0.02), spin: mergeGeometries(barrels)! };
  } else {
    out = { body: mergeGeometries([
      part(new THREE.CylinderGeometry(0.13, 0.13, 0.95, 14), acc, 0, 0.02, 0.2, H),
      part(new THREE.CylinderGeometry(0.16, 0.13, 0.12, 14), GUNMETAL, 0, 0.02, 0.7, H),
      part(new THREE.BoxGeometry(0.12, 0.18, 0.14), GUNMETAL, 0, -0.12, 0.05),
    ])! };
  }
  gunCache.set(key, out); return out;
}
const gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15 });

function buildGun(id: WeaponId, accent: number) {
  const g = new THREE.Group();
  const geo = gunGeo(id, accent);
  const body = new THREE.Mesh(geo.body, gunMat); body.castShadow = true; g.add(body);
  if (geo.spin) {
    const spin = new THREE.Mesh(geo.spin, gunMat); spin.castShadow = true; spin.position.set(0, 0.02, 0.45); g.add(spin);
    g.userData.spin = spin;
  }
  return g;
}

// ---------- ability visuals ----------
let spikeGeo: THREE.BufferGeometry | null = null;
function spikes() {
  if (!spikeGeo) {
    const parts: THREE.BufferGeometry[] = [];
    const n = 18, golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
      const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
      const c = new THREE.ConeGeometry(0.11, 0.42, 6); c.translate(0, BALL.radius + 0.12, 0);
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      parts.push(c);
    }
    spikeGeo = mergeGeometries(parts)!;
  }
  const m = new THREE.Mesh(spikeGeo, new THREE.MeshStandardMaterial({ color: 0xe8ecf5, roughness: 0.25, metalness: 0.6 }));
  m.castShadow = true; m.visible = false; return m;
}
const bubbleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8fd8ff).multiplyScalar(1.2), transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
const bubbleGeo = new THREE.IcosahedronGeometry(BALL.radius * 1.55, 2);

export interface NetSample { t: number; x: number; z: number; vx: number; vz: number; y: number; aim: number }

export interface Babo {
  id: number;
  name: string;
  color: number;
  isPlayer: boolean;   // this client's own ball
  human: boolean;      // controlled by a person (here or remotely)
  local: boolean;      // simulated on this client
  team: number;
  x: number; z: number; vx: number; vz: number;
  y: number; vy: number;
  hp: number;
  alive: boolean;
  respawnT: number;
  weapon: WeaponId;
  ammo: number;
  reloadT: number;
  cool: number;
  nades: number;
  nadeCool: number;
  ability: AbilityId;
  abCool: number;
  abT: number;          // time left on the active ability
  abCount: number;      // times used (lets remote clients replay the effect)
  spikeHits: Set<number>;
  aimX: number; aimZ: number;
  moveX: number; moveZ: number;
  fire: boolean;
  wantAbility: boolean;
  kills: number; deaths: number;
  streak: number;
  lastHitBy: number; lastHitT: number;
  hurtT: number;
  spawnShield: number;
  // visuals
  root: THREE.Group; ball: THREE.Mesh; gun: THREE.Group; ring: THREE.Mesh; mat: THREE.MeshStandardMaterial;
  spikes: THREE.Mesh; bubble: THREE.Mesh;
  recoilZ: number;
  // networking
  net: NetSample[];
  netFire: boolean; netReload: boolean;
  brain?: any;
}

export function makeBabo(id: number, name: string, color: number, weapon: WeaponId, isPlayer: boolean, ability: AbilityId = 'dash'): Babo {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: skin(color), roughness: 0.22, emissive: 0xffffff, emissiveIntensity: 0 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 32, 20), mat);
  ball.castShadow = true; ball.receiveShadow = true;
  root.add(ball);
  const gun = buildGun(weapon, color);
  root.add(gun);
  const ring = new THREE.Mesh(new THREE.RingGeometry(BALL.radius * 1.15, BALL.radius * 1.4, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: isPlayer ? 0xffffff : color, transparent: true, opacity: isPlayer ? 0.85 : 0.35, depthWrite: false }));
  ring.position.y = -BALL.radius + 0.03;
  root.add(ring);
  const sp = spikes(); ball.add(sp);
  const bubble = new THREE.Mesh(bubbleGeo, bubbleMat); bubble.visible = false; root.add(bubble);
  return {
    id, name, color, isPlayer, human: isPlayer, local: true, team: id,
    x: 0, z: 0, vx: 0, vz: 0, y: 0, vy: 0,
    hp: BALL.hp, alive: false, respawnT: 0,
    weapon, ammo: WEAPONS[weapon].clip, reloadT: 0, cool: 0, nades: GRENADE.start, nadeCool: 0,
    ability, abCool: 0, abT: 0, abCount: 0, spikeHits: new Set(),
    aimX: 1, aimZ: 0, moveX: 0, moveZ: 0, fire: false, wantAbility: false,
    kills: 0, deaths: 0, streak: 0, lastHitBy: -1, lastHitT: 0, hurtT: 0, spawnShield: 0,
    root, ball, gun, ring, mat, spikes: sp, bubble, recoilZ: 0,
    net: [], netFire: false, netReload: false,
  };
}

export function setWeapon(b: Babo, w: WeaponId) {
  b.weapon = w; b.ammo = WEAPONS[w].clip; b.reloadT = 0;
  b.root.remove(b.gun);
  b.gun = buildGun(w, b.color);
  b.root.add(b.gun);
}

export function setTeamRing(b: Babo, color: number, opacity: number) {
  const m = b.ring.material as THREE.MeshBasicMaterial; m.color.set(color); m.opacity = opacity;
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
  const spin = b.gun.userData.spin as THREE.Mesh | undefined;
  const firing = b.local ? b.fire && b.reloadT <= 0 : b.netFire && !b.netReload;
  if (spin) spin.rotation.z += dt * (firing ? 40 : 3);
  b.ring.position.y = -BALL.radius - b.y + 0.03;
  b.hurtT = Math.max(0, b.hurtT - dt);
  b.mat.emissiveIntensity = b.hurtT > 0 ? b.hurtT * 5 : b.spawnShield > 0 ? 0.25 + 0.2 * Math.sin(performance.now() / 60) : 0;
  // abilities
  const active = b.abT > 0;
  const spk = active && b.ability === 'spikes';
  b.spikes.visible = spk;
  if (spk) { const k = Math.min(1, (ABILITIES.spikes.dur - b.abT) * 10, b.abT * 8); b.spikes.scale.setScalar(0.3 + 0.7 * Math.max(0, k)); }
  const bub = active && b.ability === 'bubble';
  b.bubble.visible = bub;
  if (bub) { const k = Math.min(1, (ABILITIES.bubble.dur - b.abT) * 8, b.abT * 5); b.bubble.scale.setScalar(Math.max(0.01, k) * (1 + 0.04 * Math.sin(performance.now() / 70))); }
}
