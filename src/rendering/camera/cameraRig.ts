import * as THREE from 'three';
import { TABLE } from '../../config/table';

export type CamMode = 'aim' | 'top' | 'follow' | 'closeup' | 'rail';

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 모든 카메라 이동은 감쇠 보간(exponential smoothing)으로 부드럽게 */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  mode: CamMode = 'aim';
  // 사용자 파라미터
  aimYaw = 0; // 물리 프레임 각도
  pitch = 0.42; // rad (수평 기준 위로)
  distance = 1.15;
  // 대상
  target = new THREE.Vector3(); // 월드 좌표 (물리 x, z, -y)
  followTarget = new THREE.Vector3();
  closeTarget = new THREE.Vector3();
  topTilt = 0;
  smoothing = 6;
  // 현재 값
  private yaw = 0;
  private pit = 0.42;
  private dist = 1.15;
  private cur = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private fovCur = 45;
  private up = new THREE.Vector3(0, 1, 0);
  private shake = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.03, 40);
    this.snap();
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  /** 물리 좌표 → 월드 */
  static toWorld(x: number, y: number, z = 0) {
    return new THREE.Vector3(x, z, -y);
  }

  setTargetPhys(x: number, y: number, z = TABLE.ballRadius) {
    this.target.set(x, z, -y);
  }

  clampUser() {
    this.pitch = Math.min(1.25, Math.max(0.06, this.pitch));
    this.distance = Math.min(3.2, Math.max(0.45, this.distance));
  }

  reduceMotion = false;
  kick(amount: number) { if (!this.reduceMotion) this.shake = Math.min(1, this.shake + amount); }

  snap() {
    this.yaw = this.aimYaw; this.pit = this.pitch; this.dist = this.distance;
    this.cur.copy(this.target);
    this.update(1 / 60, true);
  }

  private topDistance(): number {
    const halfW = TABLE.halfL + TABLE.cushionWidth + 0.14, halfH = TABLE.halfW + TABLE.cushionWidth + 0.14;
    const portrait = this.camera.aspect < 1;
    const vfov = (this.fovCur * Math.PI) / 180;
    const hh = Math.tan(vfov / 2);
    const needV = portrait ? halfW : halfH;
    const needH = portrait ? halfH : halfW;
    return Math.max(needV / hh, needH / (hh * this.camera.aspect)) + 0.2;
  }

  update(dt: number, instant = false) {
    const k = instant ? 1 : damp(this.smoothing, dt);
    let goalTarget = this.target, goalYaw = this.aimYaw, goalPit = this.pitch, goalDist = this.distance, goalFov = 45;
    switch (this.mode) {
      case 'top':
        goalTarget = new THREE.Vector3(0, 0, 0);
        goalPit = 1.5 - this.topTilt; goalDist = this.topDistance();
        goalYaw = this.camera.aspect < 1 ? 0 : Math.PI / 2;
        goalFov = 40;
        break;
      case 'follow':
        goalTarget = this.followTarget; goalPit = 0.75; goalDist = 1.5; goalYaw = this.yaw;
        break;
      case 'rail':
        // 레일 시점: 테이블 측면 낮은 위치에서 큐볼을 바라본다
        goalPit = 0.16; goalDist = 1.9; goalYaw = this.aimYaw + Math.PI / 2;
        break;
      case 'closeup':
        goalTarget = this.closeTarget; goalPit = 0.5; goalDist = 0.55; goalFov = 38;
        break;
      default:
        break;
    }
    this.cur.lerp(goalTarget, k);
    this.yaw += wrap(goalYaw - this.yaw) * k;
    this.pit += (goalPit - this.pit) * k;
    this.dist += (goalDist - this.dist) * k;
    this.fovCur += (goalFov - this.fovCur) * k;
    // 위치 계산: yaw 는 조준 방향. 카메라는 그 반대쪽(뒤)
    const dirx = Math.cos(this.yaw), dirz = -Math.sin(this.yaw);
    const cp = Math.cos(this.pit), sp = Math.sin(this.pit);
    this.pos.set(this.cur.x - dirx * this.dist * cp, this.cur.y + this.dist * sp, this.cur.z - dirz * this.dist * cp);
    // 탑뷰 시 up 벡터는 yaw 방향
    this.shake *= Math.exp(-9 * dt);
    const sx = (Math.random() - 0.5) * this.shake * 0.01, sy = (Math.random() - 0.5) * this.shake * 0.01;
    this.camera.position.copy(this.pos).add(new THREE.Vector3(sx, sy, 0));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.cur);
    if (Math.abs(this.camera.fov - this.fovCur) > 0.01) {
      this.camera.fov = this.fovCur;
      this.camera.updateProjectionMatrix();
    }
  }

  get currentPos() { return this.camera.position; }
}
