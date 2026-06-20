# Raydotsh Faithful Replica Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Raydotsh conversion gap list into testable Open Canvas work packages that can eventually make `raydotsh-portfolio` a faithful builder-native replica.

**Architecture:** Treat the existing `raydotsh-portfolio` Template Seed as a benchmark fixture. Reuse existing schema-owned primitives where they already fit, and add new primitives only for behaviours that cannot be represented by current nodes and directed relations.

**Tech Stack:** TypeScript, Bun smoke tests, Section Library JSON, existing Canvas schema/validator/render paths, editor-client inspector/runtime paths, existing Runtime Hydrator, existing seed-asset and font pipelines. No raw source React, no source CSS bundle, no arbitrary custom scripts.

## Global Constraints

- Keep Template Seeds as compositions of Section Library entries.
- Do not embed `AsciiPortrait.jsx`, `RobotGame.jsx`, MUI components, Bootstrap components, or source CSS files directly in the template.
- New behaviour must be schema-owned, validator-owned, editor-previewed, and published through the Runtime Hydrator.
- Reduced motion must be explicit for every motion or interaction primitive.
- Missing targets, malformed configs, and runtime initialization failures must fail loudly with named context.
- Do not call the current Raydotsh template faithful until the fidelity ledger says every source behaviour is native, implemented, or intentionally omitted.
- Keep unrelated dirty worktree files untouched.
- No TODO comments.

---

## Scope Check

This is a program plan, not one implementation PR. The spec covers independent
subsystems: text effects, motion sequencing, responsive variants, card/grid
recipes, nav state, Rich Motion particle fields, fonts, and a possible playable
widget. Implement them as separate issues. Do not land all primitives in one
branch.

## File Map

Existing files likely touched across the program:

- `docs/specs/raydotsh-faithful-replica-design-language.md`: design-language source of truth.
- `src/templates/raydotsh-portfolio.smoke.ts`: template fidelity smoke.
- `src/templates/registry.ts`: Template Seed configuration after primitives exist.
- `src/canvas/section-library/entries/raydotsh-template-*.json`: Raydotsh Section Library entries.
- `src/canvas/schema.ts`: site-wide primitive fields and exported schema types.
- `src/canvas/behaviour-primitives.ts`: Motion Sequence, Rich Motion, Scroll Scene, and future behaviour type definitions.
- `src/canvas/validate.ts`: full-site write gate for new primitive fields.
- `src/canvas/render.ts`: published metadata and behaviour payload emission.
- `src/canvas/yjs-projection.ts`: editor persistence for owner-editable fields.
- `src/canvas/elements/*.ts`: element-local schema/render/inspector specs where a primitive belongs to one element type.
- `src/editor-client/interactions-panel*.ts`: site-level interaction authoring if the primitive is site/page scoped.
- `src/editor-client/hydrate-interactives.ts`: editor preview Runtime Hydrator dispatch.
- `src/interactive/*.ts`: visitor Runtime Hydrator adapters.
- `src/fonts/*`: Template Font Asset support if existing font loading is insufficient.
- `src/assets/seed-source/*` and `src/canvas/seed-assets.ts`: seed assets for source-approved images, point maps, favicon, and fonts.
- `package.json`: only when adding a new smoke script.

## Issue 1: Raydotsh Fidelity Ledger Smoke

**Files:**

- Modify: `src/templates/raydotsh-portfolio.smoke.ts`
- Reference: `docs/specs/raydotsh-faithful-replica-design-language.md`

**Interfaces:**

- Consumes: `getTemplateSeed('raydotsh-portfolio')`, `instantiateTemplate`, `validateEditableSite`, `validatePublishedSnapshot`, `renderCanvasSnapshot`, `injectInteractiveRuntime`.
- Produces: a fidelity ledger assertion that later issues update from `missing` or `approximate` to `native`.

- [ ] **Step 1: Add ledger constants to the smoke**

Add this shape near the top of `src/templates/raydotsh-portfolio.smoke.ts`:

```ts
type FidelityStatus = 'native' | 'approximate' | 'missing' | 'omitted';

interface FidelityItem {
  id: string;
  sourceBehaviour: string;
  status: FidelityStatus;
  requiredPrimitive?: string;
}

const RAYDOTSH_FIDELITY_LEDGER: FidelityItem[] = [
  {
    id: 'ascii-particle-portrait',
    sourceBehaviour: 'Canvas ASCII particles assemble into a portrait and repel from pointer/touch input',
    status: 'missing',
    requiredPrimitive: 'Particle Field Rich Motion',
  },
  {
    id: 'typewriter-greeting',
    sourceBehaviour: 'Hero name reveals as an ordered typewriter sequence with a cursor',
    status: 'missing',
    requiredPrimitive: 'Typewriter Text Effect',
  },
  {
    id: 'robot-game-overlay',
    sourceBehaviour: 'Game mode toggles a keyboard-controlled collectible platformer overlay',
    status: 'omitted',
    requiredPrimitive: 'Playable Widget ADR',
  },
  {
    id: 'sidebar-anchor-rail',
    sourceBehaviour: 'Desktop slash-styled side rail links to same-page anchors',
    status: 'missing',
    requiredPrimitive: 'Anchor Rail Navigation',
  },
  {
    id: 'scroll-reveal-sequence',
    sourceBehaviour: 'Repeated sections and list items reveal with child-index delays',
    status: 'approximate',
    requiredPrimitive: 'Reveal Sequence',
  },
  {
    id: 'responsive-project-variants',
    sourceBehaviour: 'Projects use desktop spotlight structure and separate mobile card structure',
    status: 'approximate',
    requiredPrimitive: 'Responsive Layout Variant',
  },
  {
    id: 'cover-grid',
    sourceBehaviour: 'Books render as responsive masonry cover grids with hover lift',
    status: 'approximate',
    requiredPrimitive: 'Cover Grid Recipe',
  },
];
```

- [ ] **Step 2: Assert the ledger is explicit**

Add assertions:

```ts
const knownLedgerIds = new Set<string>();
for (const item of RAYDOTSH_FIDELITY_LEDGER) {
  assert(item.id.length > 0, 'fidelity item id must be non-empty');
  assert(!knownLedgerIds.has(item.id), `duplicate fidelity item id ${item.id}`);
  knownLedgerIds.add(item.id);
  assert(item.sourceBehaviour.length > 20, `${item.id} must describe the source behaviour`);
  if (item.status === 'missing' || item.status === 'approximate') {
    assert(
      typeof item.requiredPrimitive === 'string' && item.requiredPrimitive.length > 0,
      `${item.id} must name the primitive that closes the gap`,
    );
  }
}

const missingOrApproximate = RAYDOTSH_FIDELITY_LEDGER.filter(
  (item) => item.status === 'missing' || item.status === 'approximate',
);
assert(missingOrApproximate.length > 0, 'current template must not be reported as faithful yet');
```

- [ ] **Step 3: Run the smoke**

Run:

```powershell
bun run raydotsh-portfolio:smoke
```

Expected: PASS, with the smoke still recording non-faithful statuses.

- [ ] **Step 4: Commit**

```powershell
git add src/templates/raydotsh-portfolio.smoke.ts
git commit -m "test: capture raydotsh fidelity ledger"
```

## Issue 2: Activate Existing Primitives In The Raydotsh Template

**Files:**

- Modify: `src/templates/registry.ts`
- Modify: `src/canvas/section-library/entries/raydotsh-template-header.json`
- Modify: `src/canvas/section-library/entries/raydotsh-template-experience.json`
- Modify: `src/canvas/section-library/entries/raydotsh-template-hero.json`
- Modify: `src/canvas/section-library/entries/raydotsh-template-software.json`
- Modify: `src/canvas/section-library/entries/raydotsh-template-books.json`
- Modify: `src/canvas/section-library/entries/manifest.ts` after sync

**Interfaces:**

- Consumes: existing `RouteTransition`, `scrollBehavior`, `ActionElement.iconKind`, `tabsStyle`, `faviconAssetId`, `navStyle`.
- Produces: a better current template without new schema.

- [ ] **Step 1: Write a failing assertion for existing primitive coverage**

In `src/templates/raydotsh-portfolio.smoke.ts`, assert metadata that should be
expressible today:

```ts
assert(state.scrollBehavior?.paddingTop === 80, 'Raydotsh anchors should land below fixed nav');
assert(state.routeTransition?.enabled === true, 'Raydotsh books route should use route transition metadata');
assert(typeof state.faviconAssetId === 'string', 'Raydotsh should bind a favicon seed asset when available');
```

Expected initial result: FAIL until the Template Seed is configured.

- [ ] **Step 2: Configure only existing fields**

In `src/templates/registry.ts`, add existing site-level fields to
`raydotshPortfolioTemplate` if the schema supports them on `TemplateSeed`.
If `TemplateSeed` does not yet pass the field through `instantiateTemplate`,
extend that pass-through with exact fields instead of widening the whole seed.

The desired instantiated state is:

```ts
state.scrollBehavior = { smooth: true, paddingTop: 80 };
state.routeTransition = {
  id: 'raydotsh-route-transition',
  enabled: true,
  mode: 'fade',
  durationMs: 220,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
};
```

- [ ] **Step 3: Preserve fail-loud behaviour**

If adding pass-through fields, update validation/smokes so unknown template
references still throw. Do not add defaults for missing fields.

- [ ] **Step 4: Sync Section Library manifest if entries changed**

Run:

```powershell
bun run section-library:sync
```

- [ ] **Step 5: Verify**

Run:

```powershell
bun run raydotsh-portfolio:smoke
bun run template-preview:smoke
bun run section-library-composition:smoke
bun run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add src/templates/registry.ts src/templates/raydotsh-portfolio.smoke.ts src/canvas/section-library/entries src/canvas/section-library/entries/manifest.ts
git commit -m "feat: use existing raydotsh template primitives"
```

## Issue 3: Typewriter Text Effect

**Files:**

- Modify: `src/canvas/behaviour-primitives.ts`
- Modify: `src/canvas/schema.ts`
- Modify: `src/canvas/validate.ts`
- Modify: `src/canvas/render.ts`
- Modify: `src/interactive/behaviour.ts`
- Modify: `src/interactive/behaviour.smoke.ts`
- Modify: `src/editor-client/hydrate-interactives.ts`
- Modify: `src/editor-client/reduced-motion-preview.smoke.ts`
- Modify: `src/canvas/yjs-projection.ts`
- Modify: `src/canvas/yjs-projection.smoke.ts`

**Interfaces:**

- Produces: a schema-owned `typewriter` text effect with ordered text runs,
  cursor policy, timing, and reduced-motion final-state behaviour.

- [ ] **Step 1: Write the runtime red test**

Add a case to `src/interactive/behaviour.smoke.ts` that creates a text host:

```ts
const typewriterStep = {
  id: 'raydotsh-typewriter-step',
  target: { type: 'element', elementId: 'raydotsh-hero-title' },
  textEffect: 'typewriter',
  to: { opacity: 1 },
  durationMs: 700,
};

assert(
  JSON.stringify(typewriterStep).includes('typewriter'),
  'smoke must exercise typewriter text effect',
);
```

Expected initial result: FAIL because validation/runtime does not accept
`textEffect: 'typewriter'`.

- [ ] **Step 2: Extend the text-effect enum**

Add `typewriter` to `MOTION_SEQUENCE_TEXT_EFFECTS` only if the effect can share
Motion Sequence target semantics. If it needs fields beyond `MotionSequenceStep`,
add a separate typed object such as:

```ts
export interface TypewriterTextEffect {
  kind: 'typewriter';
  cursor: 'none' | 'blink' | 'solid';
  revealMs: number;
  startDelayMs?: number;
  reducedMotion: 'full-text';
}
```

- [ ] **Step 3: Validate exact bounds**

In `src/canvas/validate.ts`, reject:

```ts
// Required validation outcomes:
// - unknown cursor policy
// - revealMs <= 0
// - reducedMotion other than "full-text"
// - typewriter on non-text targets if the chosen schema requires text targets
```

- [ ] **Step 4: Render explicit metadata**

Emit data attributes that the Runtime Hydrator can read without querying
arbitrary CSS selectors:

```html
data-opencanvas-text-effect="typewriter"
data-opencanvas-typewriter-cursor="blink"
data-opencanvas-typewriter-reveal-ms="700"
data-opencanvas-typewriter-reduced-motion="full-text"
```

- [ ] **Step 5: Hydrate with final-state reduced motion**

Runtime contract:

```ts
// prefers-reduced-motion: reduce -> immediately render the full semantic text.
// normal motion -> progressively reveal substring, then leave final text intact.
// failure -> behaviourFailure('typewriter-text-effect', context, error).
```

- [ ] **Step 6: Verify**

Run:

```powershell
bun run behaviour-primitives:smoke
bun run behaviour-runtime:smoke
bun run yjs-projection:smoke
bun run reduced-motion-preview:smoke
bun run typecheck
```

- [ ] **Step 7: Commit**

```powershell
git add src/canvas/behaviour-primitives.ts src/canvas/schema.ts src/canvas/validate.ts src/canvas/render.ts src/interactive/behaviour.ts src/interactive/behaviour.smoke.ts src/editor-client/hydrate-interactives.ts src/editor-client/reduced-motion-preview.smoke.ts src/canvas/yjs-projection.ts src/canvas/yjs-projection.smoke.ts
git commit -m "feat: add typewriter text effect"
```

## Issue 4: Reveal Sequence

**Files:**

- Modify: `src/canvas/behaviour-primitives.ts`
- Modify: `src/canvas/validate.ts`
- Modify: `src/canvas/render.ts`
- Modify: `src/interactive/behaviour.ts`
- Modify: `src/interactive/behaviour.smoke.ts`
- Modify: `src/editor-client/interactions-panel.smoke.ts`
- Modify: `src/editor-client/runtime-hydrator-parity.smoke.ts`

**Interfaces:**

- Consumes: existing Motion Sequence trigger/target model.
- Produces: group-level child-index stagger semantics without per-element
  hand-authored delays.

- [ ] **Step 1: Add a failing smoke for child-index stagger**

Add a `section-enter` sequence fixture with three child targets and expected
metadata:

```ts
const revealSequence = {
  id: 'raydotsh-project-card-reveal',
  trigger: { type: 'section-enter', sectionId: 'raydotsh-software' },
  reducedMotion: 'final-state',
  steps: [
    {
      id: 'project-cards',
      target: { type: 'children-of', elementId: 'raydotsh-project-grid' },
      from: { translateY: 20, opacity: 0 },
      to: { translateY: 0, opacity: 1 },
      durationMs: 600,
      staggerMs: 100,
    },
  ],
};
```

Expected initial result: FAIL because `children-of` is not a supported target.

- [ ] **Step 2: Decide target shape**

Prefer extending `BehaviourTarget` with one conceptual target:

```ts
| { type: 'children-of'; elementId: string }
```

Do not add a second animation system.

- [ ] **Step 3: Validate target resolution**

Validation must reject:

```ts
// - children-of pointing to a non-container/non-compound element
// - negative staggerMs
// - section-enter trigger with missing sectionId
// - reducedMotion omitted
```

- [ ] **Step 4: Runtime execution**

Runtime must resolve children deterministically from rendered metadata, apply
delays from child index, and emit:

```ts
behaviourFailure('motion-sequence-target-resolution', { sequenceId, stepId, target }, error);
```

when the relation cannot resolve.

- [ ] **Step 5: Verify**

Run:

```powershell
bun run behaviour-primitives:smoke
bun run behaviour-runtime:smoke
bun run interactions-panel:smoke
bun run runtime-hydrator-parity:smoke
bun run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add src/canvas/behaviour-primitives.ts src/canvas/validate.ts src/canvas/render.ts src/interactive/behaviour.ts src/interactive/behaviour.smoke.ts src/editor-client/interactions-panel.smoke.ts src/editor-client/runtime-hydrator-parity.smoke.ts
git commit -m "feat: add reveal sequence child targets"
```

## Issue 5: Responsive Layout Variant

**Files:**

- Modify: `src/canvas/schema.ts`
- Modify: `src/canvas/validate.ts`
- Modify: `src/canvas/render.ts`
- Modify: `src/canvas/responsive/index.ts`
- Modify: `src/canvas/responsive/smoke.ts`
- Modify: `src/editor-client/render.ts`
- Modify: `src/editor-client/create-editor-runtime.smoke.ts`
- Modify: `src/canvas/yjs-projection.ts`
- Modify: `src/canvas/yjs-projection.smoke.ts`

**Interfaces:**

- Produces: breakpoint-selected alternate child trees for a shared content
  source.

- [ ] **Step 1: Write the responsive red test**

In `src/canvas/responsive/smoke.ts`, create a fixture where desktop and phone
variants have different element ids but the same source id:

```ts
const variantFixture = {
  responsiveVariants: [
    {
      id: 'raydotsh-projects-desktop',
      breakpoint: 'desktop',
      contentSourceId: 'raydotsh-projects',
      elementIds: ['raydotsh-spotlight-card', 'raydotsh-project-grid'],
    },
    {
      id: 'raydotsh-projects-phone',
      breakpoint: 'phone',
      contentSourceId: 'raydotsh-projects',
      elementIds: ['raydotsh-mobile-project-list'],
    },
  ],
};
```

Expected initial result: FAIL because no variant field exists.

- [ ] **Step 2: Add the smallest schema**

Attach variants to `CanvasSection` unless code inspection proves container-level
variants are required first:

```ts
export interface ResponsiveLayoutVariant {
  id: string;
  breakpoint: 'desktop' | 'tablet' | 'phone';
  contentSourceId: string;
  elementIds: string[];
}
```

- [ ] **Step 3: Validate exclusivity and accessibility**

Validation must reject:

```ts
// - duplicate variant ids
// - duplicate breakpoint for same contentSourceId
// - elementIds that do not exist in the section
// - a phone/tablet variant without a desktop variant for the same content source
// - all variants hidden at one breakpoint
```

- [ ] **Step 4: Render inactive variants inert**

Inactive variant elements must be hidden from both visuals and accessibility:

```html
hidden
aria-hidden="true"
inert
```

Use CSS/media queries for visual selection and runtime only if needed for
`inert` updates.

- [ ] **Step 5: Verify**

Run:

```powershell
bun run responsive:smoke
bun run yjs-projection:smoke
bun run create-editor-runtime:smoke
bun run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add src/canvas/schema.ts src/canvas/validate.ts src/canvas/render.ts src/canvas/responsive src/editor-client/render.ts src/editor-client/create-editor-runtime.smoke.ts src/canvas/yjs-projection.ts src/canvas/yjs-projection.smoke.ts
git commit -m "feat: add responsive layout variants"
```

## Issue 6: Card And Cover Grid Recipes

**Files:**

- Modify: `src/canvas/elements/collection.ts` or colocated collection recipe files after inspection.
- Modify: `src/canvas/elements/collection-gallery-v2.smoke.ts`
- Modify: `src/canvas/component-style.smoke.ts`
- Modify: `src/editor-client/collection-template-edit-view.smoke.ts`
- Modify: Raydotsh section entries only after the recipe exists.

**Interfaces:**

- Consumes: Collection/Collection Entry where appropriate.
- Produces: project-card, spotlight-card, and cover-grid rendering recipes.

- [ ] **Step 1: Write a failing collection recipe smoke**

Add a fixture with two books and expected cover-grid metadata:

```ts
const coverGridPolicy = {
  mode: 'cover-grid',
  minColumnWidth: 160,
  gapPx: 20,
  itemAspect: 'asset',
  hover: 'lift',
  reducedMotion: 'static',
};
```

Expected initial result: FAIL until `cover-grid` is supported.

- [ ] **Step 2: Add closed recipe values**

Use closed recipe names:

```ts
'spotlight-card' | 'project-card' | 'cover-grid'
```

Reject arbitrary CSS or template-local recipe strings.

- [ ] **Step 3: Render repeated entries**

Each rendered item must include:

```html
data-opencanvas-collection-entry="<entry-id>"
data-opencanvas-card-recipe="cover-grid"
```

- [ ] **Step 4: Verify**

Run:

```powershell
bun run collection-gallery-v2:smoke
bun run collection-materializer:smoke
bun run collection-template-edit-view:smoke
bun run component-style:smoke
bun run typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/canvas/elements/collection* src/editor-client/collection-template-edit-view.smoke.ts src/canvas/component-style.smoke.ts
git commit -m "feat: add collection card grid recipes"
```

## Issue 7: Anchor Rail Navigation

**Files:**

- Modify: `src/canvas/elements/nav.ts`
- Modify: `src/canvas/elements/nav-render.smoke.ts`
- Modify: `src/canvas/nav-theme-on-scroll.smoke.ts` only if scroll observer is shared.
- Modify: `src/interactive/behaviour.ts` or nav-specific runtime file.
- Modify: `src/editor-client/runtime-hydrator-parity.smoke.ts`

**Interfaces:**

- Consumes: existing section `anchorId` and nav link shapes.
- Produces: side rail nav presentation and active-section relation.

- [ ] **Step 1: Add failing nav render fixture**

Use a `navStyle.recipe` or new field only after inspecting current nav recipe
fit. Desired emitted metadata:

```html
data-opencanvas-nav-rail="anchor"
data-opencanvas-nav-active-policy="section-scroll"
data-opencanvas-nav-hide-below="800"
```

- [ ] **Step 2: Validate anchor relations**

Reject a rail item when:

```ts
// - link.kind is not "anchor"
// - href does not resolve to a section anchor in the rendered page
// - hideBelow is below 320 or above 1440
```

- [ ] **Step 3: Hydrate active section**

Use IntersectionObserver. On failure to resolve anchors, emit:

```ts
behaviourFailure('anchor-rail-target-resolution', { navId, href }, error);
```

- [ ] **Step 4: Verify**

Run:

```powershell
bun run nav-render:smoke
bun run behaviour-runtime:smoke
bun run runtime-hydrator-parity:smoke
bun run typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/canvas/elements/nav.ts src/canvas/elements/nav-render.smoke.ts src/interactive/behaviour.ts src/editor-client/runtime-hydrator-parity.smoke.ts
git commit -m "feat: add anchor rail navigation"
```

## Issue 8: Interaction Style For Hover, Focus, And Touch

**Files:**

- Modify: `src/canvas/elements/component-style.ts`
- Modify: `src/canvas/component-style.smoke.ts`
- Modify: `src/canvas/render.ts`
- Modify: `src/editor-client/inspector-component-style.smoke.ts`
- Modify: `src/editor-client/reduced-motion-preview.smoke.ts`

**Interfaces:**

- Produces: bounded hover/focus/touch visual state fields on Component Style or
  recipe-owned style objects.

- [ ] **Step 1: Write failing component style smoke**

Desired shape:

```ts
const interactionStyle = {
  hover: { translateY: -7, backgroundColor: '#233554', shadow: 'kit-raised' },
  focusVisible: { outlineColor: '#64ffda', outlineWidth: 2 },
  touch: { activation: 'tap', activeDurationMs: 180 },
  reducedMotion: 'no-transform',
};
```

Expected initial result: FAIL until the field is accepted.

- [ ] **Step 2: Keep the field bounded**

Allowed transform fields:

```ts
translateX?: number;
translateY?: number;
scale?: number;
```

Allowed colour/shadow fields must use existing style-kit or hex validation.

- [ ] **Step 3: Verify**

Run:

```powershell
bun run component-style:smoke
bun run inspector-component-style:smoke
bun run reduced-motion-preview:smoke
bun run typecheck
```

- [ ] **Step 4: Commit**

```powershell
git add src/canvas/elements/component-style.ts src/canvas/component-style.smoke.ts src/canvas/render.ts src/editor-client/inspector-component-style.smoke.ts src/editor-client/reduced-motion-preview.smoke.ts
git commit -m "feat: add bounded interaction style"
```

## Issue 9: ASCII Particle Portrait Rich Motion

**Files:**

- Modify: `src/canvas/behaviour-primitives.ts`
- Modify: `src/canvas/elements/rich-motion.ts`
- Modify: `src/canvas/elements/rich-motion.smoke.ts`
- Modify: `src/canvas/validate.ts`
- Modify: `src/canvas/render.ts`
- Modify: `src/interactive/behaviour.ts`
- Modify: `src/interactive/shader-scene-rich-motion.smoke.ts` or add `src/interactive/particle-field-rich-motion.smoke.ts`
- Modify: `src/editor-client/runtime-hydrator-parity.smoke.ts`
- Modify: `src/assets/seed-source/*`
- Modify: `src/canvas/seed-assets.ts`

**Interfaces:**

- Consumes: seed asset ids or point-map asset ids.
- Produces: image/point-map sampled ASCII particle field with pointer physics.

- [ ] **Step 1: Add failing Rich Motion smoke**

Desired asset shape:

```ts
const asciiPortraitAsset = {
  id: 'raydotsh-ascii-portrait',
  kind: 'particle-field',
  mode: 'ascii-portrait',
  sourceAssetId: 'seed-raydotsh-profile',
  charset: ' .:-=+*#%@',
  color: '#64ffda',
  density: 1,
  pointer: { mode: 'repel', radiusRatio: 0.2, force: 4 },
  reducedMotion: 'settled',
};
```

Expected initial result: FAIL because `particle-field` Rich Motion is currently
only a shader-scene preset, not an asset-sampled ASCII field.

- [ ] **Step 2: Decide kind placement**

Prefer one of:

```ts
// Option A: extend ShaderSceneRichMotionAsset with mode-specific fields.
// Option B: add ParticleFieldRichMotionAsset to the RichMotionAsset union.
```

Choose Option B if image/point-map sampling does not share shader-scene
semantics.

- [ ] **Step 3: Validate source data**

Reject:

```ts
// - missing sourceAssetId or pointMapAssetId
// - empty charset
// - density <= 0
// - pointer.force < 0
// - unsupported reducedMotion
```

- [ ] **Step 4: Hydrate deterministically**

Runtime requirements:

```ts
// - sample image alpha/brightness into particles or load a precomputed point map
// - animate from scattered positions to target positions
// - pointer/touch repels particles
// - resize recalculates field
// - reduced motion renders the settled portrait immediately
```

Failure event:

```ts
behaviourFailure('rich-motion-particle-field-init', { assetId, sourceAssetId }, error);
```

- [ ] **Step 5: Verify**

Run:

```powershell
bun run rich-motion:smoke
bun run behaviour-runtime:smoke
bun run runtime-hydrator-parity:smoke
bun run seed:assets
bun run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add src/canvas/behaviour-primitives.ts src/canvas/elements/rich-motion.ts src/canvas/elements/rich-motion.smoke.ts src/canvas/validate.ts src/canvas/render.ts src/interactive/behaviour.ts src/interactive/*particle* src/editor-client/runtime-hydrator-parity.smoke.ts src/assets/seed-source src/canvas/seed-assets.ts
git commit -m "feat: add ascii particle rich motion"
```

## Issue 10: Playable Widget ADR

**Files:**

- Create: `docs/adr/0085-playable-widget-boundary.md`
- Reference: `src/components/RobotGame.jsx` in the source repo only as evidence.
- Do not modify runtime files in this issue.

**Interfaces:**

- Produces: accepted or rejected product architecture decision for bounded
  playable widgets.

- [ ] **Step 1: Write the ADR**

The ADR must answer:

```md
- Why does Playable Widget exist?
- What inbound relations are allowed? keyboard, touch, pointer, resize, scroll?
- What outbound relations are allowed? canvas render, status UI, completion event?
- Does game state persist? If yes, where? If no, say it resets on mount.
- How does editor preview work?
- How does reduced motion work?
- Why is arbitrary source app embedding rejected?
```

- [ ] **Step 2: Include reduction tests**

The ADR must explicitly ask:

```md
- Can Robot Game be represented as existing Overlay + Rich Motion + Actions?
- Can the game stay outside Open Canvas as an addon instead?
- Does this primitive serve more than Raydotsh?
```

- [ ] **Step 3: Commit**

```powershell
git add docs/adr/0085-playable-widget-boundary.md
git commit -m "docs: decide playable widget boundary"
```

## Issue 11: Template Font Asset Binding

**Files:**

- Inspect first: `src/fonts/face-emit.ts`
- Inspect first: `src/fonts/resolve.ts`
- Inspect first: `src/routes/public.ts`
- Inspect first: `src/routes/dashboard/templates.tsx`
- Modify only if needed: `src/templates/registry.ts`
- Modify only if needed: `src/canvas/seed-assets.ts`
- Modify only if needed: `src/assets/seed-source/*`
- Modify only if needed: `src/fonts/smoke.ts`
- Modify only if needed: `src/editor-client/text-fontload-remeasure.smoke.ts`

**Interfaces:**

- Produces: exact NTR font loading for built-in Template Seeds or a documented
  finding that existing Google/preset font loading already covers it.

- [ ] **Step 1: Write a font assertion**

Add a smoke assertion that rendered Raydotsh preview/publish HTML contains a
font-loading path for NTR or the chosen source-approved font asset:

```ts
assert(html.includes('NTR'), 'Raydotsh render should reference NTR font family');
assert(
  html.includes('fonts.googleapis.com') || html.includes('@font-face') || html.includes('/fonts/'),
  'Raydotsh render should include a concrete font loading mechanism',
);
```

- [ ] **Step 2: Implement only the missing relation**

If the assertion fails, add the smallest Template Seed font binding needed.
Do not add a second font pipeline parallel to `siteFont`.

- [ ] **Step 3: Verify**

Run:

```powershell
bun run fonts:smoke
bun run text-fontload-remeasure:smoke
bun run raydotsh-portfolio:smoke
bun run template-preview:smoke
bun run typecheck
```

- [ ] **Step 4: Commit**

```powershell
git add src/fonts src/routes/public.ts src/routes/dashboard/templates.tsx src/templates/registry.ts src/canvas/seed-assets.ts src/assets/seed-source src/templates/raydotsh-portfolio.smoke.ts
git commit -m "feat: bind template font assets"
```

## Issue 12: Final Raydotsh Re-authoring

**Files:**

- Modify: `src/canvas/section-library/entries/raydotsh-template-*.json`
- Modify: `src/canvas/section-library/entries/manifest.ts`
- Modify: `src/templates/registry.ts`
- Modify: `src/templates/raydotsh-portfolio.smoke.ts`
- Modify: `src/routes/dashboard/template-preview.smoke.ts`

**Interfaces:**

- Consumes: closed issues 2-9 and 11.
- Produces: Raydotsh template that uses builder-native primitives instead of
  approximations.

- [ ] **Step 1: Update the fidelity ledger**

Change ledger statuses only when the rendered template actually uses the new
primitive:

```ts
// Example:
{
  id: 'typewriter-greeting',
  sourceBehaviour: 'Hero name reveals as an ordered typewriter sequence with a cursor',
  status: 'native',
}
```

- [ ] **Step 2: Re-author Section Library entries**

Use new primitives in JSON entries. Do not leave duplicate static placeholders
visible beside active runtime primitives.

- [ ] **Step 3: Sync manifest**

Run:

```powershell
bun run section-library:sync
```

- [ ] **Step 4: Verify full template path**

Run:

```powershell
bun run raydotsh-portfolio:smoke
bun run template-preview:smoke
bun run section-library-composition:smoke
bun run seed:assets
bun run assets:smoke
bun run typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add src/canvas/section-library/entries/raydotsh-template-*.json src/canvas/section-library/entries/manifest.ts src/templates/registry.ts src/templates/raydotsh-portfolio.smoke.ts src/routes/dashboard/template-preview.smoke.ts
git commit -m "feat: reauthor raydotsh with native fidelity primitives"
```

## Plan Self-Review

- Spec coverage: every gap in `docs/specs/raydotsh-faithful-replica-design-language.md` maps to Issues 1-12.
- Scope split: Playable Widget is ADR-only until accepted; final template re-authoring waits for primitive issues.
- Existing primitive reuse: Issue 2 is separated from new schema work.
- Fail-loud posture: each runtime issue names validation and failure-event requirements.
- Verification: every issue ends with focused smokes plus `typecheck` where source files change.
