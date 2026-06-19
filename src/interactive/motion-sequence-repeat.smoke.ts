import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { serializeBehaviourPayload } from '../canvas/behaviour-payload.js';
import type { EditableSite } from '../canvas/schema.js';
import { validateEditableSite } from '../canvas/validate.js';
import { BEHAVIOUR_RUNTIME_SRC } from './behaviour.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[motion-sequence-repeat:smoke] ' + message);
}

type Listener = (event: { type: string }) => void;

class StubStyle {
  opacity = '';
  transform = '';
  clipPath = '';
  filter = '';
}

class StubElement {
  tagName: string;
  attributes = new Map<string, string>();
  children: StubElement[] = [];
  style = new StubStyle();
  textContent = '';
  animations: Array<{ keyframes: unknown[]; options: Record<string, unknown> }> = [];

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
  }

  matchesSelector(selector: string): boolean {
    const tagAttrMatch = /^([a-zA-Z0-9-]+)\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/.exec(
      selector.trim(),
    );
    if (tagAttrMatch) {
      const tagName = tagAttrMatch[1];
      const attr = tagAttrMatch[2];
      const expected = tagAttrMatch[3] ?? null;
      if (tagName === undefined || attr === undefined) return false;
      if (this.tagName !== tagName.toLowerCase()) return false;
      if (!this.attributes.has(attr)) return false;
      if (expected === null) return true;
      return this.attributes.get(attr) === expected;
    }
    const match = /^\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/.exec(selector.trim());
    if (!match) throw new Error('[stub] unsupported selector ' + selector);
    const attr = match[1];
    const expected = match[2] ?? null;
    if (attr === undefined || !this.attributes.has(attr)) return false;
    if (expected === null) return true;
    return this.attributes.get(attr) === expected;
  }

  appendChild(child: StubElement): void {
    this.children.push(child);
  }

  querySelectorAll(selector: string): StubElement[] {
    const out: StubElement[] = [];
    const walk = (node: StubElement): void => {
      if (node.matchesSelector(selector)) out.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): StubElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  animate(keyframes: unknown[], options: Record<string, unknown>): { cancel: () => void } {
    this.animations.push({ keyframes, options });
    return { cancel: () => undefined };
  }
}

class StubDocument {
  documentElement = new StubElement('html');
  body = new StubElement('body');

  constructor() {
    this.documentElement.appendChild(this.body);
  }

  querySelector(selector: string): StubElement | null {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): StubElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  addEventListener(_type: string, _listener: Listener): void {}

  dispatchEvent(_event: { type: string; detail?: unknown }): void {}
}

class StubWindow {
  matchMedia(): { matches: boolean } {
    return { matches: false };
  }
}

function runBehaviour(doc: StubDocument, win: StubWindow): void {
  const CustomEventCtor = function CustomEvent(
    this: { type: string; detail?: unknown },
    type: string,
    init?: { detail?: unknown },
  ) {
    this.type = type;
    this.detail = init?.detail;
  } as unknown as new (type: string, init?: { detail?: unknown }) => { type: string; detail?: unknown };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- must execute visitor behaviour runtime source verbatim.
  const fn = new Function(
    'document',
    'window',
    'CustomEvent',
    'requestAnimationFrame',
    `${BEHAVIOUR_RUNTIME_SRC}\nhydrateBehaviour(document);`,
  ) as (
    document: StubDocument,
    window: StubWindow,
    customEvent: new (type: string, init?: { detail?: unknown }) => { type: string; detail?: unknown },
    raf: (fn: () => void) => number,
  ) => void;
  fn(doc, win, CustomEventCtor, (cb: () => void) => {
    cb();
    return 1;
  });
}

function baseSite(): EditableSite & Record<string, unknown> {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Home',
        width: 1200,
        sections: [
          {
            id: 'hero',
            recipeId: 'custom',
            name: 'Hero',
            height: 720,
            elements: [],
          },
        ],
      },
    ],
    motionSequences: [
      {
        id: 'load-loop',
        trigger: { type: 'load-enter' },
        repeat: { count: 2, mode: 'yoyo' },
        steps: [
          {
            id: 'site-fade',
            target: { type: 'site' },
            from: { opacity: 0 },
            to: { opacity: 1 },
            durationMs: 240,
          },
        ],
      },
    ],
  };
}

const valid = baseSite();
(valid.motionSequences![0] as unknown as Record<string, unknown>).playbackDirection = 'reverse';
(valid.motionSequences![0]!.steps[0] as unknown as Record<string, unknown>).waitAfterMs = 180;
valid.motionSequences![0]!.steps.push({
  id: 'site-lift',
  target: { type: 'site' },
  to: { translateY: -24 },
  durationMs: 100,
});
valid.motionSequences![0]!.steps.push({
  id: 'site-overlap',
  target: { type: 'site' },
  to: { scale: 1.2 },
  durationMs: 80,
});
(valid.motionSequences![0]!.steps[2] as unknown as Record<string, unknown>).startAtMs = 120;
const strokeStep = valid.motionSequences![0]!.steps[1] as unknown as {
  from: Record<string, number>;
  to: Record<string, number>;
};
strokeStep.from = {
  strokeDasharray: 240,
  strokeDashoffset: 240,
  fontVariationWeight: 300,
  fontVariationWidth: 80,
};
strokeStep.to = {
  translateY: -24,
  strokeDasharray: 240,
  strokeDashoffset: 0,
  fontVariationWeight: 820,
  fontVariationWidth: 120,
};
const validation = validateEditableSite(valid);
assert(
  validation.valid,
  `repeat/yoyo reverse motion sequence must validate: ${validation.valid ? '' : validation.errors.join('; ')}`,
);

const invalidScrollRepeat = baseSite();
invalidScrollRepeat.motionSequences = [
  {
    id: 'scroll-loop',
    trigger: { type: 'scroll-scene', scrollSceneId: 'scene-hero' },
    repeat: { count: 1, mode: 'restart' },
    steps: [
      {
        id: 'site-fade',
        target: { type: 'site' },
        to: { opacity: 1 },
        durationMs: 1,
      },
    ],
  },
];
invalidScrollRepeat.scrollScenes = [
  {
    id: 'scene-hero',
    sectionId: 'hero',
    sequenceId: 'scroll-loop',
    pinTarget: { type: 'section', sectionId: 'hero' },
    startOffsetPx: 0,
    endOffsetPx: 720,
  },
];
const invalidScrollValidation = validateEditableSite(invalidScrollRepeat);
assert(!invalidScrollValidation.valid, 'scroll-scrubbed Motion Sequences must reject repeat');
assert(
  invalidScrollValidation.errors.some((error) => error.includes('motionSequences[0].repeat')),
  `scroll repeat failure must mention repeat; got ${invalidScrollValidation.valid ? '' : invalidScrollValidation.errors.join('; ')}`,
);

const invalidScrollReverse = baseSite();
invalidScrollReverse.motionSequences = [
  {
    id: 'scroll-reverse',
    trigger: { type: 'scroll-scene', scrollSceneId: 'scene-hero' },
    steps: [
      {
        id: 'site-fade',
        target: { type: 'site' },
        to: { opacity: 1 },
        durationMs: 1,
      },
    ],
  },
];
(invalidScrollReverse.motionSequences[0] as unknown as Record<string, unknown>).playbackDirection = 'reverse';
invalidScrollReverse.scrollScenes = [
  {
    id: 'scene-hero',
    sectionId: 'hero',
    sequenceId: 'scroll-reverse',
    pinTarget: { type: 'section', sectionId: 'hero' },
    startOffsetPx: 0,
    endOffsetPx: 720,
  },
];
const invalidScrollReverseValidation = validateEditableSite(invalidScrollReverse);
assert(!invalidScrollReverseValidation.valid, 'scroll-scrubbed Motion Sequences must reject reverse playback');
assert(
  invalidScrollReverseValidation.errors.some((error) => error.includes('motionSequences[0].playbackDirection')),
  `scroll reverse failure must mention playbackDirection; got ${invalidScrollReverseValidation.valid ? '' : invalidScrollReverseValidation.errors.join('; ')}`,
);

const invalidScrollWait = baseSite();
invalidScrollWait.motionSequences = [
  {
    id: 'scroll-wait',
    trigger: { type: 'scroll-scene', scrollSceneId: 'scene-hero' },
    steps: [
      {
        id: 'site-fade',
        target: { type: 'site' },
        to: { opacity: 1 },
        durationMs: 1,
      },
    ],
  },
];
(invalidScrollWait.motionSequences[0]!.steps[0] as unknown as Record<string, unknown>).waitAfterMs = 100;
invalidScrollWait.scrollScenes = [
  {
    id: 'scene-hero',
    sectionId: 'hero',
    sequenceId: 'scroll-wait',
    pinTarget: { type: 'section', sectionId: 'hero' },
    startOffsetPx: 0,
    endOffsetPx: 720,
  },
];
const invalidScrollWaitValidation = validateEditableSite(invalidScrollWait);
assert(!invalidScrollWaitValidation.valid, 'scroll-scrubbed Motion Sequences must reject waitAfterMs');
assert(
  invalidScrollWaitValidation.errors.some((error) => error.includes('motionSequences[0].steps[0].waitAfterMs')),
  `scroll wait failure must mention waitAfterMs; got ${invalidScrollWaitValidation.valid ? '' : invalidScrollWaitValidation.errors.join('; ')}`,
);

const invalidScrollStartAt = baseSite();
invalidScrollStartAt.motionSequences = [
  {
    id: 'scroll-start-at',
    trigger: { type: 'scroll-scene', scrollSceneId: 'scene-hero' },
    steps: [
      {
        id: 'site-fade',
        target: { type: 'site' },
        to: { opacity: 1 },
        durationMs: 1,
      },
    ],
  },
];
(invalidScrollStartAt.motionSequences[0]!.steps[0] as unknown as Record<string, unknown>).startAtMs = 100;
invalidScrollStartAt.scrollScenes = [
  {
    id: 'scene-hero',
    sectionId: 'hero',
    sequenceId: 'scroll-start-at',
    pinTarget: { type: 'section', sectionId: 'hero' },
    startOffsetPx: 0,
    endOffsetPx: 720,
  },
];
const invalidScrollStartAtValidation = validateEditableSite(invalidScrollStartAt);
assert(!invalidScrollStartAtValidation.valid, 'scroll-scrubbed Motion Sequences must reject startAtMs');
assert(
  invalidScrollStartAtValidation.errors.some((error) =>
    error.includes('motionSequences[0].steps[0].startAtMs'),
  ),
  `scroll startAtMs failure must mention startAtMs; got ${invalidScrollStartAtValidation.valid ? '' : invalidScrollStartAtValidation.errors.join('; ')}`,
);

const invalidDirection = baseSite();
(invalidDirection.motionSequences![0] as unknown as Record<string, unknown>).playbackDirection = 'sideways';
const invalidDirectionValidation = validateEditableSite(invalidDirection);
assert(!invalidDirectionValidation.valid, 'unsupported Motion Sequence playback direction must fail validation');
assert(
  invalidDirectionValidation.errors.some((error) => error.includes('motionSequences[0].playbackDirection')),
  `invalid playback direction failure must mention playbackDirection; got ${invalidDirectionValidation.valid ? '' : invalidDirectionValidation.errors.join('; ')}`,
);

const invalidCount = baseSite();
(
  (invalidCount.motionSequences as Array<{ repeat: { count: number } }>)[0]!
).repeat.count = 21;
const invalidCountValidation = validateEditableSite(invalidCount);
assert(!invalidCountValidation.valid, 'repeat count above the supported range must fail validation');
assert(
  invalidCountValidation.errors.some((error) => error.includes('motionSequences[0].repeat.count')),
  `repeat count failure must mention count; got ${invalidCountValidation.valid ? '' : invalidCountValidation.errors.join('; ')}`,
);

const invalidWait = baseSite();
(invalidWait.motionSequences![0]!.steps[0] as unknown as Record<string, unknown>).waitAfterMs = -1;
const invalidWaitValidation = validateEditableSite(invalidWait);
assert(!invalidWaitValidation.valid, 'negative Motion Sequence waitAfterMs must fail validation');
assert(
  invalidWaitValidation.errors.some((error) => error.includes('motionSequences[0].steps[0].waitAfterMs')),
  `negative wait failure must mention waitAfterMs; got ${invalidWaitValidation.valid ? '' : invalidWaitValidation.errors.join('; ')}`,
);

const invalidStartAt = baseSite();
(invalidStartAt.motionSequences![0]!.steps[0] as unknown as Record<string, unknown>).startAtMs = -1;
const invalidStartAtValidation = validateEditableSite(invalidStartAt);
assert(!invalidStartAtValidation.valid, 'negative Motion Sequence startAtMs must fail validation');
assert(
  invalidStartAtValidation.errors.some((error) => error.includes('motionSequences[0].steps[0].startAtMs')),
  `negative startAtMs failure must mention startAtMs; got ${invalidStartAtValidation.valid ? '' : invalidStartAtValidation.errors.join('; ')}`,
);

const doc = new StubDocument();
const script = new StubElement('script');
script.setAttribute('data-opencanvas-behaviour-payload', '');
script.textContent = serializeBehaviourPayload({
  motionSequences: valid.motionSequences as never,
  scrollScenes: [],
  richMotionAssets: [],
});
doc.body.appendChild(script);
runBehaviour(doc, new StubWindow());
const animation = doc.documentElement.animations[0];
assert(animation !== undefined, 'load-enter repeat sequence must animate the site target');
assert(animation.options.iterations === 3, 'repeat count 2 must run 3 total iterations');
assert(animation.options.direction === 'alternate', 'yoyo repeat mode must map to alternate direction');
assert(
  (animation.keyframes[0] as { opacity?: number }).opacity === 1,
  'reverse playback must start from the authored to state',
);
assert(
  (animation.keyframes[1] as { opacity?: number }).opacity === 0,
  'reverse playback must end at the authored from state',
);
const secondAnimation = doc.documentElement.animations[1];
assert(secondAnimation !== undefined, 'timed Motion Sequence must animate the next authored step');
assert(
  secondAnimation.options.delay === 420,
  `waitAfterMs must offset the next timed step by prior duration plus wait; got ${String(secondAnimation.options.delay)}`,
);
assert(
  (secondAnimation.keyframes[0] as { strokeDashoffset?: number }).strokeDashoffset === 0,
  'reverse stroke draw playback must start from the authored stroke-dash to state',
);
assert(
  (secondAnimation.keyframes[1] as { strokeDashoffset?: number }).strokeDashoffset === 240,
  'reverse stroke draw playback must end at the authored stroke-dash from state',
);
assert(
  (secondAnimation.keyframes[0] as { strokeDasharray?: number }).strokeDasharray === 240,
  'stroke draw playback must emit strokeDasharray keyframes',
);
assert(
  (secondAnimation.keyframes[0] as { fontVariationSettings?: string }).fontVariationSettings === '"wght" 820, "wdth" 120',
  'reverse variable font playback must start from the authored axis to state',
);
assert(
  (secondAnimation.keyframes[1] as { fontVariationSettings?: string }).fontVariationSettings === '"wght" 300, "wdth" 80',
  'reverse variable font playback must end at the authored axis from state',
);
const overlapAnimation = doc.documentElement.animations[2];
assert(overlapAnimation !== undefined, 'timed Motion Sequence must animate the absolute-positioned step');
assert(
  overlapAnimation.options.delay === 120,
  `startAtMs must schedule the step at its authored absolute offset; got ${String(overlapAnimation.options.delay)}`,
);
assert(
  (overlapAnimation.keyframes[0] as { transform?: string }).transform?.includes('scale(1.2)') === true,
  'reverse overlapping step must still emit authored transform keyframes',
);

const panelSource = readFileSync(join(process.cwd(), 'src', 'editor-client', 'interactions-panel.ts'), 'utf8');
assert(panelSource.includes('Repeat count'), 'Interactions panel must expose Motion Sequence repeat count');
assert(panelSource.includes('Repeat mode'), 'Interactions panel must expose Motion Sequence repeat mode');
assert(panelSource.includes('Playback direction'), 'Interactions panel must expose Motion Sequence playback direction');
assert(panelSource.includes('Start at'), 'Interactions panel must expose Motion Sequence absolute start controls');
assert(panelSource.includes('Wait after'), 'Interactions panel must expose Motion Sequence wait-after controls');
assert(panelSource.includes('Stroke dash offset'), 'Interactions panel must expose Motion Sequence stroke-draw controls');
assert(panelSource.includes('Clip path'), 'Interactions panel must expose Motion Sequence clip-path controls');
assert(panelSource.includes('Filter'), 'Interactions panel must expose Motion Sequence filter controls');
assert(panelSource.includes('Variable font weight'), 'Interactions panel must expose Motion Sequence variable-font controls');

console.log('[motion-sequence-repeat:smoke] OK');
