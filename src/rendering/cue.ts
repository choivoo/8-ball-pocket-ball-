import * as THREE from 'three';
import { TABLE } from '../config/table';
import { woodTexture } from './textures';

const R = TABLE.ballRadius;

/** 큐 스틱. 팁이 원점, 몸통이 -X 방향. 물리 프레임(z-up) 안에서 사용 */
export class CueView {
  group = new THREE.Group();
  inner = new THREE.Group();
  length = 1.45;

  constructor() {
    const len = this.length;
    const tex = woodTexture('#d6a566', 1);
    const shaftMat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 });
    const buttMat = new THREE.MeshPhysicalMaterial({ map: woodTexture('#2c140b', 1), roughness: 0.28, clearcoat: 1 });
    const parts: [number, number, number, number, THREE.Material, number][] = [
      // [length, rTip, rBack, startX(from tip, positive back), material]
    ] as any;
    void parts;
    const seg = (l0: number, l1: number, r0: number, r1: number, mat: THREE.Material) => {
      const g = new THREE.CylinderGeometry(r1, r0, l1 - l0, 20, 1);
      const m = new THREE.Mesh(g, mat);
      m.rotation.z = Math.PI / 2; // 실린더 Y축 → X축
      m.position.x = -(l0 + l1) / 2;
      m.castShadow = true;
      this.inner.add(m);
    };
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x2b66a8, roughness: 0.9 });
    const ferrule = new THREE.MeshStandardMaterial({ color: 0xf3efe4, roughness: 0.4 });
    const ring = new THREE.MeshStandardMaterial({ color: 0xd8d8de, metalness: 1, roughness: 0.25 });
    seg(0, 0.012, 0.0065, 0.0065, tipMat);
    seg(0.012, 0.038, 0.0065, 0.0068, ferrule);
    seg(0.038, len * 0.62, 0.0068, 0.0115, shaftMat);
    seg(len * 0.62, len * 0.64, 0.0117, 0.0117, ring);
    seg(len * 0.64, len, 0.0125, 0.0145, buttMat);
    this.group.add(this.inner);
  }

  /** 팁 위치/방향 지정 (물리 프레임). tipPos = 팁 끝의 3D 좌표 */
  place(tipX: number, tipY: number, tipZ: number, yaw: number, elevation: number) {
    this.group.position.set(tipX, tipY, tipZ);
    this.group.rotation.set(0, elevation, yaw, 'ZYX');
  }
}

export { R as CUE_BALL_R };
