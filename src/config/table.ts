/** 모든 길이 단위는 미터. 9피트 국제 규격 테이블. */
export const TABLE = {
  /** 플레이 면(쿠션 노즈 기준) 반길이 / 반폭: 2.54m × 1.27m */
  halfL: 1.27,
  halfW: 0.635,
  ballRadius: 0.05715 / 2,
  ballMass: 0.17,
  /** 포켓 입구(jaw tip 사이 거리) */
  cornerMouth: 0.114,
  sideMouth: 0.127,
  /** jaw tip 의 둥근 끝 반지름 */
  jawTipRadius: 0.006,
  /** 쿠션 노즈 높이 / 공 지름 (63~64%) */
  cushionHeightRatio: 0.637,
  /** 쿠션 폭(노즈 → 레일 목재) 과 레일 목재 폭 */
  cushionWidth: 0.05,
  railWidth: 0.125,
  railHeight: 0.045,
  tableHeight: 0.8,
} as const;

export const BALL_D = TABLE.ballRadius * 2;
export const HEAD_X = -TABLE.halfL / 2; // head string
export const FOOT_X = TABLE.halfL / 2; // foot spot
