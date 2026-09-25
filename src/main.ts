import { Game } from './game';

function boot() {
  const g = new Game(document.getElementById('game') as HTMLCanvasElement);
  (window as any).__game = g;
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('loading')!.classList.add('done')));
}
const hot = (window as any).claude?.hot;
hot?.ready ? hot.ready(boot) : boot();
