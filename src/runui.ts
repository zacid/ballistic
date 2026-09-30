// Rollout's between-wave screens: level-up picks, then the shop (and the win screen).
import type { Game } from './game';
import { WEAPONS, WeaponId } from './config';
import { gunThumbs } from './hud';
import { RUN, TIERS, TIER_DMG, STAT_INFO, StatId, ITEMS, Stats, WEAPON_CLASS, CLASSES, ClassId } from './rundata';
import type { Offer, Turret } from './run';

const $ = (id: string) => document.getElementById(id)!;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const sgn = (v: number) => (v > 0 ? '+' : '') + v;
const r1 = (v: number) => Math.round(v * 10) / 10;
const COIN = '<i class="coin"></i>';
const SHOWN: StatId[] = ['maxHp', 'regen', 'lifesteal', 'damage', 'rate', 'range', 'armor', 'dodge', 'speed', 'luck', 'harvest', 'pickup', 'turretDmg', 'turretRate', 'knock', 'cooldown', 'thorns'];

export class RunUi {
  private el: HTMLElement;
  private msg = '';
  private msgT = 0;
  /** Stat changes to preview in the stats panel while hovering an offer. */
  private prev: Partial<Stats> | null = null;
  constructor(private g: Game) {
    this.el = $('runui');
    this.el.addEventListener('click', e => this.click(e));
    this.el.addEventListener('mouseover', e => this.hover(e));
    this.el.addEventListener('mouseleave', () => this.hover(null));
    addEventListener('keydown', e => {
      if (!this.el.classList.contains('open') || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const r = this.g.run; if (!r) return;
      const k = e.key.toLowerCase();
      if (r.phase === 'won') return;
      if (r.phase === 'crate') { if (k === '1' || k === 'enter' || k === ' ') { e.preventDefault(); r.openCrate(true); this.render(); } else if (k === '2') { e.preventDefault(); r.openCrate(false); this.render(); } return; }
      if (k >= '1' && k <= '4') { e.preventDefault(); if (r.phase === 'levelup') this.pickLevel(Number(k) - 1); else this.buy(Number(k) - 1); }
      else if (k === 'r') { e.preventDefault(); this.reroll(); }
      else if ((k === 'enter' || k === ' ') && r.phase === 'shop' && !r.ready) { e.preventDefault(); r.nextWave(); }
    });
  }

  open() { this.prev = null; this.el.classList.add('open'); this.render(); }
  close() { this.el.classList.remove('open'); if (this.g.run) this.g.run.showRange = 0; }
  get isOpen() { return this.el.classList.contains('open'); }

  private flash(m: string) { this.msg = m; this.msgT = performance.now(); this.render(); this.g.audio.play('empty'); }

  private hover(e: Event | null) {
    const r = this.g.run; if (!r) return;
    const t = e ? (e.target as HTMLElement).closest('[data-h]') as HTMLElement | null : null;
    const key = t?.dataset.h ?? '';
    let prev: Partial<Stats> | null = null, range = 0;
    if (key === 'c' && r.crateItem) prev = r.crateItem.mods;
    else if (key.startsWith('o')) {
      const o = r.offers[Number(key.slice(1))];
      if (o?.kind === 'item') prev = o.item.mods;
      if (o?.kind === 'turret') range = o.turret.range * r.rangeMul;
    } else if (key.startsWith('l')) {
      const o = r.levelOffers[Number(key.slice(1))]; if (o) prev = { [o.stat]: o.v };
    } else if (key.startsWith('t')) {
      const tu = r.turrets[Number(key.slice(1))]; if (tu) range = tu.def.range * r.rangeMul;
    }
    r.showRange = range;
    if (JSON.stringify(prev) !== JSON.stringify(this.prev)) { this.prev = prev; const s = this.el.querySelector('.ru-stats'); if (s) s.innerHTML = this.statsHtml(); }
  }

  private click(e: Event) {
    const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (!t) return;
    const r = this.g.run; if (!r) return;
    const a = t.dataset.a!, i = Number(t.dataset.i ?? -1);
    this.g.audio.unlock();
    if (a === 'level') this.pickLevel(i);
    else if (a === 'buy') this.buy(i);
    else if (a === 'lock') { const o = r.offers[i]; if (o && !o.sold) { o.locked = !o.locked; this.g.audio.play('click'); this.render(); } }
    else if (a === 'reroll') this.reroll();
    else if (a === 'next') { if (!r.ready) r.nextWave(); }
    else if (a === 'sell') { const tu = r.turrets[i]; if (tu) { r.sell(tu); this.render(); } }
    else if (a === 'combine') { const tu = r.turrets[i]; if (tu) { r.combine(tu); this.render(); } }
    else if (a === 'sellitem') { r.sellItem(t.dataset.id!); this.render(); }
    else if (a === 'keep' || a === 'scrap') { r.openCrate(a === 'keep'); this.prev = null; this.render(); }
    else if (a === 'endless') { this.g.audio.play('click'); r.keepGoing(); this.render(); }
    else if (a === 'finish') { this.close(); this.g.end('You cleared all 20 waves!'); }
  }
  private pickLevel(i: number) { const r = this.g.run!; if (!r.levelOffers[i]) return; r.pickLevel(i); this.prev = null; this.g.audio.play('pickup'); this.render(); }
  private buy(i: number) { const r = this.g.run!, m = r.buy(i); if (m) this.flash(m); else { this.prev = null; this.render(); } }
  private reroll() {
    const r = this.g.run!;
    const ok = r.phase === 'levelup' ? r.rerollLevel() : r.reroll();
    if (!ok) this.flash('Not enough coins'); else { this.g.audio.play('click'); this.render(); }
  }

  private partnerName() { return this.g.babos.find(b => b.human && !b.isPlayer)?.name ?? 'your friend'; }

  render() {
    const r = this.g.run; if (!r) return;
    const msg = performance.now() - this.msgT < 2200 ? this.msg : '';
    if (r.phase === 'won') {
      this.el.innerHTML = `<div class="ru pill won"><div class="ru-title big">YOU WIN!</div>
        <div class="ru-sub">All ${RUN.waves} waves cleared${r.danger ? ` on Danger ${r.danger}` : ''}. Keep going for a best-wave record, or bank the win.</div>
        <div class="ru-actions center">${this.g.online && !this.g.host ? `<span class="dim">${esc(this.partnerName())} decides whether to keep going</span><button class="ghost-btn" data-a="endless">KEEP GOING TOO</button>` : `<button class="big-btn" data-a="endless">KEEP GOING (ENDLESS)</button><button class="ghost-btn" data-a="finish">FINISH RUN</button>`}</div></div>`;
      return;
    }
    if (r.phase === 'crate' && r.crateItem) {
      const it = r.crateItem;
      const lines = Object.entries(it.mods).map(([k, v]) => `<li class="${(v as number) >= 0 ? 'up' : 'down'}">${sgn(v as number)}${STAT_INFO[k as StatId].unit} ${STAT_INFO[k as StatId].name}</li>`).join('');
      this.el.innerHTML = `<div class="ru pill crate"><div class="ru-top"><div class="ru-title">LOOT CRATE${r.cratesPending > 1 ? ` <small>&times;${r.cratesPending}</small>` : ''}</div><div class="ru-coins">${COIN}<b>${r.mats}</b></div></div>
        <div class="ru-cards one"><div class="ru-card" data-h="c" style="--t:${hex(TIERS[it.tier].color)}"><span class="tier">${TIERS[it.tier].name} ITEM</span><div class="ru-glyph">${esc(it.name.split(' ').map(x => x[0]).join('').slice(0, 2))}</div><b>${esc(it.name)}</b><ul>${lines}</ul></div></div>
        <div class="ru-actions center"><button class="big-btn" data-a="keep">TAKE IT <kbd>1</kbd></button><button class="ghost-btn" data-a="scrap">SELL FOR ${COIN}${r.crateValue()} <kbd>2</kbd></button></div>
        <div class="ru-load one"><div class="ru-col"><div class="kit-label">STATS <span>hover the item to preview</span></div><div class="ru-stats">${this.statsHtml()}</div></div></div></div>`;
      return;
    }
    const coop = r.coop;
    const mate = coop ? `<div class="ru-mate${r.partnerReady ? ' ready' : ''}">${esc(this.partnerName())}: ${r.partnerReady ? 'READY' : 'shopping...'}</div>` : '';
    const top = `<div class="ru-top"><div class="ru-title">${r.phase === 'levelup' ? `LEVEL UP${r.pending > 1 ? ` <small>&times;${r.pending}</small>` : ''}` : `WAVE ${r.n} CLEARED`}</div>${mate}
      <div class="ru-coins">${COIN}<b>${r.mats}</b>${r.piggy > 0 ? `<span title="Coins left on the floor. Each coin you pick up next wave pays out one of these too.">piggy bank ${r.piggy}</span>` : ''}</div></div>`;
    let body = '';
    if (r.phase === 'levelup') {
      body = `<div class="ru-sub">Pick one. You're level ${r.lvl}. Hover a card to see the change in your stats.</div><div class="ru-cards">${r.levelOffers.map((o, i) => {
        const inf = STAT_INFO[o.stat];
        return `<button class="ru-card lvl" data-a="level" data-i="${i}" data-h="l${i}" style="--t:${hex(TIERS[o.tier].color)}"><em>${i + 1}</em><span class="tier">${TIERS[o.tier].name}</span><b>${inf.name}</b><strong>${sgn(o.v)}${inf.unit}</strong><p>${inf.hint}</p></button>`;
      }).join('')}</div>
      <div class="ru-actions"><button class="ghost-btn" data-a="reroll">REROLL ${COIN}${r.levelRerollCost} <kbd>R</kbd></button></div>
      <div class="ru-load one"><div class="ru-col"><div class="kit-label">STATS</div><div class="ru-stats">${this.statsHtml()}</div></div></div>`;
    } else {
      const thumbs = gunThumbs();
      const next = r.ready && coop ? `<button class="big-btn waiting" disabled>WAITING FOR ${esc(this.partnerName().toUpperCase())}...</button>` : `<button class="big-btn" data-a="next">${coop ? 'READY' : `WAVE ${r.n + 1}`} &rarr;</button>`;
      body = `<div class="ru-cards">${r.offers.map((o, i) => this.offerCard(o, i, thumbs)).join('')}</div>
      <div class="ru-actions"><button class="ghost-btn" data-a="reroll">REROLL ${COIN}${r.rerollCost} <kbd>R</kbd></button>${next}</div>
      ${this.loadout(thumbs)}`;
    }
    this.el.innerHTML = `<div class="ru pill">${top}${body}${msg ? `<div class="ru-msg">${esc(msg)}</div>` : ''}</div>`;
  }

  private offerCard(o: Offer, i: number, thumbs: Partial<Record<string, string>>) {
    const r = this.g.run!, afford = r.mats >= o.price, p = this.g.player;
    let name = '', kind = '', img = '', lines = '';
    if (o.kind === 'item') {
      name = o.item.name; kind = 'ITEM';
      lines = Object.entries(o.item.mods).map(([k, v]) => `<li class="${(v as number) >= 0 ? 'up' : 'down'}">${sgn(v as number)}${STAT_INFO[k as StatId].unit} ${STAT_INFO[k as StatId].name}</li>`).join('');
      const have = r.items.get(o.item.id); if (have) lines += `<li class="dim">You have ${have}</li>`;
    } else if (o.kind === 'turret') {
      const d = o.turret, have = r.turrets.find(t => t.def === d && t.tier === o.tier && t.tier < 3);
      name = d.name; kind = 'TURRET'; img = thumbs[d.w] ?? '';
      if (o.deal) lines += '<li class="deal">STARTER DEAL &minus;30%</li>';
      lines += `${this.classTag(d.w)}<li>${r1(d.dmg * TIER_DMG[o.tier])}${d.pellets ? `&times;${d.pellets}` : ''} dmg &middot; ${d.rate}/s &middot; ${d.range} m</li><li class="up">&asymp; ${Math.round(r.turretDps(d, o.tier))} damage/s, fires on its own</li>${have ? '<li class="up">Combines with one you have</li>' : r.turrets.length >= RUN.turretSlots ? '<li class="down">No free slot</li>' : ''}`;
    } else {
      const w = WEAPONS[o.w], same = p.weapon === o.w;
      name = w.name; kind = 'MAIN GUN'; img = thumbs[o.w] ?? '';
      const newTier = same ? Math.min(3, Math.max(r.mainTier + 1, o.tier)) : o.tier;
      const now = r.mainDps(), then = r.mainDps(o.w as WeaponId, newTier);
      lines = `${this.classTag(o.w)}<li class="dim">${esc(w.blurb)}</li><li class="${then >= now ? 'up' : 'down'}">${Math.round(now)} &rarr; ${Math.round(then)} damage/s</li>${same ? `<li class="up">Upgrades yours to ${TIERS[newTier].name}</li>` : '<li>Replaces your aimed gun</li>'}`;
    }
    return `<div class="ru-card${o.sold ? ' sold' : ''}${o.locked ? ' locked' : ''}${!o.sold && !afford ? ' poor' : ''}" data-h="o${i}" style="--t:${hex(TIERS[o.tier].color)}">
      <em>${i + 1}</em><span class="tier">${TIERS[o.tier].name} ${kind}</span>
      ${img ? `<img alt="" src="${img}">` : `<div class="ru-glyph">${esc(name.split(' ').map(s => s[0]).join('').slice(0, 2))}</div>`}
      <b>${esc(name)}</b><ul>${lines}</ul>
      <div class="ru-buy">${o.sold ? '<span class="dim">SOLD</span>' : `<button class="buy${afford ? '' : ' poor'}" data-a="buy" data-i="${i}">${COIN}${o.price}</button><button class="lock" data-a="lock" data-i="${i}" title="Lock: keep this offer through rerolls and into the next shop">${o.locked ? 'LOCKED' : 'LOCK'}</button>`}</div>
    </div>`;
  }

  /** "SPRAY 2/3" style tag: the gun's class, and how many of that class you'd have. */
  private classTag(w: WeaponId) {
    const c = WEAPON_CLASS[w]; if (!c) return '';
    const r = this.g.run!, have = r.classCount.get(c) ?? 0;
    return `<li class="cls" style="--k:${hex(CLASSES[c].color)}">${CLASSES[c].name.toUpperCase()}<span>you have ${have}</span></li>`;
  }
  private setsHtml() {
    const r = this.g.run!;
    return (Object.keys(CLASSES) as ClassId[]).map(c => {
      const n = r.classCount.get(c) ?? 0, def = CLASSES[c], b = r.classBonus.get(c);
      const next = n < 4 ? def.tiers[Math.max(0, Math.min(n + 1, 4) - 2)] : null;
      return `<div class="set${b ? ' on' : ''}" style="--k:${hex(def.color)}"><b>${def.name}</b><i>${'&#9679;'.repeat(Math.min(n, 4))}${'&#9675;'.repeat(Math.max(0, 4 - n))}</i><span>${b ? b.text : next && n + 1 >= 2 ? `at ${n + 1}: ${next.text}` : 'two of a kind switches on a bonus'}</span></div>`;
    }).join('');
  }

  private statsHtml() {
    const r = this.g.run!, p = this.g.player, st = r.stats, pv = this.prev ? r.preview(this.prev) : null;
    return SHOWN.map(k => {
      const cur = k === 'maxHp' ? p.maxHp : r1(st[k]);
      const nxt = pv ? (k === 'maxHp' ? p.maxHp + (this.prev?.maxHp ?? 0) : r1(pv[k])) : cur;
      const fmt = (v: number) => (k === 'maxHp' ? String(v) : sgn(v)) + (k === 'maxHp' ? '' : STAT_INFO[k].unit);
      const changed = nxt !== cur;
      const cls = changed ? (nxt > cur ? 'up chg' : 'down chg') : k !== 'maxHp' && cur > 0 ? 'up' : cur < 0 ? 'down' : '';
      return `<div class="${cls}" title="${STAT_INFO[k].hint}"><span>${STAT_INFO[k].name}</span><b>${changed ? `${fmt(cur)} &rarr; ${fmt(nxt)}` : fmt(cur)}</b></div>`;
    }).join('');
  }

  private loadout(thumbs: Partial<Record<string, string>>) {
    const r = this.g.run!, p = this.g.player, w = WEAPONS[p.weapon];
    const slot = (t: Turret | undefined, i: number) => t
      ? `<div class="ru-slot" data-h="t${i}" style="--t:${hex(TIERS[t.tier].color)}"><img alt="" src="${thumbs[t.def.w] ?? ''}"><b>${t.def.name}</b><span>${TIERS[t.tier].name} &middot; ${Math.round(r.turretDps(t.def, t.tier))}/s</span>
          <div><button data-a="sell" data-i="${i}" title="Sell for 40% of its price">SELL ${COIN}${Math.round(r.turretValue(t) * 0.4)}</button>${r.canCombine(t) ? `<button class="up" data-a="combine" data-i="${i}" title="Merge two of the same into the next tier">COMBINE</button>` : ''}</div></div>`
      : `<div class="ru-slot empty"><span>empty turret slot</span></div>`;
    const items = [...r.items.entries()].map(([id, n]) => `<span class="ru-item">${esc(ITEMS.find(i => i.id === id)?.name ?? id)}${n > 1 ? ` &times;${n}` : ''}<button data-a="sellitem" data-id="${id}" title="Sell one for ${r.itemValue(id)} coins">&times; ${r.itemValue(id)}</button></span>`).join('') || '<span class="dim">No items yet</span>';
    return `<div class="ru-load">
      <div class="ru-col"><div class="kit-label">YOUR GUN</div><div class="ru-slot main" style="--t:${hex(TIERS[r.mainTier].color)}"><img alt="" src="${thumbs[p.weapon] ?? ''}"><b>${w.name}</b><span>${TIERS[r.mainTier].name} &middot; &times;${TIER_DMG[r.mainTier]} dmg &middot; ${Math.round(r.mainDps())}/s</span></div>
        <div class="kit-label">TURRETS <span>${r.turrets.length}/${RUN.turretSlots} &middot; hover one to see its reach</span></div><div class="ru-slots">${Array.from({ length: RUN.turretSlots }, (_, i) => slot(r.turrets[i], i)).join('')}</div>
        <div class="kit-label">SETS <span>your gun + turrets, by class</span></div><div class="ru-sets">${this.setsHtml()}</div>
        <div class="kit-label">ITEMS <span>&times; sells one for 40%</span></div><div class="ru-items">${items}</div></div>
      <div class="ru-col"><div class="kit-label">STATS <span>${r.ball.name} &middot; level ${r.lvl}${r.danger ? ` &middot; Danger ${r.danger}` : ''}</span></div><div class="ru-stats">${this.statsHtml()}</div></div>
    </div>`;
  }
}
