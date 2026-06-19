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
export const RICH_MOTION_KINDS = ['image-sequence', 'rive', 'lottie', 'model-3d'] as const;
export const RIVE_INPUT_TYPES = ['boolean', 'number', 'trigger'] as const;
export const RIVE_INPUT_EVENTS = [
  'pointer-enter',
  'pointer-leave',
  'focus',
  'blur',
  'click',
  'scroll-progress',
] as const;
export const LAYOUT_TRANSITION_INITIAL_STATES = ['source', 'target'] as const;
export const LAYOUT_TRANSITION_REDUCED_MOTION_MODES = ['instant', 'allow'] as const;

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

export interface RiveRichMotionAsset {
  id: string;
  kind: 'rive';
  assetId: string;
  alt: string;
  artboard?: string;
  stateMachine?: string;
  autoplay?: boolean;
  reducedMotion: 'pause' | 'play';
  inputs?: RiveInputBinding[];
}

export type RiveInputBinding =
  | {
      id: string;
      inputName: string;
      inputType: 'boolean';
      event: Exclude<(typeof RIVE_INPUT_EVENTS)[number], 'scroll-progress'>;
      value: boolean;
    }
  | {
      id: string;
      inputName: string;
      inputType: 'number';
      event: Exclude<(typeof RIVE_INPUT_EVENTS)[number], 'scroll-progress'>;
      value: number;
    }
  | {
      id: string;
      inputName: string;
      inputType: 'trigger';
      event: Exclude<(typeof RIVE_INPUT_EVENTS)[number], 'scroll-progress'>;
    }
  | {
      id: string;
      inputName: string;
      inputType: 'number';
      event: 'scroll-progress';
      scrollSceneId: string;
    };

export interface LottieRichMotionAsset {
  id: string;
  kind: 'lottie';
  assetId: string;
  alt: string;
  renderer: 'svg' | 'canvas';
  loop?: boolean;
  autoplay?: boolean;
  reducedMotion: 'pause' | 'play';
}

export interface Model3DRichMotionAsset {
  id: string;
  kind: 'model-3d';
  assetId: string;
  alt: string;
  posterAssetId?: string;
  cameraControls: boolean;
  autoRotate?: boolean;
  reducedMotion: 'static' | 'allow';
}

export type RichMotionAsset =
  | ImageSequenceRichMotionAsset
  | RiveRichMotionAsset
  | LottieRichMotionAsset
  | Model3DRichMotionAsset;

export interface LoadExperience {
  id: string;
  label: string;
  enterLabel: string;
  background: string;
  foreground: string;
  sequenceId: string;
}

export interface LayoutTransition {
  id: string;
  name: string;
  triggerElementId: string;
  sourceElementId: string;
  targetElementId: string;
  viewTransitionName: string;
  initialState: (typeof LAYOUT_TRANSITION_INITIAL_STATES)[number];
  reducedMotion: (typeof LAYOUT_TRANSITION_REDUCED_MOTION_MODES)[number];
}
