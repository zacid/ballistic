// Room transport over a WebSocket relay (relay/ in this repo, a Cloudflare Worker).
// Same shape as PeerRoom, so Net and the lobby don't care which one is in use.
// Every message goes browser -> nearest Cloudflare data centre -> the other browser,
// which works on any network that can open a website.

const KEEPALIVE_MS = 1000;

interface PeerEntry { peer: string; isMe: boolean; sameTab: boolean; kind: 'viewer'; guest: boolean; by: null; presence: any; updatedAt: number }
type Change = { peers: PeerEntry[]; joined: PeerEntry[]; left: PeerEntry[]; updated: PeerEntry[] };
type Err = { code: string; message: string };

export class WsRoom {
  role: 'host' | 'guest';
  code: string;
  error = '';
  brokerOk = false;
  ice = { state: 'idle', local: '', remote: '', path: '' };   // kept for the lobby's diagnostics line
  rtt = 0;
  private ws: WebSocket;
  private me: PeerEntry;
  private others = new Map<string, PeerEntry>();
  private peerHandlers: ((c: Change) => void)[] = [];
  private connHandlers: ((c: boolean) => void)[] = [];
  private errHandlers: ((e: Err) => void)[] = [];
  private pending: Change = { peers: [], joined: [], left: [], updated: [] };
  private scheduled = false;
  private sendTimer = 0;
  private open = false;
  private pingAt = 0;
  private timer: number;
  private closed = false;

  constructor(role: 'host' | 'guest', code: string, relay: string) {
    this.role = role; this.code = code;
    this.me = { peer: 'me', isMe: true, sameTab: true, kind: 'viewer', guest: false, by: null, presence: {}, updatedAt: Date.now() };
    const base = relay.replace(/^http/, 'ws').replace(/\/$/, '');
    this.ws = new WebSocket(`${base}/room/${code}?role=${role}`);
    this.ws.onopen = () => { this.brokerOk = true; this.ice.state = 'relay'; this.ws.send('hi'); };
    this.ws.onmessage = ev => this.onMessage(String(ev.data));
    this.ws.onclose = () => {
      this.brokerOk = false;
      if (!this.closed && !this.error) this.fail('socket-closed', 'Lost the connection to the relay.');
      for (const e of [...this.others.values()]) this.queue('left', e);
      this.others.clear(); this.setOpen(false);
    };
    this.ws.onerror = () => { if (!this.open && !this.error) this.fail('network', "Couldn't reach the relay."); };
    this.timer = window.setInterval(() => {
      if (this.ws.readyState !== WebSocket.OPEN) return;
      this.pingAt = performance.now(); this.ws.send('ping');
      if (this.others.size) this.sendNow();
    }, KEEPALIVE_MS);
  }

  get link() { return `${location.origin}${location.pathname}#${this.code}`; }

  private onMessage(s: string) {
    if (s === 'pong') { this.rtt = Math.round(performance.now() - this.pingAt); this.ice.path = `relay, ${this.rtt}ms round trip`; return; }
    let m: any; try { m = JSON.parse(s); } catch { return; }
    if (m.t === 'hello') {
      this.me = { ...this.me, peer: m.id };
      this.setOpen(true);
      this.queue('joined', this.me);
      for (const id of m.peers || []) this.upsert(id, {});
      this.sendNow();
    } else if (m.t === 'join') { this.upsert(m.id, {}); this.sendNow(); }
    else if (m.t === 'leave') { const e = this.others.get(m.id); if (e) { this.others.delete(m.id); this.queue('left', e); } }
    else if (m.t === 'refused') {
      const map: Record<string, [string, string]> = {
        'code-taken': ['unavailable-id', 'That code is in use.'],
        'no-host': ['peer-unavailable', 'That game is no longer open.'],
        full: ['room-full', 'That game already has two players.'],
      };
      const [code, msg] = map[m.why] || ['refused', 'The relay refused the connection.'];
      this.fail(code, msg);
      this.closed = true; try { this.ws.close(1000, 'refused'); } catch { /* */ }
    } else if (m.t === 'm' && m.d && m.d.t === 'p' && typeof m.d.p === 'object') this.upsert(m.f, m.d.p);
  }

  private upsert(id: string, presence: any) {
    const existed = this.others.has(id);
    const e = Object.freeze({ peer: id, isMe: false, sameTab: false, kind: 'viewer', guest: false, by: null, presence: Object.freeze(presence), updatedAt: Date.now() }) as PeerEntry;
    this.others.set(id, e);
    this.queue(existed ? 'updated' : 'joined', e);
  }

  private fail(code: string, message: string) {
    this.error = code;
    for (const h of this.errHandlers) h({ code, message });
  }

  private setOpen(v: boolean) { if (this.open === v) return; this.open = v; for (const h of this.connHandlers) h(v); }

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
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'p', p: this.me.presence }));
  }

  // ---- the room-shaped API Net uses ----
  presence(patch: Record<string, unknown>) {
    const p = { ...this.me.presence };
    for (const k in patch) { if (patch[k] === null) delete p[k]; else p[k] = patch[k]; }
    this.me = { ...this.me, presence: p, updatedAt: Date.now() };
    if (!this.sendTimer) this.sendTimer = window.setTimeout(() => { this.sendTimer = 0; this.sendNow(); }, 33);
    return Promise.resolve();
  }
  onPeers(h: (c: Change) => void, onErr?: (e: Err) => void) {
    this.peerHandlers.push(h); if (onErr) this.errHandlers.push(onErr);
    queueMicrotask(() => h({ peers: this.peers(), joined: this.peers(), left: [], updated: [] }));
    return () => {};
  }
  peers() { return [this.me, ...this.others.values()]; }
  connected() { return this.open; }
  onConnection(h: (c: boolean) => void, onErr?: (e: Err) => void) {
    this.connHandlers.push(h); if (onErr) this.errHandlers.push(onErr);
    queueMicrotask(() => h(this.open)); return () => {};
  }
  destroy() { this.closed = true; clearInterval(this.timer); try { this.ws.close(1000, 'bye'); } catch { /* already closed */ } }
}
