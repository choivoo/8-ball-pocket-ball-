import { TABLE } from '../config/table';
import type { PhysicsConfig } from '../config/physics';

/** 쿠션 선분: 공 중심이 지나갈 수 있는 한계선(노즈에서 R·cosθ 안쪽)이 아니라 노즈 선 자체를 저장한다. */
export interface Segment {
  ax: number; ay: number; bx: number; by: number;
  nx: number; ny: number; // 테이블 안쪽 법선
  tx: number; ty: number; // 단위 접선
  len: number;
}
export interface Circle { cx: number; cy: number; r: number; pocket: number }
export interface Pocket {
  x: number; y: number; // 캡처 원 중심
  r: number; // 캡처 반경
  mx: number; my: number; // 입구 중심
  ax: number; ay: number; // 바깥쪽 축
  corner: boolean;
}

export interface TableGeometry {
  segments: Segment[];
  circles: Circle[];
  pockets: Pocket[];
}

function seg(ax: number, ay: number, bx: number, by: number, nx: number, ny: number): Segment {
  const len = Math.hypot(bx - ax, by - ay);
  return { ax, ay, bx, by, nx, ny, tx: (bx - ax) / len, ty: (by - ay) / len, len };
}

export function buildTable(): TableGeometry {
  const L = TABLE.halfL, W = TABLE.halfW, rj = TABLE.jawTipRadius;
  const s = TABLE.cornerMouth / Math.SQRT2; // 코너 입구: 노즈 점 사이 거리 = s√2
  const sm = TABLE.sideMouth / 2 + rj;
  const cx = L - s - rj; // 긴 레일 코너쪽 끝
  const cy = W - s - rj; // 짧은 레일 코너쪽 끝
  const segments: Segment[] = [
    // 긴 레일 (y=±W) 좌우 두 구간씩
    seg(-cx, W, -sm, W, 0, -1), seg(sm, W, cx, W, 0, -1),
    seg(-cx, -W, -sm, -W, 0, 1), seg(sm, -W, cx, -W, 0, 1),
    // 짧은 레일 (x=±L)
    seg(L, -cy, L, cy, -1, 0), seg(-L, -cy, -L, cy, 1, 0),
  ];
  const circles: Circle[] = [];
  const pockets: Pocket[] = [];
  const addCorner = (sx: number, sy: number) => {
    const idx = pockets.length;
    const t1 = { x: sx * cx, y: sy * W };
    const t2 = { x: sx * L, y: sy * cy };
    circles.push({ cx: t1.x, cy: t1.y, r: rj, pocket: idx }, { cx: t2.x, cy: t2.y, r: rj, pocket: idx });
    // 입구 중심: 노즈 점(모서리쪽) 사이의 중점
    const mx = (sx * (L - s) + sx * L) / 2, my = (sy * W + sy * (W - s)) / 2;
    const ax = sx * Math.SQRT1_2, ay = sy * Math.SQRT1_2;
    pockets.push({ x: mx + ax * 0.025, y: my + ay * 0.025, r: 0.046, mx, my, ax, ay, corner: true });
  };
  addCorner(-1, -1); addCorner(1, -1); addCorner(1, 1); addCorner(-1, 1);
  const addSide = (sy: number) => {
    const idx = pockets.length;
    circles.push({ cx: -sm, cy: sy * W, r: rj, pocket: idx }, { cx: sm, cy: sy * W, r: rj, pocket: idx });
    pockets.push({ x: 0, y: sy * (W + 0.03), r: 0.055, mx: 0, my: sy * W, ax: 0, ay: sy, corner: false });
  };
  addSide(-1); addSide(1);
  return { segments, circles, pockets };
}

/** 쿠션 노즈 접촉각 θ: 노즈가 공 중심보다 위에 있는 정도 */
export function nose(cfg: PhysicsConfig) {
  const R = TABLE.ballRadius;
  const hc = cfg.cushionHeightRatio * R * 2 - R; // 노즈 접점의 중심 대비 높이
  const sinT = Math.max(0, Math.min(0.95, hc / R));
  const cosT = Math.sqrt(1 - sinT * sinT);
  return { sinT, cosT, offset: R * cosT };
}
