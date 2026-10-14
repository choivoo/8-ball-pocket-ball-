import { Game } from './game';
import { loadSettings } from './config/settings';

const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
const settings = loadSettings();
const q = new URLSearchParams(location.search).get('q');
if (q === 'low' || q === 'medium' || q === 'high') settings.quality = q;
const game = new Game(canvas, settings, document.getElementById('ui')!);
(window as any).game = game;
if (new URLSearchParams(location.search).has('norender')) game.view.skipRender = true;
let last = -1;
function frame(now: number) {
  const dt = last < 0 ? 0 : Math.max(0, (now - last) / 1000);
  last = now;
  try { game.update(dt); } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as any).__ready = true;
