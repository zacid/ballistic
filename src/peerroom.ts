// A drop-in stand-in for the artifact `room` capability, built on WebRTC via PeerJS.
// It exposes the same small surface Net uses (presence / onPeers / peers / connected /
// onConnection), so the game's netcode doesn't care which transport carries it.
//
// The host registers a short, guessable-only-if-shared id ("bllstc-<code>") with the free
// PeerJS broker; the guest opens the invite link (#code) and connects straight to it.
// After the handshake, traffic goes browser-to-browser.

import Peer, { DataConnection } from 'peerjs';

const PREFIX = 'bllstc-';
const SEND_MS = 33;        // ~30 updates a second, like the room capability
const KEEPALIVE_MS = 1000;
const TIMEOUT_MS = 6000;

interface PeerEntry { peer: string; isMe: boolean; sameTab: boolean; kind: 'viewer'; guest: boolean; by: null; presence: any; updatedAt: number }
type Change = { peers: PeerEntry[]; joined: PeerEntry[]; left: PeerEntry[]; updated: PeerEntry[] };

export function newCode() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export class PeerRoom {
  role: 'host' | 'guest';
  code: string;
  error = '';
  private peer: Peer;
  private conns = new Map<string, DataConnection>();
  private lastHeard = new Map<string, number>();
  private me: PeerEntry;
  private others = new Map<string, PeerEntry>();
  private peerHandlers: ((c: Change) => void)[] = [];
  private connHandlers: ((c: boolean) => void)[] = [];
  private errHandlers: ((e: { code: string; message: string }) => void)[] = [];
  private sendTimer = 0;
  private open = false;
  private pending: Change = { peers: [], joined: [], left: [], updated: [] };
  private scheduled = false;
  /** Connection diagnostics for the lobby: ICE state and which candidate types each side found. */
  ice = { state: 'idle', local: '', remote: '', path: '' };
  private dialT = 0;

  constructor(role: 'host' | 'guest', code: string) {
    this.role = role; this.code = code;
    this.me = { peer: 'me', isMe: true, sameTab: true, kind: 'viewer', guest: false, by: null, presence: {}, updatedAt: Date.now() };
    // tests can point at a local PeerJS server; real players use the free public broker
    const opts = (window as any).__PEER_OPTS || {};
    this.peer = role === 'host' ? new Peer(PREFIX + code, opts) : new Peer(opts);
    this.peer.on('open', id => {
      this.brokerOk = true;
      this.me = { ...this.me, peer: id };
      if (role === 'guest') this.dial();
      else this.setOpen(true);
      this.queue('joined', this.me);
    });
    this.peer.on('connection', c => {
      // one friend at a time: turn away extra guests politely
      if (this.role !== 'host' || this.conns.size >= 1) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 200); }); return; }
      this.wire(c);
    });
    this.peer.on('error', (e: any) => {
      const code = String(e?.type || 'error');
      // a reused code: tell the page so it can pick another one
      this.error = code;
      for (const h of this.errHandlers) h({ code, message: String(e?.message || code) });
      this.setOpen(false);
    });
    this.peer.on('disconnected', () => { this.brokerOk = false; if (!this.peer.destroyed) this.peer.reconnect(); });
    setInterval(() => this.keepalive(), KEEPALIVE_MS);
  }

  brokerOk = false;
  get link() { return `${location.origin}${location.pathname}#${this.code}`; }

  private dial() {
    const c = this.peer.connect(PREFIX + this.code, { serialization: 'json', reliable: false });
    this.wire(c);
    this.dialT = window.setTimeout(() => {
      if (this.conns.size) return;
      this.error = 'ice-timeout';
      for (const h of this.errHandlers) h({ code: 'ice-timeout', message: 'Could not open a direct connection.' });
    }, 15000);
  }

  /** Poll the underlying RTCPeerConnection so we can see where connecting gets stuck. */
  private watch(c: DataConnection) {
    const tick = async () => {
      const pc: RTCPeerConnection | undefined = (c as any).peerConnection;
      if (!pc) { this.ice.state = 'signalling'; return; }
      this.ice.state = `${pc.iceGatheringState === 'complete' ? '' : 'gathering, '}${pc.iceConnectionState}`;
      try {
        const stats = await pc.getStats();
        const loc: Record<string, number> = {}, rem: Record<string, number> = {};
        let pair = '';
        stats.forEach((r: any) => {
          if (r.type === 'local-candidate') loc[r.candidateType] = (loc[r.candidateType] || 0) + 1;
          if (r.type === 'remote-candidate') rem[r.candidateType] = (rem[r.candidateType] || 0) + 1;
          if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
            const l = stats.get(r.localCandidateId), rr = stats.get(r.remoteCandidateId);
            pair = `${l?.candidateType}/${l?.protocol} to ${rr?.candidateType}, ${Math.round((r.currentRoundTripTime || 0) * 1000)}ms`;
          }
        });
        const fmt = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k}${v}`).join(' ') || 'none';
        this.ice.local = fmt(loc); this.ice.remote = fmt(rem); this.ice.path = pair;
      } catch { /* stats unavailable */ }
    };
    const id = window.setInterval(() => { if (!c.open && this.ice.state.includes('failed')) { tick(); } tick(); }, 700);
    c.on('close', () => clearInterval(id));
  }

  private wire(c: DataConnection) {
    this.watch(c);
    c.on('open', () => {
      clearTimeout(this.dialT); if (this.error === 'ice-timeout') this.error = '';
      this.conns.set(c.peer, c); this.lastHeard.set(c.peer, Date.now());
      this.setOpen(true);
      this.sendNow();
    });
    c.on('data', (d: any) => {
      this.lastHeard.set(c.peer, Date.now());
      if (!d || typeof d !== 'object') return;
      if (d.t === 'full') { this.error = 'room-full'; for (const h of this.errHandlers) h({ code: 'room-full', message: 'That game already has two players.' }); return; }
      if (d.t !== 'p' || typeof d.p !== 'object') return;
      const existed = this.others.has(c.peer);
      const e: PeerEntry = Object.freeze({ peer: c.peer, isMe: false, sameTab: false, kind: 'viewer', guest: false, by: null, presence: Object.freeze(d.p), updatedAt: Date.now() }) as PeerEntry;
      this.others.set(c.peer, e);
      this.queue(existed ? 'updated' : 'joined', e);
    });
    c.on('close', () => this.drop(c.peer));
    c.on('error', () => this.drop(c.peer));
  }

  private drop(id: string) {
    const e = this.others.get(id);
    this.conns.delete(id); this.lastHeard.delete(id);
    if (e) { this.others.delete(id); this.queue('left', e); }
    if (this.role === 'guest') this.setOpen(false);
  }

  private keepalive() {
    const now = Date.now();
    for (const [id, t] of this.lastHeard) if (now - t > TIMEOUT_MS) { this.conns.get(id)?.close(); this.drop(id); }
    if (this.conns.size) this.sendNow();
  }

  private setOpen(v: boolean) {
    if (this.open === v) return;
    this.open = v; for (const h of this.connHandlers) h(v);
  }

  private queue(kind: 'joined' | 'updated' | 'left', e: PeerEntry) {
    this.pending[kind].push(e);
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      const ch = { ...this.pending, peers: this.peers() };
      this.pending = { peers: [], joined: [], left: [], updated: [] };
      for (const h of this.peerHandlers) h(ch);
    });
  }

  private sendNow() {
    const msg = { t: 'p', p: this.me.presence };
    for (const c of this.conns.values()) if (c.open) { try { c.send(msg); } catch { /* channel closing */ } }
  }

  // ---- the room-shaped API Net uses ----
  presence(patch: Record<string, unknown>) {
    const p = { ...this.me.presence };
    for (const k in patch) { if (patch[k] === null) delete p[k]; else p[k] = patch[k]; }
    this.me = { ...this.me, presence: p, updatedAt: Date.now() };
    if (!this.sendTimer) this.sendTimer = window.setTimeout(() => { this.sendTimer = 0; this.sendNow(); }, SEND_MS);
    return Promise.resolve();
  }
  onPeers(h: (c: Change) => void, onErr?: (e: { code: string; message: string }) => void) {
    this.peerHandlers.push(h); if (onErr) this.errHandlers.push(onErr);
    queueMicrotask(() => h({ peers: this.peers(), joined: this.peers(), left: [], updated: [] }));
    return () => {};
  }
  peers() { return [this.me, ...this.others.values()]; }
  connected() { return this.open; }
  onConnection(h: (c: boolean) => void, onErr?: (e: { code: string; message: string }) => void) {
    this.connHandlers.push(h); if (onErr) this.errHandlers.push(onErr);
    queueMicrotask(() => h(this.open)); return () => {};
  }
  destroy() { try { this.peer.destroy(); } catch { /* already gone */ } }
}
