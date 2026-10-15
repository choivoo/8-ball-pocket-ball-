import * as THREE from 'three';
import { TABLE } from '../config/table';

const R = TABLE.ballRadius;

export interface AimInfo {
  /** 큐볼이 처음 닿는 지점(고스트볼 중심) 또는 쿠션 접촉점 */
  hit: { x: number; y: number };
  ballId: number | null;
  /** 적구 진행 방향 (단위) */
  objDir: { x: number; y: number } | null;
  /** 큐볼 접선(분리) 방향 */
  cueDir: { x: number; y: number } | null;
  /** 적구 중심 */
  obj: { x: number; y: number } | null;
}

/** 조준선 계산: 큐볼에서 angle 방향으로 쏴서 첫 접촉을 찾는다 (순수 기하) */
export function computeAim(balls: { id: number; x: number; y: number; pocketed: boolean }[], angle: number, cueId = 0): AimInfo {
  const cue = balls[cueId];
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let bestT = Infinity, bestId: number | null = null;
  for (const b of balls) {
    if (b.id === cueId || b.pocketed) continue;
    const rx = b.x - cue.x, ry = b.y - cue.y;
    const proj = rx * dx + ry * dy;
    if (proj <= 0) continue;
    const perp2 = rx * rx + ry * ry - proj * proj;
    const rr = 4 * R * R;
    if (perp2 > rr) continue;
    const t = proj - Math.sqrt(rr - perp2);
    if (t < bestT) { bestT = t; bestId = b.id; }
  }
  // 쿠션 (공 중심 한계)
  const lx = TABLE.halfL - R, ly = TABLE.halfW - R;
  let tw = Infinity;
  if (dx > 1e-9) tw = Math.min(tw, (lx - cue.x) / dx); else if (dx < -1e-9) tw = Math.min(tw, (-lx - cue.x) / dx);
  if (dy > 1e-9) tw = Math.min(tw, (ly - cue.y) / dy); else if (dy < -1e-9) tw = Math.min(tw, (-ly - cue.y) / dy);
  if (bestId === null || tw < bestT) {
    return { hit: { x: cue.x + dx * tw, y: cue.y + dy * tw }, ballId: null, objDir: null, cueDir: null, obj: null };
  }
  const gx = cue.x + dx * bestT, gy = cue.y + dy * bestT;
  const o = balls[bestId];
  let nx = o.x - gx, ny = o.y - gy;
  const l = Math.hypot(nx, ny) || 1;
  nx /= l; ny /= l;
  // 접선: 큐볼 진행방향에서 법선 성분 제거
  const dn = dx * nx + dy * ny;
  let tx = dx - dn * nx, ty = dy - dn * ny;
  const tl = Math.hypot(tx, ty);
  if (tl > 1e-6) { tx /= tl; ty /= tl; } else { tx = 0; ty = 0; }
  return { hit: { x: gx, y: gy }, ballId: bestId, objDir: { x: nx, y: ny }, cueDir: tl > 1e-6 ? { x: tx, y: ty } : null, obj: { x: o.x, y: o.y } };
}

export class AimGuideView {
  group = new THREE.Group();
  private path: THREE.Line;
  private objLine: THREE.Line;
  private cueLine: THREE.Line;
  private ghost: THREE.Mesh;
  private mk(color: number, dashed: boolean) {
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.02, gapSize: 0.014, transparent: true, opacity: 0.85, depthTest: false })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false });
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 0.001)]), mat);
    l.renderOrder = 5;
    this.group.add(l);
    return l;
  }
  constructor() {
    this.path = this.mk(0xffffff, true);
    this.objLine = this.mk(0xffe27a, false);
    this.cueLine = this.mk(0x9fd8ff, true);
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(R, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CircleGeometry(R, 40)), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
    edge.position.z = -R + 0.002;
    this.ghost.add(edge);
    this.group.add(this.ghost);
    this.group.visible = false;
  }
  private set(l: THREE.Line, a: [number, number], b: [number, number], z = 0.003) {
    l.geometry.setFromPoints([new THREE.Vector3(a[0], a[1], z), new THREE.Vector3(b[0], b[1], z)]);
    l.computeLineDistances();
  }
  /** level: 0 = 초보(고스트볼+경로), 1 = 중급(첫 충돌까지), 2 = 프로(없음) */
  update(cue: { x: number; y: number }, info: AimInfo, level: number) {
    if (level >= 2) { this.group.visible = false; return; }
    this.group.visible = true;
    this.set(this.path, [cue.x, cue.y], [info.hit.x, info.hit.y]);
    const show = info.ballId !== null;
    this.ghost.visible = show && level === 0;
    this.objLine.visible = show && level === 0;
    this.cueLine.visible = show && level === 0 && !!info.cueDir;
    if (show && info.obj && info.objDir) {
      this.ghost.position.set(info.hit.x, info.hit.y, R);
      this.set(this.objLine, [info.obj.x, info.obj.y], [info.obj.x + info.objDir.x * 0.5, info.obj.y + info.objDir.y * 0.5]);
      if (info.cueDir) this.set(this.cueLine, [info.hit.x, info.hit.y], [info.hit.x + info.cueDir.x * 0.25, info.hit.y + info.cueDir.y * 0.25]);
    } else if (level === 1) {
      this.ghost.visible = true;
      this.ghost.position.set(info.hit.x, info.hit.y, R);
    }
  }
  setColor(c: number) { (this.path.material as THREE.LineDashedMaterial).color.setHex(c); }
  hide() { this.group.visible = false; }
}
