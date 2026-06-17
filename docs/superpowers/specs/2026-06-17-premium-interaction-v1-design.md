# Premium Interaction v1 Design

## User-Outcome Brief

**Why this exists**:
Owners need published sites to feel deliberately choreographed, not static pages with isolated fades. A finished v1 lets an Owner add a modal or overlay, a branded first-load handoff, and basic same-site page transitions from the editor without writing code.

**Success criteria**:
- An Owner can open one editor surface, create an Overlay, choose how it opens, preview it, and publish it.
- An Owner can enable a Load Experience, choose a visual preset and readiness gates, preview it, and publish it.
- An Owner can enable Route Transitions, choose a curated transition mode, preview navigation, and publish it.
- A Visitor sees the chosen behaviours on the Published Site, and already-open pages continue to hydrate interactions after live updates or route swaps.
- If a declared gate, target, or transition step cannot run, the system emits an explicit failure event and keeps the current valid visitor state.

**Non-goals**:
- Full timeline/keyframe canvas.
- Arbitrary custom CSS-property animation.
- Text splitting UI.
- Scroll Scene editor.
- Shared-element Route Transitions.
- Rich Motion Assets.
- Owner-authored JavaScript as the template-fidelity path.

**Hard constraints**:
- Use Open Canvas terms: Runtime Hydrator, Overlay, Load Experience, Route Transition, Motion Sequence, Motion Sequence Lite.
- Saved site state stores Open Canvas concepts, not adapter-library calls.
- Native-first implementation; add external runtime adapters only when they materially reduce complexity and remain license-safe.
- Existing popup-section data migrates into Overlays on read; the editor stops writing `CanvasSection.trigger`.
- V1 must include editor UI for all shipped behaviours.

## Product Boundary

Premium Interaction v1 ships four connected capabilities:

1. **Runtime Hydrator v1**: one idempotent published-site hydration entrypoint that can hydrate a supplied root after initial load, live-publish replacement, or Route Transition swaps.
2. **Overlay v1**: first-class site-owned Overlays with page scope, a Canvas Section-shaped content surface, explicit trigger, dismissal policy, preview mode, and migration from old popup sections.
3. **Load Experience v1**: site-level first-load choreography with curated visuals, explicit readiness gates, run policy, timeout, preview, and explicit failure state.
4. **Route Transition v1**: same-site MPA navigation choreography that fetches, swaps, hydrates, restores scroll/focus, and animates with curated modes.

Motion Sequence Lite is the constrained Owner-facing editor for interaction choreography. It supports simple step lists only: target, effect, delay, duration, and easing.

## Domain Model

### Runtime Hydrator

The Runtime Hydrator is the execution boundary for schema-owned interactions on the Published Site. V1 exposes one idempotent visitor entrypoint that accepts a root and options. Initial load, live publish replacement, and Route Transition swaps all call the same entrypoint.

The editor may keep its TypeScript hydrator mirror in v1, but Overlay, Load Experience, Route Transition, and Motion Sequence Lite preview paths must have parity smoke tests so drift is visible.

### Overlay

An Overlay belongs to the Editable Site, not to a Canvas Page body section. It may be scoped to all pages or to named Canvas Pages. It contains one Canvas Section-shaped content surface that is edited with normal canvas tools but does not participate in page section order, anchors, or normal reading flow.

Overlay v1 triggers:
- `load`
- `delay`
- `scroll`
- `exit-intent`
- `element-click`

Overlay v1 dismissal:
- close button
- Escape
- backdrop click
- body scroll lock
- focus trap
- return focus

New Overlays default all dismissal and focus safety controls on. Owners may disable close button, Escape, and backdrop click independently. Body scroll lock, focus trap, and return focus remain explicit stored fields.

Existing `CanvasSection.trigger` popup sections migrate into Overlays on read. After migration, editor authoring writes only Overlay data.

### Load Experience

Load Experience is site-level in v1. Page-level overrides are deferred.

Visual presets:
- `fade`
- `wipe`
- `logo-card`
- `progress-bar`

Run policies:
- `every-visit`
- `once-per-session`

Readiness gates:
- `document-ready`
- `fonts-ready`
- `hero-media-ready`

A Load Experience has a bounded timeout. If a gate fails or times out, the runtime shows a visible failure state and emits a named failure event with the gate and phase. It must not silently skip the declared gate.

### Route Transition

Route Transition belongs to same-site navigation on the Published Site. It keeps published pages server-rendered and intercepts internal links only when the transition contract can be honoured.

Modes:
- `fade`
- `slide`
- `wipe`

V1 navigation flow:
1. Intercept same-site navigation.
2. Fetch the next document.
3. Parse the stable site container.
4. Animate outgoing state.
5. Swap the container.
6. Call Runtime Hydrator on the new root.
7. Restore scroll and focus.
8. Animate incoming state.

If fetch, parse, swap, hydrate, focus, scroll, or animation setup fails, the current page remains active and the runtime emits a named failure event with route, transition id, and failing phase.

### Motion Sequence Lite

Motion Sequence Lite is a step-list editor for simple Motion Sequences used by Premium Interaction v1.

Step fields:
- target
- effect
- delay
- duration
- easing

V1 targets:
- page container
- overlay surface
- overlay backdrop
- load screen parts

V1 effects:
- `fade`
- `slide`
- `scale`
- `wipe`
- `blur`

Motion Sequence Lite is not a full timeline canvas. It does not expose arbitrary property editing, keyframes, text splitting, Scroll Scenes, or shared-element timelines.

## Editor Experience

Premium Interaction v1 adds a dedicated editor sidebar tab named **Interactions**.

The Interactions tab contains:
- **Load Experience**: enabled toggle, preset select, run policy select, gate checkboxes, timeout input, Motion Sequence Lite handoff steps, preview button.
- **Route Transition**: enabled toggle, mode select, duration/easing controls, Motion Sequence Lite outgoing/incoming steps, preview navigation button.
- **Overlays**: list, create, delete, rename, page scope selector, trigger selector, element target picker for `element-click`, dismissal toggles, Motion Sequence Lite open/close steps, preview open/close button.

Inspector integrations:
- Selecting a Content Element shows a shortcut to use it as an Overlay trigger.
- Editing an Overlay content surface uses normal canvas element and section controls.
- Popup trigger controls stop being the primary authoring path once migration is in place.

## Runtime Behaviour

The published runtime hydrates:
- accordions
- carousels
- pointer-reactive effects
- Overlays
- Load Experience
- Route Transitions
- Motion Sequence Lite steps used by the above features

The hydrator is idempotent. Re-running it on an already-hydrated root must not double-bind listeners, duplicate overlays, rerun a once-per-session Load Experience, or corrupt current Route Transition state.

Runtime state ownership:
- Overlay dismissed state is scoped by site and overlay id.
- Load Experience once-per-session state is scoped by site and load experience id.
- Route Transition state is transient and does not persist beyond the current page session.

## Validation And Failure

Validation rejects:
- Overlay trigger targets that do not resolve.
- Overlay page scopes that do not resolve.
- Overlay content surfaces without valid Canvas Section-shaped content.
- Load Experience gates outside the supported gate set.
- Route Transition modes outside the supported mode set.
- Motion Sequence Lite steps with unsupported targets, effects, durations, or easing.

Runtime failures are explicit:
- Overlay open failure emits overlay id, trigger type, and phase.
- Load Experience failure emits load experience id, gate, timeout, and phase.
- Route Transition failure emits route, transition id, and phase.

No feature silently degrades into a different behaviour. If a configured interaction cannot run correctly, dependent work stops and the current valid state remains visible.

## Parallel Work Tracks

**Foundation track**:
Schema, validation, Yjs projection, migration from `CanvasSection.trigger`, renderer attributes, Runtime Hydrator entrypoint, and shared tests.

**Overlay track**:
Overlay data surface, renderer layer, trigger handling, dismissal/focus/scroll behaviour, editor list/detail UI, preview mode, popup migration acceptance tests.

**Load Experience track**:
Site-level data, renderer shell, readiness gates, timeout/failure event, visual presets, editor controls, preview.

**Route Transition track**:
Same-site interception, fetch/parse/swap, hydrate-after-swap, scroll/focus restoration, failure events, editor controls, preview.

**Motion Sequence Lite track**:
Step-list model, curated targets/effects, editor drawer, preview execution for Overlay/Load/Route surfaces.

## Test Strategy

Smoke tests:
- schema validation for all new shapes
- popup-to-overlay migration
- Yjs round trip for Premium Interaction fields
- runtime injection when any Premium Interaction is present
- hydrator idempotence
- Overlay open/close/focus/body-scroll/dismissal
- Load Experience gates, timeout, once-per-session policy
- Route Transition success and each failure phase
- editor control rendering and state writes
- editor/visitor preview parity for Motion Sequence Lite effects

E2E tests:
- Owner creates and previews an Overlay.
- Owner enables and previews a Load Experience.
- Owner enables Route Transition and navigates between published pages.
- Visitor route swap keeps accordion/carousel/pointer/overlay interactions hydrated after navigation.

## Open Coordination Notes

Other agents working in parallel should treat this document plus ADRs 0068-0071 as the contract. Any proposal to add triggers, effects, gates, route modes, full timeline editing, shared elements, page-level load overrides, or new runtime dependencies is out of V1 unless the Owner explicitly reopens scope.
