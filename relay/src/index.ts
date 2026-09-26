// Ballistic relay: a tiny WebSocket message relay on Cloudflare Workers.
//
//   wss://<worker>/room/<code>?role=host|guest
//
// Each room code maps to one Durable Object that holds at most one host and one guest
// and forwards every message from one to the other, tagged with the sender's id.
// Game logic stays in the browsers; this only moves bytes.

import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  // Cloudflare Realtime TURN key (Dashboard > Realtime > TURN). Set with `wrangler secret put`.
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Cache-Control': 'no-store' };

/** Short-lived TURN credentials so browsers can relay through their nearest Cloudflare data centre. */
async function iceServers(env: Env): Promise<Response> {
  const fallback = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }], turn: false };
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return Response.json(fallback, { headers: CORS });
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 6 * 3600 }),
  });
  if (!r.ok) return Response.json({ ...fallback, error: `turn api ${r.status}` }, { headers: CORS });
  const data = await r.json() as { iceServers: { urls: string | string[]; username?: string; credential?: string }[] };
  // browsers block port 53, and those URLs only slow ICE down
  for (const s of data.iceServers) if (Array.isArray(s.urls)) s.urls = s.urls.filter(u => !/:53\b/.test(u));
  return Response.json({ iceServers: data.iceServers, turn: true }, { headers: CORS });
}

const CODE = /^[a-z0-9]{6}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([a-z0-9]+)$/);
    if (url.pathname === '/' || url.pathname === '/health') return new Response('ballistic relay ok\n', { headers: CORS });
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/ice') return iceServers(env);
    if (!m || !CODE.test(m[1])) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    return stub.fetch(req);
  },
};

interface Tag { id: string; role: 'host' | 'guest'; joined: boolean }

export class Room extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const role = new URL(req.url).searchParams.get('role') === 'host' ? 'host' : 'guest';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), role, joined: false } satisfies Tag);
    // Nothing is sent from here: the page says "hi" once its socket is open, and we answer that.
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    const me = this.tag(ws); if (!me || typeof msg !== 'string' || msg.length > 16384) return;
    if (msg === 'ping') { this.safeSend(ws, 'pong'); return; }
    if (msg === 'hi') { this.join(ws, me); return; }
    if (!me.joined) return;
    const out = `{"t":"m","f":"${me.id}","d":${msg}}`;
    for (const other of this.members()) if (other !== ws) this.safeSend(other, out);
  }

  private join(ws: WebSocket, me: Tag) {
    if (me.joined) return;
    const others = this.members();
    const hasHost = others.some(o => this.tag(o)?.role === 'host');
    // explain and let the page hang up; closing here as well can drop the message
    const refuse = (why: string) => { this.safeSend(ws, JSON.stringify({ t: 'refused', why })); };
    if (me.role === 'host' && hasHost) return refuse('code-taken');
    if (me.role === 'guest' && !hasHost) return refuse('no-host');
    if (others.length >= 2) return refuse('full');
    ws.serializeAttachment({ ...me, joined: true } satisfies Tag);
    this.safeSend(ws, JSON.stringify({ t: 'hello', id: me.id, peers: others.map(o => this.tag(o)?.id).filter(Boolean) }));
    for (const o of others) this.safeSend(o, JSON.stringify({ t: 'join', id: me.id }));
  }

  webSocketClose(ws: WebSocket) { this.leave(ws); }
  webSocketError(ws: WebSocket) { this.leave(ws); }

  private members() { return this.ctx.getWebSockets().filter(ws => this.tag(ws)?.joined); }

  private leave(ws: WebSocket) {
    const me = this.tag(ws); if (!me) return;
    if (me.joined) for (const other of this.members()) if (other !== ws) this.safeSend(other, JSON.stringify({ t: 'leave', id: me.id }));
    ws.serializeAttachment({ ...me, joined: false });
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
  }

  private tag(ws: WebSocket): Tag | null { try { return ws.deserializeAttachment() as Tag; } catch { return null; } }
  private safeSend(ws: WebSocket, s: string) { try { ws.send(s); } catch { /* closing */ } }
}
