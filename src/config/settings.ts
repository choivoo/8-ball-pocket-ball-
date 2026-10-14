import type { QualityName } from './quality';

export interface Settings {
  aimLevel: 0 | 1 | 2; // 0 초보 / 1 중급 / 2 프로
  quality: QualityName;
  master: number; sfx: number; ambience: number; ambienceOn: boolean;
  cameraAfterShot: 'top' | 'follow' | 'stay';
  cinematic: boolean; // 아슬아슬한 포켓 슬로모션 + 클로즈업
  sensitivity: number; // 조준 감도 배수
  control: 'stroke' | 'gauge';
  playerName: string;
}

export const defaultSettings: Settings = {
  aimLevel: 0, quality: 'medium', master: 0.8, sfx: 1, ambience: 0.5, ambienceOn: true,
  cameraAfterShot: 'top', cinematic: true, sensitivity: 1, control: 'stroke', playerName: '플레이어',
};

const KEY = 'pool3d.settings.v1';

export function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

export function loadSettings(): Settings {
  const s: Settings = { ...defaultSettings };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
  } catch { /* 저장소 사용 불가 */ }
  if (isMobile() && !localStorage.getItem(KEY)) { s.quality = 'low'; s.control = 'gauge'; }
  return s;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
