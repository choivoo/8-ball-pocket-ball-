/** 외형 커스터마이즈 정의. 일부는 레벨로 잠금 해제된다. */
export interface CueSkin { id: string; name: string; shaft: string; butt: string; ring: number; unlock: number }
export interface ClothSkin { id: string; name: string; rgb: [number, number, number]; unlock: number }
export interface RailSkin { id: string; name: string; wood: string; unlock: number }
export interface BallSet { id: string; name: string; unlock: number }

export const CUE_SKINS: CueSkin[] = [
  { id: 'classic', name: '클래식 메이플', shaft: '#d6a566', butt: '#2c140b', ring: 0xd8d8de, unlock: 1 },
  { id: 'ebony', name: '에보니', shaft: '#c9b48f', butt: '#0e0b0a', ring: 0xb08a4a, unlock: 1 },
  { id: 'cherry', name: '체리 레드', shaft: '#d9b27a', butt: '#6b1d1d', ring: 0xd8d8de, unlock: 3 },
  { id: 'ocean', name: '오션 블루', shaft: '#d6b98a', butt: '#123a66', ring: 0x9fd8ff, unlock: 5 },
  { id: 'emerald', name: '에메랄드', shaft: '#d0b07a', butt: '#0f4a2c', ring: 0xb08a4a, unlock: 8 },
  { id: 'carbon', name: '카본 블랙', shaft: '#2a2a2e', butt: '#161618', ring: 0xff9a3c, unlock: 12 },
  { id: 'gold', name: '골드 에디션', shaft: '#e9d9a8', butt: '#7a5a14', ring: 0xffd66b, unlock: 20 },
];

export const CLOTH_SKINS: ClothSkin[] = [
  { id: 'green', name: '클래식 그린', rgb: [14, 92, 52], unlock: 1 },
  { id: 'blue', name: '토너먼트 블루', rgb: [16, 70, 128], unlock: 1 },
  { id: 'red', name: '버건디 레드', rgb: [122, 28, 36], unlock: 4 },
  { id: 'black', name: '미드나잇', rgb: [28, 30, 36], unlock: 7 },
  { id: 'purple', name: '로열 퍼플', rgb: [70, 36, 112], unlock: 10 },
  { id: 'teal', name: '틸', rgb: [14, 100, 108], unlock: 14 },
];

export const RAIL_SKINS: RailSkin[] = [
  { id: 'mahogany', name: '마호가니', wood: '#5b2e19', unlock: 1 },
  { id: 'walnut', name: '월넛', wood: '#3e2a1c', unlock: 1 },
  { id: 'oak', name: '오크', wood: '#8a6a44', unlock: 2 },
  { id: 'ebony', name: '에보니', wood: '#1d1512', unlock: 9 },
  { id: 'maple', name: '메이플', wood: '#b88b57', unlock: 6 },
];

export const BALL_SETS: BallSet[] = [
  { id: 'standard', name: '스탠더드', unlock: 1 },
  { id: 'contrast', name: '고대비 (색약 지원)', unlock: 1 },
  { id: 'pastel', name: '파스텔', unlock: 11 },
];

export interface Look { cue: string; cloth: string; rail: string; balls: string }
export const defaultLook: Look = { cue: 'classic', cloth: 'green', rail: 'mahogany', balls: 'standard' };

export const find = <T extends { id: string }>(arr: T[], id: string): T => arr.find((x) => x.id === id) ?? arr[0];
