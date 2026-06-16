import {
  validateInteractionTrigger,
  validateMotionSequence,
  validateScrollScene,
} from './interactions';
import type { MotionSequence, ScrollScene } from './interactions';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[interactions:smoke] ${message}`);
}

function assertThrowsContaining(label: string, fn: () => void, fragment: string): void {
  try {
    fn();
  } catch (error) {
    assert(error instanceof Error, `${label} must throw an Error`);
    assert(
      error.message.includes(fragment),
      `${label} must mention "${fragment}", got: ${error.message}`,
    );
    return;
  }

  throw new Error(`[interactions:smoke] ${label} must throw`);
}

const validSequence: MotionSequence = {
  id: 'hero-intro',
  trigger: { type: 'load' },
  steps: [
    {
      id: 'headline-in',
      target: { type: 'element', elementId: 'headline' },
      properties: {
        opacity: [0, 1],
        y: [24, 0],
      },
      durationMs: 700,
      easing: 'out-cubic',
      delayMs: 100,
    },
    {
      id: 'words',
      target: { type: 'text-split', elementId: 'headline', split: 'word' },
      properties: {
        opacity: [0, 1],
      },
      durationMs: 350,
      staggerMs: 45,
    },
  ],
};

validateMotionSequence(validSequence);

assertThrowsContaining(
  'hover trigger without elementId',
  () => validateInteractionTrigger({ type: 'hover', elementId: '' }),
  'elementId',
);

assertThrowsContaining(
  'media-ready trigger without assetId',
  () => validateInteractionTrigger({ type: 'media-ready', assetId: '' }),
  'assetId',
);

assertThrowsContaining(
  'unknown trigger type',
  () => validateInteractionTrigger({ type: 'unsupported' } as never),
  'type',
);

assertThrowsContaining(
  'negative durationMs',
  () =>
    validateMotionSequence({
      ...validSequence,
      steps: [{ ...validSequence.steps[0]!, durationMs: -1 }],
    }),
  'durationMs',
);

assertThrowsContaining(
  'unknown property',
  () =>
    validateMotionSequence({
      ...validSequence,
      steps: [
        {
          ...validSequence.steps[0]!,
          properties: { left: [0, 1] },
        } as unknown as MotionSequence['steps'][number],
      ],
    }),
  'properties',
);

assertThrowsContaining(
  'malformed property range',
  () =>
    validateMotionSequence({
      ...validSequence,
      steps: [
        {
          ...validSequence.steps[0]!,
          properties: { opacity: [0] },
        } as unknown as MotionSequence['steps'][number],
      ],
    }),
  'properties',
);

const validScrollScene: ScrollScene = {
  id: 'case-study-scroll',
  trigger: { type: 'scroll-progress', sectionId: 'case-study' },
  start: 'top bottom',
  end: 'bottom top',
  axis: 'y',
  scrub: true,
  pin: true,
  sequence: validSequence,
};

validateScrollScene(validScrollScene);

assertThrowsContaining(
  'empty start',
  () => validateScrollScene({ ...validScrollScene, start: '' }),
  'start',
);

assertThrowsContaining(
  'invalid axis',
  () => validateScrollScene({ ...validScrollScene, axis: 'z' as ScrollScene['axis'] }),
  'axis',
);

assertThrowsContaining(
  'invalid scrub',
  () => validateScrollScene({ ...validScrollScene, scrub: 'yes' as unknown as boolean }),
  'scrub',
);

assertThrowsContaining(
  'invalid pin',
  () => validateScrollScene({ ...validScrollScene, pin: 'yes' as unknown as boolean }),
  'pin',
);

console.log('[interactions:smoke] OK');
