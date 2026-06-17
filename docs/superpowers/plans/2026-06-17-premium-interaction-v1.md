# Premium Interaction v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Premium Interaction v1: Runtime Hydrator, first-class Overlays, site-level Load Experience, same-site Route Transitions, Motion Sequence Lite, and editor UI for all shipped behaviours.

**Architecture:** Add the persisted interaction model first, then let Overlay, Load Experience, Route Transition, Motion Sequence Lite, and editor UI proceed in parallel against stable types. Published execution is owned by one idempotent Runtime Hydrator entrypoint; editor preview may keep its TypeScript mirror in v1 with parity smokes.

**Tech Stack:** TypeScript, Bun smoke tests, existing Canvas renderer, existing Yjs projection, existing editor sidebar/inspector modules, native DOM/CSS/WAAPI/fetch/history first.

## Global Constraints

- Use Open Canvas terms: Runtime Hydrator, Overlay, Load Experience, Route Transition, Motion Sequence, Motion Sequence Lite.
- Saved site state stores Open Canvas concepts, not adapter-library calls.
- Native-first implementation; add external runtime adapters only when they materially reduce complexity and remain license-safe.
- Existing popup-section data migrates into Overlays on read; the editor stops writing `CanvasSection.trigger`.
- V1 must include editor UI for all shipped behaviours.
- Load Experience is site-level in v1; page overrides are out of v1.
- Overlay v1 triggers are exactly `load`, `delay`, `scroll`, `exit-intent`, and `element-click`.
- Route Transition v1 modes are exactly `fade`, `slide`, and `wipe`.
- Motion Sequence Lite effects are exactly `fade`, `slide`, `scale`, `wipe`, and `blur`.
- No silent degraded mode: validation rejects unsupported stored behaviour, and runtime failures emit named failure events with context.
- Do not modify or remove unrelated user changes. Ignore untracked `.codex-screens/` unless the Owner asks.

---

## File Structure

Core model and migration:
- Modify `src/canvas/schema.ts`: add Premium Interaction type constants and fields on `EditableSiteBase`.
- Modify `src/canvas/validate.ts`: validate Premium Interaction fields.
- Modify `src/canvas/yjs-projection.ts`: encode/decode Premium Interaction fields.
- Create `src/canvas/premium-interactions-migration.ts`: pure read-time migration from `CanvasSection.trigger` to `EditableSite.overlays`.
- Create `src/canvas/premium-interactions.smoke.ts`: schema, validation, and migration smoke.

Rendering and visitor runtime:
- Modify `src/canvas/render.ts`: emit interaction metadata, overlay layer, load shell, and route container attributes.
- Modify `src/canvas/public-styles.ts`: add base styles for overlay/load/route and Motion Sequence Lite effects.
- Modify `src/interactive/runtime.ts`: expose `window.__opencanvasHydrate(root, options)`.
- Modify `src/interactive/inject.ts`: inject runtime when Premium Interactions are configured.
- Create `src/interactive/motion-sequence-lite.ts`: visitor runtime fragment for constrained step execution.
- Create `src/interactive/overlay-v1.ts`: visitor runtime fragment for Overlay v1.
- Create `src/interactive/load-experience.ts`: visitor runtime fragment for Load Experience v1.
- Create `src/interactive/route-transition.ts`: visitor runtime fragment for Route Transition v1.
- Modify `src/interactive/build.ts`: include the new runtime fragments.
- Modify `src/routes/public.ts`: call the Runtime Hydrator after live-publish HTML swaps.
- Create `src/interactive/premium-interactions.smoke.ts`: visitor runtime and injection smoke.

Editor:
- Modify `src/editor/route.tsx`: add the static Interactions sidebar tab and panel host.
- Modify `src/editor-client/editor-context.ts`: add interaction panel methods and transient preview state.
- Modify `src/editor-client/index.ts`: bind interaction panel methods and boot wiring.
- Modify `src/editor-client/sidebar.ts`: render Interactions panel when its tab is active.
- Create `src/editor-client/interactions-panel.ts`: editor UI for Load Experience, Route Transition, Overlays, and Motion Sequence Lite.
- Modify `src/editor-client/hydrate-interactives.ts`: add editor preview parity for Overlay, Load Experience, Route Transition, and Motion Sequence Lite.
- Modify `src/editor-client/element-inspector.ts`: add "Use as overlay trigger" shortcut when an element is selected.
- Create `src/editor-client/interactions-panel.smoke.ts`: editor state-write smoke.
- Create `src/editor-client/premium-interactions-preview.smoke.ts`: editor preview parity smoke.

End-to-end:
- Create `e2e/premium-interactions.spec.ts`: Owner and Visitor flows.

---

## Parallelization Order

Task 1 is the foundation and must land first. After Task 1, Tasks 2, 3, 4, 5, and 6 can run in parallel because they consume the same model interfaces. Task 7 depends on Tasks 2-6. Task 8 runs after Task 7.

---

### Task 1: Premium Interaction Model, Validation, Projection, And Popup Migration

**Files:**
- Modify: `src/canvas/schema.ts`
- Modify: `src/canvas/validate.ts`
- Modify: `src/canvas/yjs-projection.ts`
- Create: `src/canvas/premium-interactions-migration.ts`
- Create: `src/canvas/premium-interactions.smoke.ts`

**Interfaces:**
- Produces: `Overlay`, `LoadExperience`, `RouteTransition`, `MotionSequenceLite`, `MotionSequenceLiteStep`, `InteractionTrigger`, and `migratePopupTriggersToOverlays(site: EditableSite): { site: EditableSite; changed: boolean }`.
- Produces state fields: `EditableSiteBase.overlays?: Overlay[]`, `EditableSiteBase.loadExperience?: LoadExperience`, `EditableSiteBase.routeTransition?: RouteTransition`.
- Consumed by all later tasks.

- [ ] **Step 1: Add failing schema and migration smoke**

Create `src/canvas/premium-interactions.smoke.ts`:

```ts
import assert from 'node:assert/strict';
import type { EditableSite } from './schema.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';
import { migratePopupTriggersToOverlays } from './premium-interactions-migration.js';

const baseSite: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1200,
      sections: [
        {
          id: 'section-body',
          recipeId: 'custom',
          name: 'Body',
          height: 400,
          elements: [],
        },
      ],
    },
  ],
};

const premiumSite: EditableSite = {
  ...baseSite,
  overlays: [
    {
      id: 'overlay-newsletter',
      name: 'Newsletter',
      scope: { type: 'site' },
      trigger: { type: 'load' },
      content: {
        id: 'overlay-newsletter-content',
        recipeId: 'custom',
        name: 'Newsletter content',
        height: 420,
        elements: [],
      },
      dismissal: {
        closeButton: true,
        escape: true,
        backdropClick: true,
        bodyScrollLock: true,
        focusTrap: true,
        returnFocus: true,
      },
      openSequence: {
        id: 'seq-overlay-open',
        steps: [
          {
            id: 'step-overlay-fade',
            target: { type: 'overlay-surface' },
            effect: 'fade',
            delayMs: 0,
            durationMs: 220,
            easing: 'ease-out',
          },
        ],
      },
    },
  ],
  loadExperience: {
    id: 'load-main',
    enabled: true,
    preset: 'progress-bar',
    runPolicy: 'once-per-session',
    gates: ['document-ready', 'fonts-ready'],
    timeoutMs: 4000,
    handoffSequence: {
      id: 'seq-load-handoff',
      steps: [
        {
          id: 'step-load-fade',
          target: { type: 'load-screen-part', part: 'shell' },
          effect: 'fade',
          delayMs: 0,
          durationMs: 180,
          easing: 'ease-in',
        },
      ],
    },
  },
  routeTransition: {
    id: 'route-main',
    enabled: true,
    mode: 'fade',
    durationMs: 220,
    easing: 'ease-in-out',
  },
};

const valid = validateEditableSite(premiumSite);
assert.equal(valid.valid, true, valid.errors.join('\n'));

const roundTrip = decodeYDoc(encodeYDoc(premiumSite));
assert.equal(roundTrip.overlays?.[0]?.trigger.type, 'load');
assert.equal(roundTrip.loadExperience?.preset, 'progress-bar');
assert.equal(roundTrip.routeTransition?.mode, 'fade');

const legacy: EditableSite = {
  ...baseSite,
  pages: [
    {
      ...baseSite.pages[0]!,
      sections: [
        {
          id: 'legacy-popup',
          recipeId: 'custom',
          name: 'Legacy Popup',
          height: 320,
          trigger: { type: 'delay', value: 5000 },
          elements: [],
        },
      ],
    },
  ],
};

const migrated = migratePopupTriggersToOverlays(legacy);
assert.equal(migrated.changed, true);
assert.equal(migrated.site.pages[0]?.sections.length, 0);
assert.equal(migrated.site.overlays?.[0]?.trigger.type, 'delay');
assert.equal(migrated.site.overlays?.[0]?.trigger.value, 5000);
assert.equal(migrated.site.overlays?.[0]?.content.id, 'legacy-popup');

const invalid = validateEditableSite({
  ...premiumSite,
  routeTransition: { id: 'route-main', enabled: true, mode: 'spin', durationMs: 200, easing: 'ease' },
} as unknown as EditableSite);
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.some((error) => error.includes('routeTransition.mode')));

console.log('[premium-interactions:smoke] OK');
```

- [ ] **Step 2: Run smoke and verify it fails**

Run: `bun run src/canvas/premium-interactions.smoke.ts`

Expected: fail with missing module or missing exported types/functions.

- [ ] **Step 3: Add schema types**

Modify `src/canvas/schema.ts` by adding constants near the other exported model constants:

```ts
export const OVERLAY_TRIGGER_TYPES = ['load', 'delay', 'scroll', 'exit-intent', 'element-click'] as const;
export type OverlayTriggerType = (typeof OVERLAY_TRIGGER_TYPES)[number];

export const LOAD_EXPERIENCE_PRESETS = ['fade', 'wipe', 'logo-card', 'progress-bar'] as const;
export type LoadExperiencePreset = (typeof LOAD_EXPERIENCE_PRESETS)[number];

export const LOAD_EXPERIENCE_RUN_POLICIES = ['every-visit', 'once-per-session'] as const;
export type LoadExperienceRunPolicy = (typeof LOAD_EXPERIENCE_RUN_POLICIES)[number];

export const LOAD_EXPERIENCE_GATES = ['document-ready', 'fonts-ready', 'hero-media-ready'] as const;
export type LoadExperienceGate = (typeof LOAD_EXPERIENCE_GATES)[number];

export const ROUTE_TRANSITION_MODES = ['fade', 'slide', 'wipe'] as const;
export type RouteTransitionMode = (typeof ROUTE_TRANSITION_MODES)[number];

export const MOTION_SEQUENCE_LITE_EFFECTS = ['fade', 'slide', 'scale', 'wipe', 'blur'] as const;
export type MotionSequenceLiteEffect = (typeof MOTION_SEQUENCE_LITE_EFFECTS)[number];

export const MOTION_SEQUENCE_LITE_TARGET_TYPES = [
  'page-container',
  'overlay-surface',
  'overlay-backdrop',
  'load-screen-part',
] as const;
export type MotionSequenceLiteTargetType = (typeof MOTION_SEQUENCE_LITE_TARGET_TYPES)[number];
```

Add model interfaces after `CanvasPage`:

```ts
export type InteractionTrigger =
  | { type: 'load' }
  | { type: 'exit-intent' }
  | { type: 'delay'; value: number }
  | { type: 'scroll'; value: number }
  | { type: 'element-click'; targetElementId: string };

export type OverlayScope = { type: 'site' } | { type: 'pages'; pageIds: string[] };

export type MotionSequenceLiteTarget =
  | { type: 'page-container' }
  | { type: 'overlay-surface' }
  | { type: 'overlay-backdrop' }
  | { type: 'load-screen-part'; part: 'shell' | 'brand' | 'progress' };

export interface MotionSequenceLiteStep {
  id: string;
  target: MotionSequenceLiteTarget;
  effect: MotionSequenceLiteEffect;
  delayMs: number;
  durationMs: number;
  easing: string;
}

export interface MotionSequenceLite {
  id: string;
  steps: MotionSequenceLiteStep[];
}

export interface OverlayDismissal {
  closeButton: boolean;
  escape: boolean;
  backdropClick: boolean;
  bodyScrollLock: boolean;
  focusTrap: boolean;
  returnFocus: boolean;
}

export interface Overlay {
  id: string;
  name: string;
  scope: OverlayScope;
  trigger: InteractionTrigger;
  content: CanvasSection;
  dismissal: OverlayDismissal;
  openSequence?: MotionSequenceLite;
  closeSequence?: MotionSequenceLite;
}

export interface LoadExperience {
  id: string;
  enabled: boolean;
  preset: LoadExperiencePreset;
  runPolicy: LoadExperienceRunPolicy;
  gates: LoadExperienceGate[];
  timeoutMs: number;
  handoffSequence?: MotionSequenceLite;
}

export interface RouteTransition {
  id: string;
  enabled: boolean;
  mode: RouteTransitionMode;
  durationMs: number;
  easing: string;
  outgoingSequence?: MotionSequenceLite;
  incomingSequence?: MotionSequenceLite;
}
```

Add fields to `EditableSiteBase`:

```ts
  overlays?: Overlay[];
  loadExperience?: LoadExperience;
  routeTransition?: RouteTransition;
```

- [ ] **Step 4: Add validation**

Modify `src/canvas/validate.ts`:

```ts
import {
  LOAD_EXPERIENCE_GATES,
  LOAD_EXPERIENCE_PRESETS,
  LOAD_EXPERIENCE_RUN_POLICIES,
  MOTION_SEQUENCE_LITE_EFFECTS,
  MOTION_SEQUENCE_LITE_TARGET_TYPES,
  OVERLAY_TRIGGER_TYPES,
  ROUTE_TRANSITION_MODES,
  type LoadExperienceGate,
  type LoadExperiencePreset,
  type LoadExperienceRunPolicy,
  type MotionSequenceLiteEffect,
  type MotionSequenceLiteTargetType,
  type OverlayTriggerType,
  type RouteTransitionMode,
} from './schema.js';
```

Add validator helpers:

```ts
// Reuse the existing assertNonEmptyString, assertFiniteNumber, assertOneOf,
// and isRecord helpers already in this module.
function validateMotionSequenceLite(seq: unknown, basePath: string, errors: string[]): void {
  if (seq === undefined) return;
  if (!isRecord(seq)) {
    errors.push(`${basePath} must be an object when present`);
    return;
  }
  assertNonEmptyString(seq.id, `${basePath}.id`, errors);
  if (!Array.isArray(seq.steps)) {
    errors.push(`${basePath}.steps must be an array`);
    return;
  }
  seq.steps.forEach((step, index) => {
    const stepPath = `${basePath}.steps[${String(index)}]`;
    if (!isRecord(step)) {
      errors.push(`${stepPath} must be an object`);
      return;
    }
    assertNonEmptyString(step.id, `${stepPath}.id`, errors);
    assertOneOf<MotionSequenceLiteEffect>(step.effect, MOTION_SEQUENCE_LITE_EFFECTS, `${stepPath}.effect`, errors);
    assertFiniteNumber(step.delayMs, `${stepPath}.delayMs`, errors);
    assertFiniteNumber(step.durationMs, `${stepPath}.durationMs`, errors);
    if (typeof step.durationMs === 'number' && step.durationMs <= 0) {
      errors.push(`${stepPath}.durationMs must be > 0`);
    }
    assertNonEmptyString(step.easing, `${stepPath}.easing`, errors);
    if (!isRecord(step.target)) {
      errors.push(`${stepPath}.target must be an object`);
      return;
    }
    assertOneOf<MotionSequenceLiteTargetType>(
      step.target.type,
      MOTION_SEQUENCE_LITE_TARGET_TYPES,
      `${stepPath}.target.type`,
      errors,
    );
    if (step.target.type === 'load-screen-part') {
      assertOneOf(step.target.part, ['shell', 'brand', 'progress'] as const, `${stepPath}.target.part`, errors);
    }
  });
}

function validateInteractionTrigger(trigger: unknown, basePath: string, errors: string[]): void {
  if (!isRecord(trigger)) {
    errors.push(`${basePath} must be an object`);
    return;
  }
  if (!assertOneOf<OverlayTriggerType>(trigger.type, OVERLAY_TRIGGER_TYPES, `${basePath}.type`, errors)) return;
  if (trigger.type === 'delay') {
    assertFiniteNumber(trigger.value, `${basePath}.value`, errors);
    if (typeof trigger.value === 'number' && trigger.value < 0) errors.push(`${basePath}.value must be >= 0`);
  } else if (trigger.type === 'scroll') {
    assertFiniteNumber(trigger.value, `${basePath}.value`, errors);
    if (typeof trigger.value === 'number' && (trigger.value < 0 || trigger.value > 100)) {
      errors.push(`${basePath}.value must be in [0, 100]`);
    }
  } else if (trigger.type === 'element-click') {
    assertNonEmptyString(trigger.targetElementId, `${basePath}.targetElementId`, errors);
  } else if ('value' in trigger) {
    errors.push(`${basePath}.value must be absent for ${String(trigger.type)} triggers`);
  }
}
```

Add overlay/load/route validators with exact path messages:

```ts
function validateOverlays(site: Record<string, unknown>, errors: string[]): void {
  if (site.overlays === undefined) return;
  if (!Array.isArray(site.overlays)) {
    errors.push('overlays must be an array when present');
    return;
  }
  const pageIds = new Set<string>();
  if (Array.isArray(site.pages)) {
    site.pages.forEach((page) => {
      if (isRecord(page) && typeof page.id === 'string') pageIds.add(page.id);
    });
  }
  site.overlays.forEach((overlay, index) => {
    const basePath = `overlays[${String(index)}]`;
    if (!isRecord(overlay)) {
      errors.push(`${basePath} must be an object`);
      return;
    }
    assertNonEmptyString(overlay.id, `${basePath}.id`, errors);
    assertNonEmptyString(overlay.name, `${basePath}.name`, errors);
    validateInteractionTrigger(overlay.trigger, `${basePath}.trigger`, errors);
    if (!isRecord(overlay.scope)) {
      errors.push(`${basePath}.scope must be an object`);
    } else if (overlay.scope.type === 'site') {
      if ('pageIds' in overlay.scope) errors.push(`${basePath}.scope.pageIds must be absent for site scope`);
    } else if (overlay.scope.type === 'pages') {
      if (!Array.isArray(overlay.scope.pageIds) || overlay.scope.pageIds.length === 0) {
        errors.push(`${basePath}.scope.pageIds must be a non-empty array for pages scope`);
      } else {
        overlay.scope.pageIds.forEach((pageId, pageIndex) => {
          if (typeof pageId !== 'string' || !pageIds.has(pageId)) {
            errors.push(`${basePath}.scope.pageIds[${String(pageIndex)}] must reference an existing page id`);
          }
        });
      }
    } else {
      errors.push(`${basePath}.scope.type must be one of [site, pages]`);
    }
    validateSection(overlay.content, `${basePath}.content`, errors);
    if (!isRecord(overlay.dismissal)) {
      errors.push(`${basePath}.dismissal must be an object`);
    } else {
      ['closeButton', 'escape', 'backdropClick', 'bodyScrollLock', 'focusTrap', 'returnFocus'].forEach((key) => {
        if (typeof overlay.dismissal[key] !== 'boolean') errors.push(`${basePath}.dismissal.${key} must be boolean`);
      });
    }
    validateMotionSequenceLite(overlay.openSequence, `${basePath}.openSequence`, errors);
    validateMotionSequenceLite(overlay.closeSequence, `${basePath}.closeSequence`, errors);
  });
}
```

Call these validators from the top-level editable site validation path.

- [ ] **Step 5: Add pure popup migration**

Create `src/canvas/premium-interactions-migration.ts`:

```ts
import type { CanvasSection, EditableSite, InteractionTrigger, Overlay } from './schema.js';

function triggerToInteraction(trigger: NonNullable<CanvasSection['trigger']>): InteractionTrigger {
  if (trigger.type === 'exit-intent') return { type: 'exit-intent' };
  if (trigger.type === 'delay') return { type: 'delay', value: trigger.value };
  return { type: 'scroll', value: trigger.value };
}

function defaultDismissal(): Overlay['dismissal'] {
  return {
    closeButton: true,
    escape: true,
    backdropClick: true,
    bodyScrollLock: true,
    focusTrap: true,
    returnFocus: true,
  };
}

function sectionWithoutTrigger(section: CanvasSection): CanvasSection {
  const { trigger: _trigger, ...rest } = section;
  void _trigger;
  return { ...rest };
}

export function migratePopupTriggersToOverlays(site: EditableSite): { site: EditableSite; changed: boolean } {
  const overlays: Overlay[] = [...(site.overlays ?? [])];
  let changed = false;
  const pages = site.pages.map((page) => {
    const nextSections: CanvasSection[] = [];
    let pageChanged = false;
    for (const section of page.sections) {
      if (!section.trigger) {
        nextSections.push(section);
        continue;
      }
      changed = true;
      pageChanged = true;
      overlays.push({
        id: `overlay-${section.id}`,
        name: section.name || 'Overlay',
        scope: { type: 'pages', pageIds: [page.id] },
        trigger: triggerToInteraction(section.trigger),
        content: sectionWithoutTrigger(section),
        dismissal: defaultDismissal(),
      });
    }
    return pageChanged ? { ...page, sections: nextSections } : page;
  });
  if (!changed) return { site, changed: false };
  return {
    site: {
      ...site,
      pages,
      overlays,
    },
    changed: true,
  };
}
```

- [ ] **Step 6: Add Yjs projection fields**

Modify `src/canvas/yjs-projection.ts` to encode and decode `overlays`, `loadExperience`, and `routeTransition`. Use `Y.Map` and `Y.Array` patterns already used for pages, sections, and style-kit nested records. Add assertions to `src/canvas/yjs-projection.smoke.ts` only if `src/canvas/premium-interactions.smoke.ts` does not exercise the full round-trip.

- [ ] **Step 7: Run smoke and full model checks**

Run:

```powershell
bun run src/canvas/premium-interactions.smoke.ts
bun run src/canvas/smoke.ts
bun run src/canvas/validate-parity.smoke.ts
bun run src/canvas/yjs-projection.smoke.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```powershell
git add src/canvas/schema.ts src/canvas/validate.ts src/canvas/yjs-projection.ts src/canvas/premium-interactions-migration.ts src/canvas/premium-interactions.smoke.ts src/canvas/yjs-projection.smoke.ts
git commit -m "feat: add premium interaction model"
```

---

### Task 2: Runtime Hydrator Entry Point And Rendered Interaction Shells

**Files:**
- Modify: `src/interactive/runtime.ts`
- Modify: `src/interactive/build.ts`
- Modify: `src/interactive/inject.ts`
- Modify: `src/routes/public.ts`
- Modify: `src/canvas/render.ts`
- Modify: `src/canvas/public-styles.ts`
- Create: `src/interactive/premium-hydrator.smoke.ts`

**Interfaces:**
- Consumes: `EditableSiteBase.overlays`, `loadExperience`, `routeTransition`.
- Produces visitor global: `window.__opencanvasHydrate(root?: ParentNode, options?: { reason?: string }): void`.
- Produces DOM contracts: `[data-opencanvas-route-container]`, `[data-opencanvas-overlays-root]`, `[data-opencanvas-load-experience]`.

- [ ] **Step 1: Write failing hydrator smoke**

Create `src/interactive/premium-hydrator.smoke.ts`:

```ts
import assert from 'node:assert/strict';
import { INTERACTIVE_RUNTIME_SRC } from './build.js';

assert.ok(
  INTERACTIVE_RUNTIME_SRC.includes('window.__opencanvasHydrate'),
  'runtime must expose window.__opencanvasHydrate',
);
assert.ok(
  INTERACTIVE_RUNTIME_SRC.includes('hydratePremiumInteractions'),
  'runtime must call hydratePremiumInteractions from the shared hydrator',
);
assert.ok(
  INTERACTIVE_RUNTIME_SRC.includes('data-opencanvas-route-container'),
  'runtime must know the route container contract',
);

console.log('[premium-hydrator:smoke] OK');
```

- [ ] **Step 2: Run smoke and verify it fails**

Run: `bun run src/interactive/premium-hydrator.smoke.ts`

Expected: fail because the runtime does not expose the global hydrator yet.

- [ ] **Step 3: Refactor runtime entry point**

Modify `src/interactive/runtime.ts` so `RUNTIME_ENTRY_SRC` defines `hydratePremiumInteractions` and exposes the global:

```ts
export const RUNTIME_ENTRY_SRC = String.raw`
function hydratePremiumInteractions(scope, options) {
  var root = scope || document;
  hydratePointerFx(root);
  if (typeof hydrateOverlays === 'function') hydrateOverlays(root, options || {});
  if (typeof hydrateLoadExperience === 'function') hydrateLoadExperience(root, options || {});
  if (typeof hydrateRouteTransition === 'function') hydrateRouteTransition(root, options || {});
}
function hydrateAll(scope, options) {
  var rootScope = scope || document;
  var roots = rootScope.querySelectorAll('[data-opencanvas-interactive]');
  for (var i = 0; i < roots.length; i++) {
    var root = roots[i];
    if (root.getAttribute('data-opencanvas-hydrated') === 'true') continue;
    root.setAttribute('data-opencanvas-hydrated', 'true');
    var kind = root.getAttribute('data-opencanvas-interactive');
    if (kind === 'accordion') {
      hydrateAccordion(root);
    } else if (kind === 'carousel') {
      hydrateCarousel(root);
    }
  }
  hydratePremiumInteractions(rootScope, options || {});
}
window.__opencanvasHydrate = hydrateAll;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function(){ hydrateAll(document, { reason: 'initial-load' }); });
} else {
  hydrateAll(document, { reason: 'initial-load' });
}
`;
```

- [ ] **Step 4: Add no-op runtime fragments for later tasks**

Create empty-but-contractual functions in new files, each with idempotent selectors:

`src/interactive/overlay-v1.ts`:

```ts
export const OVERLAY_RUNTIME_SRC = String.raw`
function hydrateOverlays(scope, options) {
  var root = scope || document;
  var nodes = root.querySelectorAll('[data-opencanvas-overlay]');
  for (var i = 0; i < nodes.length; i++) {
    var overlay = nodes[i];
    if (overlay.getAttribute('data-opencanvas-overlay-hydrated') === 'true') continue;
    overlay.setAttribute('data-opencanvas-overlay-hydrated', 'true');
  }
}
`;
```

`src/interactive/load-experience.ts`:

```ts
export const LOAD_EXPERIENCE_RUNTIME_SRC = String.raw`
function hydrateLoadExperience(scope, options) {
  var root = scope || document;
  var node = root.querySelector('[data-opencanvas-load-experience]');
  if (!node) return;
  if (node.getAttribute('data-opencanvas-load-hydrated') === 'true') return;
  node.setAttribute('data-opencanvas-load-hydrated', 'true');
}
`;
```

`src/interactive/route-transition.ts`:

```ts
export const ROUTE_TRANSITION_RUNTIME_SRC = String.raw`
function hydrateRouteTransition(scope, options) {
  var root = scope || document;
  var container = root.querySelector('[data-opencanvas-route-container]');
  if (!container) return;
  if (container.getAttribute('data-opencanvas-route-hydrated') === 'true') return;
  container.setAttribute('data-opencanvas-route-hydrated', 'true');
}
`;
```

`src/interactive/motion-sequence-lite.ts`:

```ts
export const MOTION_SEQUENCE_LITE_RUNTIME_SRC = String.raw`
function runMotionSequenceLite(root, sequenceId) {
  return true;
}
`;
```

- [ ] **Step 5: Include fragments in build**

Modify `src/interactive/build.ts` imports and assembly:

```ts
import { LOAD_EXPERIENCE_RUNTIME_SRC } from './load-experience.js';
import { MOTION_SEQUENCE_LITE_RUNTIME_SRC } from './motion-sequence-lite.js';
import { OVERLAY_RUNTIME_SRC } from './overlay-v1.js';
import { ROUTE_TRANSITION_RUNTIME_SRC } from './route-transition.js';
```

Add the fragments before `RUNTIME_ENTRY_SRC`:

```ts
  MOTION_SEQUENCE_LITE_RUNTIME_SRC,
  OVERLAY_RUNTIME_SRC,
  LOAD_EXPERIENCE_RUNTIME_SRC,
  ROUTE_TRANSITION_RUNTIME_SRC,
```

- [ ] **Step 6: Render stable shells**

Modify `src/canvas/render.ts`:

```ts
const rootAttrs = [
  `data-style-kit="${escapeAttr(snapshot.styleKit)}"`,
  'data-opencanvas-route-container',
  `style="${escapeAttr(rootStyle)}"`,
].join(' ');
```

Return:

```ts
return `<main class="opencanvas-site" ${rootAttrs}>${scrollStyle}${responsiveStyle}${pagesHtml}${renderOverlays(snapshot, baseCtx)}${renderLoadExperience(snapshot)}${copyScript}${tabsScript}</main>`;
```

Add `renderOverlays` and `renderLoadExperience` helpers inside `render.ts` so they can reuse `renderSection`.

- [ ] **Step 7: Call hydrator after live publish swaps**

Modify `src/routes/public.ts` near the `root.innerHTML = selectedHtml;` assignment:

```ts
root.innerHTML = selectedHtml;
var hydrate = window.__opencanvasHydrate;
if (typeof hydrate === 'function') {
  hydrate(root, { reason: 'live-publish' });
} else {
  console.error('[opencanvas-live] Runtime Hydrator missing after live publish swap', {
    version: selectedVersion
  });
}
```

- [ ] **Step 8: Inject runtime for Premium Interaction fields**

Modify `src/interactive/inject.ts`:

```ts
  if (snapshot.overlays && snapshot.overlays.length > 0) return true;
  if (snapshot.loadExperience?.enabled === true) return true;
  if (snapshot.routeTransition?.enabled === true) return true;
```

- [ ] **Step 9: Run checks**

Run:

```powershell
bun run src/interactive/premium-hydrator.smoke.ts
bun run src/interactive/smoke.ts
bun run src/interactive/popup.smoke.ts
bun run src/routes/public-404.smoke.ts
```

Expected: all pass.

- [ ] **Step 10: Commit**

```powershell
git add src/interactive/runtime.ts src/interactive/build.ts src/interactive/inject.ts src/interactive/overlay-v1.ts src/interactive/load-experience.ts src/interactive/route-transition.ts src/interactive/motion-sequence-lite.ts src/interactive/premium-hydrator.smoke.ts src/routes/public.ts src/canvas/render.ts src/canvas/public-styles.ts
git commit -m "feat: add premium interaction hydrator"
```

---

### Task 3: Overlay v1 Runtime, Rendering, And Migration Integration

**Files:**
- Modify: `src/canvas/render.ts`
- Modify: `src/canvas/public-styles.ts`
- Modify: `src/interactive/overlay-v1.ts`
- Modify: `src/editor-client/site-load-migration.ts`
- Create: `src/interactive/overlay-v1.smoke.ts`

**Interfaces:**
- Consumes: `Overlay`, `InteractionTrigger`, `MotionSequenceLite`.
- Produces DOM: `[data-opencanvas-overlay="<id>"]`, `[data-opencanvas-overlay-backdrop]`, `[data-opencanvas-overlay-surface]`, `[data-opencanvas-overlay-open]`.
- Emits failure event: `opencanvas:overlay-failed`.

- [ ] **Step 1: Write failing overlay smoke**

Create `src/interactive/overlay-v1.smoke.ts`:

```ts
import assert from 'node:assert/strict';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-17T00:00:00.000Z',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1200,
      sections: [
        {
          id: 'section-body',
          recipeId: 'custom',
          name: 'Body',
          height: 300,
          elements: [],
        },
      ],
    },
  ],
  overlays: [
    {
      id: 'overlay-welcome',
      name: 'Welcome',
      scope: { type: 'site' },
      trigger: { type: 'load' },
      content: {
        id: 'overlay-content',
        recipeId: 'custom',
        name: 'Overlay content',
        height: 320,
        elements: [],
      },
      dismissal: {
        closeButton: true,
        escape: true,
        backdropClick: true,
        bodyScrollLock: true,
        focusTrap: true,
        returnFocus: true,
      },
    },
  ],
};

const html = renderCanvasSnapshot(snapshot, '/assets', 'site-1', { turnstileSiteKey: 'test-key' });
assert.ok(html.includes('data-opencanvas-overlays-root'));
assert.ok(html.includes('data-opencanvas-overlay="overlay-welcome"'));
assert.ok(html.includes('data-opencanvas-overlay-trigger-type="load"'));
assert.equal(snapshotNeedsInteractiveRuntime(snapshot), true);

const injected = injectInteractiveRuntime(html, snapshot);
assert.ok(injected.includes('hydrateOverlays'));
assert.ok(injected.includes('opencanvas:overlay-failed'));

console.log('[overlay-v1:smoke] OK');
```

- [ ] **Step 2: Run smoke and verify it fails**

Run: `bun run src/interactive/overlay-v1.smoke.ts`

Expected: fail until render/runtime include overlay details.

- [ ] **Step 3: Render overlay layer**

Modify `renderOverlays(snapshot, baseCtx)` from Task 2:

```ts
function renderOverlays(snapshot: PublishedSnapshot, ctx: Omit<ElementRenderCtx, 'pageSlug'>): string {
  if (!snapshot.overlays || snapshot.overlays.length === 0) return '';
  const overlays = snapshot.overlays
    .map((overlay) => {
      const contentHtml = renderSection(overlay.content, Math.min(snapshot.pages[0]?.maxWidth ?? Infinity, snapshot.pages[0]?.width ?? 1200), {
        ...ctx,
        pageSlug: snapshot.pages[0]?.slug ?? '',
      });
      const trigger = overlay.trigger;
      const triggerAttrs =
        trigger.type === 'delay' || trigger.type === 'scroll'
          ? ` data-opencanvas-overlay-trigger-value="${escapeAttr(String(trigger.value))}"`
          : trigger.type === 'element-click'
            ? ` data-opencanvas-overlay-trigger-target="${escapeAttr(trigger.targetElementId)}"`
            : '';
      return `<div class="opencanvas-overlay" data-opencanvas-overlay="${escapeAttr(overlay.id)}" data-opencanvas-overlay-trigger-type="${escapeAttr(trigger.type)}"${triggerAttrs} data-opencanvas-overlay-close-button="${String(overlay.dismissal.closeButton)}" data-opencanvas-overlay-escape="${String(overlay.dismissal.escape)}" data-opencanvas-overlay-backdrop-click="${String(overlay.dismissal.backdropClick)}" data-opencanvas-overlay-body-scroll-lock="${String(overlay.dismissal.bodyScrollLock)}" data-opencanvas-overlay-focus-trap="${String(overlay.dismissal.focusTrap)}" data-opencanvas-overlay-return-focus="${String(overlay.dismissal.returnFocus)}" hidden><div class="opencanvas-overlay-backdrop" data-opencanvas-overlay-backdrop></div><div class="opencanvas-overlay-surface" data-opencanvas-overlay-surface role="dialog" aria-modal="true" aria-label="${escapeAttr(overlay.name)}">${contentHtml}</div></div>`;
    })
    .join('');
  return `<div data-opencanvas-overlays-root>${overlays}</div>`;
}
```

- [ ] **Step 4: Add overlay CSS**

Modify `src/canvas/public-styles.ts`:

```css
[data-opencanvas-overlays-root] {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 100000;
}
.opencanvas-overlay[hidden] {
  display: none;
}
.opencanvas-overlay[data-opencanvas-overlay-open] {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: auto;
}
.opencanvas-overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.56);
}
.opencanvas-overlay-surface {
  position: relative;
  z-index: 1;
  max-width: min(92vw, 960px);
  max-height: 90vh;
  overflow: auto;
  background: var(--opencanvas-kit-bg, #0c0c0d);
  color: var(--opencanvas-kit-text, #f6f6f6);
}
.opencanvas-overlay-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
}
```

- [ ] **Step 5: Implement overlay runtime**

Modify `src/interactive/overlay-v1.ts` to:
- attach trigger listeners for `load`, `delay`, `scroll`, `exit-intent`, `element-click`
- open once per trigger fire until closed
- add close button when configured
- close on Escape/backdrop when configured
- lock body scroll when configured
- remember and return focus when configured
- dispatch `new CustomEvent('opencanvas:overlay-failed', { detail })` when a configured target cannot be found

Use this failure helper inside the JS source string:

```js
function overlayFailure(id, phase, extra) {
  var detail = { overlayId: id, phase: phase };
  for (var k in (extra || {})) detail[k] = extra[k];
  window.dispatchEvent(new CustomEvent('opencanvas:overlay-failed', { detail: detail }));
  console.error('[opencanvas overlay] failed', detail);
}
```

- [ ] **Step 6: Wire editor load migration**

Modify `src/editor-client/site-load-migration.ts` so `migrateState` calls `migratePopupTriggersToOverlays(state)` and returns the migrated site. When `changed` is true, schedule save through the existing site-load migration mechanism used by the module.

- [ ] **Step 7: Run checks**

Run:

```powershell
bun run src/interactive/overlay-v1.smoke.ts
bun run src/interactive/premium-interactions.smoke.ts
bun run src/editor-client/site-load-migration.smoke.ts
bun run src/editor-client/carousel-hydration.smoke.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```powershell
git add src/canvas/render.ts src/canvas/public-styles.ts src/interactive/overlay-v1.ts src/interactive/overlay-v1.smoke.ts src/editor-client/site-load-migration.ts src/editor-client/site-load-migration.smoke.ts
git commit -m "feat: add overlay runtime"
```

---

### Task 4: Load Experience v1 Runtime And Rendering

**Files:**
- Modify: `src/canvas/render.ts`
- Modify: `src/canvas/public-styles.ts`
- Modify: `src/interactive/load-experience.ts`
- Create: `src/interactive/load-experience.smoke.ts`

**Interfaces:**
- Consumes: `LoadExperience`.
- Produces DOM: `[data-opencanvas-load-experience]`.
- Emits failure event: `opencanvas:load-experience-failed`.

- [ ] **Step 1: Write failing load smoke**

Create `src/interactive/load-experience.smoke.ts`:

```ts
import assert from 'node:assert/strict';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-17T00:00:00.000Z',
  pages: [{ id: 'home', slug: 'home', title: 'Home', width: 1200, sections: [] }],
  loadExperience: {
    id: 'load-main',
    enabled: true,
    preset: 'progress-bar',
    runPolicy: 'once-per-session',
    gates: ['document-ready', 'fonts-ready'],
    timeoutMs: 3000,
  },
};

const html = renderCanvasSnapshot(snapshot, '/assets', 'site-1', { turnstileSiteKey: 'test-key' });
assert.ok(html.includes('data-opencanvas-load-experience'));
assert.ok(html.includes('data-opencanvas-load-preset="progress-bar"'));
assert.ok(html.includes('data-opencanvas-load-gates="document-ready fonts-ready"'));
assert.equal(snapshotNeedsInteractiveRuntime(snapshot), true);
assert.ok(injectInteractiveRuntime(html, snapshot).includes('hydrateLoadExperience'));
assert.ok(injectInteractiveRuntime(html, snapshot).includes('opencanvas:load-experience-failed'));

console.log('[load-experience:smoke] OK');
```

- [ ] **Step 2: Run smoke and verify it fails**

Run: `bun run src/interactive/load-experience.smoke.ts`

Expected: fail until render/runtime support exists.

- [ ] **Step 3: Render load shell**

Implement `renderLoadExperience(snapshot)` in `src/canvas/render.ts`:

```ts
function renderLoadExperience(snapshot: PublishedSnapshot): string {
  const load = snapshot.loadExperience;
  if (!load || load.enabled !== true) return '';
  return `<div class="opencanvas-load-experience" data-opencanvas-load-experience="${escapeAttr(load.id)}" data-opencanvas-load-preset="${escapeAttr(load.preset)}" data-opencanvas-load-run-policy="${escapeAttr(load.runPolicy)}" data-opencanvas-load-gates="${escapeAttr(load.gates.join(' '))}" data-opencanvas-load-timeout-ms="${escapeAttr(String(load.timeoutMs))}"><div class="opencanvas-load-brand" data-opencanvas-load-part="brand">${escapeAttr(snapshot.pages[0]?.title ?? 'Loading')}</div><div class="opencanvas-load-progress" data-opencanvas-load-part="progress"><span></span></div><div class="opencanvas-load-error" data-opencanvas-load-part="error" hidden>Loading failed</div></div>`;
}
```

- [ ] **Step 4: Add load CSS**

Add to `src/canvas/public-styles.ts`:

```css
.opencanvas-load-experience {
  position: fixed;
  inset: 0;
  z-index: 100001;
  display: grid;
  place-items: center;
  gap: 18px;
  background: var(--opencanvas-kit-bg, #0c0c0d);
  color: var(--opencanvas-kit-text, #f6f6f6);
}
.opencanvas-load-experience[data-opencanvas-load-hidden="true"] {
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
}
.opencanvas-load-progress {
  width: min(260px, 60vw);
  height: 3px;
  background: rgba(127, 127, 127, 0.25);
  overflow: hidden;
}
.opencanvas-load-progress > span {
  display: block;
  width: 100%;
  height: 100%;
  transform: translateX(-100%);
  background: var(--opencanvas-kit-accent, currentColor);
  animation: opencanvas-load-progress 1200ms ease-in-out infinite;
}
@keyframes opencanvas-load-progress {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
.opencanvas-load-error[hidden] {
  display: none;
}
```

- [ ] **Step 5: Implement gates and failure event**

Modify `src/interactive/load-experience.ts` so `hydrateLoadExperience`:
- checks `sessionStorage` for once-per-session key `opencanvas-load-seen-<id>`
- waits for configured gates
- `document-ready`: resolves at DOMContentLoaded or immediately when ready
- `fonts-ready`: resolves `document.fonts.ready`; if `document.fonts` missing, emits failure with gate `fonts-ready`
- `hero-media-ready`: waits for the first image/video inside `[data-opencanvas-route-container]`; if none exists, resolves
- races gates against `timeoutMs`
- on failure: shows `.opencanvas-load-error`, emits `opencanvas:load-experience-failed`, leaves page visible behind the load shell only after marking the shell failed
- on success: marks once-per-session key and hides the shell

- [ ] **Step 6: Run checks**

Run:

```powershell
bun run src/interactive/load-experience.smoke.ts
bun run src/interactive/premium-hydrator.smoke.ts
bun run src/interactive/smoke.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add src/canvas/render.ts src/canvas/public-styles.ts src/interactive/load-experience.ts src/interactive/load-experience.smoke.ts
git commit -m "feat: add load experience runtime"
```

---

### Task 5: Route Transition v1 Runtime

**Files:**
- Modify: `src/canvas/render.ts`
- Modify: `src/canvas/public-styles.ts`
- Modify: `src/interactive/route-transition.ts`
- Create: `src/interactive/route-transition.smoke.ts`

**Interfaces:**
- Consumes: `RouteTransition`.
- Requires global: `window.__opencanvasHydrate`.
- Emits failure event: `opencanvas:route-transition-failed`.

- [ ] **Step 1: Write failing route smoke**

Create `src/interactive/route-transition.smoke.ts`:

```ts
import assert from 'node:assert/strict';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-17T00:00:00.000Z',
  pages: [{ id: 'home', slug: 'home', title: 'Home', width: 1200, sections: [] }],
  routeTransition: {
    id: 'route-main',
    enabled: true,
    mode: 'wipe',
    durationMs: 240,
    easing: 'ease-in-out',
  },
};

const html = renderCanvasSnapshot(snapshot, '/assets', 'site-1', { turnstileSiteKey: 'test-key' });
assert.ok(html.includes('data-opencanvas-route-container'));
assert.ok(html.includes('data-opencanvas-route-transition="route-main"'));
assert.ok(html.includes('data-opencanvas-route-mode="wipe"'));
assert.equal(snapshotNeedsInteractiveRuntime(snapshot), true);
assert.ok(injectInteractiveRuntime(html, snapshot).includes('hydrateRouteTransition'));
assert.ok(injectInteractiveRuntime(html, snapshot).includes('opencanvas:route-transition-failed'));

console.log('[route-transition:smoke] OK');
```

- [ ] **Step 2: Run smoke and verify it fails**

Run: `bun run src/interactive/route-transition.smoke.ts`

Expected: fail until route transition metadata and runtime exist.

- [ ] **Step 3: Render route transition metadata**

Modify root `<main>` attributes in `src/canvas/render.ts`:

```ts
const routeAttrs =
  snapshot.routeTransition?.enabled === true
    ? ` data-opencanvas-route-transition="${escapeAttr(snapshot.routeTransition.id)}" data-opencanvas-route-mode="${escapeAttr(snapshot.routeTransition.mode)}" data-opencanvas-route-duration-ms="${escapeAttr(String(snapshot.routeTransition.durationMs))}" data-opencanvas-route-easing="${escapeAttr(snapshot.routeTransition.easing)}"`
    : '';
```

Append `routeAttrs` to `<main class="opencanvas-site" ...>`.

- [ ] **Step 4: Add transition CSS hooks**

Add to `src/canvas/public-styles.ts`:

```css
[data-opencanvas-route-container] {
  view-transition-name: opencanvas-site;
}
[data-opencanvas-route-state="outgoing"] {
  pointer-events: none;
}
[data-opencanvas-route-mode="fade"][data-opencanvas-route-state="outgoing"] {
  opacity: 0;
}
[data-opencanvas-route-mode="slide"][data-opencanvas-route-state="outgoing"] {
  transform: translateX(-24px);
  opacity: 0;
}
[data-opencanvas-route-mode="wipe"][data-opencanvas-route-state="outgoing"] {
  clip-path: inset(0 100% 0 0);
}
```

- [ ] **Step 5: Implement route transition runtime**

Modify `src/interactive/route-transition.ts` so it:
- binds click listeners for same-origin anchors that are not `target="_blank"`, hash-only, `download`, `mailto:`, or `tel:`
- calls `event.preventDefault()`
- fetches the next document with `credentials: 'same-origin'`
- parses it using `new DOMParser().parseFromString(html, 'text/html')`
- selects `[data-opencanvas-route-container]` from the parsed document
- sets outgoing state on the current container
- waits for configured duration
- swaps `container.innerHTML`
- calls `window.__opencanvasHydrate(container, { reason: 'route-transition' })`
- updates `history.pushState`
- restores focus to `container` with `tabindex="-1"` if needed
- scrolls to top
- clears route state after incoming duration
- on any failure, leaves the current DOM in place and dispatches `opencanvas:route-transition-failed`

Use this failure helper:

```js
function routeFailure(id, phase, extra) {
  var detail = { transitionId: id, phase: phase };
  for (var k in (extra || {})) detail[k] = extra[k];
  window.dispatchEvent(new CustomEvent('opencanvas:route-transition-failed', { detail: detail }));
  console.error('[opencanvas route-transition] failed', detail);
}
```

- [ ] **Step 6: Run checks**

Run:

```powershell
bun run src/interactive/route-transition.smoke.ts
bun run src/interactive/premium-hydrator.smoke.ts
bun run src/interactive/smoke.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add src/canvas/render.ts src/canvas/public-styles.ts src/interactive/route-transition.ts src/interactive/route-transition.smoke.ts
git commit -m "feat: add route transition runtime"
```

---

### Task 6: Motion Sequence Lite Execution

**Files:**
- Modify: `src/interactive/motion-sequence-lite.ts`
- Modify: `src/canvas/public-styles.ts`
- Create: `src/interactive/motion-sequence-lite.smoke.ts`

**Interfaces:**
- Consumes DOM attributes emitted by Overlay/Load/Route tasks.
- Produces: `runMotionSequenceLite(root: ParentNode, sequenceId: string): boolean` inside visitor runtime source.

- [ ] **Step 1: Write failing sequence smoke**

Create `src/interactive/motion-sequence-lite.smoke.ts`:

```ts
import assert from 'node:assert/strict';
import { INTERACTIVE_RUNTIME_SRC } from './build.js';

assert.ok(INTERACTIVE_RUNTIME_SRC.includes('function runMotionSequenceLite'));
assert.ok(INTERACTIVE_RUNTIME_SRC.includes('data-opencanvas-motion-sequence-lite'));
assert.ok(INTERACTIVE_RUNTIME_SRC.includes('opencanvas-motion-effect'));

console.log('[motion-sequence-lite:smoke] OK');
```

- [ ] **Step 2: Run smoke and verify it fails**

Run: `bun run src/interactive/motion-sequence-lite.smoke.ts`

Expected: fail until runtime source contains the expected sequence contract.

- [ ] **Step 3: Implement constrained effect runner**

Modify `src/interactive/motion-sequence-lite.ts`:

```ts
export const MOTION_SEQUENCE_LITE_RUNTIME_SRC = String.raw`
function motionTarget(root, target) {
  if (target === 'page-container') return root.querySelector('[data-opencanvas-route-container]');
  if (target === 'overlay-surface') return root.querySelector('[data-opencanvas-overlay-surface]');
  if (target === 'overlay-backdrop') return root.querySelector('[data-opencanvas-overlay-backdrop]');
  if (target.indexOf('load-screen-part:') === 0) {
    return root.querySelector('[data-opencanvas-load-part="' + target.split(':')[1] + '"]');
  }
  return null;
}
function applyMotionEffect(el, effect, duration, easing, delay) {
  el.style.setProperty('--opencanvas-motion-lite-duration', String(duration) + 'ms');
  el.style.setProperty('--opencanvas-motion-lite-easing', easing);
  el.style.setProperty('--opencanvas-motion-lite-delay', String(delay) + 'ms');
  el.setAttribute('data-opencanvas-motion-effect', effect);
  void el.offsetWidth;
  el.setAttribute('data-opencanvas-motion-running', 'true');
  window.setTimeout(function(){
    el.removeAttribute('data-opencanvas-motion-running');
  }, delay + duration);
}
function runMotionSequenceLite(root, sequenceId) {
  var scope = root || document;
  var steps = scope.querySelectorAll('[data-opencanvas-motion-sequence-lite="' + sequenceId + '"]');
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    var targetName = step.getAttribute('data-opencanvas-motion-target') || '';
    var target = motionTarget(scope, targetName);
    if (!target) return false;
    applyMotionEffect(
      target,
      step.getAttribute('data-opencanvas-motion-effect') || 'fade',
      parseInt(step.getAttribute('data-opencanvas-motion-duration-ms') || '180', 10),
      step.getAttribute('data-opencanvas-motion-easing') || 'ease',
      parseInt(step.getAttribute('data-opencanvas-motion-delay-ms') || '0', 10)
    );
  }
  return true;
}
`;
```

- [ ] **Step 4: Add CSS effect states**

Add to `src/canvas/public-styles.ts`:

```css
[data-opencanvas-motion-running="true"] {
  transition:
    opacity var(--opencanvas-motion-lite-duration, 180ms) var(--opencanvas-motion-lite-easing, ease) var(--opencanvas-motion-lite-delay, 0ms),
    transform var(--opencanvas-motion-lite-duration, 180ms) var(--opencanvas-motion-lite-easing, ease) var(--opencanvas-motion-lite-delay, 0ms),
    filter var(--opencanvas-motion-lite-duration, 180ms) var(--opencanvas-motion-lite-easing, ease) var(--opencanvas-motion-lite-delay, 0ms),
    clip-path var(--opencanvas-motion-lite-duration, 180ms) var(--opencanvas-motion-lite-easing, ease) var(--opencanvas-motion-lite-delay, 0ms);
}
[data-opencanvas-motion-effect="fade"][data-opencanvas-motion-running="true"] {
  opacity: 0;
}
[data-opencanvas-motion-effect="slide"][data-opencanvas-motion-running="true"] {
  transform: translateY(16px);
}
[data-opencanvas-motion-effect="scale"][data-opencanvas-motion-running="true"] {
  transform: scale(0.96);
}
[data-opencanvas-motion-effect="wipe"][data-opencanvas-motion-running="true"] {
  clip-path: inset(0 100% 0 0);
}
[data-opencanvas-motion-effect="blur"][data-opencanvas-motion-running="true"] {
  filter: blur(8px);
}
```

- [ ] **Step 5: Integrate with Overlay/Load/Route runtimes**

In `overlay-v1.ts`, call `runMotionSequenceLite(overlay, sequenceId)` when `data-opencanvas-overlay-open-sequence` or close sequence attributes exist.

In `load-experience.ts`, call `runMotionSequenceLite(node, sequenceId)` before hiding the load shell when a handoff sequence exists.

In `route-transition.ts`, call it for outgoing and incoming sequence ids when rendered.

- [ ] **Step 6: Run checks**

Run:

```powershell
bun run src/interactive/motion-sequence-lite.smoke.ts
bun run src/interactive/overlay-v1.smoke.ts
bun run src/interactive/load-experience.smoke.ts
bun run src/interactive/route-transition.smoke.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add src/interactive/motion-sequence-lite.ts src/canvas/public-styles.ts src/interactive/motion-sequence-lite.smoke.ts src/interactive/overlay-v1.ts src/interactive/load-experience.ts src/interactive/route-transition.ts
git commit -m "feat: add motion sequence lite runtime"
```

---

### Task 7: Editor Interactions Panel And Preview Controls

**Files:**
- Modify: `src/editor/route.tsx`
- Modify: `src/editor-client/editor-context.ts`
- Modify: `src/editor-client/index.ts`
- Modify: `src/editor-client/sidebar.ts`
- Create: `src/editor-client/interactions-panel.ts`
- Modify: `src/editor-client/element-inspector.ts`
- Modify: `src/editor-client/hydrate-interactives.ts`
- Create: `src/editor-client/interactions-panel.smoke.ts`
- Create: `src/editor-client/premium-interactions-preview.smoke.ts`

**Interfaces:**
- Consumes: all Task 1 model fields.
- Produces: `renderInteractionsPanel(ctx: InteractionsPanelContext): void`.
- Produces editor context methods: `renderInteractionsPanel()`, `previewOverlay(overlayId: string)`, `previewLoadExperience()`, `previewRouteTransition()`, `useSelectedElementAsOverlayTrigger(overlayId: string)`.

- [ ] **Step 1: Write failing editor smoke**

Create `src/editor-client/interactions-panel.smoke.ts`:

```ts
import assert from 'node:assert/strict';
import { defaultOverlay, defaultLoadExperience, defaultRouteTransition } from './interactions-panel.js';

const overlay = defaultOverlay('overlay-a', 'Overlay A', 'page-home');
assert.equal(overlay.trigger.type, 'load');
assert.equal(overlay.dismissal.closeButton, true);
assert.equal(overlay.scope.type, 'pages');

const load = defaultLoadExperience();
assert.equal(load.enabled, false);
assert.equal(load.preset, 'fade');
assert.deepEqual(load.gates, ['document-ready']);

const route = defaultRouteTransition();
assert.equal(route.enabled, false);
assert.equal(route.mode, 'fade');

console.log('[interactions-panel:smoke] OK');
```

- [ ] **Step 2: Run smoke and verify it fails**

Run: `bun run src/editor-client/interactions-panel.smoke.ts`

Expected: fail because `interactions-panel.ts` does not exist.

- [ ] **Step 3: Add Interactions tab markup**

Modify `src/editor/route.tsx` sidebar tablist:

```tsx
<button
  type="button"
  role="tab"
  aria-selected="false"
  data-sidebar-tab="interactions"
  title="Configure overlays, load experience, and route transitions"
>
  Interactions
</button>
```

Add panel:

```tsx
<div
  class="opencanvas-sidebar-panel"
  role="tabpanel"
  hidden
  data-sidebar-panel="interactions"
>
  <div id="opencanvas-interactions-panel"></div>
</div>
```

- [ ] **Step 4: Create panel module with defaults**

Create `src/editor-client/interactions-panel.ts`:

```ts
import type {
  EditableSite,
  LoadExperience,
  Overlay,
  RouteTransition,
} from '../canvas/schema.js';
import type { EditorContext, PersistContext, RenderContext, StateContext } from './editor-context.js';
import { field, selectInput } from './dom-builders.js';

export type InteractionsPanelContext = StateContext &
  PersistContext &
  RenderContext &
  Pick<EditorContext, 'sidebar' | 'selectedElementId' | 'findElement' | 'setStatus'>;

export function defaultOverlay(id: string, name: string, pageId: string): Overlay {
  return {
    id,
    name,
    scope: { type: 'pages', pageIds: [pageId] },
    trigger: { type: 'load' },
    content: {
      id: `${id}-content`,
      recipeId: 'custom',
      name: `${name} content`,
      height: 420,
      elements: [],
    },
    dismissal: {
      closeButton: true,
      escape: true,
      backdropClick: true,
      bodyScrollLock: true,
      focusTrap: true,
      returnFocus: true,
    },
  };
}

export function defaultLoadExperience(): LoadExperience {
  return {
    id: 'load-main',
    enabled: false,
    preset: 'fade',
    runPolicy: 'every-visit',
    gates: ['document-ready'],
    timeoutMs: 4000,
  };
}

export function defaultRouteTransition(): RouteTransition {
  return {
    id: 'route-main',
    enabled: false,
    mode: 'fade',
    durationMs: 220,
    easing: 'ease-in-out',
  };
}

export function renderInteractionsPanel(ctx: InteractionsPanelContext): void {
  const host = document.getElementById('opencanvas-interactions-panel');
  if (!host || !ctx.state) return;
  host.replaceChildren();
  renderLoadControls(ctx, host);
  renderRouteControls(ctx, host);
  renderOverlayControls(ctx, host);
}
```

Add `renderLoadControls`, `renderRouteControls`, and `renderOverlayControls` in the same file. Each control mutates `ctx.state`, calls `ctx.captureForUndo()`, `ctx.renderAll()`, `renderInteractionsPanel(ctx)`, and `ctx.scheduleSave()`.

- [ ] **Step 5: Wire sidebar activation**

Modify `src/editor-client/sidebar.ts` in `attachSidebarTabs` or the active tab implementation so when `tabName === 'interactions'`, it calls `ctx.renderInteractionsPanel()`.

Add `renderInteractionsPanel(): void` to `EditorContext` in `src/editor-client/editor-context.ts`, bind it in `src/editor-client/index.ts`:

```ts
renderInteractionsPanel: () => renderInteractionsPanel(ctx),
```

- [ ] **Step 6: Add element inspector shortcut**

Modify `src/editor-client/element-inspector.ts` after the motion controls. If `ctx.state?.overlays?.length`, render a select of overlays and a button:

```ts
const useAsTriggerBtn = document.createElement('button');
useAsTriggerBtn.type = 'button';
useAsTriggerBtn.textContent = 'Use as overlay trigger';
useAsTriggerBtn.addEventListener('click', function () {
  const overlay = ctx.state?.overlays?.[0];
  if (!overlay) return;
  overlay.trigger = { type: 'element-click', targetElementId: element.id };
  ctx.captureForUndo();
  ctx.renderAll();
  ctx.scheduleSave();
  ctx.setStatus('Overlay trigger connected', 'ok');
});
```

- [ ] **Step 7: Add editor preview paths**

Modify `src/editor-client/hydrate-interactives.ts` so `hydrateInteractives(root, { skipPopups: true })` still hydrates Premium Interactions only when preview methods request it. Add direct exported helpers:

```ts
export function previewOverlayInEditor(root: ParentNode, overlayId: string): void;
export function previewLoadExperienceInEditor(root: ParentNode): void;
export function previewRouteTransitionInEditor(root: ParentNode): void;
```

Implement them with the same DOM attributes as visitor runtime. Unknown targets must log `console.error` and surface `ctx.setStatus` from caller.

- [ ] **Step 8: Add Motion Sequence Lite drawer controls**

Inside `interactions-panel.ts`, add a compact step-list renderer:

```ts
function renderSequenceLiteEditor(
  ctx: InteractionsPanelContext,
  host: HTMLElement,
  label: string,
  getSequence: () => MotionSequenceLite | undefined,
  setSequence: (sequence: MotionSequenceLite | undefined) => void,
): void
```

Controls:
- add step
- remove step
- target select
- effect select
- delay number
- duration number
- easing text

Use the exact target/effect constants from schema.

- [ ] **Step 9: Run editor checks**

Run:

```powershell
bun run src/editor-client/interactions-panel.smoke.ts
bun run src/editor-client/premium-interactions-preview.smoke.ts
bun run src/editor-client/create-editor.smoke.ts
bun run src/editor-client/create-editor-runtime.smoke.ts
bun run src/editor-client/regression.smoke.ts
```

Expected: all pass.

- [ ] **Step 10: Commit**

```powershell
git add src/editor/route.tsx src/editor-client/editor-context.ts src/editor-client/index.ts src/editor-client/sidebar.ts src/editor-client/interactions-panel.ts src/editor-client/element-inspector.ts src/editor-client/hydrate-interactives.ts src/editor-client/interactions-panel.smoke.ts src/editor-client/premium-interactions-preview.smoke.ts
git commit -m "feat: add interactions editor panel"
```

---

### Task 8: E2E Coverage And Final Verification

**Files:**
- Create: `e2e/premium-interactions.spec.ts`
- Modify: `FEATURES.md`
- Modify: `docs/specs/designer-template-fidelity-gaps.md`

**Interfaces:**
- Consumes all finished tasks.
- Produces product-level regression coverage.

- [ ] **Step 1: Add E2E spec skeleton**

Create `e2e/premium-interactions.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const premiumInteractionsUrl = process.env.PREMIUM_INTERACTIONS_URL;

test.describe('Premium Interaction v1', () => {
  test.skip(!premiumInteractionsUrl, 'Set PREMIUM_INTERACTIONS_URL to a published site with Premium Interaction v1 enabled');

  test('published site exposes premium interaction runtime when configured', async ({ page }) => {
    await page.goto(premiumInteractionsUrl!);
    await expect(page.locator('[data-opencanvas-route-container]')).toBeVisible();
    await expect(page.locator('script[data-opencanvas-interactive-runtime]')).toHaveCount(1);
  });

  test('visitor can open and dismiss overlay', async ({ page }) => {
    await page.goto(premiumInteractionsUrl!);
    const overlay = page.locator('[data-opencanvas-overlay]');
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });
});
```

Use a real published site URL for `PREMIUM_INTERACTIONS_URL`; do not add synthetic fixture routes to public routing for this test.

- [ ] **Step 2: Update feature docs**

Modify `FEATURES.md` to add Premium Interaction v1 under published site/editor features:

```md
| Premium Interactions | Interactions editor tab for site-level Load Experience, Route Transition, first-class Overlays, and Motion Sequence Lite previews |
```

Modify `docs/specs/designer-template-fidelity-gaps.md` to mark the v1 slices as addressed by Premium Interaction v1 and leave full timeline, Scroll Scene, shared-element route transitions, and Rich Motion Assets as remaining gaps.

- [ ] **Step 3: Run focused verification**

Run:

```powershell
bun run src/canvas/premium-interactions.smoke.ts
bun run src/interactive/premium-hydrator.smoke.ts
bun run src/interactive/overlay-v1.smoke.ts
bun run src/interactive/load-experience.smoke.ts
bun run src/interactive/route-transition.smoke.ts
bun run src/interactive/motion-sequence-lite.smoke.ts
bun run src/editor-client/interactions-panel.smoke.ts
bun run src/editor-client/premium-interactions-preview.smoke.ts
npx playwright test e2e/premium-interactions.spec.ts
```

Expected: all pass.

- [ ] **Step 4: Run full pre-merge verification**

Run:

```powershell
bun run typecheck
bun run ci:smoke
npx playwright test e2e/premium-interactions.spec.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add e2e/premium-interactions.spec.ts FEATURES.md docs/specs/designer-template-fidelity-gaps.md
git commit -m "test: cover premium interaction flows"
```

---

## Review Gates

- After Task 1, verify all parallel workers import exactly the Task 1 type names and do not add parallel interaction shapes.
- After Tasks 2-6, inspect the rendered DOM attributes for consistency before editor work binds to them.
- After Task 7, manually verify the Interactions tab can create and preview each feature before E2E automation.
- Before final claim, run the focused verification from Task 8 and report any command that could not run.
