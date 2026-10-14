export type QualityName = 'low' | 'medium' | 'high';
export interface Quality {
  name: QualityName;
  pixelRatio: number;
  shadowMap: number;
  bloom: boolean;
  ssao: boolean;
  msaa: number;
  ballSegments: number;
  composer: boolean;
}
export const QUALITY: Record<QualityName, Quality> = {
  low: { name: 'low', pixelRatio: 1, shadowMap: 1024, bloom: false, ssao: false, msaa: 0, ballSegments: 24, composer: false },
  medium: { name: 'medium', pixelRatio: 1.25, shadowMap: 2048, bloom: true, ssao: false, msaa: 4, ballSegments: 40, composer: true },
  high: { name: 'high', pixelRatio: 2, shadowMap: 4096, bloom: true, ssao: true, msaa: 4, ballSegments: 64, composer: true },
};
