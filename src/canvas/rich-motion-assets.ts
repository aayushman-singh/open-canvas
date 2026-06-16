import { validateInteractionTrigger, type InteractionTrigger } from './interactions';

export type RichMotionAssetFamily =
  | 'vector-animation'
  | 'interactive-vector'
  | 'image-sequence'
  | 'bounded-3d';

export type RichMotionAssetSource =
  | { kind: 'lottie-json' }
  | { kind: 'dotlottie' }
  | { kind: 'rive'; stateMachine?: string; artboard?: string }
  | { kind: 'image-sequence'; frameAssetIds: string[] }
  | { kind: 'bounded-3d'; sceneDescriptorAssetId: string };

export type RichMotionReducedMotion = 'poster' | 'pause' | 'hide';

export interface RichMotionPlayback {
  trigger: InteractionTrigger;
  loop: boolean;
  speed: number;
  segment?: string;
  reducedMotion: RichMotionReducedMotion;
}

export interface RichMotionAsset {
  id: string;
  ownerAssetId: string;
  family: RichMotionAssetFamily;
  source: RichMotionAssetSource;
  playback: RichMotionPlayback;
  posterAssetId?: string;
}

const RICH_MOTION_REDUCED_MOTION_VALUES = ['poster', 'pause', 'hide'] as const;
const RICH_MOTION_REDUCED_MOTION_SET = new Set<string>(RICH_MOTION_REDUCED_MOTION_VALUES);

export function validateRichMotionAsset(asset: RichMotionAsset): void {
  assertObject(asset, 'root');
  assertNonEmptyString(asset.id, 'id');
  assertNonEmptyString(asset.ownerAssetId, 'ownerAssetId');

  if (asset.source === undefined) {
    throw new Error('RichMotionAsset.source must be set');
  }
  if (asset.playback === undefined) {
    throw new Error('RichMotionAsset.playback must be set');
  }

  validateFamilySourceCompatibility(asset.family, asset.source.kind);
  validateSource(asset.source);
  validatePlayback(asset.playback);
}

function validatePlayback(playback: RichMotionPlayback): void {
  assertObject(playback, 'playback');

  if (typeof playback.loop !== 'boolean') {
    throw new Error('RichMotionAsset.playback.loop must be a boolean');
  }
  if (!Number.isFinite(playback.speed) || playback.speed <= 0) {
    throw new Error('RichMotionAsset.playback.speed must be finite and greater than 0');
  }
  if (
    typeof playback.reducedMotion !== 'string' ||
    !RICH_MOTION_REDUCED_MOTION_SET.has(playback.reducedMotion)
  ) {
    throw new Error(
      `RichMotionAsset.playback.reducedMotion must be one of ${RICH_MOTION_REDUCED_MOTION_VALUES.join(', ')}`,
    );
  }
  validateInteractionTrigger(playback.trigger, 'RichMotionAsset.playback.trigger');
}

function assertNonEmptyString(value: string | undefined, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`RichMotionAsset.${field} must be a non-empty string`);
  }
}

function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`RichMotionAsset.${field} must be an object`);
  }
}

function validateSource(source: RichMotionAssetSource): void {
  assertObject(source, 'source');

  if (source.kind === 'image-sequence') {
    if (!Array.isArray(source.frameAssetIds) || source.frameAssetIds.length === 0) {
      throw new Error('RichMotionAsset.source.frames must contain at least one frameAssetId');
    }
    source.frameAssetIds.forEach((frameAssetId, idx) => {
      assertNonEmptyString(frameAssetId, `source.frameAssetIds[${String(idx)}]`);
    });
  }

  if (source.kind === 'bounded-3d') {
    assertNonEmptyString(source.sceneDescriptorAssetId, 'source.sceneDescriptorAssetId');
  }
}

function validateFamilySourceCompatibility(
  family: RichMotionAssetFamily,
  sourceKind: RichMotionAssetSource['kind'],
): void {
  if (family === 'vector-animation') {
    if (sourceKind === 'lottie-json' || sourceKind === 'dotlottie') return;
    throwFamilySourceError(family, sourceKind, 'lottie-json or dotlottie');
  }

  if (family === 'interactive-vector') {
    if (sourceKind === 'rive') return;
    throwFamilySourceError(family, sourceKind, 'rive');
  }

  if (family === 'image-sequence') {
    if (sourceKind === 'image-sequence') return;
    throwFamilySourceError(family, sourceKind, 'image-sequence');
  }

  if (family === 'bounded-3d') {
    if (sourceKind === 'bounded-3d') return;
    throwFamilySourceError(family, sourceKind, 'bounded-3d');
  }

  throw new Error(`RichMotionAsset.family is unsupported: ${String(family)}`);
}

function throwFamilySourceError(
  family: RichMotionAssetFamily,
  sourceKind: RichMotionAssetSource['kind'],
  expected: string,
): never {
  throw new Error(
    `RichMotionAsset.family/source mismatch: family ${family} requires ${expected}, got ${sourceKind}`,
  );
}
