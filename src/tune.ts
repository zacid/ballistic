// The Rollout tuning panel (F2 or `): live sliders for the difficulty and economy knobs in TUNE.
// Saved per browser. In co-op the host's minion numbers (health, damage, spawns, crates) are the ones
// that count, since the host runs the wave; prices, sweep and sell-back are each player's own.
import type { Game } from './game';
import { TUNE, TUNE_DEFAULTS, TUNE_INFO, Tune } from './rundata';

const fmt = (v: number, pct?: boolean, raw?: boolean) => (pct ? `${Math.round(v * 100)}%` : raw ? String(Math.round(v * 1000) / 1000) : `×${v.toFixed(2)}`);

export class TunePanel {
  private el: HTMLElement;
  constructor(private g: Game) {
    this.el = document.createElement('div'); this.el.id = 'tune';
    document.body.appendChild(this.el);
    Object.assign(TUNE, TUNE_DEFAULTS, g.saved.tune ?? {});
    addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      if (e.key === 'F2' || e.key === '`') { e.preventDefault(); this.toggle(); }
    });
    this.el.addEventListener('input', e => {
      const t = e.target as HTMLInputElement, k = t.dataset.k as keyof Tune | undefined; if (!k) return;
      TUNE[k] = Number(t.value); this.save(); this.refresh();
    });
    this.el.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (!a) return;
      if (a.dataset.a === 'reset') { Object.assign(TUNE, TUNE_DEFAULTS); this.save(); this.render(); }
      else if (a.dataset.a === 'copy') {
        const txt = this.summary(), ta = this.el.querySelector('textarea') as HTMLTextAreaElement;
        ta.value = txt; ta.style.display = 'block'; ta.select();
        navigator.clipboard?.writeText(txt).then(() => { a.textContent = 'COPIED'; }, () => { a.textContent = 'SELECT + COPY'; });
      } else if (a.dataset.a === 'close') this.toggle(false);
    });
  }
  toggle(on = !this.el.classList.contains('open')) { this.el.classList.toggle('open', on); if (on) this.render(); }
  private save() {
    const out: Partial<Tune> = {};
    for (const { k } of TUNE_INFO) if (TUNE[k] !== TUNE_DEFAULTS[k]) out[k] = TUNE[k];
    this.g.saved.tune = out; this.g.save();
  }
  /** The changed knobs, for pasting back to be baked in as the new defaults. */
  private summary() {
    const ch = TUNE_INFO.filter(i => TUNE[i.k] !== TUNE_DEFAULTS[i.k]);
    return ch.length ? 'Ballistic tuning: ' + ch.map(i => `${i.name} ${fmt(TUNE[i.k], i.pct, i.raw)} (was ${fmt(TUNE_DEFAULTS[i.k], i.pct, i.raw)})`).join('; ') : 'Ballistic tuning: all defaults';
  }
  private refresh() {
    for (const i of TUNE_INFO) {
      const l = this.el.querySelector(`label[data-k="${i.k}"]`); if (!l) continue;
      l.classList.toggle('chg', TUNE[i.k] !== TUNE_DEFAULTS[i.k]);
      l.querySelector('b')!.textContent = fmt(TUNE[i.k], i.pct, i.raw);
    }
  }
  private render() {
    const r = this.g.run;
    this.el.innerHTML = `<h3>ROLLOUT TUNING</h3><p>Changes apply straight away (health to new spawns). ${r?.coop ? "In co-op the host's minion settings are the ones used." : 'Saved in this browser.'} F2 to close.</p>
      ${TUNE_INFO.map(i => `<label data-k="${i.k}" class="${TUNE[i.k] !== TUNE_DEFAULTS[i.k] ? 'chg' : ''}"><span>${i.name}</span><b>${fmt(TUNE[i.k], i.pct, i.raw)}</b><input type="range" data-k="${i.k}" min="${i.min}" max="${i.max}" step="${i.step}" value="${TUNE[i.k]}"></label>`).join('')}
      <div class="row"><button class="ghost-btn" data-a="copy">COPY NUMBERS</button><button class="ghost-btn" data-a="reset">RESET</button><button class="ghost-btn" data-a="close">CLOSE</button></div>
      <textarea readonly></textarea>`;
  }
}
