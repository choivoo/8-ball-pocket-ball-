import { TABLE } from '../config/table';
import type { PhysicsConfig } from '../config/physics';
import { buildTable, nose, type TableGeometry } from './tableGeometry';
import { makeBall, type Ball, type PhysEvent } from './types';
import { Rng } from './rng';

const R = TABLE.ballRadius;
const M = TABLE.ballMass;
const I = 0.4 * M * R * R;
const D2 = 4 * R * R;
const EPS = 1e-9;

/**
 * 당구 전용 물리 월드. 렌더링과 무관하며 결정적이다.
 * 위치/선속도는 테이블 평면(x,y) + 점프용 z, 각속도는 3축 전부.
 * 이벤트 기반(충돌 시각 예측)으로 서브스텝 안에서도 터널링이 일어나지 않는다.
 */
export class World {
  balls: Ball[] = [];
  time = 0;
  geom: TableGeometry = buildTable();
  rng = new Rng(12345);
  listeners: ((e: PhysEvent) => void)[] = [];
  private acc = 0;
  private noseInfo;

  constructor(public cfg: PhysicsConfig) {
    this.noseInfo = nose(cfg);
    for (let i = 0; i < 16; i++) this.balls.push(makeBall(i));
  }

  /** 쿠션 높이 등 파생값 갱신 (설정 변경 후 호출) */
  refresh() {
    this.noseInfo = nose(this.cfg);
  }

  private emit(e: PhysEvent) {
    for (const l of this.listeners) l(e);
  }

  isMoving(): boolean {
    for (const b of this.balls) if (!b.pocketed && this.ballMoving(b)) return true;
    return false;
  }

  private ballMoving(b: Ball): boolean {
    return b.vx !== 0 || b.vy !== 0 || b.z > 0 || b.vz !== 0 || b.wx !== 0 || b.wy !== 0 || b.wz !== 0;
  }

  /** 렌더 프레임 시간을 받아 고정 서브스텝으로 진행. 소비한 서브스텝 수를 반환 */
  advance(realDt: number, timeScale = 1, maxSteps = 40): number {
    this.acc += Math.min(realDt, 0.1) * timeScale;
    const dt = this.cfg.dt;
    let n = 0;
    while (this.acc >= dt && n < maxSteps) {
      this.step(dt);
      this.acc -= dt;
      n++;
    }
    if (n >= maxSteps) this.acc = 0;
    return n;
  }

  step(dt: number) {
    let remaining = dt;
    for (let iter = 0; iter < 64 && remaining > 1e-12; iter++) {
      const hit = this.findEarliest(remaining);
      const t = hit ? hit.t : remaining;
      if (t > 0) this.integrate(t);
      remaining -= t;
      if (!hit) break;
      this.resolve(hit);
    }
    this.checkPockets();
    this.time += dt;
  }

  // ------------------------------------------------------------------ 충돌 탐색
  private findEarliest(maxT: number): Hit | null {
    let best: Hit | null = null;
    let bt = maxT;
    const bs = this.balls;
    const geom = this.geom;
    const { offset } = this.noseInfo;
    for (let i = 0; i < 16; i++) {
      const a = bs[i];
      if (a.pocketed) continue;
      const am = a.vx !== 0 || a.vy !== 0 || a.z > 0 || a.vz !== 0;
      // 공-공
      for (let j = i + 1; j < 16; j++) {
        const b = bs[j];
        if (b.pocketed) continue;
        const bm = b.vx !== 0 || b.vy !== 0 || b.z > 0 || b.vz !== 0;
        if (!am && !bm) continue;
        if (a.z > 0 || b.z > 0) continue; // 공중 공은 discrete 처리 (resolveAirborne)
        const dx = b.x - a.x, dy = b.y - a.y;
        const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
        const A = dvx * dvx + dvy * dvy;
        if (A < EPS) continue;
        const B = 2 * (dx * dvx + dy * dvy);
        if (B >= 0) continue; // 멀어지는 중
        const C = dx * dx + dy * dy - D2;
        let t: number;
        if (C <= 0) t = 0;
        else {
          const disc = B * B - 4 * A * C;
          if (disc < 0) continue;
          t = (-B - Math.sqrt(disc)) / (2 * A);
        }
        if (t < bt) { bt = t; best = { kind: 0, t, i, j }; }
      }
      if (!am || a.z > R * 0.45) continue;
      // 쿠션 선분
      for (let k = 0; k < geom.segments.length; k++) {
        const s = geom.segments[k];
        const vn = a.vx * s.nx + a.vy * s.ny;
        if (vn >= 0) continue;
        const d0 = (a.x - s.ax) * s.nx + (a.y - s.ay) * s.ny - offset;
        let t = d0 <= 0 ? 0 : d0 / -vn;
        if (t >= bt) continue;
        if (d0 < -0.02) continue; // 이미 벽 밖 (다른 요소가 처리)
        const px = a.x + a.vx * t - s.ax, py = a.y + a.vy * t - s.ay;
        const along = px * s.tx + py * s.ty;
        if (along < 0 || along > s.len) continue;
        bt = t; best = { kind: 1, t, i, j: k };
      }
      // jaw tip 원
      for (let k = 0; k < geom.circles.length; k++) {
        const c = geom.circles[k];
        const dx = c.cx - a.x, dy = c.cy - a.y;
        const A = a.vx * a.vx + a.vy * a.vy;
        const B = -2 * (dx * a.vx + dy * a.vy);
        if (B >= 0) continue;
        const rr = R + c.r;
        const C = dx * dx + dy * dy - rr * rr;
        let t: number;
        if (C <= 0) t = 0;
        else {
          const disc = B * B - 4 * A * C;
          if (disc < 0) continue;
          t = (-B - Math.sqrt(disc)) / (2 * A);
        }
        if (t < bt) { bt = t; best = { kind: 2, t, i, j: k }; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ 운동 적분
  private integrate(t: number) {
    const cfg = this.cfg;
    for (const b of this.balls) {
      if (b.pocketed) continue;
      if (b.vx === 0 && b.vy === 0 && b.z === 0 && b.vz === 0 && b.wx === 0 && b.wy === 0 && b.wz === 0) continue;
      this.moveBall(b, t, cfg);
    }
    // 공중 공의 discrete 충돌
    for (let i = 0; i < 16; i++) {
      const a = this.balls[i];
      if (a.pocketed) continue;
      for (let j = i + 1; j < 16; j++) {
        const b = this.balls[j];
        if (b.pocketed || (a.z <= 0 && b.z <= 0)) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = (b.z - a.z);
        if (dx * dx + dy * dy + dz * dz < D2) this.collideBalls(a, b);
      }
    }
  }

  private moveBall(b: Ball, t: number, cfg: PhysicsConfig) {
    const g = cfg.gravity;
    b.x += b.vx * t;
    b.y += b.vy * t;
    // 방향 적분
    const wm = Math.hypot(b.wx, b.wy, b.wz);
    if (wm > 0) rotateQuat(b, wm * t);

    if (b.z > 0 || b.vz > 0) {
      // 공중: 중력만 작용
      b.vz -= g * t;
      b.z += b.vz * t;
      if (b.z <= 0) {
        const vland = -b.vz;
        b.z = 0;
        if (vland > cfg.bounceThreshold) {
          b.vz = vland * cfg.restTable;
          this.emit({ type: 'land', id: b.id, speed: vland });
        } else b.vz = 0;
      }
      return;
    }

    let rem = t;
    const u0x = b.vx - R * b.wy, u0y = b.vy + R * b.wx;
    let us = Math.hypot(u0x, u0y);
    if (us > 1e-4) {
      // 슬라이딩: 접촉점 속도 u 는 일정 방향으로 선형 감소 (가속도 3.5 μ g)
      const rate = 3.5 * cfg.muSliding * g;
      const ts = us / rate;
      const tt = Math.min(rem, ts);
      const ax = -cfg.muSliding * g * u0x / us, ay = -cfg.muSliding * g * u0y / us;
      b.vx += ax * tt;
      b.vy += ay * tt;
      b.wx += 2.5 * ay * tt / R;
      b.wy -= 2.5 * ax * tt / R;
      rem -= tt;
      if (tt === ts) {
        // 정확히 구름 조건으로 정렬
        b.wy = b.vx / R;
        b.wx = -b.vy / R;
      }
    }
    if (rem > 0 && us <= 1e-4 || (rem > 0 && Math.hypot(b.vx - R * b.wy, b.vy + R * b.wx) <= 1e-4)) {
      // 구름
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const dec = (cfg.muRolling * g + cfg.rollingViscous * sp) * rem;
        if (dec >= sp || sp < cfg.stopSpeed) {
          b.vx = b.vy = 0;
          b.wx = b.wy = 0;
        } else {
          const k = (sp - dec) / sp;
          b.vx *= k; b.vy *= k;
          b.wy = b.vx / R; b.wx = -b.vy / R;
        }
      } else {
        b.wx = b.wy = 0;
      }
    }
    // 수직축 스핀 감쇠
    if (b.wz !== 0) {
      const d = cfg.spinDecel * t;
      b.wz = Math.abs(b.wz) <= d ? 0 : b.wz - Math.sign(b.wz) * d;
    }
  }

  // ------------------------------------------------------------------ 충돌 해결
  private resolve(h: Hit) {
    if (h.kind === 0) {
      const a = this.balls[h.i], b = this.balls[h.j];
      this.collideBalls(a, b);
    } else if (h.kind === 1) {
      const a = this.balls[h.i];
      const s = this.geom.segments[h.j];
      const { sinT, cosT } = this.noseInfo;
      const speed = this.cushionImpulse(a, -s.nx, -s.ny, sinT, cosT, false);
      if (speed > 0) this.emit({ type: 'cushion', id: a.id, speed, x: a.x, y: a.y });
    } else {
      const a = this.balls[h.i];
      const c = this.geom.circles[h.j];
      let nx = c.cx - a.x, ny = c.cy - a.y;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      const speed = this.cushionImpulse(a, nx, ny, 0, 1, true);
      if (speed > 0) this.emit({ type: 'jaw', id: a.id, speed, x: a.x, y: a.y });
    }
  }

  /** 공-공: 탄성 충돌 + 접촉점 마찰(throw) + 스핀 전달 */
  private collideBalls(a: Ball, b: Ball) {
    let nx = b.x - a.x, ny = b.y - a.y, nz = b.z - a.z;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz;
    if (vn <= 0) {
      this.separate(a, b, nx, ny);
      return;
    }
    const cfg = this.cfg;
    const Jn = M * (1 + cfg.restBallBall) * vn / 2;
    // 접촉점 속도 (a: +R n, b: -R n)
    const pax = a.vx + (a.wy * nz - a.wz * ny) * R, pay = a.vy + (a.wz * nx - a.wx * nz) * R, paz = a.vz + (a.wx * ny - a.wy * nx) * R;
    const pbx = b.vx - (b.wy * nz - b.wz * ny) * R, pby = b.vy - (b.wz * nx - b.wx * nz) * R, pbz = b.vz - (b.wx * ny - b.wy * nx) * R;
    let sx = pax - pbx, sy = pay - pby, sz = paz - pbz;
    const sn = sx * nx + sy * ny + sz * nz;
    sx -= sn * nx; sy -= sn * ny; sz -= sn * nz;
    const sm = Math.hypot(sx, sy, sz);
    // 법선 임펄스
    a.vx -= Jn * nx / M; a.vy -= Jn * ny / M; a.vz -= Jn * nz / M;
    b.vx += Jn * nx / M; b.vy += Jn * ny / M; b.vz += Jn * nz / M;
    if (sm > 1e-6) {
      const mu = cfg.muBallBallBase + cfg.muBallBallVar * Math.exp(-cfg.muBallBallDecay * sm);
      const Jt = Math.min(mu * Jn, sm * M / 7);
      const tx = sx / sm, ty = sy / sm, tz = sz / sm;
      // a 에 -t 방향, b 에 +t 방향
      a.vx -= Jt * tx / M; a.vy -= Jt * ty / M;
      b.vx += Jt * tx / M; b.vy += Jt * ty / M;
      if (a.z > 0) a.vz -= Jt * tz / M;
      if (b.z > 0) b.vz += Jt * tz / M;
      // 토크: ω += (r × F)/I ; r_a = R n, F_a = -Jt t ; r_b = -R n, F_b = +Jt t
      const cx = ny * tz - nz * ty, cy = nz * tx - nx * tz, cz = nx * ty - ny * tx;
      const k = R * Jt / I;
      a.wx -= k * cx; a.wy -= k * cy; a.wz -= k * cz;
      b.wx -= k * cx; b.wy -= k * cy; b.wz -= k * cz;
    }
    this.separate(a, b, nx, ny);
    if (a.z === 0) a.vz = 0;
    if (b.z === 0) b.vz = 0;
    this.emit({ type: 'ballBall', a: a.id, b: b.id, speed: vn, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }

  private separate(a: Ball, b: Ball, nx: number, ny: number) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const gap = 2 * R * 1.000001 - d;
    if (gap > 0 && d > 1e-9 && a.z === 0 && b.z === 0) {
      const ux = dx / d, uy = dy / d;
      a.x -= ux * gap / 2; a.y -= uy * gap / 2;
      b.x += ux * gap / 2; b.y += uy * gap / 2;
    }
  }

  /**
   * 쿠션/jaw 접촉. (wx,wy) = 벽 방향 단위벡터(공 → 벽).
   * 접촉점은 공 중심보다 높은 노즈 위(sinT>0)이므로 상하 스핀이 수평 반사에 영향을 준다.
   * 반환: 법선 접근 속도 (충돌 없으면 0)
   */
  private cushionImpulse(b: Ball, wx: number, wy: number, sinT: number, cosT: number, jaw: boolean): number {
    const cfg = this.cfg;
    const cx = wx * cosT, cy = wy * cosT, cz = sinT; // 접촉 법선 (공 → 접점)
    const rx = R * cx, ry = R * cy, rz = R * cz;
    // 접촉점 속도
    const vpx = b.vx + b.wy * rz - b.wz * ry;
    const vpy = b.vy + b.wz * rx - b.wx * rz;
    const vpz = b.vz + b.wx * ry - b.wy * rx;
    const vpn = vpx * cx + vpy * cy + vpz * cz;
    if (vpn <= 0) return 0;
    const e = jaw ? cfg.restJaw : Math.max(cfg.restCushionMin, cfg.restCushion0 - cfg.restCushionSlope * vpn);
    const mu = jaw ? cfg.muJaw : cfg.muCushion;
    const Jn = M * (1 + e) * vpn;
    let sx = vpx - vpn * cx, sy = vpy - vpn * cy, sz = vpz - vpn * cz;
    const sm = Math.hypot(sx, sy, sz);
    let Fx = -Jn * cx, Fy = -Jn * cy, Fz = -Jn * cz;
    if (sm > 1e-9) {
      const Jt = Math.min(mu * Jn, sm * 2 * M / 7);
      Fx -= Jt * sx / sm; Fy -= Jt * sy / sm; Fz -= Jt * sz / sm;
    }
    b.vx += Fx / M; b.vy += Fy / M;
    if (b.z > 0) b.vz += Fz / M;
    // 토크
    b.wx += (ry * Fz - rz * Fy) / I;
    b.wy += (rz * Fx - rx * Fz) / I;
    b.wz += (rx * Fy - ry * Fx) / I;
    return vpn;
  }

  private checkPockets() {
    const P = this.geom.pockets;
    for (const b of this.balls) {
      if (b.pocketed) continue;
      for (let k = 0; k < P.length; k++) {
        const p = P[k];
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < p.r && (b.z < R * 0.5)) {
          this.pocketBall(b, k);
          break;
        }
      }
      // 안전장치: 테이블 밖으로 나간 공은 가장 가까운 포켓으로
      if (!b.pocketed && (Math.abs(b.x) > TABLE.halfL + 0.06 || Math.abs(b.y) > TABLE.halfW + 0.06)) {
        let bk = 0, bd = 1e9;
        for (let k = 0; k < P.length; k++) {
          const d = Math.hypot(b.x - P[k].x, b.y - P[k].y);
          if (d < bd) { bd = d; bk = k; }
        }
        this.pocketBall(b, bk);
      }
    }
  }

  private pocketBall(b: Ball, k: number) {
    const sp = Math.hypot(b.vx, b.vy);
    b.pocketed = true;
    b.pocketIndex = k;
    b.pocketTime = this.time;
    this.emit({ type: 'pocket', id: b.id, pocket: k, speed: sp });
  }

  // ------------------------------------------------------------------ 큐 타격
  /**
   * 큐 타격 모델. 큐 축 방향 d 로 임펄스가 가해지고 접촉점 r 에서 선속도/각속도가 생긴다.
   * 큐팁 마찰 원뿔(μ_tip)을 벗어나면 miscue. 엘리베이션은 d 의 수직 성분으로 반영되어
   * 천 바운스(점프)와 swerve(수평 축 스핀 + 슬라이딩 마찰)를 자연스럽게 만든다.
   */
  strike(shot: { angle: number; speed: number; a: number; b: number; elevation: number }): { miscue: boolean; ballSpeed: number } {
    const cfg = this.cfg;
    const ball = this.balls[0];
    let a = shot.a, bb = shot.b;
    const rn = Math.hypot(a, bb);
    if (rn > 0.98) { a *= 0.98 / rn; bb *= 0.98 / rn; }
    const cs = Math.cos(shot.angle), sn = Math.sin(shot.angle);
    const th = shot.elevation;
    const s = Math.sqrt(Math.max(0, 1 - a * a - bb * bb));
    // 큐 축 방향 d (수평 f 를 elevation 만큼 아래로 기울임), 큐 축에 수직인 right / up' 프레임에서 타점을 정의
    const fx = cs, fy = sn, rx = sn, ry = -cs;
    const ce = Math.cos(th), se = Math.sin(th);
    const dx = fx * ce, dy = fy * ce, dz = -se;
    // up' = right × d
    const ux = ry * dz, uy = -rx * dz, uz = rx * dy - ry * dx;
    const px = R * (-s * dx + a * rx + bb * ux), py = R * (-s * dy + a * ry + bb * uy), pz = R * (-s * dz + bb * uz);
    // 접촉 법선 (공 안쪽) n = -p/R
    const ndot = -(px * dx + py * dy + pz * dz) / R;
    const tanG = ndot <= 0 ? 99 : Math.sqrt(Math.max(0, 1 - ndot * ndot)) / ndot;
    let miscue = tanG > cfg.muTip;
    let V = Math.min(shot.speed, cfg.maxCueSpeed * 1.4);
    let ang = shot.angle;
    if (miscue) {
      V *= 0.55;
      ang += this.rng.gauss() * 0.12 * Math.sign(a || 1);
    }
    const cs2 = Math.cos(ang), sn2 = Math.sin(ang);
    const d2x = cs2 * Math.cos(th), d2y = sn2 * Math.cos(th);
    // r × d
    const cxv = py * dz - pz * d2y, cyv = pz * d2x - px * dz, czv = px * d2y - py * d2x;
    const inv = 1 / cfg.cueMass + 1 / M + (cxv * cxv + cyv * cyv + czv * czv) / I;
    const J = (1 + cfg.cueRestitution) * V / inv;
    let vx = J * d2x / M, vy = J * d2y / M, vz = J * dz / M;
    ball.wx = (py * dz - pz * d2y) * J / I;
    ball.wy = (pz * d2x - px * dz) * J / I;
    ball.wz = (px * d2y - py * d2x) * J / I;
    // squirt: 큐 엔드매스로 인한 편향 (타점 반대쪽으로 공이 밀림)
    const mr = cfg.cueEndMass / M;
    const sq = Math.atan((a * mr) / (1 + mr + 2.5 * a * a)) * cfg.squirtScale * Math.cos(th);
    const cq = Math.cos(sq), sq2 = Math.sin(sq);
    const nvx = vx * cq - vy * sq2, nvy = vx * sq2 + vy * cq;
    vx = nvx; vy = nvy;
    ball.vx = vx; ball.vy = vy;
    // 천 바운스
    if (vz < 0) {
      const down = -vz;
      vz = down > cfg.bounceThreshold ? down * cfg.restTable : 0;
    }
    ball.vz = vz;
    if (vz > 0) ball.z = 1e-6;
    this.emit({ type: 'cue', speed: V, miscue, elevation: th });
    return { miscue, ballSpeed: Math.hypot(vx, vy) };
  }

  /** 정지 상태에서도 연출(포켓 낙하 등)용 시간을 흘려보낸다 */
  idle(dt: number) { this.time += dt; }

  // ------------------------------------------------------------------ 유틸
  /** 정지할 때까지 시뮬레이션 (테스트/AI 용). 시뮬레이션 시간(초) 반환 */
  settle(maxTime = 40, dt = this.cfg.dt): number {
    const t0 = this.time;
    while (this.isMoving() && this.time - t0 < maxTime) this.step(dt);
    return this.time - t0;
  }

  snapshot(): Ball[] {
    return this.balls.map((b) => ({ ...b }));
  }
  restore(s: Ball[]) {
    for (let i = 0; i < 16; i++) Object.assign(this.balls[i], s[i]);
  }
}

interface Hit { kind: 0 | 1 | 2; t: number; i: number; j: number }

function rotateQuat(b: Ball, ang: number) {
  const wm = Math.hypot(b.wx, b.wy, b.wz);
  const h = ang / 2, s = Math.sin(h) / wm;
  const dx = b.wx * s, dy = b.wy * s, dz = b.wz * s, dw = Math.cos(h);
  const x = b.qx, y = b.qy, z = b.qz, w = b.qw;
  let nx = dw * x + dx * w + dy * z - dz * y;
  let ny = dw * y - dx * z + dy * w + dz * x;
  let nz = dw * z + dx * y - dy * x + dz * w;
  let nw = dw * w - dx * x - dy * y - dz * z;
  const n = 1 / Math.hypot(nx, ny, nz, nw);
  b.qx = nx * n; b.qy = ny * n; b.qz = nz * n; b.qw = nw * n;
}
