# Designer Template Fidelity Gaps

**Status:** Investigation
**Date:** 2026-06-16

**Agent pickup:** future work now lives in
[`docs/specs/designer-interactions-future-work.md`](designer-interactions-future-work.md).

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
- Sections can become popups via `exit-intent`, `delay`, or `scroll` triggers.
- Layout has top-only sticky elements (`stickyOffset`) and carousel-local
  horizontal scroll snap.
- The importer captures computed `transition`, `animation`, `transform`, and
  `will-change`, then maps them to the nearest Motion Preset
  (`services/scraper/src/dom-walker.ts`).

That baseline is useful, but it is not enough for 1:1 designer-template
fidelity.

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

### 1. No Motion Graph Or Timeline

Current state:

- Each element, section, or page can choose one Motion Preset plus an optional
  delay.
- Motion presets resolve to kit-scoped CSS keyframes. They mostly control
  `transform` and `opacity`.
- The editor exposes a select and delay input; element delay is capped at
  2000ms in the inspector.

User-visible miss:

- Cannot reproduce staged hero intros where logo, mask, headline words, media,
  nav, and CTA all enter on one choreographed timeline.
- Cannot chain animations across multiple elements.
- Cannot define per-step duration, easing, repeat, yoyo, reverse, or wait.
- Cannot express character/word line reveals, mask wipes, clip-path reveals,
  filter/blur timelines, SVG stroke drawing, or variable-font axis animation.

Needed primitive:

- A schema-owned Motion Sequence: trigger, ordered steps, target selectors,
  properties, duration, easing, delay, stagger, and completion behaviour.
- Validation must reject unsupported targets/properties instead of silently
  dropping steps.

### 2. Scroll Motion Is Triggered, Not Scrubbed

Current state:

- Published output uses IntersectionObserver to reveal once when an element or
  section crosses a threshold.
- `parallax-soft` is an entrance preset, not a scroll-progress relation.
- Sticky is top-only per element; scroll-snap exists only as a carousel mode.

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

### 3. No Template-Native Preloader

Current state:

- Published pages do not have a site-level loading/preloader object.
- There are loading states in dashboard/editor chrome, but not in Template
  state or public page rendering.
- Media elements use native loading behaviour where relevant, but no authored
  loading choreography exists.

User-visible miss:

- Cannot reproduce branded preloaders, progress numbers, logo draws, mask
  openings, media-readiness gates, or first-load page reveals.
- Cannot choose whether a preloader runs once per session, per page, or only
  before heavy media.

Needed primitive:

- A Load Experience at site/page level: visual content, run policy, readiness
  gate, timeout/error behaviour, and transition into the first page state.
- The failure path must be explicit. Do not silently skip the loader when an
  asset is late.

### 4. No Page Or Route Transition System

Current state:

- Public navigation is multi-page HTML routing.
- The live-update script swaps snapshot HTML via `innerHTML`, but inline
  scripts do not execute after that swap; ADR 0066 already calls out live
  re-hydration as a follow-up.
- There is no View Transition API integration or schema-owned route transition.

User-visible miss:

- Cannot reproduce shared-element transitions between list/detail pages.
- Cannot animate between template pages with masks, wipes, crossfades, or
  continuity of the clicked card/image/title.
- Cannot guarantee interactive runtime hydration after page-state swaps.

Needed primitive:

- A Route Transition contract: trigger, outgoing animation, incoming
  animation, optional shared-element mapping, hydration handoff, and reduced
  motion behaviour.

### 5. Popup Sections Are Not Designer-Grade Modals

Current state:

- A section becomes a popup when it has an `exit-intent`, `delay`, or `scroll`
  trigger.
- The runtime creates a hard-coded backdrop and close button with inline
  styles.
- Popup show mutates the section into fixed center positioning.
- No element-click trigger exists; ADR 0054 documents it as a deferred drill-in
  overlay contract.
- The editor skips popup hydration so Owners do not get trapped while editing.

User-visible miss:

- Cannot reproduce click-open project modals, nav overlays, command palettes,
  full-screen menu transitions, iframe drill-ins, gallery lightboxes, or
  product-tour overlays.
- Cannot style modal chrome as part of a Template.
- No entrance/exit variants, backdrop variants, close-button placement, focus
  trap, return focus, body scroll lock, or modal preview mode.

Needed primitive:

- An Overlay/Modal model: content section, trigger relation, chrome style,
  open/close Motion Sequences, focus and scroll contract, dismissal policy,
  and editor preview controls.

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

- Forms have `FormStyle`.
- Accordions, tabs, carousels, and collections do not yet have full typed
  style objects.
- ADR 0067 proposes `accordionStyle`, `carouselStyle`, `tabsStyle`, and
  `collectionStyle`, plus stronger editor/public DOM parity.
- ADR 0066 explicitly deferred static Variant CSS preview parity in the editor.

User-visible miss:

- A template author can pick a Variant but cannot precisely tune component
  anatomy such as active tab fill, tab indicator color, accordion body padding,
  carousel arrow size, dot colors, or collection card radius without raw
  `pinnedStyle`.
- The editor can diverge from published output for static variant arms.

Needed primitive:

- Implement ADR 0067 or a stricter successor, with typed Component Style fields
  and one component DOM/CSS contract shared by editor preview and public render.

### 8. Collection Rendering Is Not Ready For Premium Card Templates

Current state:

- `CollectionElement.entries` exists as materialized per-entry output.
- `renderCollection` emits an empty collection frame with data attributes.
- ADR 0067 correctly states that collection card/image styling must ship only
  once there is a real published render target.

User-visible miss:

- Cannot reproduce premium blog/case-study grids, animated card reveals,
  hover card transitions, image-only rails, or custom card templates as a
  first-class published component.

Needed primitive:

- Published Collection rendering for `card`, `image-only`, and `custom` display
  modes, with Component Style variables on the collection host and support for
  nested interactive/runtime scans.

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

User-visible miss:

- Cannot reproduce word-by-word reveals, line mask reveals, character staggers,
  kinetic headlines, type scrambles, or text tied to scroll progress.

Needed primitive:

- Text Split targets as an explicit render mode: by character, word, or line,
  with semantic HTML preserved and the Motion Sequence targeting generated
  spans. Accessibility must define what screen readers see.

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

User-visible miss:

- Every new premium interaction doubles the chance that the editor preview and
  published site drift.
- Template authors cannot trust a behaviour unless both runtimes and their
  parity tests are updated.

Needed primitive:

- One interaction runtime source that can be consumed by both visitor output
  and editor preview, or a stricter code-generation/parity boundary that makes
  drift impossible to miss.

### 14. Motion Authoring UX Is Too Thin

Current state:

- Element inspector exposes Motion Preset, delay, and replay.
- Section inspector exposes Entrance Preset and Popup Trigger.
- Page fields exist in schema and context, but there is no visible timeline or
  transition editor.

User-visible miss:

- Template authors cannot inspect or tune choreography as choreography.
- Long sequences become hidden fields scattered across elements and sections.

Needed primitive:

- A Motion panel that shows triggers, targets, sequence steps, delays, preview,
  replay, reduced-motion state, and validation errors in one place.

## Priority Order

1. **Canonical Motion/Interaction model.** Add the smallest set of new concepts
   before adding more one-off variants: Trigger, Target, Motion Sequence,
   Scroll Scene, Overlay, and Route Transition.
2. **Runtime single-source/parity.** New interactions will multiply risk unless
   visitor and editor hydration are unified or generated.
3. **Designer-grade Overlay/Modal.** This is the highest-value concrete gap for
   portfolio/project templates and product sites.
4. **Preloader and Route Transition.** These define first impression and
   navigation polish.
5. **Scroll Scene.** Needed for the most visible "fancy site" storytelling
   patterns.
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
