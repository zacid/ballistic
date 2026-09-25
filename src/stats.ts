/** Frame-time bookkeeping for the on-screen performance panel. */
export class Stats {
  readonly N = 180;
  frames = new Float32Array(this.N);   // ms between frames
  i = 0;
  count = 0;
  sim = 0; render = 0; hud = 0;        // smoothed CPU ms per section
  private k = 0.1;

  frame(realDt: number, sim: number, render: number, hud: number) {
    if (realDt <= 0 || realDt > 1) return;       // tab was hidden
    this.frames[this.i] = realDt * 1000; this.i = (this.i + 1) % this.N; this.count = Math.min(this.N, this.count + 1);
    this.sim += (sim - this.sim) * this.k; this.render += (render - this.render) * this.k; this.hud += (hud - this.hud) * this.k;
  }

  /** fps over the last second, mean frame ms, worst frame and 1%-low fps over the window. */
  summary() {
    let sum = 0, worst = 0, n = 0, lastSec = 0, lastN = 0;
    const sorted: number[] = [];
    for (let k = 0; k < this.count; k++) {
      const v = this.frames[(this.i - 1 - k + this.N) % this.N];
      sum += v; n++; worst = Math.max(worst, v); sorted.push(v);
      if (lastSec < 1000) { lastSec += v; lastN++; }
    }
    sorted.sort((a, b) => b - a);
    const p99 = sorted[Math.floor(sorted.length * 0.01)] ?? 0;
    return { fps: lastSec > 0 ? (lastN * 1000) / lastSec : 0, avg: n ? sum / n : 0, worst, low1: p99 > 0 ? 1000 / p99 : 0 };
  }

  draw(c: HTMLCanvasElement) {
    const g = c.getContext('2d'); if (!g) return;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const scale = H / 50; // 50 ms tall
    // 60 fps and 30 fps guides
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, H - 16.7 * scale, W, 1); g.fillRect(0, H - 33.3 * scale, W, 1);
    const bw = W / this.N;
    for (let k = 0; k < this.count; k++) {
      const v = this.frames[(this.i - this.count + k + this.N) % this.N];
      g.fillStyle = v > 33.4 ? '#ff5a5a' : v > 17.5 ? '#ffc83a' : '#3ee08f';
      const h = Math.min(H, v * scale);
      g.fillRect(k * bw, H - h, Math.max(1, bw - 0.3), h);
    }
  }
}
