import * as THREE from 'three';
import { TABLE } from '../config/table';
import { QUALITY, type QualityName, type Quality } from '../config/quality';
import { buildTableMesh, type TableParts } from './tableMesh';
import { BallViews } from './balls';
import { CueView } from './cue';
import { AimGuideView } from './aimGuide';
import { buildRoom, buildEnvironmentTexture } from './environment';
import { CameraRig } from './camera/cameraRig';
import { PostFX } from './postfx';
import type { Ball } from '../physics/types';

const R = TABLE.ballRadius;

export interface CueState {
  visible: boolean;
  x: number; y: number; z: number; // 큐볼 위치
  angle: number; elevation: number;
  a: number; b: number;
  pull: number; // 큐팁이 공 표면에서 떨어진 거리
}

export class GameView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  physRoot = new THREE.Group();
  table: TableParts;
  balls: BallViews;
  cue = new CueView();
  aim = new AimGuideView();
  rig: CameraRig;
  post!: PostFX;
  quality: Quality;
  spot!: THREE.SpotLight;
  private ghostBall: THREE.Mesh;
  private pocketXY: { x: number; y: number }[] = [];
  private envTex: THREE.Texture | null = null;
  room: THREE.Group;
  private raycaster = new THREE.Raycaster();

  constructor(public canvas: HTMLCanvasElement, qn: QualityName) {
    this.quality = QUALITY[qn];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.quality.composer, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    this.scene.background = new THREE.Color(0x0a0706);
    this.scene.fog = new THREE.Fog(0x0a0706, 5, 14);

    this.physRoot.rotation.x = -Math.PI / 2; // 물리 프레임(z-up) → 월드(y-up)
    this.scene.add(this.physRoot);
    this.table = buildTableMesh();
    this.physRoot.add(this.table.group);
    this.balls = new BallViews(this.quality.ballSegments);
    this.physRoot.add(this.balls.group);
    this.physRoot.add(this.cue.group);
    this.physRoot.add(this.aim.group);
    this.pocketXY = this.table.pocketCenters.map((c) => ({ x: c.x, y: c.y }));

    this.ghostBall = new THREE.Mesh(
      new THREE.SphereGeometry(R, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
    );
    this.ghostBall.visible = false;
    this.physRoot.add(this.ghostBall);

    this.room = buildRoom(false);
    this.scene.add(this.room);
    this.setupLights();
    this.envTex = buildEnvironmentTexture(this.renderer);
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.4;

    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    this.rig = new CameraRig(w / h);
    this.post = new PostFX(this.renderer, this.scene, this.rig.camera, this.quality, w, h);
    this.resize();
  }

  private setupLights() {
    const hemi = new THREE.HemisphereLight(0xffe9c8, 0x1a0f0a, 0.08);
    this.scene.add(hemi);
    const spot = new THREE.SpotLight(0xfff0d8, 9.5, 0, 0.95, 0.85, 2);
    spot.position.set(0, 1.55, 0);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.bias = -0.00015;
    spot.shadow.normalBias = 0.012;
    spot.shadow.radius = 4;
    spot.shadow.camera.near = 0.6;
    spot.shadow.camera.far = 3.2;
    this.scene.add(spot, spot.target);
    this.spot = spot;
    this.applyShadowQuality();
    for (const x of [-0.85, 0.85]) {
      const s = new THREE.SpotLight(0xffe3b8, 3.2, 0, 0.8, 0.9, 2);
      s.position.set(x, 1.5, 0); s.target.position.set(x * 0.5, 0, 0);
      this.scene.add(s, s.target);
    }
  }

  private applyShadowQuality() {
    this.spot.shadow.mapSize.set(this.quality.shadowMap, this.quality.shadowMap);
    this.spot.shadow.map?.dispose();
    this.spot.shadow.map = null;
  }

  setQuality(qn: QualityName) {
    this.quality = QUALITY[qn];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio));
    this.applyShadowQuality();
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.post.setQuality(this.quality, w, h);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / h);
    this.post.resize(w, h);
  }

  syncBalls(balls: Ball[], time: number) {
    this.balls.sync(balls, time, this.pocketXY);
  }

  setCue(c: CueState) {
    this.cue.group.visible = c.visible;
    if (!c.visible) return;
    const rn = Math.hypot(c.a, c.b);
    const k = rn > 0.98 ? 0.98 / rn : 1;
    const a = c.a * k, b = c.b * k;
    const s = Math.sqrt(Math.max(0, 1 - a * a - b * b));
    const cs = Math.cos(c.angle), sn = Math.sin(c.angle);
    const fx = cs, fy = sn, rx = sn, ry = -cs;
    const ce = Math.cos(c.elevation), se = Math.sin(c.elevation);
    const d = [fx * ce, fy * ce, -se];
    const ux = ry * d[2], uy = -rx * d[2], uz = rx * d[1] - ry * d[0]; // up' = right × d
    const px = R * (-s * d[0] + a * rx + b * ux), py = R * (-s * d[1] + a * ry + b * uy), pz = R * (-s * d[2] + b * uz);
    const gap = 0.004 + c.pull;
    this.cue.place(c.x + px - d[0] * gap, c.y + py - d[1] * gap, R + c.z + pz - d[2] * gap, c.angle, c.elevation);
  }

  setGhostBall(x: number | null, y = 0, valid = true) {
    if (x === null) { this.ghostBall.visible = false; return; }
    this.ghostBall.visible = true;
    this.ghostBall.position.set(x, y, R);
    (this.ghostBall.material as THREE.MeshBasicMaterial).color.set(valid ? 0xffffff : 0xff4444);
  }

  /** 화면 좌표 → 테이블 평면(물리 x,y) */
  pickTable(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return null;
    return { x: p.x, y: -p.z };
  }

  /** 물리 좌표 → 화면 픽셀 */
  project(x: number, y: number, z = R): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, z, -y).project(this.rig.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, visible: v.z < 1 };
  }

  skipRender = false;
  render(dt: number) {
    this.rig.update(dt);
    if (this.skipRender) return;
    (this.room.userData.lamps as THREE.Object3D).visible = this.rig.camera.position.y < 1.15;
    this.post.render(dt);
  }
}
