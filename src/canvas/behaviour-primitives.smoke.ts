import type { EditableSite } from './schema.js';
import { validateEditableSite } from './validate.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[behaviour-primitives:smoke] ${message}`);
  }
}

function buildValidState(): EditableSite & Record<string, unknown> {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Behaviour Primitives',
        width: 1440,
        sections: [
          {
            id: 'section-hero',
            recipeId: 'custom',
            name: 'Hero',
            height: 640,
            elements: [
              {
                id: 'tabs-hero',
                type: 'tabs',
                box: { x: 0, y: 0, w: 480, h: 260, z: 1 },
                activeTabId: 'overview',
                tabs: [
                  {
                    id: 'overview',
                    label: [{ text: 'Overview' }],
                    elements: [
                      {
                        id: 'tab-copy',
                        type: 'text',
                        box: { x: 0, y: 0, w: 320, h: 48, z: 1 },
                        content: [{ text: 'Nested text target' }],
                        role: 'body',
                        fontSize: 18,
                        fontWeight: 400,
                        align: 'left',
                      },
                    ],
                  },
                  {
                    id: 'details',
                    label: [{ text: 'Details' }],
                    elements: [
                      {
                        id: 'tab-shape',
                        type: 'shape',
                        box: { x: 0, y: 0, w: 120, h: 120, z: 1 },
                        variant: 'rect',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    loadExperience: {
      id: 'load-hero',
      label: 'Prepare the hero',
      enterLabel: 'Enter site',
      background: '#050505',
      foreground: '#f5f5f5',
      runPolicy: 'once-per-session',
      progress: {
        display: 'bar-number',
        durationMs: 900,
        label: 'Loading',
      },
      mediaReadiness: {
        assetIds: ['hero-video', 'hero-poster'],
        timeoutMs: 2000,
      },
      logoDraw: {
        text: 'Ari Vale',
        durationMs: 1000,
        strokeWidth: 2,
      },
      handoff: {
        effect: 'mask-open',
        durationMs: 420,
        easing: 'cubic-bezier(.76,0,.24,1)',
      },
      sequenceId: 'sequence-load',
    },
    motionSequences: [
      {
        id: 'sequence-load',
        trigger: { type: 'load-enter' },
        reducedMotion: 'final-state',
        steps: [
          {
            id: 'step-site',
            target: { type: 'site' },
            to: { opacity: 1 },
            durationMs: 200,
          },
          {
            id: 'step-text',
            target: { type: 'text-split', elementId: 'tab-copy', unit: 'word' },
            textEffect: 'scramble',
            from: { opacity: 0, translateY: 24 },
            to: { opacity: 1, translateY: 0 },
            durationMs: 360,
            staggerMs: 40,
          },
          {
            id: 'step-text-mask',
            target: { type: 'text-split', elementId: 'tab-copy', unit: 'line' },
            textEffect: 'mask-reveal',
            from: { opacity: 0 },
            to: { opacity: 1 },
            durationMs: 280,
          },
        ],
      },
      {
        id: 'sequence-scroll',
        trigger: { type: 'scroll-scene', scrollSceneId: 'scene-hero' },
        steps: [
          {
            id: 'step-element',
            target: { type: 'element', elementId: 'tab-copy' },
            to: { translateX: 12, filter: 'blur(0px)' },
            durationMs: 280,
          },
        ],
      },
    ],
    scrollScenes: [
      {
        id: 'scene-hero',
        sectionId: 'section-hero',
        sequenceId: 'sequence-scroll',
        pinTarget: { type: 'element', elementId: 'tab-copy' },
        horizontalTrack: { elementId: 'tab-copy', distancePx: 480 },
        beforeAfterReveal: {
          beforeElementId: 'tabs-hero',
          afterElementId: 'tab-copy',
          axis: 'x',
          startProgress: 0.1,
          endProgress: 0.9,
          reducedMotion: 'end',
        },
        startOffsetPx: 0,
        endOffsetPx: 720,
        snapPoints: [0, 0.5, 1],
      },
    ],
    richMotionAssets: [
      {
        id: 'rich-hero',
        kind: 'image-sequence',
        frameAssetIds: ['frame-001', 'frame-002'],
        posterAssetId: 'poster-001',
        alt: 'Hero image sequence',
        playback: { driver: 'load', fps: 24 },
      },
    ],
  };
}

function expectValid(state: EditableSite & Record<string, unknown>, label: string): void {
  const result = validateEditableSite(state);
  assert(result.valid, `${label} should validate: ${result.valid ? '' : result.errors.join('; ')}`);
}

function expectInvalid(
  state: EditableSite & Record<string, unknown>,
  expectedFragment: string,
  label: string,
): void {
  const result = validateEditableSite(state);
  assert(!result.valid, `${label} should fail validation`);
  assert(
    result.errors.some((error) => error.includes(expectedFragment)),
    `${label} should mention ${JSON.stringify(expectedFragment)}; got ${result.errors.join('; ')}`,
  );
}

const validState = buildValidState();
expectValid(validState, 'valid behaviour primitive state');

const invalidLoadHandoffEffect = structuredClone(validState);
(
  invalidLoadHandoffEffect.loadExperience as { handoff: { effect: string } }
).handoff.effect = 'custom-js';
expectInvalid(
  invalidLoadHandoffEffect,
  'loadExperience.handoff.effect',
  'invalid load handoff effect',
);

const invalidLoadHandoffDuration = structuredClone(validState);
(
  invalidLoadHandoffDuration.loadExperience as { handoff: { durationMs: number } }
).handoff.durationMs = 40000;
expectInvalid(
  invalidLoadHandoffDuration,
  'loadExperience.handoff.durationMs',
  'invalid load handoff duration',
);

const missingElementTarget = structuredClone(validState);
(
  (missingElementTarget.motionSequences as { steps: { target: { elementId?: string } }[] }[])[0]!
    .steps[1]!.target
).elementId = 'missing-element';
expectInvalid(
  missingElementTarget,
  'motionSequences[0].steps[1].target.elementId',
  'missing motion target',
);

const missingScrollSequence = structuredClone(validState);
(missingScrollSequence.scrollScenes as { sequenceId: string }[])[0]!.sequenceId =
  'missing-sequence';
expectInvalid(missingScrollSequence, 'scrollScenes[0].sequenceId', 'scroll scene missing sequence');

const invalidScrollSnapPoints = structuredClone(validState);
(invalidScrollSnapPoints.scrollScenes as { snapPoints: unknown[] }[])[0]!.snapPoints = [
  0,
  0.75,
  0.5,
  1.2,
];
expectInvalid(invalidScrollSnapPoints, 'scrollScenes[0].snapPoints[2]', 'scroll snap order');
expectInvalid(invalidScrollSnapPoints, 'scrollScenes[0].snapPoints[3]', 'scroll snap range');

const missingHorizontalTrack = structuredClone(validState);
(
  (missingHorizontalTrack.scrollScenes as { horizontalTrack: { elementId: string } }[])[0]!
    .horizontalTrack
).elementId = 'missing-element';
expectInvalid(
  missingHorizontalTrack,
  'scrollScenes[0].horizontalTrack.elementId',
  'scroll scene missing horizontal track element',
);

const missingRevealElement = structuredClone(validState);
(
  (missingRevealElement.scrollScenes as { beforeAfterReveal: { afterElementId: string } }[])[0]!
    .beforeAfterReveal
).afterElementId = 'missing-element';
expectInvalid(
  missingRevealElement,
  'scrollScenes[0].beforeAfterReveal.afterElementId',
  'scroll scene missing before-after reveal element',
);

const duplicateRevealElement = structuredClone(validState);
(
  (duplicateRevealElement.scrollScenes as { beforeAfterReveal: { afterElementId: string } }[])[0]!
    .beforeAfterReveal
).afterElementId = 'tabs-hero';
expectInvalid(
  duplicateRevealElement,
  'scrollScenes[0].beforeAfterReveal.afterElementId must differ',
  'scroll scene duplicate before-after reveal elements',
);

const invalidRevealProgress = structuredClone(validState);
(
  (invalidRevealProgress.scrollScenes as {
    beforeAfterReveal: { startProgress: number; endProgress: number };
  }[])[0]!.beforeAfterReveal
).startProgress = 0.8;
(
  (invalidRevealProgress.scrollScenes as {
    beforeAfterReveal: { startProgress: number; endProgress: number };
  }[])[0]!.beforeAfterReveal
).endProgress = 0.2;
expectInvalid(
  invalidRevealProgress,
  'scrollScenes[0].beforeAfterReveal.endProgress',
  'scroll scene invalid before-after reveal progress window',
);

const emptyRichMotionFrames = structuredClone(validState);
(emptyRichMotionFrames.richMotionAssets as { frameAssetIds: string[] }[])[0]!.frameAssetIds = [];
expectInvalid(
  emptyRichMotionFrames,
  'richMotionAssets[0].frameAssetIds',
  'image sequence with no frames',
);

const missingLoadSequence = structuredClone(validState);
(missingLoadSequence.loadExperience as { sequenceId: string }).sequenceId = 'missing-sequence';
expectInvalid(missingLoadSequence, 'loadExperience.sequenceId', 'load experience missing sequence');

const invalidLoadProgress = structuredClone(validState);
(invalidLoadProgress.loadExperience as { progress: Record<string, unknown> }).progress = {
  display: 'spinner',
  durationMs: -1,
  label: '',
};
expectInvalid(invalidLoadProgress, 'loadExperience.progress.display', 'load progress display');
expectInvalid(invalidLoadProgress, 'loadExperience.progress.durationMs', 'load progress duration');
expectInvalid(invalidLoadProgress, 'loadExperience.progress.label', 'load progress label');

const invalidLoadRunPolicy = structuredClone(validState);
(invalidLoadRunPolicy.loadExperience as { runPolicy: string }).runPolicy = 'sometimes';
expectInvalid(invalidLoadRunPolicy, 'loadExperience.runPolicy', 'load run policy');

const invalidLoadReadiness = structuredClone(validState);
(invalidLoadReadiness.loadExperience as { mediaReadiness: Record<string, unknown> }).mediaReadiness = {
  assetIds: [''],
  timeoutMs: -1,
};
expectInvalid(invalidLoadReadiness, 'loadExperience.mediaReadiness.assetIds[0]', 'load readiness asset');
expectInvalid(invalidLoadReadiness, 'loadExperience.mediaReadiness.timeoutMs', 'load readiness timeout');

const invalidLogoDraw = structuredClone(validState);
(invalidLogoDraw.loadExperience as { logoDraw: Record<string, unknown> }).logoDraw = {
  text: '',
  durationMs: -1,
  strokeWidth: 0,
};
expectInvalid(invalidLogoDraw, 'loadExperience.logoDraw.text', 'load logo draw text');
expectInvalid(invalidLogoDraw, 'loadExperience.logoDraw.durationMs', 'load logo draw duration');
expectInvalid(invalidLogoDraw, 'loadExperience.logoDraw.strokeWidth', 'load logo draw stroke width');

const unsupportedProperty = structuredClone(validState);
(
  (unsupportedProperty.motionSequences as { steps: { to: Record<string, unknown> }[] }[])[0]!
    .steps[0]!.to
).skewX = 15;
expectInvalid(
  unsupportedProperty,
  'motionSequences[0].steps[0].to.skewX',
  'unsupported motion property',
);

const unsupportedTextEffect = structuredClone(validState);
(
  (unsupportedTextEffect.motionSequences as { steps: { textEffect?: string }[] }[])[0]!
    .steps[1]!
).textEffect = 'randomize';
expectInvalid(
  unsupportedTextEffect,
  'motionSequences[0].steps[1].textEffect',
  'unsupported text effect',
);

const textEffectOnElement = structuredClone(validState);
(
  (textEffectOnElement.motionSequences as { steps: { textEffect?: string }[] }[])[0]!
    .steps[0]!
).textEffect = 'scramble';
expectInvalid(
  textEffectOnElement,
  'motionSequences[0].steps[0].textEffect',
  'text effect target guard',
);

console.log('[behaviour-primitives:smoke] OK');
