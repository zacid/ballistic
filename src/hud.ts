import * as THREE from 'three';
import type { Game } from './game';
import type { Babo } from './babo';
import { ONLINE_URL, ABILITIES, AbilityId, BALL, COLORS, DIFFICULTY, Difficulty, GRENADE, LADDER, MAPS, MapChoice, ARENA_SIZES, ArenaSize, ModeId, MODES, PICKABLE, START_WEAPON, WEAPONS, WeaponId } from './config';
import { QUALITY, Quality } from './render';
import { buildGun } from './babo';
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
  private pingT = 0;
  private lobbyT = 0;

  constructor(private g: Game) {
    this.buildMenu();
    $('play').addEventListener('click', () => { this.g.audio.unlock(); this.g.startSolo(); });
    $('play-online').addEventListener('click', () => { this.g.audio.play('click'); this.g.openLobby(); });
    $('again').addEventListener('click', () => { this.g.audio.play('click'); this.g.rematch(); });
    $('to-lobby').addEventListener('click', () => this.g.backToLobby());
    $('to-menu').addEventListener('click', () => this.toMenu());
    $('lobby-back').addEventListener('click', () => { this.g.leaveLobby(); this.toMenu(); });
    for (const m of ['duel', 'coop', 'ggduel', 'waves'] as ModeId[]) $('lobby-' + m).addEventListener('click', () => { this.g.audio.play('click'); this.g.hostMatch(m); });
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
    $('tog-music').addEventListener('change', e => { const on = (e.target as HTMLInputElement).checked; this.g.saved.music = on; this.g.save(); this.g.audio.music.setEnabled(on); });
    // browsers only allow sound after a click or key press: start the menu music on the first one
    const wake = () => this.g.audio.unlock();
    addEventListener('pointerdown', wake, { once: true }); addEventListener('keydown', wake, { once: true });
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
    this.buildArsenal();
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
    this.segs(() => this.buildMenu());
    const ms = $('solo-seg'); ms.innerHTML = '';
    for (const m of ['solo', 'gungame', 'waves'] as const) {
      const b = document.createElement('button'); b.textContent = MODES[m].name;
      b.className = m === this.g.saved.soloMode ? 'on' : '';
      b.addEventListener('click', () => { this.g.audio.unlock(); this.g.audio.play('click'); this.g.saved.soloMode = m; this.g.save(); this.buildMenu(); });
      ms.appendChild(b);
    }
    const sm = this.g.saved.soloMode, gg = sm === 'gungame';
    $('tagline').textContent = gg ? 'Gun Game: every pop moves you up a weapon. Pop someone with spikes to win.'
      : sm === 'waves' ? `Hold the Fort: survive the waves from the keep.${this.g.saved.bestWave ? ` Best: wave ${this.g.saved.bestWave}.` : ''}`
      : `${['Four', 'Six', 'Eight'][[3, 5, 7].indexOf(this.g.saved.botCount)] ?? 'Eight'} toy balls, eight guns, one arena. First to 20 pops wins.`;
    $('cards-label').textContent = gg ? 'Gun Game hands these out in order, rockets first.' : 'Start with a pistol. Roll over a gun in the arena to grab it.';
    $('best').textContent = this.g.saved.best ? `Best finish: ${ordinal(this.g.saved.best)}` : '';
  }

  /** Compact gun strip: a rendered thumbnail per gun; hover or tap one for its details underneath. */
  private arsenalSel: WeaponId = START_WEAPON;
  private buildArsenal() {
    const cards = $('cards'); cards.innerHTML = '';
    const order: WeaponId[] = [START_WEAPON, ...PICKABLE.filter(w => w !== START_WEAPON && !WEAPONS[w].ammo), ...PICKABLE.filter(w => WEAPONS[w].ammo)];
    const thumbs = gunThumbs();
    for (const id of order) {
      const w = WEAPONS[id];
      const c = document.createElement('button');
      c.className = 'gun' + (id === this.arsenalSel ? ' sel' : ''); c.style.setProperty('--c', hex(w.color));
      const tag = id === START_WEAPON ? '<span class="tg start">START</span>' : w.ammo ? `<span class="tg power">POWER &middot; ${w.ammo}</span>` : '<span class="tg">PICK UP</span>';
      c.innerHTML = `<img alt="" src="${thumbs[id] ?? ''}"><span class="nm">${w.name}</span>${tag}`;
      c.setAttribute('aria-label', `${w.name}: ${w.blurb}`);
      const show = () => { this.arsenalSel = id; cards.querySelectorAll('.gun').forEach(e => e.classList.toggle('sel', e === c)); this.gunInfo(); };
      c.addEventListener('mouseenter', show); c.addEventListener('focus', show); c.addEventListener('click', show);
      cards.appendChild(c);
    }
    this.gunInfo();
  }
  private gunInfo() {
    const w = WEAPONS[this.arsenalSel];
    const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`;
    $('gun-info').innerHTML = `<div class="txt"><b style="color:${hex(w.color)}">${w.name}</b>${w.blurb}</div><div>${bar('POWER', w.stats.power)}${bar('RANGE', w.stats.range)}${bar('FIRE RATE', w.stats.rate)}</div>`;
  }

  /** Bot difficulty and arena pickers; the menu and the lobby both have a pair. */
  private segs(redraw: () => void) {
    for (const pre of ['', 'lobby-']) {
      const ds = $(pre + 'difficulty-seg'); ds.innerHTML = '';
      for (const d of Object.keys(DIFFICULTY) as Difficulty[]) {
        const b = document.createElement('button'); b.textContent = DIFFICULTY[d].label;
        if (d === 'adaptive') b.title = 'Hold the Fort sizes each wave to how well you played the last one';
        b.className = d === this.g.saved.difficulty ? 'on' : '';
        b.addEventListener('click', () => { this.g.audio.unlock(); this.g.audio.play('click'); this.g.saved.difficulty = d; this.g.save(); redraw(); });
        ds.appendChild(b);
      }
      // how many bots: solo Free-for-all / Gun Game in the menu, 2 vs bots in the lobby
      const key = pre ? 'coopBots' : 'botCount';
      const cs = $(pre + 'count-seg'); cs.innerHTML = '';
      cs.hidden = pre === '' && this.g.saved.soloMode === 'waves';
      for (const n of [3, 5, 7]) {
        const b = document.createElement('button'); b.textContent = `${n} bots`;
        b.title = pre ? `${n} bots in 2 vs bots` : `${n} bots in Free-for-all and Gun Game`;
        b.className = n === this.g.saved[key] ? 'on' : '';
        b.addEventListener('click', () => { this.g.audio.unlock(); this.g.audio.play('click'); this.g.saved[key] = n; this.g.save(); redraw(); });
        cs.appendChild(b);
      }
      // Hold the Fort always plays on the Fort, so the solo arena picker locks while it's chosen
      const locked = pre === '' && this.g.saved.soloMode === 'waves';
      const cur: MapChoice = locked ? 'fort' : this.g.saved.map;
      const as = $(pre + 'map-seg'); as.innerHTML = '';
      for (const m of Object.keys(MAPS) as MapChoice[]) {
        const b = document.createElement('button'); b.textContent = MAPS[m].name; b.title = locked ? 'Hold the Fort always plays on the Fort' : MAPS[m].blurb;
        b.className = m === cur ? 'on' : ''; b.disabled = locked;
        b.addEventListener('click', () => { this.g.audio.unlock(); this.g.audio.play('click'); this.g.saved.map = m; this.g.save(); redraw(); });
        as.appendChild(b);
      }
      const ss = $(pre + 'size-seg'); ss.innerHTML = '';
      ss.hidden = cur !== 'random';
      for (const z of Object.keys(ARENA_SIZES) as ArenaSize[]) {
        const b = document.createElement('button'); b.textContent = ARENA_SIZES[z].name;
        b.className = z === this.g.saved.arenaSize ? 'on' : '';
        b.addEventListener('click', () => { this.g.audio.unlock(); this.g.audio.play('click'); this.g.saved.arenaSize = z; this.g.save(); redraw(); });
        ss.appendChild(b);
      }
    }
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
    ($('tog-music') as HTMLInputElement).checked = this.g.saved.music !== false;
  }

  pickAbility(a: AbilityId, silent = true) {
    this.g.saved.ability = a; this.g.pendingAbility = a; this.g.save();
    if (!silent && this.g.player) this.toast(this.g.player.ability === a ? `${ABILITIES[a].name} ready` : `${ABILITIES[a].name} on next respawn`);
  }

  /** Compact gun + ability picker, used in the lobby and the pause menu. */
  renderKit(id: string) {
    const el = $(id); const g = this.g;
    const inMatch = g.state === 'countdown' || g.state === 'playing';
    void inMatch;
    el.innerHTML = `<div class="kit-row">${Object.values(ABILITIES).map(a => `<button data-a="${a.id}" class="${a.id === g.saved.ability ? 'on' : ''}">${a.name}<small>${a.cooldown}s</small></button>`).join('')}</div>`;
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      g.audio.play('click');
      const w = (b as HTMLElement).dataset.w as WeaponId | undefined, a = (b as HTMLElement).dataset.a as AbilityId | undefined;
      if (w) this.pickWeapon(w, !inMatch);
      if (a) this.pickAbility(a, !inMatch);
      if (g.online) g.net.set({ c: g.saved.color });
      this.renderKit(id);
    }));
  }

  // ---------- lobby ----------
  showLobby() {
    for (const id of ['menu', 'result', 'pause']) $(id).classList.remove('open');
    $('hud').classList.add('hidden');
    $('lobby').classList.add('open');
    this.renderKit('lobby-kit');
    const again = () => this.segs(again); again();
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
    for (const m of ['duel', 'coop', 'ggduel', 'waves'] as ModeId[]) ($('lobby-' + m) as HTMLButtonElement).disabled = !friends.length;
    $('lobby-diag').textContent = room
      ? `${room.role} | code ${room.code} | server ${room.brokerOk ? 'ok' : 'no'} | ${net.linked ? 'connected' : 'not connected'} | ${friends.length} in lobby`
        + (room.ice.state === 'relay' ? (room.ice.path ? ` | ${room.ice.path}` : '') : room.ice.path && room.ice.state.includes('connected') ? ` | ${room.ice.path}` : room.ice.state !== 'idle' ? ` | ICE ${room.ice.state} | mine ${room.ice.local || '-'} | theirs ${room.ice.remote || '-'}${room.ice.path ? ' | via ' + room.ice.path : ''}` : '')
        + (err ? ` | error ${err}` : '')
      : '';
    if (!$('lobby-kit').childElementCount) this.renderKit('lobby-kit');
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
  }

  pickWeapon(w: WeaponId, silent = false) {
    const g = this.g;
    if (g.mode?.gun && (g.state === 'countdown' || g.state === 'playing')) { if (!silent) this.toast('Gun Game picks your gun for you'); return; }
    this.g.pendingWeapon = w; this.g.saved.weapon = w; this.g.save();
    if (!silent && this.g.player) this.toast(this.g.player.weapon === w ? `${WEAPONS[w].name} equipped` : `${WEAPONS[w].name} on next respawn`);
  }

  togglePause() {
    this.g.paused = !this.g.paused;
    if (this.g.paused) {
      this.renderKit('pause-kit');
      $('pause-title').textContent = this.g.online ? 'MENU' : 'PAUSED';
      $('pause-note').textContent = this.g.online ? "The match keeps running while this is open. You're still in play!" : '';
    }
    $('pause').classList.toggle('open', this.g.paused);
    if (!this.g.paused) this.g.audio.unlock();
  }

  showResult(ranked: Babo[], place: number, won: boolean) {
    const g = this.g;
    let title: string;
    if (g.mode.waves) {
      const n = g.wv.n, best = g.saved.bestWave ?? n;
      title = won && !g.online ? `NEW BEST: WAVE ${n}` : 'THE FORT FELL';
      $('result-sub').textContent = `You held out to wave ${n}${g.online ? '' : ` · best ${best}`}`;
    }
    else if (g.mode.teams) { const ts = g.teamScores(); const mine = ts[g.player.team]; const theirs = Math.max(...Object.entries(ts).filter(([k]) => Number(k) !== g.player.team).map(([, v]) => v), 0); title = mine > theirs ? 'TEAM WINS!' : mine === theirs ? 'DRAW' : 'BOTS WIN'; $('result-sub').textContent = `Your team ${mine} : ${theirs} bots`; }
    else if (g.mode.gun) {
      const champ = ranked[0]?.won ? ranked[0] : null;
      title = won ? 'YOU WIN!' : p1(g.nameOf(ranked[0])) + ' WINS';
      $('result-sub').textContent = champ ? `${g.nameOf(champ)} popped someone with spikes` : 'Time up: highest level takes it';
    }
    else if (g.mode.id === 'duel') { const foe = g.babos.find(b => !b.isPlayer)!; title = won ? 'YOU WIN!' : p1(foe.name) + ' WINS'; $('result-sub').textContent = `${g.player.kills} : ${foe.kills}`; }
    else { title = won ? 'WINNER!' : `${ordinal(place)} PLACE`; $('result-sub').textContent = ''; }
    if (g.endReason && !g.mode.waves) $('result-sub').textContent = g.endReason;
    $('result-title').textContent = title;
    $('result-title').className = won ? '' : 'lose';
    $('again').textContent = g.online ? 'REMATCH' : 'PLAY AGAIN';
    $('to-lobby').hidden = !g.online;
    $('to-menu').textContent = g.online ? 'LEAVE' : 'MAIN MENU';
    $('result-mid').textContent = g.mode.gun ? 'LEVEL' : 'POPS';
    $('result-table').innerHTML = ranked.map((b, i) =>
      `<tr class="${b.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><i style="background:${hex(b.color)}"></i>${esc(this.g.nameOf(b))}</td><td>${g.mode.gun ? lvl(b) : b.kills}</td><td>${b.deaths}</td></tr>`).join('');
    setTimeout(() => $('result').classList.add('open'), 700);
  }

  // ---------- events ----------
  banner(text: string, small = false, dur = 1.3) {
    const el = $('banner'); el.textContent = text; el.className = 'show' + (small ? ' small' : ''); this.bannerT = dur;
  }
  toast(msg: string) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); this.toastT = 2.2; }
  hurt(k: number) { this.hurtV = Math.min(1, this.hurtV + k); }

  feed(killer: Babo | null, victim: Babo, knifed = false) {
    const d = document.createElement('div');
    const n = (b: Babo) => `<b style="color:${hex(b.color)}">${esc(this.g.nameOf(b))}</b>`;
    d.innerHTML = killer ? `${n(killer)} <span>${knifed ? 'SPIKED' : 'popped'}</span> ${n(victim)}` : `${n(victim)} <span>popped themselves</span>`;
    if (knifed) d.classList.add('spiked');
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
    const ranked = this.ranked();
    $('board-table').innerHTML = ranked.map((b, i) =>
      `<tr class="${b.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><i style="background:${hex(b.color)}"></i>${esc(this.g.nameOf(b))}</td><td>${this.g.mode.gun ? lvl(b) + ' ' : ''}${WEAPONS[b.weapon].name}</td><td>${b.kills}</td><td>${b.deaths}</td></tr>`).join('');
  }

  /** Threat bars for adaptive solo matches (same look as Hold the Fort's). */
  private ffaMeter() {
    const f = this.g.ffa; if (!f.active) return '';
    const th = f.threat();
    return `<span class="threat t${th}" title="How hard the bots go at you, sized to how you're playing">${'<b></b>'.repeat(th)}${'<i></i>'.repeat(5 - th)}</span>`;
  }

  private ranked() {
    const g = this.g;
    return g.mode?.gun
      ? [...g.babos].sort((a, b) => Number(b.won) - Number(a.won) || b.tier - a.tier || b.tierKills - a.tierKills || b.kills - a.kills)
      : [...g.babos].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
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
      o.fill.style.transform = `scaleX(${Math.max(0, Math.min(1.5, b.hp / b.maxHp))})`;
      o.fill.classList.toggle('over', b.hp > b.maxHp);
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
    const key = `${p.weapon}|${p.ammo}|${p.reloadT > 0}|${p.nades}|${p.reserve}`;
    if (key !== this.lastAmmoKey) {
      this.lastAmmoKey = key;
      $('wpn-name').textContent = w.name;
      const pips = $('ammo');
      if (w.kind === 'lob' || w.kind === 'melee' || w.kind === 'grav') pips.innerHTML = `<span class="ammo-n">&infin;</span>`;
      else if (w.clip <= 8) pips.innerHTML = Array.from({ length: w.clip }, (_, i) => `<i class="${i < p.ammo ? 'on' : ''}"></i>`).join('');
      else pips.innerHTML = `<div class="ammo-bar"><b style="transform:scaleX(${p.ammo / w.clip})"></b></div><span class="ammo-n">${p.ammo}</span>`;
      if (p.reserve >= 0) pips.insertAdjacentHTML('beforeend', `<span class="ammo-res">+${p.reserve}</span>`);
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
      const out = g.mode.waves && g.wv.out.has(p.id);
      $('dead-t').textContent = out ? (g.wv.breakT > 0 ? 'Back any second' : 'Out until the next wave') : `Back in ${Math.max(0, p.respawnT).toFixed(1)}s`;
      $('dead-next').textContent = `Respawning with ${g.mode.gun ? WEAPONS[LADDER[Math.min(p.tier, LADDER.length - 1)]].name : WEAPONS[START_WEAPON].name} + ${ABILITIES[g.pendingAbility].name}. P to change ability.`;
    } else $('dead').classList.remove('show');

    // ping to the other player (online only)
    this.pingT -= dt;
    if (this.pingT <= 0) {
      this.pingT = 0.5;
      const room: any = g.online ? g.peerRoom : null;
      const pingEl = $('ping');
      pingEl.hidden = !room || typeof room.ping !== 'number';
      if (room && typeof room.ping === 'number') {
        const ms = room.ping, kind = room.pathKind || '';
        pingEl.className = 'pill ' + (!ms ? '' : ms < 60 ? 'good' : ms < 120 ? 'warn' : 'bad');
        pingEl.innerHTML = `<b>${ms ? ms : '--'}</b><span>ms</span><em>${kind}</em>`;
        pingEl.title = kind === 'relay' ? 'Round trip to the relay server' : 'Round trip to your friend';
      }
    }

    // clock + race
    if (g.mode.waves) {
      const w = g.wv;
      $('clock').textContent = w.breakT > 0 ? (w.n ? `NEXT WAVE ${Math.ceil(w.breakT)}` : `GET READY ${Math.ceil(w.breakT)}`) : `WAVE ${w.n}`;
      $('clock').classList.toggle('hurry', w.boss >= 0);
    } else {
      const t = Math.ceil(g.matchT); $('clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      $('clock').classList.toggle('hurry', g.matchT < 30 && g.state === 'playing');
    }
    this.boardT -= dt;
    if (this.boardT <= 0) {
      this.boardT = 0.25;
      const ranked = this.ranked();
      const place = ranked.indexOf(p) + 1;
      if (g.mode.waves) {
        const w = g.wv, left = w.breakT > 0 ? 0 : w.queue + g.babos.filter(b => !b.human && b.alive).length;
        const hearts = w.lives <= 6 ? '&#9829;'.repeat(w.lives) || '<i>&#9829;</i>' : `&#9829;&times;${w.lives}`;
        const th = g.director.adaptive ? g.director.threat(Math.max(1, w.n)) : 0;
        const meter = th ? `<span class="threat t${th}" title="How hard the bots are pushing, sized to how you're playing">${'<b></b>'.repeat(th)}${'<i></i>'.repeat(5 - th)}</span>` : '';
        $('race').innerHTML = `<span class="lives">${hearts}</span>${meter}<span>${w.breakT > 0 ? (w.n ? 'wave clear' : 'get ready') : `${left} bot${left === 1 ? '' : 's'} left`}</span>${w.out.has(p.id) ? '<em>out</em>' : ''}`;
      } else if (g.mode.teams) {
        const ts = g.teamScores(); const mine = ts[p.team] ?? 0;
        const theirs = Math.max(0, ...Object.entries(ts).filter(([k]) => Number(k) !== p.team).map(([, v]) => v));
        $('race').innerHTML = `<b>${mine}</b><span>: ${theirs} &middot; to ${g.mode.limit}</span>`;
      } else if (g.mode.gun) {
        const per = g.mode.perTier ?? 1, last = p.tier >= LADDER.length - 1;
        const need = last ? 'spikes to win!' : per > 1 ? `${per - p.tierKills} to next` : '';
        $('race').innerHTML = this.ffaMeter() + `<b>L${Math.min(p.tier + 1, LADDER.length)}</b><span>/ ${LADDER.length} &middot; ${WEAPONS[LADDER[Math.min(p.tier, LADDER.length - 1)]].name}${need ? ' &middot; ' + need : ''}</span><em>${ordinal(place)}</em>`;
      } else $('race').innerHTML = this.ffaMeter() + `<b>${p.kills}</b><span>/ ${g.mode.limit}</span><em>${ordinal(place)}</em>`;
      const top = ranked.slice(0, 4); if (!top.includes(p)) top[3] = p;
      $('mini').innerHTML = top.map(b => `<div class="${b.isPlayer ? 'me' : ''}"><i style="background:${hex(b.color)}"></i><span>${esc(this.g.nameOf(b))}</span><b>${g.mode.gun ? lvl(b) : b.kills}</b></div>`).join('');
      if ($('board').classList.contains('open')) this.renderBoard();
    }
    void this.deathKiller;
  }
}

/** Render each gun model once into a small transparent picture for the menu. */
let thumbCache: Partial<Record<WeaponId, string>> | null = null;
function gunThumbs() {
  if (thumbCache) return thumbCache;
  thumbCache = {};
  try {
    const W = 192, H = 120;
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setSize(W, H, false); r.setPixelRatio(1); r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); scene.add(sun);
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
    cam.position.set(0.4, 1.1, 3.4); cam.lookAt(0, 0, 0);
    for (const id of PICKABLE) {
      const gun = buildGun(id, WEAPONS[id].color);
      gun.rotation.set(0.25, -Math.PI / 2 + 0.35, 0);
      const box = new THREE.Box3().setFromObject(gun), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const k = 2.3 / Math.max(size.x, size.y * 1.6, size.z, 0.01);
      gun.scale.setScalar(k); gun.position.set(-c.x * k, -c.y * k, -c.z * k);
      scene.add(gun); r.render(scene, cam); scene.remove(gun);
      thumbCache[id] = r.domElement.toDataURL('image/png');
    }
    r.dispose(); r.forceContextLoss();
  } catch { /* no WebGL for thumbnails: names still show */ }
  return thumbCache;
}

export function ordinal(n: number) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

const p1 = (n: string) => n.toUpperCase();
const lvl = (b: Babo) => b.won ? '&#9733;' : `L${b.tier + 1}`;
