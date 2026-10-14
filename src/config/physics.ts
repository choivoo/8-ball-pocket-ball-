/** 튜닝 가능한 모든 물리 파라미터. lil-gui 가 이 객체를 직접 바인딩한다. */
export interface PhysicsConfig {
  gravity: number;
  /** 고정 서브스텝 (초) */
  dt: number;
  muSliding: number; // 천-공 슬라이딩 마찰
  muRolling: number; // 구름 저항
  rollingViscous: number; // 속도 비례 천 저항 (1/s)
  spinDecel: number; // 수직축(English) 스핀 감쇠 rad/s²
  restBallBall: number; // 공-공 반발계수
  muBallBallBase: number; // 공-공 throw 마찰 (Alciatore)
  muBallBallVar: number;
  muBallBallDecay: number;
  restCushion0: number; // 쿠션 반발계수 (저속)
  restCushionSlope: number; // 속도 증가에 따른 감소
  restCushionMin: number;
  muCushion: number; // 쿠션 접촉 마찰
  restJaw: number;
  muJaw: number;
  cushionHeightRatio: number;
  restTable: number; // 점프 시 천 바운스
  bounceThreshold: number;
  // 큐
  cueMass: number;
  cueEndMass: number; // squirt 계산용 엔드매스
  cueRestitution: number;
  muTip: number; // 큐팁 마찰 (miscue 한계)
  squirtScale: number;
  maxCueSpeed: number; // m/s
  stopSpeed: number; // 이 이하는 정지로 간주
}

export const defaultPhysics: PhysicsConfig = {
  gravity: 9.81,
  dt: 0.001,
  muSliding: 0.2,
  muRolling: 0.01,
  rollingViscous: 0.02,
  spinDecel: 12,
  restBallBall: 0.95,
  muBallBallBase: 0.01,
  muBallBallVar: 0.108,
  muBallBallDecay: 1.088,
  restCushion0: 0.88,
  restCushionSlope: 0.045,
  restCushionMin: 0.55,
  muCushion: 0.2,
  restJaw: 0.6,
  muJaw: 0.2,
  cushionHeightRatio: 0.637,
  restTable: 0.35,
  bounceThreshold: 0.25,
  cueMass: 0.54,
  cueEndMass: 0.03,
  cueRestitution: 0.8,
  muTip: 0.6,
  squirtScale: 1,
  maxCueSpeed: 7.5,
  stopSpeed: 0.0015,
};

export function clonePhysics(c: PhysicsConfig = defaultPhysics): PhysicsConfig {
  return { ...c };
}
