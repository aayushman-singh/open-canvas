import type { ParticleFieldPoint } from './behaviour-primitives.js';

export const PARTICLE_FIELD_BREAKPOINT_SIZES = {
  phone: 220,
  tablet: 280,
  desktop: 400,
} as const;

export function particleFieldGridFontSize(canvasSize: number): number {
  return canvasSize <= 280 ? 5 : 7;
}

export function sampleAsciiPointsFromPixels(
  pixels: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  charset: string,
): ParticleFieldPoint[] {
  const chars = charset.split('');
  if (chars.length === 0) return [];

  const fontSize = particleFieldGridFontSize(Math.max(canvasWidth, canvasHeight));
  const colGap = fontSize * 0.7;
  const rowGap = fontSize * 1.1;
  const points: ParticleFieldPoint[] = [];

  for (let y = 0; y < canvasHeight; y += rowGap) {
    for (let x = 0; x < canvasWidth; x += colGap) {
      const i = (Math.floor(y) * canvasWidth + Math.floor(x)) * 4;
      const a = pixels[i + 3];
      if (a === undefined || a <= 128) continue;

      const r = pixels[i] ?? 0;
      const g = pixels[i + 1] ?? 0;
      const b = pixels[i + 2] ?? 0;
      const brightness = (r + g + b) / (3 * 255);
      const charIndex = Math.floor(brightness * (chars.length - 1));

      points.push({
        x: Number(x.toFixed(1)),
        y: Number(y.toFixed(1)),
        char: chars[charIndex] ?? chars[chars.length - 1] ?? '@',
        alpha: Number((0.4 + brightness * 0.6).toFixed(2)),
      });
    }
  }

  return points;
}

export function assertNonEmptyParticleFieldPointSets(
  pointSets: import('./behaviour-primitives.js').ParticleFieldPointSet[],
): void {
  for (const set of pointSets) {
    if (set.points.length === 0) {
      throw new Error(
        'Portrait image produced no visible ASCII points; try a higher-contrast photo',
      );
    }
  }
}
