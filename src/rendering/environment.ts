import * as THREE from 'three';
import { wallTexture } from './textures';
import { TABLE } from '../config/table';

/** 어둑한 당구장: 벽, 바 조명, 큐 걸이, 펜던트 램프. 월드 좌표(y-up), 테이블 천 높이 = y 0 */
export function buildRoom(withEmissive = true): THREE.Group {
  const g = new THREE.Group();
  const floorY = -TABLE.tableHeight;
  const wallTex = wallTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, color: 0x3a302c });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.75 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = floorY; floor.receiveShadow = true;
  g.add(floor);
  const H = 3.4;
  const mkWall = (w: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat);
    m.position.set(x, floorY + H / 2, z); m.rotation.y = ry;
    g.add(m);
  };
  mkWall(14, 0, -6, 0); mkWall(14, 0, 6, Math.PI); mkWall(12, -7, 0, Math.PI / 2); mkWall(12, 7, 0, -Math.PI / 2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), new THREE.MeshStandardMaterial({ color: 0x120d0b, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = floorY + H;
  g.add(ceil);

  // 펜던트 램프 3개
  const lamps = new THREE.Group();
  g.userData.lamps = lamps;
  g.add(lamps);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x103a22, roughness: 0.35, metalness: 0.6 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: withEmissive ? 14 : 1 });
  for (const x of [-0.85, 0, 0.85]) {
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.3, 0.18, 24, 1, true), lampMat);
    shade.material.side = THREE.DoubleSide;
    shade.position.set(x, 1.45, 0);
    lamps.add(shade);
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.01, 24), glow);
    bulb.position.set(x, 1.36, 0);
    lamps.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.3, 6), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    cord.position.set(x, 2.1, 0);
    lamps.add(cord);
  }
  // 바 조명 (벽을 따라 은은한 스트립)
  const strip = new THREE.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff7a1c, emissiveIntensity: withEmissive ? 3.5 : 0.5 });
  const strip2 = new THREE.MeshStandardMaterial({ color: 0x4aa0ff, emissive: 0x2a6cff, emissiveIntensity: withEmissive ? 2.5 : 0.4 });
  for (const [x, y, z, w, d, mat] of [
    [0, floorY + 2.4, -5.95, 10, 0.04, strip], [0, floorY + 1.0, -5.95, 10, 0.04, strip2],
    [-6.95, floorY + 2.4, 0, 0.04, 8, strip], [6.95, floorY + 2.4, 0, 0.04, 8, strip],
  ] as [number, number, number, number, number, THREE.Material][]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), mat);
    m.position.set(x, y, z);
    g.add(m);
  }
  // 바 카운터 + 술병 (흐릿한 배경 요소)
  const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1.0, 0.7), new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.5 }));
  counter.position.set(0, floorY + 0.5, -5.4);
  g.add(counter);
  const bottleMats = [0x2a7f46, 0x7a3b12, 0x1c5aa0, 0x9a2222].map((c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.1, transmission: 0.0, metalness: 0, clearcoat: 1 }));
  for (let i = 0; i < 16; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.3, 10), bottleMats[i % 4]);
    b.position.set(-2.4 + i * 0.32, floorY + 1.15, -5.5);
    g.add(b);
  }
  // 큐 걸이 (벽 우측)
  const rack = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 1.4), new THREE.MeshStandardMaterial({ color: 0x2a160c, roughness: 0.5 }));
  rack.position.set(6.9, floorY + 1.6, -1.2);
  g.add(rack);
  const cueMat = new THREE.MeshStandardMaterial({ color: 0xc89a5e, roughness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.013, 1.4, 8), cueMat);
    c.position.set(6.84, floorY + 1.6, -1.8 + i * 0.22);
    g.add(c);
  }
  return g;
}

export function buildEnvironmentTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07050a);
  scene.add(buildRoom(true));
  // 추가: 램프 반사를 위해 위쪽 대형 소프트박스
  const soft = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.3, 4.2) }));
  soft.rotation.x = Math.PI / 2; soft.position.set(0, 1.5, 0);
  scene.add(soft);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.02);
  pm.dispose();
  return rt.texture;
}
