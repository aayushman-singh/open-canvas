import type { ParticleFieldPoint, ParticleFieldPointSet, ParticleFieldRichMotionAsset } from '../canvas/behaviour-primitives.js';
import { PARTICLE_FIELD_BREAKPOINTS } from '../canvas/behaviour-primitives.js';
import {
  PARTICLE_FIELD_BREAKPOINT_SIZES,
  sampleAsciiPointsFromPixels,
  assertNonEmptyParticleFieldPointSets,
} from '../canvas/particle-field-ascii.js';
import type { EditorContext } from './editor-context.js';

export type ParticleFieldPortraitUploadContext = Pick<
  EditorContext,
  'postAssetUpload' | 'setStatus' | 'siteBase'
>;

type PortraitImageSource = CanvasImageSource & { width: number; height: number };

function portraitAssetUrl(ctx: ParticleFieldPortraitUploadContext, sourceAssetId: string): string {
  return ctx.siteBase + '/assets/' + encodeURIComponent(sourceAssetId);
}

function createPortraitSampleCanvas(canvasSize: number): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(canvasSize, canvasSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('particle-field-ascii-canvas-context-unavailable');
    return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('particle-field-ascii-canvas-context-unavailable');
  return { canvas, ctx };
}

function readPortraitImageData(
  img: PortraitImageSource,
  canvasSize: number,
): { pixels: Uint8ClampedArray; width: number; height: number } {
  const { ctx } = createPortraitSampleCanvas(canvasSize);
  const canvasWidth = canvasSize;
  const canvasHeight = canvasSize;

  const scale = 0.8;
  const imgAspect = img.width / img.height;

  let drawHeight = canvasHeight * scale;
  let drawWidth = drawHeight * imgAspect;

  if (drawWidth > canvasWidth * scale) {
    drawWidth = canvasWidth * scale;
    drawHeight = drawWidth / imgAspect;
  }

  const offsetX = (canvasWidth - drawWidth) / 2;
  const offsetY = (canvasHeight - drawHeight) / 2;

  ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  return { pixels: imageData.data, width: canvasWidth, height: canvasHeight };
}

export function processImageToAsciiPoints(
  img: PortraitImageSource,
  canvasSize: number,
  charset: string,
): ParticleFieldPoint[] {
  const { pixels, width, height } = readPortraitImageData(img, canvasSize);
  return sampleAsciiPointsFromPixels(pixels, width, height, charset);
}

export function buildParticleFieldPointSets(
  img: PortraitImageSource,
  charset: string,
): ParticleFieldPointSet[] {
  return PARTICLE_FIELD_BREAKPOINTS.map((breakpoint) => {
    const canvasSize = PARTICLE_FIELD_BREAKPOINT_SIZES[breakpoint];
    return {
      breakpoint,
      canvasSize,
      points: processImageToAsciiPoints(img, canvasSize, charset),
    };
  });
}

export function loadImageFromAssetUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('particle-field-portrait-image-load-failed'));
    img.src = url;
  });
}

export async function regenerateParticleFieldPointSetsFromSource(
  ctx: ParticleFieldPortraitUploadContext,
  asset: ParticleFieldRichMotionAsset,
  sourceAssetId: string,
): Promise<ParticleFieldPointSet[]> {
  const img = await loadImageFromAssetUrl(portraitAssetUrl(ctx, sourceAssetId));
  const pointSets = buildParticleFieldPointSets(img, asset.charset);
  assertNonEmptyParticleFieldPointSets(pointSets);
  return pointSets;
}

export async function uploadParticleFieldPortrait(
  ctx: ParticleFieldPortraitUploadContext,
  asset: ParticleFieldRichMotionAsset,
  file: File,
): Promise<{ sourceAssetId: string; pointSets: ParticleFieldPointSet[] }> {
  const upload = await ctx.postAssetUpload(file, asset.alt, '');
  if (upload.kind !== 'image') {
    throw new Error('Portrait upload must be an image');
  }
  const pointSets = await regenerateParticleFieldPointSetsFromSource(ctx, asset, upload.assetId);
  return { sourceAssetId: upload.assetId, pointSets };
}
