import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HALF } from './arena';

export type Quality = 'high' | 'medium' | 'low';
export const QUALITY: Record<Quality, { label: string; ao: boolean; bloom: boolean; pr: number; shadow: number }> = {
  high: { label: 'High', ao: true, bloom: true, pr: 2, shadow: 2048 },
  medium: { label: 'Medium', ao: false, bloom: true, pr: 1.5, shadow: 2048 },
  low: { label: 'Low', ao: false, bloom: false, pr: 1, shadow: 1024 },
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.5, 200);
  composer: EffectComposer;
  ao: GTAOPass;
  bloom: UnrealBloomPass;
  sun: THREE.DirectionalLight;
  quality: Quality = 'high';
  shake = 0;
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3(0, 30, 14);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const s = this.scene;
    s.background = new THREE.Color(0x9cc9ea);
    s.fog = new THREE.Fog(0x9cc9ea, 38, 75);

    const hemi = new THREE.HemisphereLight(0xdff0ff, 0x8a7a6a, 1.25);
    s.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.sun.position.set(-14, 26, 10);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -HALF - 3; sc.right = HALF + 3; sc.top = HALF + 3; sc.bottom = -HALF - 3; sc.near = 1; sc.far = 70;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.03; this.sun.shadow.radius = 4;
    s.add(this.sun); s.add(this.sun.target);
    const fill = new THREE.DirectionalLight(0xb8d4ff, 0.55); fill.position.set(12, 10, -14); s.add(fill);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(s, this.camera));
    this.ao = new GTAOPass(s, this.camera, 1, 1);
    this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.5, scale: 1.2, samples: 12 });
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.45, 1.35);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality) {
    this.quality = q;
    const c = QUALITY[q];
    this.ao.enabled = c.ao; this.bloom.enabled = c.bloom;
    if (this.sun.shadow.mapSize.x !== c.shadow) {
      this.sun.shadow.mapSize.set(c.shadow, c.shadow);
      this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null;
    }
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, QUALITY[this.quality].pr);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep roughly the same visible area on portrait screens
    this.camera.fov = w < h ? 58 : 40;
    this.camera.updateProjectionMatrix();
  }

  /** Follow a point, leaning toward where the player aims. */
  follow(x: number, z: number, ax: number, az: number, dt: number, snap = false) {
    const portrait = innerWidth < innerHeight;
    const lead = portrait ? 0.18 : 0.28;
    const tx = x + (ax - x) * lead, tz = z + (az - z) * lead;
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (tz - this.camTarget.z) * k;
    const height = portrait ? 25 : 23;
    this.camPos.set(this.camTarget.x, height, this.camTarget.z + height * 0.36);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * s; this.camera.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.4);
    }
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z);
  }

  addShake(a: number) { this.shake = Math.min(1.2, this.shake + a); }

  render() { this.composer.render(); }
}
