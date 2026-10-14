import { GameView } from './rendering/view';
import { World } from './physics/world';
import { defaultPhysics, clonePhysics } from './config/physics';
import { EightBall } from './game-rules/eightBall';

const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
const q = (new URLSearchParams(location.search).get('q') as any) || 'medium';
const view = new GameView(canvas, q);
const world = new World(clonePhysics(defaultPhysics));
EightBall.setupRack(world, 1);
const cam = (new URLSearchParams(location.search).get('cam')) || 'aim';
view.rig.mode = cam as any;
view.rig.aimYaw = 0;
view.rig.setTargetPhys(world.balls[0].x, world.balls[0].y);
view.rig.snap();
view.syncBalls(world.balls, 0);
view.setCue({ visible: cam === 'aim', x: world.balls[0].x, y: 0, z: 0, angle: 0, elevation: 0.05, a: 0, b: 0, pull: 0.08 });
(window as any).__ready = false;
let n = 0;
function loop() {
  view.render(1 / 60);
  if (++n === 20) (window as any).__ready = true;
  requestAnimationFrame(loop);
}
loop();
