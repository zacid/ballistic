// Renders 12 s of the City rain ambience offline to a WAV (for listening) and reports its levels.
import { chromium } from 'playwright-core';
import fs from 'fs';
const outPath = process.argv[2] || 'rain.wav';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.goto('http://127.0.0.1:8766/'); await p.waitForTimeout(1200);
const b64 = await p.evaluate(async () => {
  const SR = 44100, T = 12, off = new OfflineAudioContext(2, SR * T, SR);
  const A = new (window.__game.audio.constructor)();
  const noise = off.createBuffer(1, SR, SR), d = noise.getChannelData(0); for (let i = 0; i < SR; i++) d[i] = Math.random() * 2 - 1;
  const master = off.createGain(); master.gain.value = 0.38 * 2.2; master.connect(off.destination);   // game master level, boosted for listening
  A.ctx = off; A.noiseBuf = noise; A.master = master;
  A.ambience('rain');
  const g = off.createGain(); g.connect(master);
  // the live game schedules these from a timer; offline we lay the same random drops out up front
  let t = 0.3; while (t < T) { A.drop(t, g); const rate = 6 + 3 * Math.sin(t * 0.13) + 2 * Math.sin(t * 0.041); t += -Math.log(1 - Math.random()) / rate; }
  const buf = await off.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length, out = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, SR, true); out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) for (const [k, ch] of [[0, L], [1, R]]) out.setInt16(44 + i * 4 + k * 2, Math.max(-1, Math.min(1, ch[i])) * 32767, true);
  let s = ''; const u8 = new Uint8Array(out.buffer); for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
  return btoa(s);
});
fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
await b.close();
