export const BEHAVIOUR_TARGET_TYPES = ['site', 'page', 'section', 'element', 'text-split'] as const;
export const TEXT_SPLIT_UNITS = ['word', 'line', 'char'] as const;
export const MOTION_SEQUENCE_TRIGGER_TYPES = [
  'load-enter',
  'section-enter',
  'scroll-scene',
] as const;
export const MOTION_SEQUENCE_PROPERTIES = [
  'opacity',
  'translateX',
  'translateY',
  'scale',
  'rotate',
  'clipPath',
  'filter',
] as const;
export const RICH_MOTION_KINDS = ['image-sequence'] as const;

export type BehaviourTarget =
  | { type: 'site' }
  | { type: 'page'; pageId: string }
  | { type: 'section'; sectionId: string }
  | { type: 'element'; elementId: string }
  | { type: 'text-split'; elementId: string; unit: 'word' | 'line' | 'char' };

export interface MotionSequenceStep {
  id: string;
  target: BehaviourTarget;
  from?: Partial<Record<(typeof MOTION_SEQUENCE_PROPERTIES)[number], string | number>>;
  to: Partial<Record<(typeof MOTION_SEQUENCE_PROPERTIES)[number], string | number>>;
  durationMs: number;
  delayMs?: number;
  staggerMs?: number;
  easing?: string;
}

export interface MotionSequence {
  id: string;
  trigger:
    | { type: 'load-enter' }
    | { type: 'section-enter'; sectionId: string }
    | { type: 'scroll-scene'; scrollSceneId: string };
  steps: MotionSequenceStep[];
  reducedMotion?: 'skip' | 'final-state';
}

export interface ScrollScene {
  id: string;
  sectionId: string;
  sequenceId: string;
  pinTarget: { type: 'section'; sectionId: string } | { type: 'element'; elementId: string };
  startOffsetPx: number;
  endOffsetPx: number;
}

export interface ImageSequenceRichMotionAsset {
  id: string;
  kind: 'image-sequence';
  frameAssetIds: string[];
  posterAssetId: string;
  alt: string;
  playback: {
    driver: 'load' | 'scroll-scene';
    fps?: number;
    loop?: boolean;
    scrollSceneId?: string;
  };
}

export type RichMotionAsset = ImageSequenceRichMotionAsset;

export interface LoadExperience {
  id: string;
  label: string;
  enterLabel: string;
  background: string;
  foreground: string;
  sequenceId: string;
}
