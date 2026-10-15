import type { QualityName } from './quality';
import { defaultLook, type Look } from '../meta/customize';

export interface Settings {
  aimLevel: 0 | 1 | 2; // 0 초보 / 1 중급 / 2 프로
  quality: QualityName;
  master: number; sfx: number; ambience: number; ambienceOn: boolean;
  cameraAfterShot: 'top' | 'follow' | 'stay';
  cinematic: boolean; // 아슬아슬한 포켓 슬로모션 + 클로즈업
  sensitivity: number; // 조준 감도 배수
  control: 'stroke' | 'gauge';
  playerName: string;
  // 매치
  rules: 'eight' | 'nine';
  raceTo: number; // 먼저 N 승
  shotClock: 0 | 30 | 45 | 60; // 초 (0 = 없음)
  // 외형 / 접근성 / 편의
  look: Look;
  haptics: boolean;
  uiScale: number;
  showFps: boolean;
  autoQuality: boolean;
  reduceMotion: boolean;
  aimColor: 'white' | 'cyan' | 'yellow';
  musicOn: boolean; music: number;
  tutorialDone: boolean;
  invertDrag: boolean;
  pitchSensitivity: number;
  lastSeenVersion: string;
}

export const defaultSettings: Settings = {
  aimLevel: 0, quality: 'medium', master: 0.8, sfx: 1, ambience: 0.5, ambienceOn: true,
  cameraAfterShot: 'top', cinematic: true, sensitivity: 1, control: 'stroke', playerName: '플레이어',
  rules: 'eight', raceTo: 1, shotClock: 0,
  look: { ...defaultLook }, haptics: true, uiScale: 1, showFps: false, autoQuality: true, reduceMotion: false,
  aimColor: 'white', musicOn: true, music: 0.35, tutorialDone: false, invertDrag: false, pitchSensitivity: 1, lastSeenVersion: '',
};

const KEY = 'pool3d.settings.v1';

export function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

export function loadSettings(): Settings {
  const s: Settings = { ...defaultSettings };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const o = JSON.parse(raw); Object.assign(s, o); s.look = { ...defaultLook, ...(o.look || {}) }; }
  } catch { /* 저장소 사용 불가 */ }
  if (isMobile() && !localStorage.getItem(KEY)) { s.quality = 'low'; s.control = 'gauge'; }
  return s;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
