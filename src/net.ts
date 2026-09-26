// Online play over the artifact `room` capability.
//
// Everything travels in each player's *presence* object (sent ~30x/s, any
// signed-in viewer may set it), so no event-topic permissions are needed:
//   lobby fields   n (nickname), c (colour index), lob (in lobby), start (host's match offer)
//   match fields   s (snapshot of the entities this client simulates), h (host-only match state),
//                  ev (a rolling log of recent events with sequence numbers, so a dropped
//                  update is recovered by the next one)
//
// Authority model: every client simulates its own ball (and the host simulates the bots).
// The client that owns the *attacker* decides hits and sends them to the victim's owner,
// who applies the damage and reports deaths. The host keeps the score and the clock.

import type { ModeId } from './config';

export type NetEvent =
  | { k: 'hit'; v: number; a: number; d: number; x: number; z: number; y: number }
  | { k: 'die'; v: number; by: number }
  | { k: 'nade'; o: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  | { k: 'boom'; o: number; x: number; z: number; r: number; y?: number }
  | { k: 'pick'; i: number };

export interface StartOffer { e: number; mode: ModeId; seed: number; guest: string; roster: RosterEntry[]; diff: string; map?: string }
export interface RosterEntry { id: number; name: string; color: number; team: number; human: boolean; peer?: string }
export interface HostState { e: number; st: 'c' | 'p' | 'o'; t: number; k: number[]; d: number[]; g?: number[] }

export interface Peerish { peer: string; isMe: boolean; sameTab: boolean; presence: any; updatedAt: number }

type Listener = () => void;

export class Net {
  room: any = null;
  status: 'off' | 'connecting' | 'ready' | 'unavailable' = 'off';
  error = '';
  linked = false;   // room connection currently up
  me = '';
  peers: Peerish[] = [];
  private seq = 0;
  private log: { q: number; t: number; e: NetEvent }[] = [];
  private seen = new Map<string, number>();       // peer -> last processed event seq
  private offsets = new Map<string, number[]>();  // peer -> recent (localNow - senderTime) samples
  private onChange: Listener[] = [];
  onEvent: (from: string, e: NetEvent) => void = () => {};
  onSnapshot: (from: string, s: any, recvT: number, offset: number) => void = () => {};
  onHost: (from: string, h: HostState) => void = () => {};
  onLeft: (peer: string) => void = () => {};
  presenceBase: Record<string, unknown> = {};

  /** Connect over the artifact room capability, or over a provided room-shaped transport (PeerRoom). */
  async connect(provided?: any) {
    if (!provided && (this.status === 'ready' || this.status === 'connecting')) return this.status;
    this.reset();
    this.status = 'connecting'; this.emitChange();
    if (provided) this.room = provided;
    else try {
      const c = (window as any).claude;
      this.room = c?.use ? await c.use('room') : null;
    } catch { this.room = null; }
    if (!this.room) { this.status = 'unavailable'; this.error = (window as any).claude?.use ? 'room_null' : 'no_runtime'; this.emitChange(); return this.status; }
    try { this.room.onConnection((c: boolean) => { this.linked = c; this.emitChange(); }, (e: any) => { this.error = e.code; this.emitChange(); }); } catch { /* older runtime */ }
    const room = this.room;
    this.room.onPeers((ch: any) => {
      if (room !== this.room) return;
      this.deliveries++;
      this.peers = ch.peers as Peerish[];
      const mine = this.peers.find(p => p.sameTab); if (mine) this.me = mine.peer;
      for (const p of ch.left) { this.seen.delete(p.peer); this.offsets.delete(p.peer); this.onLeft(p.peer); }
      for (const p of [...ch.joined, ...ch.updated]) if (!p.sameTab) this.receive(p);
      this.emitChange();
    }, (e: any) => { this.error = e.code; if (e.code !== 'upstream_error') { this.status = 'unavailable'; this.emitChange(); } });
    this.status = 'ready'; this.emitChange();
    // Belt and braces: also read the synchronous peers() snapshot a few times a second,
    // in case change deliveries are sparse.
    this.pollId = window.setInterval(() => this.poll(), 250);
    return this.status;
  }

  private pollId = 0;
  reset() {
    if (this.pollId) clearInterval(this.pollId);
    this.pollId = 0; this.room = null; this.peers = []; this.me = ''; this.error = ''; this.linked = false;
    this.status = 'off'; this.deliveries = 0; this.lastSeenAt.clear(); this.seen.clear(); this.offsets.clear();
    this.presenceBase = {}; this.log = [];
  }

  deliveries = 0;
  private lastSeenAt = new Map<string, number>();
  private poll() {
    let list: Peerish[] = [];
    try { list = this.room.peers() as Peerish[]; } catch { return; }
    if (!Array.isArray(list)) return;
    const before = this.peers.length;
    if (list.length >= this.peers.length || list !== this.peers) this.peers = list;
    const mine = list.find(p => p.sameTab); if (mine) this.me = mine.peer;
    let changed = before !== list.length;
    for (const p of list) {
      if (p.sameTab) continue;
      if (this.lastSeenAt.get(p.peer) !== p.updatedAt) { this.lastSeenAt.set(p.peer, p.updatedAt); this.receive(p); changed = true; }
    }
    if (changed) this.emitChange();
  }

  debug() {
    let raw = -1; try { raw = this.room?.peers?.().length ?? -1; } catch { /* */ }
    let conn = '?'; try { conn = String(this.room?.connected?.()); } catch { /* */ }
    return `peers() ${raw} | updates ${this.deliveries} | me ${this.me ? this.me.slice(0, 6) : 'unset'} | connected() ${conn}`;
  }

  changed(fn: Listener) { this.onChange.push(fn); }
  private emitChange() { for (const f of this.onChange) f(); }

  // sameTab, not isMe: your own second tab is isMe too, and should count as a player
  others() { return this.peers.filter(p => !p.sameTab && (p as any).kind !== 'agent' && p.presence && p.presence.lob); }

  set(patch: Record<string, unknown>) {
    if (!this.room) return;
    Object.assign(this.presenceBase, patch);
    this.room.presence(patch).catch((e: any) => { this.error = e?.code || 'presence_failed'; this.emitChange(); });
  }

  send(e: NetEvent) {
    this.log.push({ q: ++this.seq, t: performance.now(), e });
  }

  /** Called ~20x/s during a match with this client's snapshot (and host state if hosting). */
  flush(snapshot: unknown, host: HostState | null) {
    if (!this.room) return;
    const now = performance.now();
    while (this.log.length && (now - this.log[0].t > 1500 || this.log.length > 36)) this.log.shift();
    const patch: Record<string, unknown> = { s: snapshot, ev: this.log.map(l => [l.q, l.e]) };
    if (host) patch.h = host;
    // stay under the 4 KiB presence budget: drop the oldest events if we must
    let json = JSON.stringify({ ...this.presenceBase, ...patch });
    while (json.length > 3900 && (patch.ev as unknown[]).length > 0) {
      (patch.ev as unknown[]).shift(); this.log.shift();
      json = JSON.stringify({ ...this.presenceBase, ...patch });
    }
    this.set(patch);
  }

  clearMatch() { this.log = []; this.seen.clear(); this.set({ s: null, ev: null, h: null }); }

  private receive(p: Peerish) {
    const pr = p.presence; if (!pr) return;
    const now = performance.now();
    if (pr.ev) {
      const last = this.seen.get(p.peer) ?? 0;
      let max = last;
      for (const [q, e] of pr.ev as [number, NetEvent][]) {
        if (q > last) { this.onEvent(p.peer, e); max = Math.max(max, q); }
      }
      // a restarted peer counts from 1 again
      const top = (pr.ev as [number][]).length ? (pr.ev as [number][])[pr.ev.length - 1][0] : 0;
      this.seen.set(p.peer, top < last - 50 ? top : max);
    }
    if (pr.h) this.onHost(p.peer, pr.h);
    if (pr.s && typeof pr.s.t === 'number') {
      const arr = this.offsets.get(p.peer) ?? [];
      arr.push(now - pr.s.t); if (arr.length > 40) arr.shift();
      this.offsets.set(p.peer, arr);
      // the smallest observed offset approximates the one-way delay plus clock difference
      this.onSnapshot(p.peer, pr.s, now, Math.min(...arr));
    }
  }

  resetSeen(peer: string) { this.seen.delete(peer); }
}
