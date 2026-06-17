# Velocity Athlete Fidelity Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one original, high-fidelity "Velocity Athlete" template that proves Open Canvas can reproduce the class of interaction and composition observed in the Lando Norris benchmark without copying protected assets, source, brand, or copy.

**Architecture:** Add a small behaviour graph to `EditableSite`, target existing sections/elements by id, render a validated JSON behaviour payload, hydrate it through the existing interactive runtime entrypoint, and compose the template from Section Library entries referenced by a `TemplateSeed`.

**Tech Stack:** TypeScript, Bun, Section Library JSON, existing Canvas element dispatch tables, native browser Web Animations API, native canvas/image-sequence rendering, existing smoke tests. No GSAP and no arbitrary custom JS.

## Global Constraints

- The shipped template is fictional and original. Do not use Lando Norris, McLaren, Quadrant, sponsor marks, scraped copy, scraped images, scraped scripts, or scraped asset URLs.
- Do not add GSAP, ScrollTrigger, Lenis, Rive, Three.js, or Webflow runtime code in this slice. The first rich-motion adapter is a native image-sequence adapter backed by original seed assets.
- Do not store free-form script strings in templates. Behaviour must be schema-owned, validator-owned, renderer-owned, and runtime-owned.
- Failure is explicit. Missing behaviour targets, unknown adapter kinds, failed image-sequence frame loads, unsupported motion properties, and unresolved section refs must throw or emit a clear failure event with context; they must not silently degrade.
- Keep unrelated dirty worktree files untouched. Stage only files changed for this feature.
- Use `pathlib` or Node `path` helpers in scripts; do not hardcode platform separators.
- No TODO comments.

---

## Scope Check

This plan is one vertical slice, not the entire Awwwards capability set. It includes:

- Load Experience
- Motion Sequence
- Text Split Target
- Scroll Scene
- Rich Motion Asset with native image-sequence adapter
- Velocity Athlete template seed and section entries
- A fidelity ledger smoke that protects the benchmark-critical contracts

This plan explicitly excludes:

- Menu Overlay
- Route Transition
- Pointer gesture expansion
- Rive/Three/WebGL adapters
- A general website importer
- Rewriting legacy carousel/accordion hydration internals

Those exclusions keep the first slice shippable while still proving the hard parts that current templates cannot express.

## File Map

Create:

- `src/canvas/behaviour-primitives.ts`
- `src/canvas/behaviour-primitives.smoke.ts`
- `src/canvas/elements/rich-motion.ts`
- `src/canvas/elements/rich-motion.smoke.ts`
- `src/interactive/behaviour.ts`
- `src/interactive/behaviour.smoke.ts`
- `src/templates/velocity-athlete-fidelity.smoke.ts`
- `scripts/sync-section-library-manifest.ts`
- `src/canvas/section-library/entries/velocity-template-header.json`
- `src/canvas/section-library/entries/velocity-template-hero.json`
- `src/canvas/section-library/entries/velocity-template-impact.json`
- `src/canvas/section-library/entries/velocity-template-story.json`
- `src/canvas/section-library/entries/velocity-template-artifacts.json`
- `src/canvas/section-library/entries/velocity-template-store.json`
- `src/canvas/section-library/entries/velocity-template-footer.json`
- `src/assets/seed-source/velocity-helmet-frame-00.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-01.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-02.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-03.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-04.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-05.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-06.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-07.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-08.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-09.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-10.svg.b64`
- `src/assets/seed-source/velocity-helmet-frame-11.svg.b64`
- `src/assets/seed-source/velocity-track-study.svg.b64`
- `src/assets/seed-source/velocity-garage-study.svg.b64`
- `src/assets/seed-source/velocity-suit-study.svg.b64`
- `src/assets/seed-source/velocity-product-study.svg.b64`

Modify:

- `package.json`
- `src/canvas/schema.ts`
- `src/canvas/validate.ts`
- `src/canvas/render.ts`
- `src/canvas/yjs-projection.ts`
- `src/canvas/yjs-projection.smoke.ts`
- `src/canvas/seed-assets.ts`
- `src/canvas/section-library/entries/manifest.ts`
- `src/canvas/section-library/registry.ts`
- `src/canvas/section-library/extraction.smoke.ts`
- `src/canvas/section-library/origin-mapping.ts`
- `src/canvas/elements/index.ts`
- `src/editor-client/body-builders-data.ts`
- `src/editor-client/hydrate-interactives.ts`
- `src/editor-client/render.ts`
- `src/editor-client/sidebar-factories.ts`
- `src/templates/registry.ts`

## Task 1: Add The Red Fidelity Ledger Smoke

- [ ] Create `src/templates/velocity-athlete-fidelity.smoke.ts`.
- [ ] Add package script:

```json
"velocity-athlete:smoke": "bun run src/templates/velocity-athlete-fidelity.smoke.ts"
```

- [ ] The smoke must fail before implementation because `velocity-athlete` does not exist yet.
- [ ] Use this structure:

```ts
import { injectInteractiveRuntime } from '../interactive/inject.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { validateEditableSite, validatePublishedSnapshot } from '../canvas/validate.js';
import { getTemplateSeed, instantiateTemplate } from './registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[velocity-athlete:smoke] ${message}`);
}

const seed = getTemplateSeed('velocity-athlete');
assert(seed !== null, 'velocity-athlete template seed must be registered');

const state = instantiateTemplate('velocity-athlete');
const editValidation = validateEditableSite(state);
assert(editValidation.valid, editValidation.valid ? '' : editValidation.errors.join('\n'));

const snapshot: PublishedSnapshot = {
  ...state,
  version: 1,
  publishedAt: '2026-06-17T00:00:00.000Z',
};
const publishValidation = validatePublishedSnapshot(snapshot);
assert(publishValidation.valid, publishValidation.valid ? '' : publishValidation.errors.join('\n'));

const html = injectInteractiveRuntime(
  renderCanvasSnapshot(snapshot, '/assets', 'site_velocity_smoke', {
    turnstileSiteKey: '1x00000000000000000000AA',
  }),
  snapshot,
);

const forbidden = ['lando', 'norris', 'mclaren', 'quadrant', 'gsap', 'ScrollTrigger'];
for (const token of forbidden) {
  assert(!html.toLowerCase().includes(token.toLowerCase()), `rendered template leaks forbidden token ${token}`);
}

assert(state.loadExperience !== undefined, 'template must define a Load Experience');
assert((state.motionSequences ?? []).length >= 3, 'template must define at least three Motion Sequences');
assert((state.scrollScenes ?? []).length >= 1, 'template must define at least one Scroll Scene');
assert((state.richMotionAssets ?? []).length >= 1, 'template must define at least one Rich Motion Asset');
assert(html.includes('data-opencanvas-load-experience'), 'rendered HTML must include load-experience chrome');
assert(html.includes('data-opencanvas-rich-motion'), 'rendered HTML must include a rich-motion element');
assert(html.includes('data-opencanvas-behaviour-payload'), 'rendered HTML must include the behaviour payload');
assert(html.includes('data-opencanvas-interactive-runtime'), 'rendered HTML must include the interactive runtime');
```

- [ ] Run and capture the expected failure:

```powershell
bun run velocity-athlete:smoke
```

## Task 2: Define Behaviour Primitives In The Canvas Schema

- [ ] Create `src/canvas/behaviour-primitives.ts` with closed enums and types.
- [ ] Use these public contracts:

```ts
export const BEHAVIOUR_TARGET_TYPES = ['site', 'page', 'section', 'element', 'text-split'] as const;
export const TEXT_SPLIT_UNITS = ['word', 'line', 'char'] as const;
export const MOTION_SEQUENCE_TRIGGER_TYPES = ['load-enter', 'section-enter', 'scroll-scene'] as const;
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
  trigger: { type: 'load-enter' } | { type: 'section-enter'; sectionId: string } | { type: 'scroll-scene'; scrollSceneId: string };
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
  playback: { driver: 'load' | 'scroll-scene'; fps?: number; loop?: boolean; scrollSceneId?: string };
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
```

- [ ] Add these optional fields to `EditableSiteBase` in `src/canvas/schema.ts`:

```ts
loadExperience?: LoadExperience;
motionSequences?: MotionSequence[];
scrollScenes?: ScrollScene[];
richMotionAssets?: RichMotionAsset[];
```

- [ ] Extend `TemplateSeed` in `src/templates/registry.ts` with the same optional site-level fields and deep-clone them in `instantiateTemplate`.
- [ ] Add `validateBehaviourPrimitives(state, errors)` in `src/canvas/validate.ts` and call it from `validateSiteShape` after page/header/footer validation has collected ids.
- [ ] Validate:
  - unique ids for load experience, sequences, scroll scenes, rich motion assets, and sequence steps
  - load experience `sequenceId` resolves
  - every motion target resolves to an existing page, section, element, or text element
  - every motion property is in `MOTION_SEQUENCE_PROPERTIES`
  - every duration, delay, stagger, start offset, and end offset is finite and non-negative
  - scroll scene `sectionId`, `pinTarget`, and `sequenceId` resolve
  - rich motion kind is `image-sequence`
  - image sequence has at least 2 frame ids, a non-empty poster id, and asset-id-shaped frame ids
  - `playback.driver === 'scroll-scene'` requires a resolving `scrollSceneId`
- [ ] Create `src/canvas/behaviour-primitives.smoke.ts` covering one valid state and these invalid cases:
  - sequence targets a missing element
  - scroll scene references a missing sequence
  - rich motion asset has empty `frameAssetIds`
  - load experience references a missing sequence
  - step uses an unsupported property name
- [ ] Add package script:

```json
"behaviour-primitives:smoke": "bun run src/canvas/behaviour-primitives.smoke.ts"
```

- [ ] Run:

```powershell
bun run behaviour-primitives:smoke
bun run validate-parity:smoke
```

## Task 3: Add The Rich Motion Element

- [ ] Add `rich-motion` to `ELEMENT_TYPES` in `src/canvas/schema.ts`.
- [ ] Create `src/canvas/elements/rich-motion.ts`:

```ts
import type { BackgroundSize, BaseElement } from '../schema.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, styleFromEntries } from './render-utils.js';

export interface RichMotionElement extends BaseElement {
  type: 'rich-motion';
  assetRefId: string;
  fit: BackgroundSize;
  label: string;
}

export function renderRichMotion(element: RichMotionElement): string {
  const style = styleFromEntries([
    ['width', '100%'],
    ['height', '100%'],
    ['display', 'block'],
  ]);
  return `<div class="opencanvas-rich-motion" data-opencanvas-rich-motion="${escapeAttr(element.id)}" data-rich-motion-asset-ref="${escapeAttr(element.assetRefId)}" aria-label="${escapeAttr(element.label)}" style="${style}"><canvas data-opencanvas-rich-motion-canvas="${escapeAttr(element.id)}" style="${style}"></canvas></div>`;
}

export const richMotionInspectorSpec: InspectorSpec = {
  fields: [
    { kind: 'text', label: 'Label', path: 'label' },
    { kind: 'text', label: 'Asset ref', path: 'assetRefId' },
    { kind: 'select', label: 'Fit', path: 'fit', options: ['cover', 'contain'] },
  ],
};

export const richMotionSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'rich-motion',
      sidebarLabel: 'Rich Motion',
      sidebarTip: 'Add a structured motion asset',
      toolbarLabel: '+Motion',
      toolbarTip: 'Add rich motion',
      factoryName: 'rich-motion',
    },
  ],
};

export const richMotionAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    assetRefId: { type: 'string', description: 'Rich Motion Asset id referenced by this element.' },
    label: { type: 'string', description: 'Accessible label for the motion asset.' },
    fit: { type: 'string', enum: ['cover', 'contain'], description: 'How the motion canvas fits inside the element frame.' },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.assetRefId !== undefined) {
      if (typeof args.assetRefId !== 'string') throw new Error('assetRefId must be a string');
      patch.assetRefId = args.assetRefId;
    }
    if (args.label !== undefined) {
      if (typeof args.label !== 'string') throw new Error('label must be a string');
      patch.label = args.label;
    }
    if (args.fit !== undefined) {
      if (args.fit !== 'cover' && args.fit !== 'contain') throw new Error('fit must be cover or contain');
      patch.fit = args.fit;
    }
    return patch;
  },
};
```

- [ ] Wire the element through `src/canvas/elements/index.ts` render, inspector, agent tool, and sidebar dispatch.
- [ ] Re-export `RichMotionElement` from `src/canvas/schema.ts`.
- [ ] Update `src/editor-client/body-builders-data.ts` with `buildRichMotionBodyImpl`.
- [ ] Update `src/editor-client/sidebar-factories.ts`:

```ts
| 'rich-motion'
```

and:

```ts
'rich-motion': () => ({
  defaultSize: { w: 520, h: 520 },
  payload: {
    type: 'rich-motion',
    assetRefId: '__placeholder__',
    fit: 'contain',
    label: 'Rich motion asset',
  },
}),
```

- [ ] Update `src/canvas/yjs-projection.ts` encode/decode dispatch and the synthetic fixture in `src/canvas/yjs-projection.smoke.ts`.
- [ ] Add publish-only validation that rejects `rich-motion.assetRefId === '__placeholder__'`, a missing referenced `richMotionAssets[]` entry, or an unsupported asset kind. Extend `PUBLISH_ONLY_REQUIRED_FIELDS` with `richMotion.assetRefId-resolves` and update `validate-parity.smoke.ts`.
- [ ] Add `src/canvas/elements/rich-motion.smoke.ts` to assert render output, validator acceptance, placeholder publish rejection, dispatch coverage, and Yjs round trip.
- [ ] Add package script:

```json
"rich-motion:smoke": "bun run src/canvas/elements/rich-motion.smoke.ts"
```

- [ ] Run:

```powershell
bun run rich-motion:smoke
bun run element-files:smoke
bun run element-dispatch:smoke
bun run inspector-dispatch:smoke
bun run agent-tool-dispatch:smoke
bun run sidebar-dispatch:smoke
bun run yjs-projection:smoke
```

## Task 4: Render And Hydrate The Behaviour Payload

- [ ] Add `BEHAVIOUR_RUNTIME_SRC` to `src/interactive/behaviour.ts`.
- [ ] The runtime must:
  - parse the single `[data-opencanvas-behaviour-payload]` JSON block
  - hydrate `[data-opencanvas-load-experience]`
  - split text targets into spans for `text-split` steps
  - execute load and section-enter sequences with Web Animations API
  - drive scroll-scene sequences with `scroll` plus `requestAnimationFrame`
  - hydrate `image-sequence` rich motion assets into their canvas
  - log and throw with `{ code, context, cause }` when a target, frame, canvas, sequence, scene, or asset cannot resolve
- [ ] Use this failure helper in the runtime source string:

```js
function behaviourFailure(code, context, cause) {
  var detail = { code: code, context: context, cause: cause && cause.message ? cause.message : String(cause) };
  if (typeof console !== 'undefined' && console.error) console.error('[opencanvas behaviour]', detail);
  if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('opencanvas:behaviour-failure', { detail: detail }));
  }
  throw cause instanceof Error ? cause : new Error(code + ': ' + detail.cause);
}
```

- [ ] Update `src/interactive/build.ts` to include `BEHAVIOUR_RUNTIME_SRC` inside the existing IIFE.
- [ ] Update `src/interactive/inject.ts`:
  - `snapshotNeedsInteractiveRuntime` returns true when any behaviour primitive exists
  - element walking recurses into `flow-container.items[]` as well as tabs and collection entries
- [ ] Update `src/canvas/render.ts`:
  - render load-experience chrome when `snapshot.loadExperience` exists
  - render a `<script type="application/json" data-opencanvas-behaviour-payload>` block when any behaviour primitive exists
  - escape `<` in serialized JSON as `\u003c`
- [ ] Payload shape:

```ts
interface BehaviourPayload {
  loadExperience?: LoadExperience;
  motionSequences: MotionSequence[];
  scrollScenes: ScrollScene[];
  richMotionAssets: Array<RichMotionAsset & { frameUrls?: string[]; posterUrl?: string }>;
}
```

- [ ] Resolve image-sequence URLs during render using the same `assetBasePath` used by media elements.
- [ ] Update `src/editor-client/hydrate-interactives.ts` so `hydrateInteractives(root, { skipPopups: true, behaviourState: ctx.state })` hydrates new behaviour primitives in editor preview.
- [ ] Update `src/editor-client/render.ts` to pass `ctx.state` into `hydrateInteractives`.
- [ ] Add `src/interactive/behaviour.smoke.ts` with a DOM stub that verifies:
  - valid payload marks load experience as hydrated
  - missing target throws through `opencanvas:behaviour-failure`
  - text split creates word spans
  - scroll scene computes progress and applies transform
  - image sequence refuses an empty frame list
- [ ] Add package script:

```json
"behaviour-runtime:smoke": "bun run src/interactive/behaviour.smoke.ts"
```

- [ ] Run:

```powershell
bun run behaviour-runtime:smoke
bun run interactive:smoke
bun run carousel-hydration:smoke
```

## Task 5: Repair Section Library Manifest Sync For Composition-Era Templates

- [ ] Create `scripts/sync-section-library-manifest.ts`.
- [ ] The script must:
  - read every `src/canvas/section-library/entries/*.json`
  - reject missing or duplicate `baseSlug`
  - regenerate `src/canvas/section-library/entries/manifest.ts`
  - preserve `src/canvas/section-library/origin-mapping.ts` as the legacy audit map
  - never delete entry JSON files
- [ ] Add package script:

```json
"section-library:sync": "bun run scripts/sync-section-library-manifest.ts"
```

- [ ] Update comments in `src/canvas/section-library/registry.ts` and `src/canvas/section-library/entries/manifest.ts` to name `section-library:sync` as the current manifest command.
- [ ] Keep `scripts/extract-section-library.ts` in place as a legacy extraction script, but update its header comment to state it is not the command for adding composition-era templates.
- [ ] Extend `src/canvas/section-library/extraction.smoke.ts` to assert every JSON entry on disk appears in `SECTION_LIBRARY`.
- [ ] Run:

```powershell
bun run section-library:sync
bun run section-library-extraction:smoke
```

## Task 6: Add Original Velocity Seed Assets

- [ ] Create twelve original helmet image-sequence SVGs as base64 files:
  - `velocity-helmet-frame-00.svg.b64`
  - `velocity-helmet-frame-01.svg.b64`
  - `velocity-helmet-frame-02.svg.b64`
  - `velocity-helmet-frame-03.svg.b64`
  - `velocity-helmet-frame-04.svg.b64`
  - `velocity-helmet-frame-05.svg.b64`
  - `velocity-helmet-frame-06.svg.b64`
  - `velocity-helmet-frame-07.svg.b64`
  - `velocity-helmet-frame-08.svg.b64`
  - `velocity-helmet-frame-09.svg.b64`
  - `velocity-helmet-frame-10.svg.b64`
  - `velocity-helmet-frame-11.svg.b64`
- [ ] Create four original editorial SVG media studies as base64 files:
  - `velocity-track-study.svg.b64`
  - `velocity-garage-study.svg.b64`
  - `velocity-suit-study.svg.b64`
  - `velocity-product-study.svg.b64`
- [ ] The visual direction is fictional motorsport-adjacent: abstract helmet, speed contours, garage forms, race suit textile, product macro. Do not draw recognizable team marks, driver likenesses, sponsor marks, or protected liveries.
- [ ] Add these exact asset ids to `SEED_ASSET_REGISTRY` in `src/canvas/seed-assets.ts`:
  - `seed-velocity-helmet-frame-00`
  - `seed-velocity-helmet-frame-01`
  - `seed-velocity-helmet-frame-02`
  - `seed-velocity-helmet-frame-03`
  - `seed-velocity-helmet-frame-04`
  - `seed-velocity-helmet-frame-05`
  - `seed-velocity-helmet-frame-06`
  - `seed-velocity-helmet-frame-07`
  - `seed-velocity-helmet-frame-08`
  - `seed-velocity-helmet-frame-09`
  - `seed-velocity-helmet-frame-10`
  - `seed-velocity-helmet-frame-11`
  - `seed-velocity-track-study`
  - `seed-velocity-garage-study`
  - `seed-velocity-suit-study`
  - `seed-velocity-product-study`
- [ ] Compute `contentHash`, `r2Key`, `width`, `height`, and `byteSize` from the final bytes before editing `seed-assets.ts`; do not reuse the transparent placeholder metadata.
- [ ] Run:

```powershell
bun run assets:smoke
```

## Task 7: Compose Velocity Section Entries And Template Seed

- [ ] Add seven Section Library JSON entries listed in the file map.
- [ ] Use this section sequence:
  - header: compact nav, signal mark, tour/store/social links
  - hero: full-screen dark field, contour line shapes, central `rich-motion`, event card, giant fictional name
  - impact: large split-text manifesto
  - story: tall scroll section with horizontally translated track of media panels
  - artifacts: collection/grid-style archive using original media studies
  - store: product CTA with citron/orange accents
  - footer: dense logo/footer marquee approximation using repeated text elements
- [ ] Use these stable ids in the entries because the behaviour graph targets them:
  - `velocity-header`
  - `velocity-hero`
  - `velocity-impact`
  - `velocity-story`
  - `velocity-artifacts`
  - `velocity-store`
  - `velocity-footer`
  - `velocity-hero-motion`
  - `velocity-impact-heading`
  - `velocity-story-track`
- [ ] Add `velocityAthleteTemplate` to `src/templates/registry.ts`:

```ts
export const velocityAthleteTemplate: TemplateSeed = {
  id: 'velocity-athlete',
  name: 'Velocity Athlete',
  tagline: 'A kinetic personal-brand template for athletes, creators, and high-energy product drops.',
  styleKit: 'custom',
  customStyleKit: VELOCITY_KIT,
  headerRef: { sectionId: 'velocity-template-header-v1', instanceId: 'velocityheader' },
  footerRef: { sectionId: 'velocity-template-footer-v1', instanceId: 'velocityfooter' },
  loadExperience: {
    id: 'velocity-load',
    label: 'Ari Vale',
    enterLabel: 'Load Vale',
    background: '#111112',
    foreground: '#C8FF1A',
    sequenceId: 'velocity-load-sequence',
  },
  richMotionAssets: [
    {
      id: 'velocity-helmet-sequence',
      kind: 'image-sequence',
      posterAssetId: 'seed-velocity-helmet-frame-00',
      alt: 'Abstract signal helmet rotating through a kinetic frame sequence',
      frameAssetIds: [
        'seed-velocity-helmet-frame-00',
        'seed-velocity-helmet-frame-01',
        'seed-velocity-helmet-frame-02',
        'seed-velocity-helmet-frame-03',
        'seed-velocity-helmet-frame-04',
        'seed-velocity-helmet-frame-05',
        'seed-velocity-helmet-frame-06',
        'seed-velocity-helmet-frame-07',
        'seed-velocity-helmet-frame-08',
        'seed-velocity-helmet-frame-09',
        'seed-velocity-helmet-frame-10',
        'seed-velocity-helmet-frame-11',
      ],
      playback: { driver: 'load', fps: 18, loop: true },
    },
  ],
  motionSequences: [
    {
      id: 'velocity-load-sequence',
      trigger: { type: 'load-enter' },
      reducedMotion: 'final-state',
      steps: [
        { id: 'load-out', target: { type: 'site' }, to: { opacity: 1 }, durationMs: 260 },
        { id: 'hero-motion-in', target: { type: 'element', elementId: 'velocity-hero-motion' }, from: { scale: 0.88, opacity: 0 }, to: { scale: 1, opacity: 1 }, durationMs: 620, delayMs: 80 },
      ],
    },
    {
      id: 'velocity-impact-split',
      trigger: { type: 'section-enter', sectionId: 'velocity-impact' },
      reducedMotion: 'final-state',
      steps: [
        { id: 'impact-words', target: { type: 'text-split', elementId: 'velocity-impact-heading', unit: 'word' }, from: { translateY: 32, opacity: 0 }, to: { translateY: 0, opacity: 1 }, durationMs: 420, staggerMs: 28 },
      ],
    },
    {
      id: 'velocity-story-scrub',
      trigger: { type: 'scroll-scene', scrollSceneId: 'velocity-story-scene' },
      reducedMotion: 'final-state',
      steps: [
        { id: 'story-track-x', target: { type: 'element', elementId: 'velocity-story-track' }, from: { translateX: 0 }, to: { translateX: -940 }, durationMs: 1 },
      ],
    },
  ],
  scrollScenes: [
    {
      id: 'velocity-story-scene',
      sectionId: 'velocity-story',
      sequenceId: 'velocity-story-scrub',
      pinTarget: { type: 'section', sectionId: 'velocity-story' },
      startOffsetPx: 0,
      endOffsetPx: 1800,
    },
  ],
  pages: [
    {
      id: 'page-velocity-home',
      slug: 'home',
      title: 'Ari Vale - Velocity Athlete',
      width: 1440,
      pageBackground: '#111112',
      sectionGap: 0,
      bodyRefs: [
        { sectionId: 'velocity-template-hero-v1', instanceId: 'velocityhero' },
        { sectionId: 'velocity-template-impact-v1', instanceId: 'velocityimpact' },
        { sectionId: 'velocity-template-story-v1', instanceId: 'velocitystory' },
        { sectionId: 'velocity-template-artifacts-v1', instanceId: 'velocityartifacts' },
        { sectionId: 'velocity-template-store-v1', instanceId: 'velocitystore' },
      ],
    },
  ],
};
```

- [ ] Add `velocityAthleteTemplate` to `allTemplateSeeds`.
- [ ] Add `VELOCITY_KIT` in the same file using the spec palette:
  - pit black `#111112`
  - bone white `#F4F4ED`
  - signal citron `#C8FF1A`
  - deep olive `#282C20`
  - track graphite `#5D6254`
  - heat orange `#FF6B2A`
- [ ] Run manifest sync:

```powershell
bun run section-library:sync
```

- [ ] Run:

```powershell
bun run section-library-extraction:smoke
bun run section-library-composition:smoke
bun run velocity-athlete:smoke
```

## Task 8: Add Visual And Regression Verification

- [ ] Run focused verification:

```powershell
bun run behaviour-primitives:smoke
bun run rich-motion:smoke
bun run behaviour-runtime:smoke
bun run velocity-athlete:smoke
bun run section-library-extraction:smoke
bun run section-library-composition:smoke
bun run yjs-projection:smoke
bun run interactive:smoke
```

- [ ] Run full verification:

```powershell
bun run typecheck
bun run ci:smoke
```

- [ ] Start the app after implementation:

```powershell
bun run dev
```

- [ ] Use Playwright against the local app or a static rendered preview to capture desktop and mobile screenshots of the Velocity template.
- [ ] Verify visually:
  - load gate appears before entry
  - central rich-motion object renders and advances
  - hero content fits at desktop and mobile widths
  - split-text section animates without overlapping
  - story track scrubs horizontally
  - artifact/store/footer sections remain readable
  - palette is not a one-note dark-blue/purple/beige/brown theme
  - no Lando/McLaren/Norris/Quadrant/GSAP strings appear in page source

## Task 9: Commit

- [ ] Check worktree:

```powershell
git status --short
```

- [ ] Stage only files changed for this implementation.
- [ ] Commit with:

```powershell
git commit -m "feat: add velocity athlete fidelity pilot"
```

## Self-Review Checklist

- [ ] The implementation keeps protected benchmark content out of source and assets.
- [ ] The behaviour graph is schema-owned and validator-owned.
- [ ] Rich motion has a supported native adapter in this slice.
- [ ] Every new element type is wired through render, editor body, inspector, sidebar, agent tool, Yjs, and dispatch smokes.
- [ ] Section Library manifest sync no longer depends on obsolete `.state` template seeds.
- [ ] The fidelity smoke fails on missing benchmark-critical contracts.
- [ ] The full smoke suite passes before completion is claimed.
