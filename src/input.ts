import * as THREE from 'three';
import type { Game } from './game';
import type { Babo } from './babo';
import { WEAPONS } from './config';

const $ = (id: string) => document.getElementById(id)!;

export class Input {
  keys = new Set<string>();
  mouse = new THREE.Vector2(0, 0);
  mouseDown = false;
  abilityQueued = false;
  touch = false;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.55);
  private hit = new THREE.Vector3();
  private aimTmp = new THREE.Vector3();
  // touch sticks
  private mv = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private am = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private touchAim = { x: 1, z: 0, active: false };

  constructor(private g: Game, canvas: HTMLCanvasElement) {
    addEventListener('keydown', e => this.key(e, true));
    addEventListener('keyup', e => this.key(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
    canvas.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') this.setMouse(e); });
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      this.setMouse(e);
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.nade();
    });
    addEventListener('pointerup', e => { if (e.button === 0) this.mouseDown = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // touch: left half moves, right half aims + fires
    canvas.addEventListener('touchstart', e => this.touchStart(e), { passive: false });
    canvas.addEventListener('touchmove', e => this.touchMove(e), { passive: false });
    canvas.addEventListener('touchend', e => this.touchEnd(e));
    canvas.addEventListener('touchcancel', e => this.touchEnd(e));
    $('btn-nade').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.nade(); });
    $('btn-ab').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.abilityQueued = true; });
    $('btn-reload').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (this.g.player?.alive) this.g.reload(this.g.player); });
  }

  private setMouse(e: PointerEvent) {
    this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.g.hud.cursor(e.clientX, e.clientY);
    if (this.touch) { this.touch = false; document.body.classList.remove('touch'); }
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text' && k !== 'escape') return;
    if (k === 'tab') { e.preventDefault(); this.g.hud.scoreboard(down && this.g.state !== 'menu'); return; }
    if (down && !e.repeat) {
      if (k === 'p' || k === 'escape') { if (this.g.state === 'playing' || this.g.state === 'countdown') this.g.hud.togglePause(); }
      if (k === 'f') this.g.hud.setPerf(!this.g.saved.perf);
      if (k === 'm') { this.g.setMuted(!this.g.saved.muted); this.g.hud.syncSettings(); this.g.hud.toast(this.g.saved.muted ? 'Sound off' : 'Sound on'); }
      if (this.g.state === 'playing' && !this.g.paused) {
        if (k === 'g' || k === 'q') this.nade();
        if (k === ' ' || k === 'shift') { e.preventDefault(); this.abilityQueued = true; }
        if (k === 'r' && this.g.player.alive) this.g.reload(this.g.player);
      }
      if (k === 'enter' && (this.g.state === 'menu' || (this.g.state === 'over' && !this.g.online))) this.g.start();
    }
    if (down) this.keys.add(k); else this.keys.delete(k);
  }

  private nade() {
    const g = this.g; if (g.state !== 'playing' || g.paused || !g.player?.alive) return;
    const p = new THREE.Vector3(); this.aimWorld(p);
    g.throwNade(g.player, p.x, p.z);
  }

  /** Where the player is aiming, on the ground plane. */
  aimWorld(out: THREE.Vector3) {
    const p = this.g.player;
    if (this.touch) {
      out.set(p.x + this.touchAim.x * 7, p.y + 0.55, p.z + this.touchAim.z * 7); return out;
    }
    // aim on the plane at the ball's own height, so aiming stays true up on the battlements
    this.plane.constant = -((p?.y ?? 0) + 0.55);
    this.ray.setFromCamera(this.mouse, this.g.r.camera);
    if (this.ray.ray.intersectPlane(this.plane, this.hit)) out.copy(this.hit);
    return out;
  }

  apply(b: Babo) {
    const g = this.g;
    if (g.paused) { b.moveX = b.moveZ = 0; b.fire = false; return; }
    let mx = 0, mz = 0;
    if (this.touch) {
      const dx = this.mv.x - this.mv.ox, dy = this.mv.y - this.mv.oy, l = Math.hypot(dx, dy);
      if (this.mv.id >= 0 && l > 8) { const k = Math.min(1, l / 55); mx = (dx / l) * k; mz = (dy / l) * k; }
    } else {
      const k = this.keys;
      if (k.has('w') || k.has('arrowup')) mz -= 1;
      if (k.has('s') || k.has('arrowdown')) mz += 1;
      if (k.has('a') || k.has('arrowleft')) mx -= 1;
      if (k.has('d') || k.has('arrowright')) mx += 1;
    }
    b.moveX = mx; b.moveZ = mz;
    const a = this.aimWorld(this.aimTmp);
    const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz);
    if (l > 0.2) { b.aimX = dx / l; b.aimZ = dz / l; }
    b.aimDist = l;
    b.fire = this.touch ? this.touchAim.active : this.mouseDown;
    if (this.abilityQueued) { b.wantAbility = true; this.abilityQueued = false; }
    // reloading an empty clip automatically; tapping fire while reloading does nothing
    if (b.fire && b.ammo <= 0 && b.reloadT <= 0) g.reload(b);
    void WEAPONS;
  }

  // ---------- touch ----------
  private touchStart(e: TouchEvent) {
    e.preventDefault();
    if (!this.touch) { this.touch = true; document.body.classList.add('touch'); }
    this.g.audio.unlock();
    for (const t of Array.from(e.changedTouches)) {
      const left = t.clientX < innerWidth / 2;
      const s = left ? this.mv : this.am;
      if (s.id >= 0) continue;
      s.id = t.identifier; s.ox = s.x = t.clientX; s.oy = s.y = t.clientY;
      this.g.hud.stick(left ? 'move' : 'aim', true, s.ox, s.oy, 0, 0);
    }
  }
  private touchMove(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      for (const [s, name] of [[this.mv, 'move'], [this.am, 'aim']] as const) {
        if (s.id !== t.identifier) continue;
        s.x = t.clientX; s.y = t.clientY;
        let dx = s.x - s.ox, dy = s.y - s.oy; const l = Math.hypot(dx, dy);
        if (l > 60) { s.ox += dx * (1 - 60 / l); s.oy += dy * (1 - 60 / l); dx = s.x - s.ox; dy = s.y - s.oy; }
        this.g.hud.stick(name, true, s.ox, s.oy, dx, dy);
        if (name === 'aim') {
          const l2 = Math.hypot(dx, dy);
          if (l2 > 14) { this.touchAim.x = dx / l2; this.touchAim.z = dy / l2; this.touchAim.active = true; }
        }
      }
    }
  }
  private touchEnd(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      if (this.mv.id === t.identifier) { this.mv.id = -1; this.g.hud.stick('move', false, 0, 0, 0, 0); }
      if (this.am.id === t.identifier) { this.am.id = -1; this.touchAim.active = false; this.g.hud.stick('aim', false, 0, 0, 0, 0); }
    }
  }
}
