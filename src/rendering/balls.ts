import * as THREE from 'three';
import { TABLE } from '../config/table';
import { ballTexture, blobShadowTexture } from './textures';
import type { Ball } from '../physics/types';

const R = TABLE.ballRadius;

export class BallViews {
  meshes: THREE.Mesh[] = [];
  shadows: THREE.Mesh[] = [];
  group = new THREE.Group();
  private blobTex = blobShadowTexture();
  private hidden: boolean[] = [];

  constructor(segments: number) {
    const geo = new THREE.SphereGeometry(R, segments, Math.max(12, Math.floor(segments * 0.75)));
    // 구 텍스처 u 가 x축 기준으로 시작하도록 (번호가 적도에 오게)
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshPhysicalMaterial({
        map: ballTexture(i), roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
        specularIntensity: 1, ior: 1.5, envMapIntensity: 1.1,
      });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = false;
      // 구 지오메트리의 극(Y축)을 물리 z축으로 맞춘다: 부모(physics root)에서 z-up
      m.rotation.order = 'XYZ';
      this.meshes.push(m);
      const sh = new THREE.Mesh(
        new THREE.PlaneGeometry(R * 3.4, R * 3.4),
        new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
      );
      sh.renderOrder = 1;
      this.shadows.push(sh);
      this.group.add(m, sh);
      this.hidden.push(false);
    }
  }

  /** 물리 상태를 메시에 반영. `time` 은 포켓 낙하 연출용 시뮬레이션 시간 */
  sync(balls: Ball[], time: number, pockets: { x: number; y: number }[]) {
    const q = new THREE.Quaternion();
    // 구 지오메트리는 Y축이 극 → 물리 z축이 극이 되도록 X축 +90° 보정
    const fix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const b = balls[i], m = this.meshes[i], sh = this.shadows[i];
      if (b.pocketed) {
        const dt = time - b.pocketTime;
        const p = pockets[b.pocketIndex];
        if (dt > 1.2 || !p) { m.visible = false; sh.visible = false; continue; }
        m.visible = true;
        // 구멍 중심으로 빨려들며 낙하
        const k = Math.min(1, dt / 0.25);
        const x = b.x + (p.x - b.x) * k, y = b.y + (p.y - b.y) * k;
        const z = R - 0.5 * 9.8 * dt * dt * 0.6;
        m.position.set(x, y, Math.max(z, -0.4));
        sh.visible = false;
        if (z < -0.1) m.visible = dt < 0.5;
        continue;
      }
      m.visible = true; sh.visible = true;
      m.position.set(b.x, b.y, R + b.z);
      q.set(b.qx, b.qy, b.qz, b.qw);
      m.quaternion.copy(q).multiply(fix);
      sh.position.set(b.x, b.y, 0.0012 + i * 1e-5);
      const s = 1 - Math.min(0.5, b.z * 6);
      sh.scale.set(s, s, 1);
      (sh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - Math.min(0.7, b.z * 8));
    }
  }
}
