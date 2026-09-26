// Best of both transports, behind the same room-shaped API.
//
//  1. WebRTC with Cloudflare's TURN servers. TURN is anycast, so each player relays through
//     their *nearest* Cloudflare data centre (Johannesburg / Cape Town for SA players), and
//     it runs over 443 like HTTPS, so strict firewalls let it through. Lowest latency.
//  2. The WebSocket relay (a Durable Object) as a fallback. Always works, but Durable Objects
//     don't run in Africa, so from SA it's a trip to Europe and back.
//
// The host listens on both at once; the guest tries WebRTC first and falls back after a few seconds.

import { PeerRoom } from './peerroom';
import { WsRoom } from './wsroom';

type Room = PeerRoom | WsRoom;
interface PeerEntry { peer: string; isMe: boolean; sameTab: boolean; kind: 'viewer'; guest: boolean; by: null; presence: any; updatedAt: number }
type Change = { peers: PeerEntry[]; joined: PeerEntry[]; left: PeerEntry[]; updated: PeerEntry[] };
type Err = { code: string; message: string };

const P2P_TIMEOUT_MS = 8000;

export class DuoRoom {
  role: 'host' | 'guest';
  code: string;
  error = '';
  private p2p: PeerRoom | null = null;
  private ws: WsRoom | null = null;
  private myPresence: Record<string, unknown> = {};
  private peerHandlers: ((c: Change) => void)[] = [];
  private connHandlers: ((c: boolean) => void)[] = [];
  private errHandlers: ((e: Err) => void)[] = [];
  private wasOpen = false;
  private destroyed = false;
  turn = false;          // TURN credentials were available
  mode: 'auto' | 'p2p' | 'ws';

  constructor(role: 'host' | 'guest', code: string, private relay: string, mode: 'auto' | 'p2p' | 'ws' = 'auto') {
    this.role = role; this.code = code; this.mode = mode;
    if (mode === 'ws') { this.startWs(); return; }
    this.startP2p();
    if (role === 'host' && mode === 'auto') this.startWs();
  }

  private async startP2p() {
    let servers: RTCIceServer[] | undefined;
    try {
      const r = await fetch(this.relay.replace(/^ws/, 'http').replace(/\/$/, '') + '/ice', { cache: 'no-store' });
      const j = await r.json(); servers = j.iceServers; this.turn = !!j.turn;
    } catch { /* fall back to PeerJS defaults */ }
    if (this.destroyed) return;
    const room = new PeerRoom(this.role, this.code, servers, this.role === 'guest' && this.mode === 'auto' ? P2P_TIMEOUT_MS : 15000);
    this.p2p = room;
    this.attach(room);
  }

  private startWs() {
    if (this.ws || this.destroyed) return;
    const room = new WsRoom(this.role, this.code, this.relay);
    this.ws = room;
    this.attach(room);
  }

  private attach(room: Room) {
    room.presence(this.myPresence);
    room.onPeers(ch => this.relayChange(ch), e => this.childError(room, e));
    room.onConnection(() => this.connChanged(), e => this.childError(room, e));
  }

  private childError(room: Room, e: Err) {
    // the guest's direct attempt failed: go through the relay instead
    if (room === this.p2p && this.role === 'guest' && this.mode === 'auto' && !this.ws) { this.startWs(); return; }
    // a clash on the invite code is worth reporting from either transport (the page picks a new code)
    const bothDown = (!this.p2p || !!this.p2p.error) && (!this.ws || !!this.ws.error);
    if (e.code === 'unavailable-id' || bothDown || this.mode !== 'auto') {
      this.error = e.code;
      for (const h of this.errHandlers) h(e);
    }
  }

  private others(room: Room | null) { return room ? room.peers().filter(p => !p.sameTab) as PeerEntry[] : []; }
  /** The transport currently carrying the friend, else the most promising one. */
  get active(): Room | null {
    if (this.p2p && this.others(this.p2p).length) return this.p2p;
    if (this.ws && this.others(this.ws).length) return this.ws;
    return this.role === 'guest' ? (this.ws ?? this.p2p) : (this.p2p ?? this.ws);
  }

  private meEntry(): PeerEntry {
    const base = this.active?.peers().find(p => p.sameTab) as PeerEntry | undefined;
    return { peer: base?.peer ?? 'me', isMe: true, sameTab: true, kind: 'viewer', guest: false, by: null, presence: this.myPresence, updatedAt: Date.now() };
  }

  private relayChange(ch: Change) {
    const strip = (l: PeerEntry[]) => l.filter(p => !p.sameTab);
    const out: Change = { peers: this.peers(), joined: strip(ch.joined), left: strip(ch.left), updated: strip(ch.updated) };
    for (const h of this.peerHandlers) h(out);
  }

  private connChanged() {
    const open = this.connected();
    if (open === this.wasOpen) return;
    this.wasOpen = open;
    for (const h of this.connHandlers) h(open);
  }

  // ---- lobby diagnostics ----
  get brokerOk() { return !!(this.p2p?.brokerOk || this.ws?.brokerOk); }
  get ice() {
    const a = this.active;
    if (!a) return { state: 'idle', local: '', remote: '', path: '' };
    if (a === this.ws) return { ...a.ice, path: `relay (Europe), ${this.ws!.rtt}ms round trip` };
    const i = a.ice;
    const via = /relay/.test(i.path) ? 'Cloudflare TURN' : 'direct';
    return { ...i, path: i.path ? `${via}: ${i.path}` : '' };
  }
  get link() { return `${location.origin}${location.pathname}#${this.code}`; }

  // ---- the room-shaped API Net uses ----
  presence(patch: Record<string, unknown>) {
    const p = { ...this.myPresence };
    for (const k in patch) { if (patch[k] === null) delete p[k]; else p[k] = patch[k]; }
    this.myPresence = p;
    this.p2p?.presence(patch); this.ws?.presence(patch);
    return Promise.resolve();
  }
  onPeers(h: (c: Change) => void, onErr?: (e: Err) => void) {
    this.peerHandlers.push(h); if (onErr) this.errHandlers.push(onErr);
    queueMicrotask(() => h({ peers: this.peers(), joined: this.peers(), left: [], updated: [] }));
    return () => {};
  }
  peers(): PeerEntry[] {
    const seen = new Set<string>(); const out: PeerEntry[] = [this.meEntry()];
    for (const p of [...this.others(this.p2p), ...this.others(this.ws)]) if (!seen.has(p.peer)) { seen.add(p.peer); out.push(p); }
    return out;
  }
  connected() { return !!(this.p2p?.connected() || this.ws?.connected()); }
  onConnection(h: (c: boolean) => void, onErr?: (e: Err) => void) {
    this.connHandlers.push(h); if (onErr) this.errHandlers.push(onErr);
    queueMicrotask(() => h(this.connected())); return () => {};
  }
  destroy() { this.destroyed = true; this.p2p?.destroy(); this.ws?.destroy(); }
}
