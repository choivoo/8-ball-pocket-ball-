import * as THREE from 'three';
import { TABLE } from '../config/table';
import { buildTable, nose } from '../physics/tableGeometry';
import { defaultPhysics } from '../config/physics';
import { feltTextures, woodTexture, leatherNormal } from './textures';

const L = TABLE.halfL, W = TABLE.halfW;
const CW = TABLE.cushionWidth; // 쿠션 폭
const RW = 0.115; // 레일 목재 폭
const RH = TABLE.railHeight;
const HOLE_R = 0.088; // 포켓 구멍 반경

/** 포켓 구멍의 원 (중심, 반지름): 물리의 포켓 형상과 시각적으로 맞춘다 */
export function pocketHoles() {
  const g = buildTable();
  return g.pockets.map((p) => ({ x: p.x - p.ax * 0.005, y: p.y - p.ay * 0.005, r: p.corner ? HOLE_R - 0.004 : HOLE_R }));
}

/** 레일 안쪽 개구부: 직사각형 ∪ 포켓 원 (원점 기준 star-shaped → 극좌표 샘플) */
function openingPolygon(): THREE.Vector2[] {
  const holes = pocketHoles();
  const hx = L + CW, hy = W + CW;
  const pts: THREE.Vector2[] = [];
  const N = 1440;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const dx = Math.cos(th), dy = Math.sin(th);
    // 사각형 경계까지
    const tr = Math.min(Math.abs(dx) > 1e-9 ? hx / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-9 ? hy / Math.abs(dy) : 1e9);
    let r = tr;
    for (const h of holes) {
      // 광선-원 교차 (먼 쪽)
      const b = dx * h.x + dy * h.y;
      const c = h.x * h.x + h.y * h.y - h.r * h.r;
      const disc = b * b - c;
      if (disc > 0) {
        const t2 = b + Math.sqrt(disc);
        if (t2 > r) r = t2;
      }
    }
    pts.push(new THREE.Vector2(dx * r, dy * r));
  }
  return pts;
}

export interface TableParts {
  group: THREE.Group;
  cloth: THREE.Mesh;
  pocketCenters: THREE.Vector3[];
}

export function buildTableMesh(): TableParts {
  const group = new THREE.Group();
  const felt = feltTextures(8);
  const clothMat = new THREE.MeshStandardMaterial({ map: felt.map, normalMap: felt.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.96, metalness: 0 });
  const woodTex = woodTexture('#5b2e19', 3);
  const woodMat = new THREE.MeshPhysicalMaterial({ map: woodTex, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, color: 0xa88470 });
  const darkWood = new THREE.MeshStandardMaterial({ map: woodTexture('#33170c', 2), roughness: 0.55 });
  const holes = pocketHoles();

  // --- 천 (플레이 면). 포켓 구멍을 뚫는다.
  const clothShape = new THREE.Shape();
  const ex = L + CW + 0.01, ey = W + CW + 0.01;
  clothShape.moveTo(-ex, -ey); clothShape.lineTo(ex, -ey); clothShape.lineTo(ex, ey); clothShape.lineTo(-ex, ey); clothShape.closePath();
  for (const h of holes) {
    const p = new THREE.Path();
    p.absarc(h.x, h.y, h.r, 0, Math.PI * 2, true);
    clothShape.holes.push(p);
  }
  const clothGeo = new THREE.ShapeGeometry(clothShape, 24);
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.receiveShadow = true;
  group.add(cloth);

  // --- 쿠션 (고무 + 천)
  const phys = buildTable();
  const cushionMat = new THREE.MeshStandardMaterial({ map: felt.map, normalMap: felt.normal, color: 0xbfd8c4, roughness: 0.95 });
  const n = nose(defaultPhysics);
  const noseH = TABLE.cushionHeightRatio * 2 * TABLE.ballRadius;
  void n;
  const profile = new THREE.Shape();
  profile.moveTo(0.011, 0.0); profile.lineTo(0.0, noseH); profile.lineTo(0.003, noseH + 0.001);
  profile.lineTo(CW + 0.005, RH - 0.002); profile.lineTo(CW + 0.005, 0); profile.closePath();
  for (const s of phys.segments) {
    const geo = new THREE.ExtrudeGeometry(profile, { depth: s.len, bevelEnabled: false });
    // 로컬: x=바깥방향(−n), y=위, z=선분 진행방향
    const X = new THREE.Vector3(-s.nx, -s.ny, 0), Y = new THREE.Vector3(0, 0, 1);
    let Z = new THREE.Vector3().crossVectors(X, Y);
    const tdir = new THREE.Vector3(s.tx, s.ty, 0);
    const start = new THREE.Vector3(s.ax, s.ay, 0);
    if (Z.dot(tdir) < 0) { start.set(s.bx, s.by, 0); }
    const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(start);
    geo.applyMatrix4(m);
    const mesh = new THREE.Mesh(geo, cushionMat);
    mesh.castShadow = false; mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- 레일 (포켓 개구부를 가진 한 장의 목재 프레임)
  const outerX = L + CW + RW, outerY = W + CW + RW;
  const outer = new THREE.Shape();
  const rr = 0.07;
  outer.moveTo(-outerX + rr, -outerY); outer.lineTo(outerX - rr, -outerY); outer.quadraticCurveTo(outerX, -outerY, outerX, -outerY + rr);
  outer.lineTo(outerX, outerY - rr); outer.quadraticCurveTo(outerX, outerY, outerX - rr, outerY);
  outer.lineTo(-outerX + rr, outerY); outer.quadraticCurveTo(-outerX, outerY, -outerX, outerY - rr);
  outer.lineTo(-outerX, -outerY + rr); outer.quadraticCurveTo(-outerX, -outerY, -outerX + rr, -outerY);
  const opening = openingPolygon();
  const hole = new THREE.Path();
  hole.setFromPoints(opening.slice().reverse());
  outer.holes.push(hole);
  const railGeo = new THREE.ExtrudeGeometry(outer, { depth: RH + 0.16, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 10 });
  railGeo.translate(0, 0, -0.16);
  // UV 를 월드 좌표 기반으로 (나뭇결이 길게 흐르도록)
  const uv = railGeo.attributes.uv as THREE.BufferAttribute;
  const pos = railGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 1.4 + pos.getZ(i) * 2, pos.getY(i) / 0.5);
  const rail = new THREE.Mesh(railGeo, woodMat);
  rail.castShadow = true; rail.receiveShadow = true;
  group.add(rail);

  // --- 다이아몬드 (진주 인레이)
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xf2efe6, roughness: 0.25, metalness: 0.1, iridescence: 0.8, clearcoat: 1 });
  const dg = new THREE.BoxGeometry(0.014, 0.014, 0.002);
  const q = L / 4;
  const dpos: [number, number][] = [];
  for (const sx of [-3, -2, -1, 1, 2, 3]) for (const sy of [-1, 1]) dpos.push([sx * q, sy * (W + CW + RW * 0.5)]);
  for (const sy of [-1, 0, 1]) for (const sx of [-1, 1]) dpos.push([sx * (L + CW + RW * 0.5), sy * q]);
  for (const [x, y] of dpos) {
    const d = new THREE.Mesh(dg, pearl);
    d.position.set(x, y, RH + 0.0065);
    d.rotation.z = Math.PI / 4;
    group.add(d);
  }

  // --- 포켓: 가죽 망 + 컵 + 금속 링
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x1a0f0a, roughness: 0.75, normalMap: leatherNormal(), side: THREE.DoubleSide });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a4a, metalness: 1, roughness: 0.28 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9d9de, metalness: 1, roughness: 0.2 });
  const centers: THREE.Vector3[] = [];
  holes.forEach((h, i) => {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(h.r, h.r * 0.8, 0.14, 24, 1, true), leatherMat);
    cup.rotation.x = Math.PI / 2; cup.position.set(h.x, h.y, -0.07);
    group.add(cup);
    const net = new THREE.Mesh(new THREE.SphereGeometry(h.r * 0.8, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), leatherMat);
    net.rotation.x = Math.PI / 2; net.position.set(h.x, h.y, -0.14);
    net.scale.set(1, 1, 1.0);
    group.add(net);
    centers.push(new THREE.Vector3(h.x, h.y, 0));
    // 금속 링: 개구부 바깥쪽 호
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      const x = h.x + Math.cos(a) * (h.r + 0.003), y = h.y + Math.sin(a) * (h.r + 0.003);
      if (Math.abs(x) > L + CW + 0.002 || Math.abs(y) > W + CW + 0.002) pts.push(new THREE.Vector3(x, y, RH + 0.003));
      else if (pts.length > 1) { addArc(pts); pts.length = 0; }
    }
    if (pts.length > 1) addArc(pts);
    function addArc(p: THREE.Vector3[]) {
      const curve = new THREE.CatmullRomCurve3(p.slice());
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, p.length * 2, 0.0045, 8, false), i < 4 ? brass : chrome);
      tube.castShadow = true;
      group.add(tube);
    }
  });
  // 코너 금속 장식판
  const plateGeo = new THREE.BoxGeometry(0.09, 0.016, 0.003);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const pl = new THREE.Mesh(plateGeo, brass);
    pl.position.set(sx * (L + CW + RW * 0.62), sy * (W + CW + RW * 0.62), RH + 0.005);
    pl.rotation.z = Math.atan2(sy, sx) + Math.PI / 2 - (sx * sy > 0 ? 0 : Math.PI);
    pl.rotation.z = sx * sy > 0 ? Math.PI / 4 : -Math.PI / 4;
    group.add(pl);
  }

  // --- 캐비닛 / 다리
  const bodyH = 0.2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(outerX * 2 - 0.1, outerY * 2 - 0.1, bodyH), darkWood);
  body.position.z = -0.16 - bodyH / 2 + 0.002;
  body.castShadow = true;
  group.add(body);
  const legGeo = new THREE.BoxGeometry(0.16, 0.16, TABLE.tableHeight - 0.36);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, darkWood);
    leg.position.set(sx * (outerX - 0.2), sy * (outerY - 0.2), -0.36 - (TABLE.tableHeight - 0.36) / 2);
    leg.castShadow = true;
    group.add(leg);
  }
  // 헤드/풋 스팟
  const spotMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e0, transparent: true, opacity: 0.55 });
  for (const x of [-L / 2, L / 2]) {
    const s = new THREE.Mesh(new THREE.CircleGeometry(0.0045, 16), spotMat);
    s.position.set(x, 0, 0.0005);
    group.add(s);
  }
  return { group, cloth, pocketCenters: centers };
}
