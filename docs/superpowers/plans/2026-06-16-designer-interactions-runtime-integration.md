# Designer Interactions Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the accepted designer interaction ADRs persistable, validated, renderable, and hydratable on published pages.

**Architecture:** Site-level interaction fields are the source of truth. The renderer emits deterministic data hooks and JSON payloads; the visitor Runtime Hydrator owns DOM attachment after initial load and live page swaps. Free third-party adapters remain behind the same contract, but this slice uses native browser primitives so the feature does not wait on package bundling, CSP, and asset-byte decisions.

**Tech Stack:** TypeScript, Bun smoke tests, existing public renderer, existing inline interactive runtime, native Web Animations, DOM event delegation.

---

## Boundaries

- No GSAP.
- No arbitrary Owner JavaScript.
- No silent rich-motion blank state: unsupported runtime families emit explicit failure events.
- Existing popup-section triggers remain supported; Overlay is additive in this slice.
- Route-transition navigation adapters are not shipped in this slice; live publish hydration already exercises the Runtime Hydrator contract.

## Task 1: Load And Route Transition Contract

**Files:**

- Create: `src/canvas/load-transitions.ts`
- Create: `src/canvas/load-transitions.smoke.ts`

- [ ] Write a smoke that validates a bounded load experience and route transition, then rejects empty ids, unbounded gates, and route transitions without hydration.
- [ ] Run `bun run src/canvas/load-transitions.smoke.ts` and confirm it fails because the module does not exist.
- [ ] Implement exported types and validators for `LoadExperience` and `RouteTransition`.
- [ ] Run `bun run src/canvas/load-transitions.smoke.ts` and confirm it passes.

## Task 2: Schema And Validation Integration

**Files:**

- Modify: `src/canvas/schema.ts`
- Modify: `src/canvas/validate.ts`
- Create: `src/canvas/designer-interactions-integration.smoke.ts`

- [ ] Write a smoke that proves `EditableSite` and `PublishedSnapshot` accept valid `motionSequences`, `scrollScenes`, `overlays`, `overlaySections`, `richMotionAssets`, `loadExperience`, and `routeTransition`.
- [ ] In the same smoke, reject unresolved overlay content, unresolved click targets, unresolved sequence references, unresolved rich asset owner assets, and duplicate ids.
- [ ] Run the smoke and confirm the missing schema/validator paths fail.
- [ ] Add optional site fields to `EditableSiteBase`.
- [ ] Validate all new fields through `SITE_FIELD_VALIDATORS`.
- [ ] Validate cross-relations against page/header/footer/overlay section ids and element ids.
- [ ] Run the smoke, existing domain smokes, `bun run canvas:smoke`, and `bun run validate-parity:smoke`.

## Task 3: Public Render Hooks

**Files:**

- Modify: `src/canvas/render.ts`
- Modify: `src/interactive/inject.ts`
- Modify: `src/canvas/designer-interactions-integration.smoke.ts`

- [ ] Extend the smoke to assert published HTML includes motion JSON, scroll-scene JSON, overlay shell markup, and rich-motion markers.
- [ ] Run the smoke and confirm those assertions fail.
- [ ] Render a single `script[type="application/json"]` payload for motion/scroll data when present.
- [ ] Render overlay content outside the normal body section order in a dedicated overlay layer.
- [ ] Mark rich-motion asset owners with stable attributes and avoid pretending unsupported families are playable.
- [ ] Make `snapshotNeedsInteractiveRuntime` return true for any new interaction field that needs hydration.
- [ ] Run the integration smoke and `bun run interactive:smoke`.

## Task 4: Visitor Runtime Hydration

**Files:**

- Create: `src/interactive/motion.ts`
- Create: `src/interactive/overlay.ts`
- Create: `src/interactive/rich-motion.ts`
- Modify: `src/interactive/build.ts`
- Modify: `src/interactive/runtime.ts`
- Modify: `src/interactive/smoke.ts`

- [ ] Extend `interactive:smoke` with a stub DOM case for load-triggered motion, click-triggered overlay open/close, body scroll lock, and rich-motion failure event dispatch.
- [ ] Run `bun run interactive:smoke` and confirm the new assertions fail.
- [ ] Hydrate motion sequences through native `element.animate` when available and apply final styles directly when not available.
- [ ] Hydrate scroll scenes by mapping scroll progress to whitelisted style properties.
- [ ] Hydrate overlays with delegated triggers, Escape/backdrop/close dismissal, focus return when available, and body scroll lock.
- [ ] Hydrate rich-motion markers by dispatching explicit unsupported-runtime failure events.
- [ ] Run `bun run interactive:smoke` and confirm it passes.

## Task 5: Verification

- [ ] Run all new smokes.
- [ ] Run existing interaction/canvas smokes.
- [ ] Run `bun run typecheck`.
- [ ] Run Prettier check on changed files.
- [ ] Run `git diff --check`.
- [ ] Request a final code review and fix Critical or Important findings.
