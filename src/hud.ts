import * as THREE from 'three';
import type { Game } from './game';
import type { Babo } from './babo';
import { ONLINE_URL, ABILITIES, AbilityId, BALL, COLORS, DIFFICULTY, Difficulty, GRENADE, MODES, ModeId, WEAPONS, WeaponId } from './config';
import { QUALITY, Quality } from './render';
import type { RenderFlags } from './render';

const $ = (id: string) => document.getElementById(id)!;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

interface Floater { el: HTMLElement; x: number; z: number; t: number }

export class Hud {
  private overheads = new Map<number, { el: HTMLElement; fill: HTMLElement }>();
  private floaters: Floater[] = [];
  private bannerT = 0;
  private toastT = 0;
  private hurtV = 0;
  private v = new THREE.Vector3();
  private lastAmmoKey = '';
  private boardT = 0;
  private deathKiller = '';
  private abWasReady = true;
  private lobbyT = 0;

  constructor(private g: Game) {
    this.buildMenu();
    $('play').addEventListener('click', () => { this.g.audio.unlock(); this.g.startSolo(); });
    $('play-online').addEventListener('click', () => { this.g.audio.play('click'); this.g.openLobby(); });
    $('again').addEventListener('click', () => { if (this.g.online) this.g.backToLobby(); else this.g.startSolo(); });
    $('to-menu').addEventListener('click', () => this.toMenu());
    $('lobby-back').addEventListener('click', () => { this.g.leaveLobby(); this.toMenu(); });
    for (const m of ['duel', 'coop'] as ModeId[]) $('lobby-' + m).addEventListener('click', () => { this.g.audio.play('click'); this.g.hostMatch(m); });
    $('invite-btn').addEventListener('click', () => { this.g.audio.play('click'); this.g.createInvite(); });
    $('invite-copy').addEventListener('click', () => {
      const inp = $('invite-link') as HTMLInputElement;
      const done = () => { $('invite-copy').textContent = 'COPIED'; setTimeout(() => ($('invite-copy').textContent = 'COPY'), 1500); };
      navigator.clipboard?.writeText(inp.value).then(done, () => { inp.select(); document.execCommand?.('copy'); done(); });
    });
    const nick = $('nick') as HTMLInputElement;
    nick.value = this.g.saved.nick;
    nick.addEventListener('input', () => this.g.setNick(nick.value.trim()));
    $('resume').addEventListener('click', () => this.togglePause());
    $('quit').addEventListener('click', () => { this.g.paused = false; this.toMenu(); });
    $('gear').addEventListener('click', () => { $('settings').classList.toggle('open'); this.syncSettings(); });
    $('tog-mute').addEventListener('change', e => this.g.setMuted((e.target as HTMLInputElement).checked));
    const qs = $('quality-seg');
    for (const q of ['auto', 'ultra', 'high', 'medium', 'low'] as const) {
      const b = document.createElement('button'); b.textContent = q === 'auto' ? 'Auto' : QUALITY[q].label; b.dataset.q = q;
      b.addEventListener('click', () => {
        this.g.saved.quality = q; this.g.save();
        this.g.r.setQuality(q === 'auto' ? 'high' : q); this.syncSettings();
      });
      qs.appendChild(b);
    }
    if (this.g.saved.quality !== 'auto') this.g.r.setQuality(this.g.saved.quality);
    // debug switches that override the preset until the next preset change
    for (const k of ['ao', 'bloom', 'shadows'] as const) {
      $('dbg-' + k).addEventListener('change', e => { this.g.r.flags[k] = (e.target as HTMLInputElement).checked; this.g.r.applyFlags(); this.syncSettings(); });
    }
    const rs = $('res-seg');
    for (const v of [0.5, 0.75, 1]) {
      const b = document.createElement('button'); b.textContent = `${Math.round(v * 100)}%`; b.dataset.v = String(v);
      b.addEventListener('click', () => { this.g.r.flags.res = v; this.g.r.applyFlags(); this.syncSettings(); });
      rs.appendChild(b);
    }
    $('tog-perf').addEventListener('change', e => this.setPerf((e.target as HTMLInputElement).checked));
    this.setPerf(this.g.saved.perf !== false);
    this.syncSettings();
    $('menu').classList.add('open');
  }

  // ---------- menu ----------
  private buildMenu() {
    const cards = $('cards'); cards.innerHTML = '';
    const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`;
    for (const w of Object.values(WEAPONS)) {
      const c = document.createElement('button');
      c.className = 'card' + (w.id === this.g.saved.weapon ? ' on' : ''); c.dataset.id = w.id;
      c.setAttribute('aria-pressed', String(w.id === this.g.saved.weapon));
      c.innerHTML = `<div class="key">${Object.keys(WEAPONS).indexOf(w.id) + 1}</div><h2>${w.name}</h2><p>${w.blurb}</p>${bar('POWER', w.stats.power)}${bar('RANGE', w.stats.range)}${bar('FIRE RATE', w.stats.rate)}`;
      c.addEventListener('click', () => { this.g.audio.unlock(); this.g.audio.play('click'); this.g.saved.weapon = w.id; this.g.pendingWeapon = w.id; this.g.save(); this.buildMenu(); });
      cards.appendChild(c);
    }
    const ab = $('abilities'); ab.innerHTML = '';
    for (const a of Object.values(ABILITIES)) {
      const c = document.createElement('button');
      c.className = 'chip' + (a.id === this.g.saved.ability ? ' on' : '');
      c.setAttribute('aria-pressed', String(a.id === this.g.saved.ability));
      c.innerHTML = `<b>${a.name}</b><span>${a.blurb}</span><em>${a.cooldown}s cooldown</em>`;
      c.addEventListener('click', () => { this.g.audio.unlock(); this.g.audio.play('click'); this.pickAbility(a.id); this.buildMenu(); });
      ab.appendChild(c);
    }
    const sw = $('swatches'); sw.innerHTML = '';
    COLORS.forEach((col, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (i === this.g.saved.color ? ' on' : ''); b.style.background = hex(col.hex);
      b.title = col.name; b.setAttribute('aria-label', col.name); b.setAttribute('aria-pressed', String(i === this.g.saved.color));
      b.addEventListener('click', () => { this.g.audio.unlock(); this.g.audio.play('click'); this.g.saved.color = i; this.g.save(); this.buildMenu(); });
      sw.appendChild(b);
    });
    const ds = $('difficulty-seg'); ds.innerHTML = '';
    for (const d of Object.keys(DIFFICULTY) as Difficulty[]) {
      const b = document.createElement('button'); b.textContent = DIFFICULTY[d].label;
      b.className = d === this.g.saved.difficulty ? 'on' : '';
      b.addEventListener('click', () => { this.g.audio.unlock(); this.g.audio.play('click'); this.g.saved.difficulty = d; this.g.save(); this.buildMenu(); });
      ds.appendChild(b);
    }
    $('best').textContent = this.g.saved.best ? `Best finish: ${ordinal(this.g.saved.best)}` : '';
  }

  setPerf(on: boolean) {
    this.g.saved.perf = on; this.g.save();
    $('perf').classList.toggle('show', on); document.body.classList.toggle('perf', on);
    ($('tog-perf') as HTMLInputElement).checked = on;
  }

  syncSettings() {
    for (const b of Array.from($('quality-seg').children) as HTMLElement[]) b.classList.toggle('on', b.dataset.q === this.g.saved.quality);
    const f: RenderFlags = this.g.r.flags;
    ($('dbg-ao') as HTMLInputElement).checked = f.ao; ($('dbg-bloom') as HTMLInputElement).checked = f.bloom; ($('dbg-shadows') as HTMLInputElement).checked = f.shadows;
    for (const b of Array.from($('res-seg').children) as HTMLElement[]) b.classList.toggle('on', Number(b.dataset.v) === f.res);
    ($('tog-mute') as HTMLInputElement).checked = this.g.saved.muted;
  }

  pickAbility(a: AbilityId) {
    this.g.saved.ability = a; this.g.pendingAbility = a; this.g.save();
  }

  // ---------- lobby ----------
  showLobby() {
    for (const id of ['menu', 'result', 'pause']) $(id).classList.remove('open');
    $('hud').classList.add('hidden');
    $('lobby').classList.add('open');
    this.renderLobby();
  }
  toLobby() { this.g.backToLobby(); }

  renderLobby() {
    if (this.g.state !== 'lobby') { $('lobby').classList.remove('open'); return; }
    const g = this.g, net = g.net, room = g.peerRoom;
    const st = $('lobby-status'), list = $('lobby-peers');
    const friends = net.others();
    const me = `<div class="peer me"><i style="background:${hex(COLORS[g.saved.color % COLORS.length].hex)}"></i><span>${esc(g.saved.nick || 'Player')}</span><em>you${room?.role === 'host' ? ' (host)' : ''}</em></div>`;
    list.innerHTML = me + friends.map(p => `<div class="peer"><i style="background:${hex(COLORS[(Number(p.presence.c) || 0) % COLORS.length].hex)}"></i><span>${esc(String(p.presence.n || 'Friend'))}</span><em>ready</em></div>`).join('');
    const fname = friends.length ? String(friends[0].presence.n || 'Your friend') : '';
    const err = room?.error || '';
    let msg: string;
    if (g.inArtifact) msg = ONLINE_URL
      ? `Online play doesn't work inside claude.ai. Open the hosted game: <a href="${esc(ONLINE_URL)}" target="_blank" rel="noopener">${esc(ONLINE_URL)}</a>`
      : `Online play doesn't work inside claude.ai. Use the version hosted on GitHub Pages.`;
    else if (!room) msg = 'Create an invite link, then send it to your friend.';
    else if (err === 'peer-unavailable') msg = 'That invite has expired, or your friend closed the game. Ask them for a new link.';
    else if (err === 'room-full') msg = 'That game already has two players.';
    else if (err === 'network' || err === 'server-error' || err === 'socket-error' || err === 'socket-closed') msg = "Couldn't reach the matchmaking server. Check your connection and try again.";
    else if (err === 'ice-timeout') msg = "Couldn't open a direct connection between your two networks. The details below show where it got stuck.";
    else if (err === 'browser-incompatible') msg = "This browser can't make direct connections (WebRTC). Try Chrome, Edge, Firefox or Safari.";
    else if (err && err !== 'unavailable-id') msg = `Connection problem (${esc(err)}). Try again.`;
    else if (friends.length) msg = `${esc(fname)} is here. Either of you can pick a mode.`;
    else if (room.role === 'host') msg = net.linked ? 'Send the link to your friend. Waiting for them to open it...' : 'Setting up your game...';
    else msg = "Joining your friend's game...";
    st.innerHTML = msg;
    const inv = !g.inArtifact && (!room || room.role === 'host');
    $('lobby-invite').hidden = !inv;
    $('invite-btn').hidden = !!room;
    $('invite-row').hidden = !(room && room.role === 'host' && net.linked);
    if (room && room.role === 'host') ($('invite-link') as HTMLInputElement).value = room.link;
    $('lobby-steps').hidden = g.inArtifact || room?.role === 'guest' || friends.length > 0;
    for (const m of ['duel', 'coop'] as ModeId[]) ($('lobby-' + m) as HTMLButtonElement).disabled = !friends.length;
    $('lobby-diag').textContent = room
      ? `${room.role} | code ${room.code} | ${room.ice.state === 'relay' || (room as any).rtt !== undefined ? 'relay' : 'broker'} ${room.brokerOk ? 'ok' : 'no'} | ${net.linked ? 'connected' : 'not connected'} | ${friends.length} in lobby`
        + (room.ice.state === 'relay' ? (room.ice.path ? ` | ${room.ice.path}` : '') : room.ice.state !== 'idle' ? ` | ICE ${room.ice.state} | mine ${room.ice.local || '-'} | theirs ${room.ice.remote || '-'}${room.ice.path ? ' | via ' + room.ice.path : ''}` : '')
        + (err ? ` | error ${err}` : '')
      : '';
    $('lobby-loadout').textContent = `Your loadout: ${WEAPONS[g.saved.weapon].name} + ${ABILITIES[g.saved.ability].name}. Change it from the main menu.`;
  }

  toMenu() {
    if (this.g.online || this.g.state === 'lobby') this.g.leaveLobby();
    $('lobby').classList.remove('open');
    this.g.state = 'menu';
    for (const b of this.g.babos) b.root.visible = false;
    for (const o of this.overheads.values()) o.el.remove(); this.overheads.clear();
    $('result').classList.remove('open'); $('pause').classList.remove('open'); $('hud').classList.add('hidden');
    this.buildMenu(); $('menu').classList.add('open');
  }

  onStart() {
    $('lobby').classList.remove('open');
    $('menu').classList.remove('open'); $('result').classList.remove('open'); $('pause').classList.remove('open');
    $('hud').classList.remove('hidden'); $('feed').innerHTML = ''; $('dead').classList.remove('show');
    for (const o of this.overheads.values()) o.el.remove(); this.overheads.clear();
    for (const b of this.g.babos) {
      if (b.isPlayer) continue;
      const el = document.createElement('div'); el.className = 'oh';
      const mate = this.g.mode.teams && b.team === this.g.player.team;
      el.innerHTML = `<div class="oh-name${b.human ? ' human' : ''}" style="color:${hex(b.color)}">${mate ? '&#9679; ' : ''}${esc(b.name)}</div><div class="oh-bar"><div class="oh-fill${mate ? ' mate' : ''}"></div></div>`;
      $('overheads').appendChild(el);
      this.overheads.set(b.id, { el, fill: el.querySelector('.oh-fill') as HTMLElement });
    }
    $('hp-dot').style.background = hex(this.g.player.color);
    $('ab-name').textContent = ABILITIES[this.g.player.ability].name;
    $('hints').classList.remove('fade'); setTimeout(() => $('hints').classList.add('fade'), 15000);
    $('mode-tag').textContent = this.g.online ? `${this.g.mode.name} online` : '';
    this.pickWeapon(this.g.saved.weapon, true);
  }

  pickWeapon(w: WeaponId, silent = false) {
    this.g.pendingWeapon = w; this.g.saved.weapon = w; this.g.save();
    if (!silent) this.toast(this.g.player.weapon === w ? `${WEAPONS[w].name} equipped` : `${WEAPONS[w].name} on next respawn`);
  }

  togglePause() {
    this.g.paused = !this.g.paused;
    $('pause').classList.toggle('open', this.g.paused);
    if (!this.g.paused) this.g.audio.unlock();
  }

  showResult(ranked: Babo[], place: number, won: boolean) {
    const g = this.g;
    let title: string;
    if (g.mode.teams) { const ts = g.teamScores(); const mine = ts[g.player.team]; const theirs = Math.max(...Object.entries(ts).filter(([k]) => Number(k) !== g.player.team).map(([, v]) => v), 0); title = mine > theirs ? 'TEAM WINS!' : mine === theirs ? 'DRAW' : 'BOTS WIN'; $('result-sub').textContent = `Your team ${mine} : ${theirs} bots`; }
    else if (g.mode.id === 'duel') { const foe = g.babos.find(b => !b.isPlayer)!; title = won ? 'YOU WIN!' : p1(foe.name) + ' WINS'; $('result-sub').textContent = `${g.player.kills} : ${foe.kills}`; }
    else { title = won ? 'WINNER!' : `${ordinal(place)} PLACE`; $('result-sub').textContent = ''; }
    if (g.endReason) $('result-sub').textContent = g.endReason;
    $('result-title').textContent = title;
    $('result-title').className = won ? '' : 'lose';
    $('again').textContent = g.online ? 'BACK TO LOBBY' : 'PLAY AGAIN';
    $('to-menu').textContent = g.online ? 'LEAVE' : 'CHANGE LOADOUT';
    $('result-table').innerHTML = ranked.map((b, i) =>
      `<tr class="${b.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><i style="background:${hex(b.color)}"></i>${esc(this.g.nameOf(b))}</td><td>${b.kills}</td><td>${b.deaths}</td></tr>`).join('');
    setTimeout(() => $('result').classList.add('open'), 700);
  }

  // ---------- events ----------
  banner(text: string, small = false, dur = 1.3) {
    const el = $('banner'); el.textContent = text; el.className = 'show' + (small ? ' small' : ''); this.bannerT = dur;
  }
  toast(msg: string) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); this.toastT = 2.2; }
  hurt(k: number) { this.hurtV = Math.min(1, this.hurtV + k); }

  feed(killer: Babo | null, victim: Babo) {
    const d = document.createElement('div');
    const n = (b: Babo) => `<b style="color:${hex(b.color)}">${esc(this.g.nameOf(b))}</b>`;
    d.innerHTML = killer ? `${n(killer)} <span>popped</span> ${n(victim)}` : `${n(victim)} <span>popped themselves</span>`;
    if (killer?.isPlayer || victim.isPlayer) d.classList.add('me');
    const f = $('feed'); f.prepend(d);
    while (f.children.length > 5) f.lastChild!.remove();
    setTimeout(() => d.classList.add('fade'), 4500); setTimeout(() => d.remove(), 5200);
  }

  onPlayerDeath(killer: Babo | null) {
    this.deathKiller = killer ? killer.name : '';
    $('dead-by').innerHTML = killer ? `Popped by <b style="color:${hex(killer.color)}">${esc(this.g.nameOf(killer))}</b>` : 'Popped yourself';
    $('dead').classList.add('show');
  }

  floater(x: number, z: number, n: number) {
    const el = document.createElement('div'); el.className = 'floater'; el.textContent = String(n);
    $('floaters').appendChild(el);
    this.floaters.push({ el, x: x + (Math.random() - 0.5) * 0.6, z, t: 0 });
  }

  scoreboard(show: boolean) {
    $('board').classList.toggle('open', show);
    if (show) this.renderBoard();
  }
  private renderBoard() {
    const ranked = [...this.g.babos].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    $('board-table').innerHTML = ranked.map((b, i) =>
      `<tr class="${b.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><i style="background:${hex(b.color)}"></i>${esc(this.g.nameOf(b))}</td><td>${WEAPONS[b.weapon].name}</td><td>${b.kills}</td><td>${b.deaths}</td></tr>`).join('');
  }

  cursor(x: number, y: number) { const c = $('cross'); c.style.transform = `translate(${x}px, ${y}px)`; }

  stick(name: 'move' | 'aim', on: boolean, ox: number, oy: number, dx: number, dy: number) {
    const s = $(name === 'move' ? 'stick-move' : 'stick-aim');
    s.classList.toggle('on', on);
    if (on) { s.style.transform = `translate(${ox}px, ${oy}px)`; (s.firstElementChild as HTMLElement).style.transform = `translate(${dx}px, ${dy}px)`; }
  }

  // ---------- per frame ----------
  private perfT = 0;
  private lastUploads = 0;
  private updatePerf(dt: number) {
    if (!this.g.saved.perf) return;
    const g = this.g, st = g.stats;
    st.draw($('perf-graph') as HTMLCanvasElement);
    this.perfT -= dt; if (this.perfT > 0) return;
    this.perfT = 0.25;
    const s = st.summary(), r = g.r, f = r.flags, i = r.info;
    const up = g.arena.uploads - this.lastUploads; this.lastUploads = g.arena.uploads;
    const col = (fps: number) => fps >= 55 ? 'good' : fps >= 30 ? 'warn' : 'bad';
    const flags = [f.ao ? (QUALITY[r.quality].aoScale < 1 ? 'AO&frac12;' : 'AO') : null, f.bloom ? 'Bloom' : null, f.shadows ? 'Shadows' : null].filter(Boolean).join(' ') || 'no effects';
    $('perf-text').innerHTML =
      `<div class="big ${col(s.fps)}">${Math.round(s.fps)} <small>fps</small></div>` +
      `<div>1% low <b class="${col(s.low1)}">${Math.round(s.low1)}</b> &middot; worst ${s.worst.toFixed(0)} ms</div>` +
      `<div>frame ${s.avg.toFixed(1)} ms</div>` +
      `<div>CPU sim ${st.sim.toFixed(1)} &middot; draw ${st.render.toFixed(1)} &middot; ui ${st.hud.toFixed(1)}</div>` +
      `<div>GPU ${r.gpuMs >= 0 ? r.gpuMs.toFixed(1) + ' ms' : 'n/a in this browser'}</div>` +
      `<div>${i.calls} draws &middot; ${(i.triangles / 1000).toFixed(0)}k tris</div>` +
      `<div>${i.w}&times;${i.h} @${i.pr.toFixed(2)}x &middot; ${QUALITY[r.quality].label}${f.res < 1 ? ' ' + Math.round(f.res * 100) + '%' : ''}</div>` +
      `<div>${flags} &middot; paint ${up * 4}/s</div>`;
  }

  update(dt: number) {
    const g = this.g;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); }
    this.updatePerf(dt);
    if (g.state === 'lobby') { this.lobbyT -= dt; if (this.lobbyT <= 0) { this.lobbyT = 0.5; this.renderLobby(); } }
    if (g.state === 'menu' || g.state === 'lobby') return;
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) $('banner').classList.remove('show'); }
    const p = g.player;
    const cam = g.r.camera;

    // overheads
    for (const b of g.babos) {
      const o = this.overheads.get(b.id); if (!o) continue;
      if (!b.alive) { o.el.style.display = 'none'; continue; }
      this.v.set(b.x, 1.35 + b.y, b.z).project(cam);
      if (this.v.z > 1) { o.el.style.display = 'none'; continue; }
      o.el.style.display = '';
      o.el.style.transform = `translate(${((this.v.x + 1) / 2) * innerWidth}px, ${((1 - this.v.y) / 2) * innerHeight}px)`;
      o.fill.style.transform = `scaleX(${Math.max(0, Math.min(1.5, b.hp / BALL.hp)) / 1.0})`;
      o.fill.classList.toggle('over', b.hp > BALL.hp);
    }
    // floaters
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]; f.t += dt;
      if (f.t > 0.8) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      this.v.set(f.x, 1.3 + f.t * 1.6, f.z).project(cam);
      f.el.style.transform = `translate(${((this.v.x + 1) / 2) * innerWidth}px, ${((1 - this.v.y) / 2) * innerHeight}px) scale(${f.t < 0.1 ? 1.4 - f.t * 4 : 1})`;
      f.el.style.opacity = String(f.t > 0.5 ? (0.8 - f.t) / 0.3 : 1);
    }
    // hurt vignette
    this.hurtV = Math.max(0, this.hurtV - dt * 1.6);
    const low = p.alive && p.hp < 30 ? 0.35 + 0.15 * Math.sin(g.clock * 8) : 0;
    $('hurt').style.opacity = String(Math.max(this.hurtV, low));

    // player panel
    const hp = Math.max(0, Math.ceil(p.hp));
    $('hp-num').textContent = String(p.alive ? hp : 0);
    $('hp-fill').style.transform = `scaleX(${p.alive ? Math.min(1, p.hp / BALL.hp) : 0})`;
    $('hp-over').style.transform = `scaleX(${p.alive ? Math.max(0, (p.hp - BALL.hp) / 50) : 0})`;
    $('hp').classList.toggle('low', p.alive && p.hp < 30);
    const w = WEAPONS[p.weapon];
    const key = `${p.weapon}|${p.ammo}|${p.reloadT > 0}|${p.nades}`;
    if (key !== this.lastAmmoKey) {
      this.lastAmmoKey = key;
      $('wpn-name').textContent = w.name;
      const pips = $('ammo');
      if (w.clip <= 8) pips.innerHTML = Array.from({ length: w.clip }, (_, i) => `<i class="${i < p.ammo ? 'on' : ''}"></i>`).join('');
      else pips.innerHTML = `<div class="ammo-bar"><b style="transform:scaleX(${p.ammo / w.clip})"></b></div><span class="ammo-n">${p.ammo}</span>`;
      $('nades').innerHTML = Array.from({ length: GRENADE.max }, (_, i) => `<i class="${i < p.nades ? 'on' : ''}"></i>`).join('');
    }
    // ability
    const ad = ABILITIES[p.ability];
    const abReady = p.abCool <= 0;
    $('ab').classList.toggle('ready', abReady && p.alive); $('ab').classList.toggle('active', p.abT > 0);
    $('ab-cd').textContent = abReady ? 'ready' : Math.ceil(p.abCool) + 's';
    ($('ab') as HTMLElement).style.setProperty('--p', String(abReady ? 1 : 1 - p.abCool / ad.cooldown));
    if (abReady && !this.abWasReady && g.state === 'playing' && p.alive) g.audio.play('ready');
    this.abWasReady = abReady;
    $('reload').style.transform = `scaleX(${p.reloadT > 0 ? 1 - p.reloadT / w.reload : 0})`;
    $('wpn').classList.toggle('reloading', p.reloadT > 0);
    // crosshair reload ring
    $('cross').classList.toggle('reloading', p.reloadT > 0);
    ($('cross') as HTMLElement).style.setProperty('--r', String(p.reloadT > 0 ? 1 - p.reloadT / w.reload : 0));

    // death overlay
    if (!p.alive && g.state === 'playing') {
      $('dead-t').textContent = `Back in ${Math.max(0, p.respawnT).toFixed(1)}s`;
      $('dead-next').textContent = `Respawning with ${WEAPONS[g.pendingWeapon].name} + ${ABILITIES[g.pendingAbility].name}. Press 1 2 3 to switch gun.`;
    } else $('dead').classList.remove('show');

    // clock + race
    const t = Math.ceil(g.matchT); $('clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    $('clock').classList.toggle('hurry', g.matchT < 30 && g.state === 'playing');
    this.boardT -= dt;
    if (this.boardT <= 0) {
      this.boardT = 0.25;
      const ranked = [...g.babos].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      const place = ranked.indexOf(p) + 1;
      if (g.mode.teams) {
        const ts = g.teamScores(); const mine = ts[p.team] ?? 0;
        const theirs = Math.max(0, ...Object.entries(ts).filter(([k]) => Number(k) !== p.team).map(([, v]) => v));
        $('race').innerHTML = `<b>${mine}</b><span>: ${theirs} &middot; to ${g.mode.limit}</span>`;
      } else $('race').innerHTML = `<b>${p.kills}</b><span>/ ${g.mode.limit}</span><em>${ordinal(place)}</em>`;
      const top = ranked.slice(0, 4); if (!top.includes(p)) top[3] = p;
      $('mini').innerHTML = top.map(b => `<div class="${b.isPlayer ? 'me' : ''}"><i style="background:${hex(b.color)}"></i><span>${esc(this.g.nameOf(b))}</span><b>${b.kills}</b></div>`).join('');
      if ($('board').classList.contains('open')) this.renderBoard();
    }
    void this.deathKiller;
  }
}

export function ordinal(n: number) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

const p1 = (n: string) => n.toUpperCase();
