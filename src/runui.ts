// Rollout's between-wave screens: level-up picks, then the shop.
import type { Game } from './game';
import { WEAPONS } from './config';
import { gunThumbs } from './hud';
import { RUN, TIERS, TIER_DMG, STAT_INFO, StatId, ITEMS, Stats } from './rundata';
import type { Offer, Turret } from './run';

const $ = (id: string) => document.getElementById(id)!;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const sgn = (v: number) => (v > 0 ? '+' : '') + v;
const COIN = '<i class="coin"></i>';

export class RunUi {
  private el: HTMLElement;
  private msg = '';
  private msgT = 0;
  constructor(private g: Game) {
    this.el = $('runui');
    this.el.addEventListener('click', e => this.click(e));
    addEventListener('keydown', e => {
      if (!this.el.classList.contains('open') || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const r = this.g.run; if (!r) return;
      const k = e.key.toLowerCase();
      if (k >= '1' && k <= '4') { e.preventDefault(); if (r.phase === 'levelup') this.pickLevel(Number(k) - 1); else this.buy(Number(k) - 1); }
      else if (k === 'r') { e.preventDefault(); this.reroll(); }
      else if ((k === 'enter' || k === ' ') && r.phase === 'shop') { e.preventDefault(); r.nextWave(); }
    });
  }

  open() { this.el.classList.add('open'); this.render(); }
  close() { this.el.classList.remove('open'); }

  private flash(m: string) { this.msg = m; this.msgT = performance.now(); this.render(); this.g.audio.play('empty'); }

  private click(e: Event) {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (!t) return;
    const r = this.g.run; if (!r) return;
    const a = t.dataset.a!, i = Number(t.dataset.i ?? -1);
    this.g.audio.unlock();
    if (a === 'level') this.pickLevel(i);
    else if (a === 'buy') this.buy(i);
    else if (a === 'lock') { const o = r.offers[i]; if (o && !o.sold) { o.locked = !o.locked; this.g.audio.play('click'); this.render(); } }
    else if (a === 'reroll') this.reroll();
    else if (a === 'next') r.nextWave();
    else if (a === 'sell') { const tu = r.turrets[i]; if (tu) { r.sell(tu); this.render(); } }
    else if (a === 'combine') { const tu = r.turrets[i]; if (tu) { r.combine(tu); this.render(); } }
  }
  private pickLevel(i: number) { const r = this.g.run!; if (!r.levelOffers[i]) return; r.pickLevel(i); this.g.audio.play('pickup'); this.render(); }
  private buy(i: number) { const r = this.g.run!, m = r.buy(i); if (m) this.flash(m); else this.render(); }
  private reroll() {
    const r = this.g.run!;
    const ok = r.phase === 'levelup' ? r.rerollLevel() : r.reroll();
    if (!ok) this.flash('Not enough coins'); else { this.g.audio.play('click'); this.render(); }
  }

  render() {
    const r = this.g.run; if (!r) return;
    const msg = performance.now() - this.msgT < 2200 ? this.msg : '';
    const top = `<div class="ru-top"><div class="ru-title">${r.phase === 'levelup' ? `LEVEL UP${r.pending > 1 ? ` <small>&times;${r.pending}</small>` : ''}` : `WAVE ${r.n} CLEARED`}</div>
      <div class="ru-coins">${COIN}<b>${r.mats}</b>${r.piggy > 0 ? `<span title="Coins you left on the floor. Each coin you pick up next wave pays out one of these too.">piggy bank ${r.piggy}</span>` : ''}</div></div>`;
    let body = '';
    if (r.phase === 'levelup') {
      body = `<div class="ru-sub">Pick one. You're level ${r.lvl}.</div><div class="ru-cards">${r.levelOffers.map((o, i) => {
        const inf = STAT_INFO[o.stat];
        return `<button class="ru-card lvl" data-a="level" data-i="${i}" style="--t:${hex(TIERS[o.tier].color)}"><em>${i + 1}</em><span class="tier">${TIERS[o.tier].name}</span><b>${inf.name}</b><strong>${sgn(o.v)}${inf.unit}</strong><p>${inf.hint}</p></button>`;
      }).join('')}</div>
      <div class="ru-actions"><button class="ghost-btn" data-a="reroll">REROLL ${COIN}${r.levelRerollCost} <kbd>R</kbd></button></div>`;
    } else {
      const thumbs = gunThumbs();
      body = `<div class="ru-cards">${r.offers.map((o, i) => this.offerCard(o, i, thumbs)).join('')}</div>
      <div class="ru-actions"><button class="ghost-btn" data-a="reroll">REROLL ${COIN}${r.rerollCost} <kbd>R</kbd></button><button class="big-btn" data-a="next">WAVE ${r.n + 1} &rarr;</button></div>
      ${this.loadout(thumbs)}`;
    }
    this.el.innerHTML = `<div class="ru pill">${top}${body}${msg ? `<div class="ru-msg">${esc(msg)}</div>` : ''}</div>`;
  }

  private offerCard(o: Offer, i: number, thumbs: Partial<Record<string, string>>) {
    const r = this.g.run!, afford = r.mats >= o.price;
    let name = '', kind = '', img = '', lines = '';
    if (o.kind === 'item') {
      name = o.item.name; kind = 'ITEM';
      lines = Object.entries(o.item.mods).map(([k, v]) => `<li class="${(v as number) >= 0 ? 'up' : 'down'}">${sgn(v as number)}${STAT_INFO[k as StatId].unit} ${STAT_INFO[k as StatId].name}</li>`).join('');
    } else if (o.kind === 'turret') {
      const d = o.turret, have = r.turrets.find(t => t.def === d && t.tier === o.tier && t.tier < 3);
      name = d.name; kind = 'TURRET'; img = thumbs[d.w] ?? '';
      lines = `<li>${Math.round(d.dmg * TIER_DMG[o.tier] * 10) / 10}${d.pellets ? `&times;${d.pellets}` : ''} dmg &middot; ${d.rate}/s &middot; ${d.range} m</li><li class="dim">Fires on its own at the nearest enemy</li>${have ? '<li class="up">Combines with one you have</li>' : r.turrets.length >= RUN.turretSlots ? '<li class="down">No free slot</li>' : ''}`;
    } else {
      const w = WEAPONS[o.w], same = this.g.player.weapon === o.w;
      name = w.name; kind = 'MAIN GUN'; img = thumbs[o.w] ?? '';
      lines = `<li class="dim">${esc(w.blurb)}</li>${same ? '<li class="up">You have it: upgrades a tier</li>' : '<li>Replaces your aimed gun</li>'}`;
    }
    return `<div class="ru-card${o.sold ? ' sold' : ''}${o.locked ? ' locked' : ''}" style="--t:${hex(TIERS[o.tier].color)}">
      <em>${i + 1}</em><span class="tier">${TIERS[o.tier].name} ${kind}</span>
      ${img ? `<img alt="" src="${img}">` : `<div class="ru-glyph">${esc(name.split(' ').map(s => s[0]).join('').slice(0, 2))}</div>`}
      <b>${esc(name)}</b><ul>${lines}</ul>
      <div class="ru-buy">${o.sold ? '<span class="dim">SOLD</span>' : `<button class="buy${afford ? '' : ' poor'}" data-a="buy" data-i="${i}">${COIN}${o.price}</button><button class="lock" data-a="lock" data-i="${i}" title="Lock: keep this offer through rerolls and into the next shop">${o.locked ? 'LOCKED' : 'LOCK'}</button>`}</div>
    </div>`;
  }

  private loadout(thumbs: Partial<Record<string, string>>) {
    const r = this.g.run!, p = this.g.player, w = WEAPONS[p.weapon];
    const slot = (t: Turret | undefined, i: number) => t
      ? `<div class="ru-slot" style="--t:${hex(TIERS[t.tier].color)}"><img alt="" src="${thumbs[t.def.w] ?? ''}"><b>${t.def.name}</b><span>${TIERS[t.tier].name}</span>
          <div><button data-a="sell" data-i="${i}" title="Sell for 40% of its price">SELL ${COIN}${Math.round(r.turretValue(t) * 0.4)}</button>${r.canCombine(t) ? `<button class="up" data-a="combine" data-i="${i}" title="Merge two of the same into the next tier">COMBINE</button>` : ''}</div></div>`
      : `<div class="ru-slot empty"><span>empty turret slot</span></div>`;
    const items = [...r.items.entries()].map(([id, n]) => `<span class="ru-item">${esc(itemName(id))}${n > 1 ? ` &times;${n}` : ''}</span>`).join('') || '<span class="dim">No items yet</span>';
    const st = r.stats as Stats;
    const shown: StatId[] = ['maxHp', 'regen', 'lifesteal', 'damage', 'rate', 'range', 'armor', 'dodge', 'speed', 'luck', 'harvest', 'pickup', 'turretDmg', 'turretRate', 'knock', 'cooldown', 'thorns'];
    const stats = shown.map(k => { const v = k === 'maxHp' ? p.maxHp : Math.round(st[k] * 10) / 10; return `<div class="${k !== 'maxHp' && v > 0 ? 'up' : v < 0 ? 'down' : ''}" title="${STAT_INFO[k].hint}"><span>${STAT_INFO[k].name}</span><b>${k === 'maxHp' ? v : sgn(v)}${k === 'maxHp' ? '' : STAT_INFO[k].unit}</b></div>`; }).join('');
    return `<div class="ru-load">
      <div class="ru-col"><div class="kit-label">YOUR GUN</div><div class="ru-slot main" style="--t:${hex(TIERS[r.mainTier].color)}"><img alt="" src="${thumbs[p.weapon] ?? ''}"><b>${w.name}</b><span>${TIERS[r.mainTier].name} &middot; &times;${TIER_DMG[r.mainTier]} dmg</span></div>
        <div class="kit-label">TURRETS <span>${r.turrets.length}/${RUN.turretSlots}</span></div><div class="ru-slots">${Array.from({ length: RUN.turretSlots }, (_, i) => slot(r.turrets[i], i)).join('')}</div>
        <div class="kit-label">ITEMS</div><div class="ru-items">${items}</div></div>
      <div class="ru-col"><div class="kit-label">STATS <span>${r.ball.name} &middot; level ${r.lvl}</span></div><div class="ru-stats">${stats}</div></div>
    </div>`;
  }
}

function itemName(id: string) { return ITEMS.find(i => i.id === id)?.name ?? id; }
