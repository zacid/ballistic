// Test double for the artifact `room` capability, over BroadcastChannel with fake latency.
(() => {
  const LAT = 70;
  const me = 'p' + Math.random().toString(36).slice(2, 10);
  const bc = new BroadcastChannel('mockroom');
  const peers = new Map(); // peer -> {peer, presence, updatedAt}
  let mine = { peer: me, isMe: true, sameTab: true, kind: 'viewer', guest: false, by: null, presence: {}, updatedAt: Date.now() };
  peers.set(me, mine);
  const handlers = [];
  let pendingJoined = [], pendingUpdated = [], pendingLeft = [], scheduled = false;
  const deliver = () => {
    scheduled = false;
    const snap = Object.freeze([...peers.values()]);
    const ch = { peers: snap, joined: pendingJoined, left: pendingLeft, updated: pendingUpdated };
    pendingJoined = []; pendingUpdated = []; pendingLeft = [];
    for (const h of handlers) h(ch);
  };
  const sched = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(deliver); } };
  bc.onmessage = (ev) => setTimeout(() => {
    const m = ev.data;
    if (m.type === 'hello') { bc.postMessage({ type: 'p', peer: me, presence: mine.presence }); return; }
    if (m.type === 'bye') { const p = peers.get(m.peer); if (p) { peers.delete(m.peer); pendingLeft.push(p); sched(); } return; }
    const existed = peers.has(m.peer);
    const p = { peer: m.peer, isMe: false, sameTab: false, kind: 'viewer', guest: false, by: null, presence: Object.freeze(m.presence), updatedAt: Date.now() };
    peers.set(m.peer, p);
    (existed ? pendingUpdated : pendingJoined).push(p); sched();
  }, LAT + Math.random() * 20);
  let sendScheduled = false;
  const room = {
    presence(patch) {
      const pr = { ...mine.presence };
      for (const k in patch) { if (patch[k] === null) delete pr[k]; else pr[k] = patch[k]; }
      mine = { ...mine, presence: pr, updatedAt: Date.now() }; peers.set(me, mine);
      if (!sendScheduled) { sendScheduled = true; setTimeout(() => { sendScheduled = false; bc.postMessage({ type: 'p', peer: me, presence: JSON.parse(JSON.stringify(mine.presence)) }); }, 33); }
      return Promise.resolve();
    },
    onPeers(h) { handlers.push(h); pendingJoined.push(mine); sched(); bc.postMessage({ type: 'hello' }); return () => {}; },
    peers() { return [...peers.values()]; },
    connected() { return true; },
    onConnection(h) { setTimeout(() => h(true)); return () => {}; },
    emit() { return Promise.resolve(); }, on() { return () => {}; },
  };
  addEventListener('beforeunload', () => bc.postMessage({ type: 'bye', peer: me }));
  window.__mockLeave = () => bc.postMessage({ type: 'bye', peer: me });
  window.claude = { use: async (name) => name === 'room' ? room : null };
})();
