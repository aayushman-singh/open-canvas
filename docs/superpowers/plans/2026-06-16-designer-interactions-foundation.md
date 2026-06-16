# Designer Interactions Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the typed foundation for ADR 0069, ADR 0070, and ADR 0072 without yet wiring it into persisted site state.

**Architecture:** Phase one creates pure domain modules with validators and smoke tests. The modules are intentionally disjoint so workers can implement them in parallel without touching shared schema/runtime files. Later phases integrate these models into `EditableSite`, renderer, Runtime Hydrator, importer, and editor controls.

**Tech Stack:** TypeScript, Bun smoke tests, existing fail-loud validation style from `src/canvas/validate.ts`.

---

## Boundaries

- Do not modify `src/canvas/schema.ts` in this phase.
- Do not modify `src/routes/public.ts` in this phase.
- Do not install animation/runtime packages in this phase.
- Do not use GSAP.
- Each worker owns only its listed files.

## Task 1: Interaction And Motion Model

**Files:**

- Create: `src/canvas/interactions.ts`
- Create: `src/canvas/interactions.smoke.ts`

- [ ] **Step 1: Write the failing smoke**

Create `src/canvas/interactions.smoke.ts` with assertions for:

```ts
import {
  validateMotionSequence,
  validateScrollScene,
  type MotionSequence,
  type ScrollScene,
} from './interactions';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[interactions:smoke] ${message}`);
}

function expectInvalid(label: string, fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    assert(
      err instanceof Error && err.message.includes(label),
      `expected error to mention ${label}`,
    );
  }
  assert(threw, `expected ${label} to fail`);
}

const sequence: MotionSequence = {
  id: 'hero-intro',
  trigger: { type: 'load' },
  steps: [
    {
      id: 'headline-in',
      target: { type: 'element', elementId: 'headline' },
      properties: { opacity: [0, 1], y: [24, 0] },
      durationMs: 700,
      easing: 'out-cubic',
      delayMs: 100,
    },
    {
      id: 'words',
      target: { type: 'text-split', elementId: 'headline', split: 'word' },
      properties: { opacity: [0, 1] },
      durationMs: 350,
      staggerMs: 45,
    },
  ],
};

validateMotionSequence(sequence);

expectInvalid('durationMs', () =>
  validateMotionSequence({
    ...sequence,
    steps: [{ ...sequence.steps[0]!, durationMs: -1 }],
  }),
);

expectInvalid('properties', () =>
  validateMotionSequence({
    ...sequence,
    steps: [{ ...sequence.steps[0]!, properties: { left: [0, 100] } }],
  }),
);

const scene: ScrollScene = {
  id: 'case-study-scroll',
  trigger: { type: 'scroll-progress', sectionId: 'case-study' },
  start: 'top bottom',
  end: 'bottom top',
  axis: 'y',
  scrub: true,
  sequence,
};

validateScrollScene(scene);

expectInvalid('start', () => validateScrollScene({ ...scene, start: '' }));
expectInvalid('axis', () => validateScrollScene({ ...scene, axis: 'z' as 'x' }));

console.log('[interactions:smoke] OK');
```

- [ ] **Step 2: Run the smoke and verify it fails**

Run: `bun run src/canvas/interactions.smoke.ts`

Expected: fails because `src/canvas/interactions.ts` does not exist.

- [ ] **Step 3: Implement the model and validators**

Create `src/canvas/interactions.ts` with:

```ts
export const INTERACTION_TRIGGER_TYPES = [
  'load',
  'viewport-enter',
  'scroll-progress',
  'hover',
  'pointer-move',
  'click',
  'route-navigation',
  'media-ready',
] as const;

export type InteractionTriggerType = (typeof INTERACTION_TRIGGER_TYPES)[number];

export type InteractionTrigger =
  | { type: 'load' }
  | { type: 'viewport-enter'; sectionId?: string; elementId?: string }
  | { type: 'scroll-progress'; sectionId?: string; elementId?: string }
  | { type: 'hover'; elementId: string }
  | { type: 'pointer-move'; elementId?: string }
  | { type: 'click'; elementId: string }
  | { type: 'route-navigation'; fromPageId?: string; toPageId?: string }
  | { type: 'media-ready'; assetId: string };

export const INTERACTION_TARGET_TYPES = [
  'page',
  'section',
  'element',
  'component-part',
  'text-split',
  'overlay',
] as const;

export type InteractionTargetType = (typeof INTERACTION_TARGET_TYPES)[number];
export type TextSplitMode = 'character' | 'word' | 'line';

export type InteractionTarget =
  | { type: 'page'; pageId: string }
  | { type: 'section'; sectionId: string }
  | { type: 'element'; elementId: string }
  | { type: 'component-part'; elementId: string; part: string }
  | { type: 'text-split'; elementId: string; split: TextSplitMode }
  | { type: 'overlay'; overlayId: string };

export const MOTION_PROPERTY_NAMES = [
  'opacity',
  'x',
  'y',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'blur',
  'clipPath',
  'filter',
  'backgroundColor',
  'color',
  'strokeDashoffset',
] as const;

export type MotionPropertyName = (typeof MOTION_PROPERTY_NAMES)[number];
export type MotionPropertyValue = number | string;
export type MotionPropertyRange = [MotionPropertyValue, MotionPropertyValue];
export type MotionProperties = Partial<Record<MotionPropertyName, MotionPropertyRange>>;

export interface MotionStep {
  id: string;
  target: InteractionTarget;
  properties: MotionProperties;
  durationMs: number;
  easing?: string;
  delayMs?: number;
  staggerMs?: number;
}

export interface MotionSequence {
  id: string;
  trigger: InteractionTrigger;
  steps: MotionStep[];
}

export interface ScrollScene {
  id: string;
  trigger: Extract<InteractionTrigger, { type: 'scroll-progress' }>;
  start: string;
  end: string;
  axis: 'x' | 'y';
  scrub: boolean;
  pin?: boolean;
  snapPoints?: number[];
  sequence: MotionSequence;
}

export function validateMotionSequence(sequence: MotionSequence): void;
export function validateScrollScene(scene: ScrollScene): void;
```

Implementation rules:

- Non-empty ids are required.
- `steps` must contain at least one step.
- `durationMs`, `delayMs`, and `staggerMs` must be finite non-negative numbers.
- `properties` must contain at least one whitelisted key.
- Unknown property keys fail loudly with the property name.
- `ScrollScene.start` and `ScrollScene.end` must be non-empty.
- `ScrollScene.axis` must be `x` or `y`.
- `snapPoints`, when present, must be finite numbers in `[0, 1]`.

- [ ] **Step 4: Run the smoke and verify it passes**

Run: `bun run src/canvas/interactions.smoke.ts`

Expected: `[interactions:smoke] OK`

## Task 2: Overlay Model

**Files:**

- Create: `src/canvas/overlays.ts`
- Create: `src/canvas/overlays.smoke.ts`

- [ ] **Step 1: Write the failing smoke**

Create `src/canvas/overlays.smoke.ts` with assertions for:

```ts
import { validateOverlay, type Overlay } from './overlays';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[overlays:smoke] ${message}`);
}

function expectInvalid(label: string, fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    assert(
      err instanceof Error && err.message.includes(label),
      `expected error to mention ${label}`,
    );
  }
  assert(threw, `expected ${label} to fail`);
}

const overlay: Overlay = {
  id: 'project-detail',
  contentSectionId: 'overlay-project-detail',
  trigger: { type: 'click', elementId: 'project-card' },
  modality: 'modal',
  placement: { type: 'center' },
  dismissal: {
    closeButton: true,
    escapeKey: true,
    backdropClick: true,
    routeChange: true,
  },
  focus: {
    initial: { type: 'overlay' },
    returnTo: { type: 'trigger' },
    trap: true,
  },
  bodyScroll: 'lock',
  openSequenceId: 'overlay-open',
  closeSequenceId: 'overlay-close',
};

validateOverlay(overlay);

expectInvalid('contentSectionId', () => validateOverlay({ ...overlay, contentSectionId: '' }));
expectInvalid('dismissal', () =>
  validateOverlay({
    ...overlay,
    dismissal: { closeButton: false, escapeKey: false, backdropClick: false, routeChange: false },
  }),
);
expectInvalid('focus.trap', () =>
  validateOverlay({ ...overlay, modality: 'modal', focus: { ...overlay.focus, trap: false } }),
);

console.log('[overlays:smoke] OK');
```

- [ ] **Step 2: Run the smoke and verify it fails**

Run: `bun run src/canvas/overlays.smoke.ts`

Expected: fails because `src/canvas/overlays.ts` does not exist.

- [ ] **Step 3: Implement the overlay contract**

Create `src/canvas/overlays.ts` with exported:

```ts
import type { InteractionTrigger } from './interactions';

export type OverlayModality = 'modal' | 'non-modal';
export type OverlayBodyScroll = 'lock' | 'allow';

export type OverlayPlacement =
  | { type: 'center' }
  | { type: 'fullscreen' }
  | { type: 'anchored'; anchorElementId: string; side: 'top' | 'right' | 'bottom' | 'left' };

export interface OverlayDismissal {
  closeButton: boolean;
  escapeKey: boolean;
  backdropClick: boolean;
  routeChange: boolean;
}

export type OverlayFocusTarget =
  | { type: 'overlay' }
  | { type: 'first-focusable' }
  | { type: 'element'; elementId: string }
  | { type: 'trigger' };

export interface OverlayFocusContract {
  initial: OverlayFocusTarget;
  returnTo: OverlayFocusTarget;
  trap: boolean;
}

export interface Overlay {
  id: string;
  contentSectionId: string;
  trigger: InteractionTrigger;
  modality: OverlayModality;
  placement: OverlayPlacement;
  dismissal: OverlayDismissal;
  focus: OverlayFocusContract;
  bodyScroll: OverlayBodyScroll;
  openSequenceId?: string;
  closeSequenceId?: string;
}

export function validateOverlay(overlay: Overlay): void;
```

Validation rules:

- `id` and `contentSectionId` must be non-empty.
- `trigger.type === 'click'` must carry a non-empty `elementId`.
- At least one dismissal boolean must be `true`.
- `modal` overlays must set `focus.trap === true`.
- `anchored` placement must carry a non-empty `anchorElementId`.
- `bodyScroll` must be `lock` or `allow`.

- [ ] **Step 4: Run the smoke and verify it passes**

Run: `bun run src/canvas/overlays.smoke.ts`

Expected: `[overlays:smoke] OK`

## Task 3: Rich Motion Asset Model

**Files:**

- Create: `src/canvas/rich-motion-assets.ts`
- Create: `src/canvas/rich-motion-assets.smoke.ts`

- [ ] **Step 1: Write the failing smoke**

Create `src/canvas/rich-motion-assets.smoke.ts` with assertions for:

```ts
import { validateRichMotionAsset, type RichMotionAsset } from './rich-motion-assets';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[rich-motion-assets:smoke] ${message}`);
}

function expectInvalid(label: string, fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    assert(
      err instanceof Error && err.message.includes(label),
      `expected error to mention ${label}`,
    );
  }
  assert(threw, `expected ${label} to fail`);
}

const lottie: RichMotionAsset = {
  id: 'asset-lottie',
  ownerAssetId: 'owner-asset-lottie',
  family: 'vector-animation',
  source: { kind: 'lottie-json' },
  playback: { trigger: { type: 'viewport-enter' }, loop: false, speed: 1, reducedMotion: 'poster' },
};

validateRichMotionAsset(lottie);

const rive: RichMotionAsset = {
  id: 'asset-rive',
  ownerAssetId: 'owner-asset-rive',
  family: 'interactive-vector',
  source: { kind: 'rive', stateMachine: 'Hero' },
  playback: {
    trigger: { type: 'hover', elementId: 'hero-card' },
    loop: true,
    speed: 1,
    reducedMotion: 'pause',
  },
};

validateRichMotionAsset(rive);

expectInvalid('ownerAssetId', () => validateRichMotionAsset({ ...lottie, ownerAssetId: '' }));
expectInvalid('speed', () =>
  validateRichMotionAsset({ ...lottie, playback: { ...lottie.playback, speed: 0 } }),
);
expectInvalid('frames', () =>
  validateRichMotionAsset({
    id: 'seq',
    ownerAssetId: 'seq-manifest',
    family: 'image-sequence',
    source: { kind: 'image-sequence', frameAssetIds: [] },
    playback: {
      trigger: { type: 'scroll-progress' },
      loop: false,
      speed: 1,
      reducedMotion: 'poster',
    },
  }),
);

console.log('[rich-motion-assets:smoke] OK');
```

- [ ] **Step 2: Run the smoke and verify it fails**

Run: `bun run src/canvas/rich-motion-assets.smoke.ts`

Expected: fails because `src/canvas/rich-motion-assets.ts` does not exist.

- [ ] **Step 3: Implement the rich motion asset contract**

Create `src/canvas/rich-motion-assets.ts` with exported:

```ts
import type { InteractionTrigger } from './interactions';

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

export function validateRichMotionAsset(asset: RichMotionAsset): void;
```

Validation rules:

- `id` and `ownerAssetId` must be non-empty.
- `speed` must be finite and greater than `0`.
- `image-sequence` must contain at least one `frameAssetIds` entry.
- `bounded-3d` must carry a non-empty `sceneDescriptorAssetId`.
- `family` and `source.kind` must be compatible:
  - `vector-animation`: `lottie-json` or `dotlottie`
  - `interactive-vector`: `rive`
  - `image-sequence`: `image-sequence`
  - `bounded-3d`: `bounded-3d`

- [ ] **Step 4: Run the smoke and verify it passes**

Run: `bun run src/canvas/rich-motion-assets.smoke.ts`

Expected: `[rich-motion-assets:smoke] OK`

## Phase Verification

Run these from `C:/Repo/open-canvas/.worktrees/designer-interactions-runtime`:

```bash
bun run src/canvas/interactions.smoke.ts
bun run src/canvas/overlays.smoke.ts
bun run src/canvas/rich-motion-assets.smoke.ts
bun run typecheck
```

Expected: all commands exit `0`.
