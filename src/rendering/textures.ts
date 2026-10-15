import * as THREE from 'three';
import { Rng } from '../physics/rng';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/** 값 노이즈 높이맵 → 노멀맵 */
function heightToNormal(h: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const n = Math.hypot(nx, ny, nz);
      nx /= n; ny /= n; nz /= n;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function feltTextures(repeat = 5, rgb: [number, number, number] = [14, 92, 52]) {
  const size = 512;
  const rng = new Rng(7);
  const h = new Float32Array(size * size);
  // 울 펠트: 짧은 섬유 + 미세 노이즈
  for (let i = 0; i < size * size; i++) h[i] = rng.next() * 0.6;
  for (let k = 0; k < 9000; k++) {
    let x = rng.next() * size, y = rng.next() * size;
    const a = rng.next() * Math.PI * 2, len = 3 + rng.next() * 8;
    for (let s = 0; s < len; s++) {
      const ix = Math.floor(x + size) % size, iy = Math.floor(y + size) % size;
      h[iy * size + ix] += 0.35;
      x += Math.cos(a); y += Math.sin(a);
    }
  }
  const normal = heightToNormal(h, size, 2.2);
  const [c, ctx] = canvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 0.78 + Math.min(1, h[i]) * 0.3;
    img.data[i * 4] = rgb[0] * v + 4; img.data[i * 4 + 1] = rgb[1] * v + 4; img.data[i * 4 + 2] = rgb[2] * v + 4; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.repeat.set(repeat, repeat); normal.repeat.set(repeat, repeat);
  return { map, normal };
}

export function woodTexture(base = '#5a2f1a', repeatX = 2) {
  const [c, ctx] = canvas(1024, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, base); g.addColorStop(1, '#3d1e10');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 256);
  const rng = new Rng(21);
  for (let i = 0; i < 260; i++) {
    const y = rng.next() * 256;
    ctx.strokeStyle = `rgba(${rng.next() < 0.5 ? '20,8,2' : '120,70,40'},${0.05 + rng.next() * 0.14})`;
    ctx.lineWidth = 0.5 + rng.next() * 2.4;
    ctx.beginPath(); ctx.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 64) ctx.lineTo(x, y + Math.sin(x * 0.01 + i) * 4 + (rng.next() - 0.5) * 2);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeatX, 1);
  t.anisotropy = 8;
  return t;
}

export function leatherNormal() {
  const size = 256, rng = new Rng(3);
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) h[i] = rng.next();
  // 블러 비슷하게 평균
  const o = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += h[((y + dy + size) % size) * size + ((x + dx + size) % size)];
    o[y * size + x] = s / 9;
  }
  const t = heightToNormal(o, size, 6);
  t.repeat.set(3, 3);
  return t;
}

const BALL_SETS: Record<string, Record<number, string>> = {
  standard: { 1: '#f2c20f', 2: '#1546b8', 3: '#d4281f', 4: '#4b1d83', 5: '#ee6a12', 6: '#0b7a3a', 7: '#7a1620', 8: '#0b0b0d' },
  // 색약 지원: 명도/색상 차이를 크게 벌리고 번호를 키운다
  contrast: { 1: '#ffe100', 2: '#0057e7', 3: '#ff2a1a', 4: '#8a2be2', 5: '#ff8a00', 6: '#00b050', 7: '#7a0010', 8: '#000000' },
  pastel: { 1: '#f6d86a', 2: '#7ea6e8', 3: '#ee8c86', 4: '#a98bd6', 5: '#f4b27d', 6: '#7cc79b', 7: '#c27b86', 8: '#33353a' },
};
let currentSet = 'standard';
export function setBallSet(name: string) { currentSet = BALL_SETS[name] ? name : 'standard'; }
export function ballColor(id: number): string {
  if (id === 0) return '#f6f3ea';
  return BALL_SETS[currentSet][id <= 8 ? id : id - 8];
}

/** 등장방형 텍스처: 적도 위 u=0.25, 0.75 에 번호 원이 오도록 */
export function ballTexture(id: number): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const [c, ctx] = canvas(W, H);
  const col = ballColor(id);
  const stripe = id >= 9;
  ctx.fillStyle = stripe ? '#f4f1e8' : col;
  ctx.fillRect(0, 0, W, H);
  if (stripe) {
    ctx.fillStyle = col;
    ctx.fillRect(0, H * 0.25, W, H * 0.5);
  }
  if (id === 0) {
    // 큐볼: 작은 점 표시 하나
    ctx.fillStyle = '#c33';
    for (const u of [0.25, 0.75]) { ctx.beginPath(); ctx.arc(u * W, H / 2, 7, 0, Math.PI * 2); ctx.fill(); }
  } else {
    const rpx = currentSet === 'contrast' ? 66 : 56;
    for (const u of [0.25, 0.75]) {
      ctx.fillStyle = '#f7f5ee';
      ctx.beginPath(); ctx.ellipse(u * W, H / 2, rpx, rpx, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = `bold ${(id > 9 ? 62 : 72) + (currentSet === 'contrast' ? 14 : 0)}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(id), u * W, H / 2 + 3);
      if (id === 6 || id === 9) ctx.fillRect(u * W - 18, H / 2 + 34, 36, 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function blobShadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function wallTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#1b1411'; ctx.fillRect(0, 0, 512, 512);
  const rng = new Rng(5);
  // 벽돌 + 목재 패널 느낌
  for (let y = 0; y < 512; y += 32) {
    for (let x = (y / 32) % 2 ? 0 : -32; x < 512; x += 64) {
      const v = 28 + rng.next() * 18;
      ctx.fillStyle = `rgb(${v + 14},${v * 0.6},${v * 0.5})`;
      ctx.fillRect(x + 2, y + 2, 60, 28);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(4, 2);
  return t;
}
