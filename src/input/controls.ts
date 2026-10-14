import type { GameView } from '../rendering/view';
import type { Settings } from '../config/settings';

export interface AimState { angle: number; elevation: number; a: number; b: number }

const MAX_PULL = 0.4;

/**
 * 마우스/트랙패드/터치 입력.
 * - 드래그: 조준 회전 (Shift = 1/10 미세 조준), 세로 드래그 = 카메라 높이
 * - 우클릭 또는 Space 누른 채 마우스를 뒤로(아래) 당겼다 앞으로(위) 밀기 = 스트로크. 미는 속도 = 샷 파워
 * - 휠 = 줌, Alt+휠 / ↑↓ = 큐 엘리베이션, ←→ = 미세 조준
 * - 터치: 한 손가락 조준, 두 손가락 줌/피치, 파워 게이지는 UI 슬라이더
 */
export class Controls {
  aim: AimState = { angle: 0, elevation: 0, a: 0, b: 0 };
  enabled = false; // 조준 가능 (내 차례)
  placing = false; // 볼 인 핸드
  editing = false; // 연습: 공 드래그
  pull = 0; // 스트로크 중 큐 당김 거리 (m)
  stroking = false;
  onFire: (cueSpeed: number) => void = () => {};
  onPlaceMove: (x: number, y: number) => void = () => {};
  onPlaceClick: (x: number, y: number) => void = () => {};
  onEditPointer: (type: 'down' | 'move' | 'up', x: number, y: number) => boolean = () => false;
  onAimChanged: () => void = () => {};
  onToggleTop: () => void = () => {};
  onPause: () => void = () => {};
  onReplay: () => void = () => {};
  onConfirm: () => void = () => {};
  onUserInteract: () => void = () => {};

  private keys = new Set<string>();
  private samples: { t: number; s: number }[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private dragMoved = 0;
  private downPos = { x: 0, y: 0 };
  private rightDown = false;
  private spaceDown = false;
  private strokeMaxPull = 0;
  private editDragging = false;

  constructor(private canvas: HTMLCanvasElement, private view: GameView, private settings: () => Settings) {
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keyUp(e));
    window.addEventListener('blur', () => { this.keys.clear(); this.endStroke(true); });
  }

  get rig() { return this.view.rig; }

  // ------------------------------------------------------------ 포인터
  private down(e: PointerEvent) {
    this.onUserInteract();
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.downPos = { x: e.clientX, y: e.clientY };
    this.dragMoved = 0;
    if (this.pointers.size === 2) this.pinch = this.pinchDist();
    const p = this.view.pickTable(e.clientX, e.clientY);
    if (this.editing && p) {
      this.editDragging = this.onEditPointer('down', p.x, p.y);
      if (this.editDragging) return;
    }
    if (e.pointerType === 'mouse' && e.button === 2 && this.enabled && this.settings().control === 'stroke') {
      this.beginStroke();
      try { this.canvas.requestPointerLock?.(); } catch { /* ignore */ }
    }
  }

  private move(e: PointerEvent) {
    const prev = this.pointers.get(e.pointerId);
    if (this.placing) {
      const p = this.view.pickTable(e.clientX, e.clientY);
      if (p && (e.pointerType === 'mouse' || prev)) this.onPlaceMove(p.x, p.y);
    }
    if (this.editDragging) {
      const p = this.view.pickTable(e.clientX, e.clientY);
      if (p) this.onEditPointer('move', p.x, p.y);
      return;
    }
    if (this.stroking && (this.rightDown || this.spaceDown)) {
      const dy = e.pointerType === 'mouse' ? e.movementY : prev ? e.clientY - prev.y : 0;
      this.stroke(dy);
      if (prev) { prev.x = e.clientX; prev.y = e.clientY; }
      return;
    }
    if (!prev) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    prev.x = e.clientX; prev.y = e.clientY;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    if (this.pointers.size >= 2) {
      const d = this.pinchDist();
      if (this.pinch > 0) this.rig.distance *= this.pinch / d;
      this.pinch = d;
      this.rig.clampUser();
      return;
    }
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    if (this.placing && e.pointerType === 'touch') return; // 터치 배치 중엔 카메라 고정
    const fine = e.shiftKey ? 0.1 : 1;
    const sens = 0.0034 * this.settings().sensitivity * fine;
    if (this.enabled) {
      this.aim.angle -= dx * sens;
      this.onAimChanged();
    } else {
      this.rig.aimYaw -= dx * sens;
    }
    this.rig.pitch += dy * 0.004 * (e.shiftKey ? 0.3 : 1);
    this.rig.clampUser();
  }

  private up(e: PointerEvent) {
    const had = this.pointers.has(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = 0;
    if (this.editDragging) {
      const p = this.view.pickTable(e.clientX, e.clientY);
      this.onEditPointer('up', p?.x ?? 0, p?.y ?? 0);
      this.editDragging = false;
      return;
    }
    if (e.pointerType === 'mouse' && e.button === 2) { this.endStroke(false); if (document.pointerLockElement) document.exitPointerLock(); }
    if (had && this.placing && this.dragMoved < 6 && e.pointerType === 'mouse' && e.button === 0) {
      const p = this.view.pickTable(e.clientX, e.clientY);
      if (p) this.onPlaceClick(p.x, p.y);
    }
  }

  private pinchDist() {
    const a = [...this.pointers.values()];
    return a.length < 2 ? 0 : Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (e.altKey && this.enabled) {
      this.changeElevation(-Math.sign(e.deltaY) * 2);
      return;
    }
    this.rig.distance *= Math.exp(e.deltaY * 0.0012);
    this.rig.clampUser();
  }

  // ------------------------------------------------------------ 키보드
  private keyDown(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.onUserInteract();
    if (e.code === 'Space') {
      e.preventDefault();
      if (!this.spaceDown && this.enabled && this.settings().control === 'stroke') { this.spaceDown = true; this.beginStroke(); }
      return;
    }
    if (this.keys.has(e.code)) return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'Escape': this.onPause(); break;
      case 'KeyT': this.onToggleTop(); break;
      case 'KeyP': this.onReplay(); break;
      case 'Enter': this.onConfirm(); break;
      case 'KeyR': this.rig.pitch = 0.42; this.rig.distance = 1.15; break;
      case 'ArrowUp': case 'KeyW': this.changeElevation(2); break;
      case 'ArrowDown': case 'KeyS': this.changeElevation(-2); break;
    }
  }
  private keyUp(e: KeyboardEvent) {
    this.keys.delete(e.code);
    if (e.code === 'Space') { this.spaceDown = false; this.endStroke(false); }
  }

  changeElevation(deg: number) {
    this.aim.elevation = Math.max(0, Math.min((75 * Math.PI) / 180, this.aim.elevation + (deg * Math.PI) / 180));
    this.onAimChanged();
  }

  /** 키 반복: 좌우 미세 조준 */
  update(dt: number) {
    if (!this.enabled || this.stroking) return;
    const fine = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 0.1 : 1;
    let d = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) d += 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) d -= 1;
    if (d) {
      this.aim.angle += d * dt * 0.9 * fine * this.settings().sensitivity;
      this.onAimChanged();
    }
  }

  // ------------------------------------------------------------ 스트로크
  private beginStroke() {
    if (!this.enabled) return;
    this.stroking = true;
    this.rightDown = !this.spaceDown;
    this.pull = 0; this.strokeMaxPull = 0;
    this.samples = [{ t: performance.now(), s: 0 }];
  }

  private stroke(dyPx: number) {
    const now = performance.now();
    // 아래로 움직임 = 큐를 뒤로 당김
    this.pull = Math.max(0, Math.min(MAX_PULL, this.pull + dyPx * 0.0011));
    this.strokeMaxPull = Math.max(this.strokeMaxPull, this.pull);
    this.samples.push({ t: now, s: this.pull });
    while (this.samples.length > 2 && now - this.samples[0].t > 140) this.samples.shift();
    if (this.pull <= 0 && this.strokeMaxPull > 0.035 && dyPx < 0) {
      // 임팩트: 최근 구간의 평균 전진 속도 = 큐 스피드
      let ref = this.samples[0];
      for (const s of this.samples) if (now - s.t <= 70) { ref = s; break; }
      const dt = Math.max(0.008, (now - ref.t) / 1000);
      const vf = Math.max(0, (ref.s - 0) / dt);
      const V = Math.max(0.35, vf * 1.7);
      this.stroking = false; this.rightDown = false; this.spaceDown = false;
      const p = this.pull; this.pull = 0;
      void p;
      this.onFire(V);
    }
  }

  private endStroke(force: boolean) {
    if (!this.stroking && !force) return;
    this.stroking = false; this.rightDown = false;
    if (!force) this.spaceDown = false;
    this.pull = 0; // 취소: 큐가 원위치로
  }

  cancel() { this.endStroke(true); }
}
