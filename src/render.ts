import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HALF } from './arena';
import type { ThemeLook } from './themes';

export type Quality = 'ultra' | 'high' | 'medium' | 'low';
export interface QualityDef { label: string; msaa: number; ao: boolean; aoScale: number; bloom: boolean; shadows: boolean; pr: number; shadow: number; dynShadows: boolean }
export const QUALITY: Record<Quality, QualityDef> = {
  ultra: { label: 'Ultra', msaa: 4, ao: true, aoScale: 1, bloom: true, shadows: true, pr: 2, shadow: 2048, dynShadows: true },
  high: { label: 'High', msaa: 4, ao: true, aoScale: 0.5, bloom: true, shadows: true, pr: 1.5, shadow: 2048, dynShadows: true },
  medium: { label: 'Medium', msaa: 2, ao: false, aoScale: 0.5, bloom: true, shadows: true, pr: 1.25, shadow: 1024, dynShadows: false },
  low: { label: 'Low', msaa: 0, ao: false, aoScale: 0.5, bloom: false, shadows: true, pr: 1, shadow: 1024, dynShadows: false },
};

/** Live switches the perf panel can flip independently of the preset. */
export interface RenderFlags { ao: boolean; bloom: boolean; shadows: boolean; res: number }

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.5, 200);
  composer: EffectComposer;
  ao: GTAOPass;
  bloom: UnrealBloomPass;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
  private hemiBase = 1.25;
  private flashT = 0;
  quality: Quality = 'high';
  flags: RenderFlags = { ao: true, bloom: true, shadows: true, res: 1 };
  gpuMs = -1;            // -1: timer queries unavailable
  info = { calls: 0, triangles: 0, w: 0, h: 0, pr: 1 };
  private timer: any = null;
  private queries: WebGLQuery[] = [];
  private aoScale = 0.5;
  shake = 0;
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3(0, 30, 14);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    // MSAA happens in the composer's render target instead (the default framebuffer's AA is wasted behind post-processing)
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false; // the composer renders several passes per frame; count them all
    const gl = this.renderer.getContext();
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const s = this.scene;
    s.background = new THREE.Color(0x9cc9ea);
    s.fog = new THREE.Fog(0x9cc9ea, 38, 75);

    const hemi = new THREE.HemisphereLight(0xdff0ff, 0x8a7a6a, 1.25);
    s.add(hemi); this.hemi = hemi;
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.sun.position.set(-14, 26, 10);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -HALF - 3; sc.right = HALF + 3; sc.top = HALF + 3; sc.bottom = -HALF - 3; sc.near = 1; sc.far = 70;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.03; this.sun.shadow.radius = 4;
    s.add(this.sun); s.add(this.sun.target);
    const fill = new THREE.DirectionalLight(0xb8d4ff, 0.55); fill.position.set(12, 10, -14); s.add(fill); this.fill = fill;

    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(s, this.camera));
    this.ao = new GTAOPass(s, this.camera, 1, 1);
    // run AO at a fraction of screen resolution (it's blurry by nature); the blend upsamples it
    const aoSetSize = this.ao.setSize.bind(this.ao);
    this.ao.setSize = (w: number, h: number) => aoSetSize(Math.max(1, Math.round(w * this.aoScale)), Math.max(1, Math.round(h * this.aoScale)));
    this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.5, scale: 1.2, samples: 8 });
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
    this.flags = { ao: c.ao, bloom: c.bloom, shadows: c.shadows, res: 1 };
    this.aoScale = c.aoScale;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) if (rt.samples !== c.msaa) { rt.samples = c.msaa; rt.dispose(); }
    if (this.sun.shadow.mapSize.x !== c.shadow) {
      this.sun.shadow.mapSize.set(c.shadow, c.shadow);
      this.sun.shadow.map?.dispose(); (this.sun.shadow as any).map = null;
    }
    this.applyFlags();
  }

  /**
   * Medium/Low: the arena's shadows are drawn into the shadow map once (walls never move) and moving
   * things get cheap blob shadows instead, so the shadow pass stops running every frame.
   * High/Ultra: everything casts real shadows, redrawn each frame.
   */
  dynShadows = true;
  onShadowMode: (dynamic: boolean) => void = () => {};
  bakeShadows() { this.sun.shadow.needsUpdate = true; }

  applyFlags() {
    this.ao.enabled = this.flags.ao; this.bloom.enabled = this.flags.bloom;
    const dyn = QUALITY[this.quality].dynShadows;
    this.dynShadows = dyn;
    this.sun.shadow.autoUpdate = dyn;
    // static mode: the shadow camera only sees layer 1 (the arena's static casters)
    if (dyn) this.sun.shadow.camera.layers.set(0); else this.sun.shadow.camera.layers.set(1);
    this.sun.shadow.needsUpdate = true;
    this.onShadowMode(dyn);
    if (this.sun.castShadow !== this.flags.shadows) this.sun.castShadow = this.flags.shadows;
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, QUALITY[this.quality].pr) * this.flags.res;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.info.w = Math.round(w * pr); this.info.h = Math.round(h * pr); this.info.pr = pr;
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

  /** Sky, fog and light for an arena theme. */
  setTheme(L: ThemeLook) {
    (this.scene.background as THREE.Color).setHex(L.sky);
    const f = this.scene.fog as THREE.Fog; f.color.setHex(L.sky); f.near = L.fog[0]; f.far = L.fog[1];
    this.hemi.color.setHex(L.hemi[0]); this.hemi.groundColor.setHex(L.hemi[1]); this.hemi.intensity = this.hemiBase = L.hemi[2];
    this.sun.color.setHex(L.sun[0]); this.sun.intensity = L.sun[1];
    this.fill.intensity = L.fill;
  }
  /** Lightning in the sky: two quick bright flickers. */
  skyFlash() { this.flashT = 0.32; }
  /** Current camera focus on the ground (weather follows it). */
  get focus() { return this.camTarget; }
  private stepFlash(dt: number) {
    if (this.flashT <= 0) return;
    this.flashT = Math.max(0, this.flashT - dt);
    const t = 0.32 - this.flashT, k = t < 0.06 ? 1 : t < 0.12 ? 0.2 : t < 0.2 ? 0.8 : Math.max(0, 1 - (t - 0.2) / 0.12) * 0.6;
    this.hemi.intensity = this.hemiBase * (1 + 2.2 * k);
  }

  addShake(a: number) { this.shake = Math.min(1.2, this.shake + a); }

  render(dt = 0) {
    this.stepFlash(dt);
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.renderer.info.reset();
    let q: WebGLQuery | null = null;
    if (this.timer) { q = gl.createQuery(); if (q) gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q); }
    this.composer.render();
    if (q) { gl.endQuery(this.timer.TIME_ELAPSED_EXT); this.queries.push(q); }
    this.info.calls = this.renderer.info.render.calls; this.info.triangles = this.renderer.info.render.triangles;
    // read back finished GPU timings (they arrive a frame or two late)
    while (this.queries.length) {
      const f = this.queries[0];
      if (!gl.getQueryParameter(f, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.timer.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(f, gl.QUERY_RESULT) as number;
      if (!disjoint) this.gpuMs = this.gpuMs < 0 ? ns / 1e6 : this.gpuMs * 0.9 + (ns / 1e6) * 0.1;
      gl.deleteQuery(f); this.queries.shift();
    }
    if (this.queries.length > 8) { for (const f of this.queries) gl.deleteQuery(f); this.queries.length = 0; }
  }
}
