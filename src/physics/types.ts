export interface Ball {
  id: number; // 0 = cue, 1..7 solid, 8, 9..15 stripe
  x: number; y: number; z: number; // z = 정지 높이 기준 점프 높이
  vx: number; vy: number; vz: number;
  wx: number; wy: number; wz: number;
  qx: number; qy: number; qz: number; qw: number; // 방향 (렌더링용)
  pocketed: boolean;
  pocketIndex: number;
  pocketTime: number;
}

export type PhysEvent =
  | { type: 'cue'; speed: number; miscue: boolean; elevation: number }
  | { type: 'ballBall'; a: number; b: number; speed: number; x: number; y: number }
  | { type: 'cushion'; id: number; speed: number; x: number; y: number }
  | { type: 'jaw'; id: number; speed: number; x: number; y: number }
  | { type: 'pocket'; id: number; pocket: number; speed: number }
  | { type: 'land'; id: number; speed: number };

export interface Shot {
  angle: number; // 조준 방향 (rad, 테이블 평면)
  speed: number; // 큐 스피드 m/s
  a: number; // 좌우 타점 (공 반지름 단위, +는 오른쪽)
  b: number; // 상하 타점 (+는 위)
  elevation: number; // 큐 엘리베이션 (rad)
}

export interface BallSnapshot {
  balls: Ball[];
  time: number;
}

export function makeBall(id: number, x = 0, y = 0): Ball {
  return {
    id, x, y, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    qx: 0, qy: 0, qz: 0, qw: 1, pocketed: false, pocketIndex: -1, pocketTime: 0,
  };
}
