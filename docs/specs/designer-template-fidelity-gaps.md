# Designer Template Fidelity Gaps

**Status:** Investigation
**Date:** 2026-06-17

## User-Visible Done State

The target user is a template author trying to reproduce a high-end designer
website as an Open Canvas Template. "Done" means the published site feels like
the reference site to a visitor, not merely that the same sections exist.

Observable success:

- First load has the same intentional choreography: preloader, reveal order,
  media readiness, and handoff into the page.
- Scroll effects are timeline-grade: pinned scenes, scrubbed progress,
  staggered text/media reveals, and section-to-section continuity.
- Hover, cursor, and component interactions are authored, previewed, and
  published as part of the Template, not hidden in raw scripts.
- Modal and overlay behaviour matches the reference: trigger, backdrop,
  entrance, exit, close affordance, focus handling, and body scroll behaviour.
- Page navigation can preserve visual continuity through page/state
  transitions.
- The editor preview and published site match for every supported behaviour.
- Unsupported source-site behaviours are reported loudly during import or
  template authoring; the builder must not silently approximate them.

Non-goals:

- Copying proprietary assets, source code, brand marks, or protected designs.
  This document is about capability fidelity, not legal clearance.
- Treating `addon_custom_scripts` as the answer. Owner-authored scripts are a
  deliberate addon, but they sit outside the canvas schema, editor preview,
  validator, Section Library, and Template composition model.
- Implementing the gaps in this document. This is an investigation deliverable.

## Current Capability Surface

Open Canvas has real motion and interaction primitives already:

- Template Seeds are compositions of Section Instance refs resolved from the
  Section Library (`src/templates/registry.ts`, ADR 0061).
- Custom Templates persist `siteState` plus an asset manifest
  (`src/routes/api/custom-templates.ts`).
- Elements can carry `motion?: { preset; delayMs }`; Pages can carry
  `entranceAnimation`, `scrollTriggerMode`, `defaultMotionPreset`; Sections can
  carry `entrance`.
- `MOTION_PRESETS` is a closed 17-value set: `none`, directional fades/slides,
  scale/zoom/blur/rotate/flip/bounce, `stagger-children`, `slow-drift`, and
  `parallax-soft` (`src/canvas/schema.ts`).
- Published pages use one IntersectionObserver pass that toggles
  `[data-visible]` for `[data-entrance]` and page-level on-scroll entrances
  (`src/routes/public.ts`).
- The interactive runtime hydrates accordion, carousel, popup sections, and
  pointer-fx in one inline IIFE (`src/interactive/*`).
- ADR 0066 added Variant presets for forms, carousels, accordions, and tabs;
  the shipped pointer-fx primitives are `spotlight` and `tilt`, but only Form
  `spotlight` is attached to a catalogued variant.
- Carousel has `paginate` and `scroll-snap` modes, plus style variants such as
  `coverflow`, `ken-burns`, and `editorial`.
- Legacy sections with `exit-intent`, `delay`, or `scroll` popup triggers are
  migrated into first-class Overlays on editor load.
- Layout has top-only sticky elements (`stickyOffset`) and carousel-local
  horizontal scroll snap.
- The importer captures computed `transition`, `animation`, `transform`, and
  `will-change`, then maps them to the nearest Motion Preset
  (`services/scraper/src/dom-walker.ts`).
- Premium Interaction v1 adds schema-owned `Overlay`, `LoadExperience`,
  `RouteTransition`, and `MotionSequenceLite` fields to editable and
  published site state. The editor exposes them in the Interactions sidebar
  tab, with preview controls and a selected-element shortcut for overlay
  click triggers.
- Published output now emits first-class overlay shells, load-experience
  shells, route-transition metadata, and Motion Sequence Lite descriptors.
  The Runtime Hydrator rehydrates these after live-publish HTML swaps.

That baseline is useful, and Premium Interaction v1 closes the first typed
slice of the modal/preload/route gap. It is still not enough for 1:1
designer-template fidelity.

## Premium Interaction v1 Ship Update

Shipped on June 17, 2026:

- **Overlays v1:** site/page scoped content sections with load, delay, scroll,
  exit-intent, and element-click triggers; explicit dismissal policy; editor
  preview; legacy popup migration.
- **Load Experience v1:** preset, run policy, readiness gates, timeout, and
  handoff sequence metadata.
- **Route Transition v1:** same-origin navigation interception with fade,
  slide, and wipe modes; live-publish rehydration handoff.
- **Motion Sequence Lite:** constrained ordered steps for overlay open/close,
  load handoff, and route outgoing/incoming states. Targets are page
  container, overlay surface/backdrop, and load-screen parts; effects are
  fade, slide, scale, wipe, and blur.

Still explicitly out of scope after v1:

- Full timeline authoring with arbitrary properties, repeats, yoyo/reverse,
  waits, text splits, SVG stroke drawing, variable-font axes, and per-step
  completion behaviour.
- Scroll Scene: pinned/scrubbed progress, horizontal storytelling, image
  sequence scrubs, and scroll-bound Motion Sequence progress.
- Shared-element or FLIP route transitions across pages, filters, tabs, and
  overlay/detail states.
- Rich Motion Assets: Lottie/Rive, WebGL/Three.js, shader distortion, Spline
  surfaces, and particle fields.

## Benchmark Behaviours

The missing behaviours are visible in current designer-site inspiration sets
and mainstream animation tooling:

- Awwwards tracks loading-animation examples as a distinct pattern category:
  <https://www.awwwards.com/awwwards/collections/loading-page/>
- Awwwards tracks transitions as animated changes between pages, states, or
  views: <https://www.awwwards.com/awwwards/collections/transitions/>
- GSAP ScrollTrigger documents scroll-triggered, pinned, scrubbed, snapped, and
  timeline-controlled animation:
  <https://gsap.com/docs/v3/Plugins/ScrollTrigger/>
- GSAP Flip documents layout/state transitions across DOM changes:
  <https://gsap.com/docs/v3/Plugins/Flip/>
- MDN's View Transition API documents browser-native transitions between views,
  including SPA and MPA navigation:
  <https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API>

Those behaviours should not be copied as raw library calls inside templates.
They should be represented as Open Canvas concepts that the schema, editor,
renderer, validator, import path, and published runtime all understand.

## Gaps

### 1. No Full Motion Graph Or Timeline

Current state:

- Each element, section, or page can choose one Motion Preset plus an optional
  delay.
- Motion presets resolve to kit-scoped CSS keyframes. They mostly control
  `transform` and `opacity`.
- The editor exposes a select and delay input; element delay is capped at
  2000ms in the inspector.
- Motion Sequence Lite now exists for Premium Interaction v1, but only for
  overlay, load, and route surfaces with a small target/effect vocabulary.
- **June 2026 update:** the Interactions panel now exposes full schema-owned
  Motion Sequences for creation, deletion, trigger editing, reduced-motion
  policy, ordered steps, target selection, text-split unit targeting, numeric
  `from`/`to` properties, delay, duration, stagger, and easing.

User-visible miss:

- Cannot reproduce staged hero intros where logo, mask, headline words, media,
  nav, and CTA all enter on one choreographed timeline.
- Cannot chain animations across multiple elements.
- Cannot yet define repeat, yoyo, reverse, wait, visual timeline keyframes,
  SVG stroke drawing, variable-font axis animation, or non-numeric filter /
  clip-path editing from the UI.

Needed primitive:

- A schema-owned Motion Sequence: trigger, ordered steps, target selectors,
  properties, duration, easing, delay, stagger, and completion behaviour.
- Validation must reject unsupported targets/properties instead of silently
  dropping steps.
- Remaining next wave: timeline canvas UX, repeat/yoyo/wait controls,
  non-numeric property editors, and SVG/variable-font effect catalogs.

### 2. Scroll Motion Is Triggered, Not Scrubbed

Current state:

- Published output uses IntersectionObserver to reveal once when an element or
  section crosses a threshold.
- `parallax-soft` is an entrance preset, not a scroll-progress relation.
- Sticky is top-only per element; scroll-snap exists only as a carousel mode.
- **June 2026 update:** Scroll Scene now has an owner-facing editor slice in
  the Interactions panel for creating/editing a pinned scene, its trigger
  section, pin target, range, reduced-motion policy, and linked Motion Sequence
  first target. This closes the "template JSON only" authoring gap for the
  first scroll-story relation, but horizontal storytelling, snap points,
  multi-step timeline editing, and unified timeline canvas remain open.

User-visible miss:

- Cannot reproduce scroll stories where scroll position drives animation
  progress.
- Cannot pin a section while animating child layers through a multi-step
  sequence.
- Cannot build horizontal-scroll storytelling sections, image sequence scrubs,
  before/after reveals, or scroll-progress typography.

Needed primitive:

- A Scroll Scene: trigger section, start/end bounds, optional pinning, scrubbed
  progress, snap points, and a Motion Sequence bound to progress rather than
  time.

### 3. Load Experience V1 Exists, Full Preloader Authoring Does Not

Current state:

- Published pages can carry `loadExperience` with enabled state, preset,
  run policy, readiness gates, timeout, and optional Motion Sequence Lite
  handoff.
- The editor exposes this in the Interactions tab with preview.
- Media elements use native loading behaviour where relevant, but no authored
  custom preloader content or progress-number choreography exists yet.
- **June 2026 update:** the Interactions panel now exposes the richer
  Behaviour Load Experience enter moment used by designer templates: editable
  label, enter label, foreground/background colours, and a linked `load-enter`
  Motion Sequence with a restore gate when the relation is missing.

User-visible miss:

- Cannot reproduce branded preloaders, progress numbers, logo draws, mask
  openings, media-readiness gates, or first-load page reveals.
- Cannot yet author custom progress numbers, logo draws, media-readiness maps,
  or run policy for the Behaviour Load Experience model.

Needed primitive:

- Next wave: custom visual content, media readiness mapping, branded progress
  numbers/logo draws, and richer transition into the first page state. The
  failure path must stay explicit; do not silently skip the loader when an
  asset is late.

### 4. Route Transition V1 Exists, Shared-Element Navigation Does Not

Current state:

- Public navigation is multi-page HTML routing.
- The live-update script swaps snapshot HTML via `innerHTML` and now calls the
  Runtime Hydrator after the swap.
- `routeTransition` can enable fade, slide, or wipe transitions with
  outgoing/incoming Motion Sequence Lite hooks.
- There is no View Transition API shared-element mapping yet.

User-visible miss:

- Cannot reproduce shared-element transitions between list/detail pages.
- Cannot animate between template pages with masks, wipes, crossfades, or
  continuity of the clicked card/image/title.
- Cannot guarantee interactive runtime hydration after page-state swaps.

Needed primitive:

- Next wave: shared-element mapping, geometry capture, View Transition API or
  FLIP handoff, reduced-motion policy, and explicit failure events when a
  source/destination relation cannot be resolved.

### 5. Overlay V1 Replaces Popup Sections, But Designer-Grade Modals Need More

Current state:

- Legacy popup-triggered sections migrate into `EditableSite.overlays` on
  editor load.
- Overlay v1 supports site/page scope, load/delay/scroll/exit-intent/
  element-click triggers, template-owned content sections, focus/scroll
  dismissal policy, open/close Motion Sequence Lite metadata, and editor
  preview.
- Chrome styling is still base-level; there is not yet a reusable overlay
  chrome style catalog.

User-visible miss:

- Cannot reproduce click-open project modals, nav overlays, command palettes,
  full-screen menu transitions, iframe drill-ins, gallery lightboxes, or
  product-tour overlays.
- Cannot style modal chrome as part of a Template.
- Entrance/exit variants, backdrop variants, close-button placement, and
  reusable modal chrome presets are still missing.

Needed primitive:

- Next wave: reusable chrome styles, close-button placement presets, backdrop
  variants, lightbox/gallery/product-tour presets, iframe drill-in contracts,
  and richer open/close sequences.

### 6. Pointer, Hover, And Cursor Effects Are Too Narrow

Current state:

- Pointer-fx exists as a runtime concept with `spotlight` and `tilt`.
- Only Form `spotlight` is attached to a shipped variant.
- Hover states are mostly fixed CSS inside component/style-kit selectors.

User-visible miss:

- Cannot reproduce magnetic buttons, cursor trails, image-follow cursors,
  hover reveal masks, card tilt on arbitrary surfaces, pointer-driven parallax,
  drag/inertia sliders, or hover-to-preview grids.
- Cannot author touch-specific equivalents for mobile.

Needed primitive:

- Pointer FX and Hover State as schema-owned presets with component-neutral
  targets, mobile alternatives, and inspector controls. `tilt` should either
  become a real catalogued option or remain internal; unused primitives should
  not be presented as capability.

### 7. Component Styling Still Stops Short Of Template Fidelity

Current state:

- Forms, accordions, tabs, carousels, and collections have typed sparse
  Component Style objects (`formStyle`, `accordionStyle`, `tabsStyle`,
  `carouselStyle`, and `collectionStyle`).
- ADR 0067 is accepted and shipped with validator, render, Yjs, agent, and
  inspector smoke coverage.
- Editor/public DOM parity is in place for the styled component parts covered
  by ADR 0067.

User-visible miss:

- A template author can now tune the first ADR 0067 field catalog without raw
  `pinnedStyle`.
- Template fidelity still stops at the first catalog: there are no reusable
  saved Component Style recipes, arbitrary unit controls, collection title /
  excerpt / CTA typography controls, or Component Style objects for unrelated
  elements such as action, shape, container, table, nav, chart, code, text,
  media, and embed.

Needed primitive:

- A second Component Style wave should add named owner-visible parts by ADR,
  not expose raw CSS variables. Reusable style recipes and arbitrary units
  remain separate decisions.

### 8. Collection Rendering Is Not Ready For Premium Card Templates

Current state:

- `CollectionElement.entries` exists as materialized per-entry output.
- `renderCollection` emits materialized entries inside the collection frame for
  `card`, `image-only`, and `custom` displays.
- Built-in `card` and `image-only` displays consume `collectionStyle` host
  variables for entry chrome; `custom` display keeps the Owner's custom
  template-owned chrome.

User-visible miss:

- Basic published collection cards and custom templates are real, but premium
  CMS experiences still lack animated card reveals, hover transitions, filters,
  search, editorial states, drafts, scheduling, and full detail/list workflow.

Needed primitive:

- CMS workflow primitives around the shipped renderer: filters, search/sort UI,
  editorial states, scheduling, previews, and a richer second-wave card style
  catalog.

### 9. No Layout Or Shared-Element Animation

Current state:

- The canvas renderer uses absolute element placement, with top-only sticky as
  an opt-in alternate positioning regime.
- Tabs panels have inline full-width sizing; ADR 0066 dropped `vertical-rail`
  tabs because CSS alone cannot reflow that layout.
- There is no FLIP/shared-layout transition model.

User-visible miss:

- Cannot animate cards rearranging into a modal/detail state.
- Cannot animate grid/list view switches.
- Cannot morph one element into another across tabs, filters, page routes, or
  overlays.

Needed primitive:

- A Layout Transition relation: named source target, named destination target,
  state-change trigger, geometry capture, transform inversion, and published
  runtime support.

### 10. Text Animation Is Not First-Class

Current state:

- Text elements support rich inline runs and some typography fields.
- Motion targets the whole positioned element wrapper.
- **June 2026 update:** Text elements now expose a Text Split Target inspector
  control that writes schema-owned Motion Sequence targets for word, line, or
  character splitting. The visitor runtime generates presentational split spans
  with `aria-hidden="true"` and preserves the full semantic text on the host
  with `aria-label`.

User-visible miss:

- Cannot yet reproduce advanced kinetic headlines, type scrambles, variable
  font axes, or arbitrary multi-step text timelines from a unified timeline
  canvas.

Needed primitive:

- Text Split targets as an explicit render mode: by character, word, or line,
  with semantic HTML preserved and the Motion Sequence targeting generated
  spans. Accessibility must define what screen readers see.
- Remaining next wave: richer text-specific effects, scroll-progress text
  presets, and visual multi-step editing of split targets.

### 11. Rich Media / 3D / Shader Surfaces Are Missing

Current state:

- Media supports images and videos.
- Sections support background video assets.
- Embeds are iframe-based and CSP-gated.
- Charts render static SVG.

User-visible miss:

- Cannot reproduce common designer-site surfaces such as Lottie/Rive
  animations, image sequence scrubbing, WebGL/Three.js scenes, shader
  distortion, Spline-like embeds as editable first-class media, or canvas-based
  particle fields.

Needed primitive:

- A deliberate media-extension decision. Do not add arbitrary "animation file"
  blobs without defining asset type, playback controls, CSP, editor preview,
  reduced-motion handling, and publish-time failure behaviour.

### 12. Import Collapses Source Motion Too Aggressively

Current state:

- The scraper reads `transition`, `animation`, `transform`, and `will-change`.
- `detectMotion` maps those signals to one of the existing Motion Presets.
- Scraped element types are limited to text, media, action, shape, container,
  and embed.

User-visible miss:

- A designer-site import can visually lose the most valuable part of the
  reference: the choreography.
- The owner gets a plausible static layout rather than an explicit report of
  unsupported animation semantics.

Needed primitive:

- Import should produce an animation inventory: detected source animation
  names/properties/timings/triggers, mapped Open Canvas primitive when exact,
  and explicit unsupported findings when not exact.

### 13. Runtime Hydration Has Two Sources Of Truth

Current state:

- Visitor runtime fragments live as string source under `src/interactive/`.
- Editor hydration mirrors those behaviours manually in
  `src/editor-client/hydrate-interactives.ts`.
- ADR 0066 identifies this duplication as a follow-up.
- Premium Interaction v1 adds explicit editor preview helpers and smokes for
  the new surfaces, but it does not remove the two-source runtime shape.
- **June 2026 update:** editor render, visitor initial load, live publish
  swaps, and route transitions now share the named Runtime Hydrator boundary
  `window.__opencanvasHydrate`. A parity smoke pins that every swap surface
  consumes the same entrypoint and that editor hydration fails loudly if the
  boundary is missing. The underlying visitor string fragments and TS editor
  adapters are still separate implementation nodes.

User-visible miss:

- Every new premium interaction doubles the chance that the editor preview and
  published site drift.
- Template authors cannot trust a behaviour unless both runtimes and their
  parity tests are updated.

Needed primitive:

- One interaction runtime source that can be consumed by both visitor output
  and editor preview, or a stricter code-generation/parity boundary that makes
  drift impossible to miss.
- Remaining next wave: move individual runtime adapters behind generated or
  shared modules so parity is structural, not only boundary-pinned.

### 14. Motion Authoring UX Is Too Thin

Current state:

- Element inspector exposes Motion Preset, delay, and replay.
- Section inspector exposes Entrance Preset and Popup Trigger.
- The Interactions sidebar tab exposes Load Experience, Route Transition,
  Overlays, and Motion Sequence Lite step lists.
- There is still no full timeline editor for arbitrary elements, text splits,
  scroll scenes, or shared-layout transitions.

User-visible miss:

- Template authors cannot inspect or tune choreography as choreography.
- Long sequences become hidden fields scattered across elements and sections.

Needed primitive:

- A Motion panel that shows triggers, targets, sequence steps, delays, preview,
  replay, reduced-motion state, and validation errors in one place.

## Priority Order

1. **Runtime single-source/parity.** New interactions will multiply risk unless
   visitor and editor hydration are unified or generated.
2. **Full timeline and Scroll Scene.** Needed for the most visible "fancy site"
   choreography and storytelling patterns.
3. **Shared-element route/layout transitions.** Needed for list/detail,
   filters, tabs, and overlay/detail continuity.
4. **Designer-grade Overlay/Modal v2.** Overlay v1 is real; reusable chrome,
   richer sequences, and modal-specific presets remain.
5. **Rich Motion Assets.** Needed for Lottie/Rive/WebGL/shader/particle
   surfaces, but only after asset type, CSP, editor preview, and
   reduced-motion contracts are defined.
6. **Component Style and Collection rendering.** ADR 0067 is already pointed at
   this, but collection render must be real before styling it.
7. **Pointer/Hover FX catalog.** Useful, but should compose with the Motion
   model instead of becoming its own parallel universe.
8. **Import animation inventory.** Once the runtime vocabulary exists, import
   can map source behaviours exactly or fail loudly.

## Pushback On The Obvious Shortcut

Do not solve this by letting templates carry arbitrary JS/CSS blobs as their
main interaction model. That would be fast, but it creates the wrong system:

- The editor cannot preview or inspect it.
- The validator cannot prove it is supported.
- The Section Library cannot version or search it semantically.
- The Agent cannot edit it safely.
- Runtime hydration and live publish cannot reason about it.
- Failures become "nothing happened" bugs instead of explicit validation
  errors.

`addon_custom_scripts` should remain Owner-authored code for integrations and
exceptional custom work. Template fidelity needs schema-owned behaviours.

## Minimal Conceptual System

The current system has several separate nodes that all mean "make something
move": Motion Preset, section entrance, page entrance, pointer-fx, popup
trigger, carousel runtime state, and component Variant CSS. That is acceptable
for simple effects, but it is not minimally complex for designer-template
fidelity because each new effect adds another relation and another preview path.

The reduced target model:

- **Trigger**: load, viewport enter, scroll progress, hover, pointer move,
  click, route navigation, media ready.
- **Target**: page, section, element, component part, text split, overlay.
- **Motion Sequence**: ordered steps over targets.
- **Interaction State**: open/closed, active slide, active tab, hovered,
  pointer position, scroll progress.
- **Runtime Hydrator**: one source of truth that publishes state and runs
  sequences in both editor and visitor contexts.

Every existing feature should map into that model:

- Element/section/page entrances become `Trigger -> Motion Sequence`.
- Pointer-fx becomes `pointer move -> Interaction State -> CSS variables`.
- Carousel `coverflow` becomes `active slide -> Interaction State -> CSS`.
- Popup sections become `Trigger -> Overlay open Motion Sequence`.
- Route transitions become `route navigation -> outgoing/incoming Motion
  Sequences`.

That keeps behaviour explicit and prevents the next designer-template wave from
adding disconnected one-off runtimes.
