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

// 그래픽 컨텍스트가 끊기면 안내 후 복구
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  game.ui.showInfo('그래픽 연결이 끊겼습니다', '기기의 그래픽 메모리가 부족해 연결이 끊어졌습니다. 새로고침하면 복구됩니다.', '새로고침', () => location.reload());
});
canvas.addEventListener('webglcontextrestored', () => location.reload());
window.addEventListener('error', (e) => console.error('[error]', e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[unhandled]', e.reason));
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
