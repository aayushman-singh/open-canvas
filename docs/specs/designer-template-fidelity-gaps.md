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
- Repeating motion motifs such as logo/text marquees are editable in the
  element inspector and match between editor preview and published pages.
- Hover video previews are authored on video media elements and execute via
  the same Runtime Hydrator in editor preview and published pages.
- Pointer-reactive spotlight, tilt, magnetic, cursor-follow, reveal-mask, and
  pointer-parallax effects plus cursor trails and image-follow cursors are
  selectable on arbitrary elements with explicit reduced-motion behaviour and
  tap/toggle touch activation; drag-inertia can publish draggable offset state.
- Collection galleries can be dragged as schema-owned sliders that update
  active-entry state, inspector-authored axis/inertia policy, and editor/visitor
  Runtime Hydrator state without custom scripts.
- Rich Motion Assets can represent Rive files as schema-owned assets with
  artboard/state-machine metadata and a bounded runtime adapter.
- Rich Motion Assets can represent Lottie JSON files as schema-owned assets
  with renderer/autoplay/loop/reduced-motion metadata and a bounded runtime
  adapter.
- Rich Motion Assets can represent bounded 3D GLB-style scenes as schema-owned
  `model-3d` assets backed by a pinned `<model-viewer>` runtime adapter.
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
  the shipped pointer-fx primitives are `spotlight`, `tilt`, `magnetic`,
  `cursor-follow`, `reveal-mask`, `pointer-parallax`, `cursor-trail`, and
  `image-follow`, but only Form `spotlight` is attached to a catalogued
  variant.
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
- **June 2026 update:** Runtime Hydrator parity is now a named gate. Visitor
  output, editor render, live-publish swaps, and route-transition swaps all
  consume `window.__opencanvasHydrate`; `runtime-hydrator-parity:smoke` is wired
  into `ci:smoke` so drift fails before publish.
- **June 2026 update:** element-level Marquee is now schema-owned. The
  element inspector can enable direction, speed, pause-on-hover, hover-reverse,
  and explicit reduced-motion mode plus an edge-fade mask; renderer/editor
  wrappers emit `data-opencanvas-marquee*` metadata; Marquee is the first shared-source Runtime Hydrator adapter: editor preview imports the typed implementation from `src/interactive/marquee.ts`, while published pages receive `MARQUEE_RUNTIME_SRC` generated from those same functions.
- **June 2026 update:** video media elements can now opt into Video Stream
  Hover. The media inspector exposes play-on-hover/focus mode and explicit
  reduced-motion behaviour plus pointer scrub; renderer emits
  `data-opencanvas-video-hover*` metadata on the `<video>`; visitor/editor
  hydrators play, pause, reset, and scrub via the same named Runtime Hydrator;
  validation rejects image/autoplay conflicts and malformed modes.
- **June 2026 update:** Pointer FX is now owner-facing beyond Form
  `spotlight`. Element wrappers can store `pointerFx` with `spotlight`, `tilt`,
  `magnetic`, `cursor-follow`, `reveal-mask`, `pointer-parallax`, or
  `cursor-trail`, `image-follow`, or `drag-inertia`, explicit reduced-motion
  mode, tap/toggle touch activation, validator/Yjs persistence, renderer
  metadata, editor inspector controls, and named runtime failure events.
- **June 2026 update:** Rich Motion Assets now include a `rive` kind. The
  schema stores the Rive asset id, artboard, state machine, autoplay, alt text,
  and explicit reduced-motion policy; renderer/editor emit fit metadata; the
  Behaviour runtime loads a pinned official Rive canvas runtime and emits
  named behaviour failures when runtime loading or Rive initialization fails.
- **June 2026 update:** Rich Motion Assets now include a `lottie` kind. The
  schema stores the Lottie JSON asset id, renderer, autoplay, loop, alt text,
  and explicit reduced-motion policy; the Behaviour runtime loads pinned
  `lottie-web` and emits named failures for runtime loading or initialization.
- **June 2026 update:** Rich Motion Assets now include a `model-3d` kind for
  bounded GLB/USDZ-class scenes. The schema stores model asset id, optional
  poster, camera controls, auto-rotate, alt text, and explicit reduced-motion
  policy; the Behaviour runtime loads pinned `<model-viewer>` and emits named
  failures for runtime loading, initialization, and model load errors.

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
- **Shared-element Route Transition:** schema-owned source/target element
  mappings expose View Transition API continuity for list/detail navigation,
  with named failure events when the API or mapped relation is unavailable.
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
- FLIP route transitions across filters, tabs, and overlay/detail states.
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
- **June 2026 update:** Motion Sequences now support finite repeat metadata
  with `restart` or `yoyo` mode for time-based load/section-enter sequences.
  The Interactions panel exposes repeat count/mode, the Runtime Hydrator maps
  this to finite Web Animations iterations/direction, and scroll-scene
  sequences reject repeat instead of silently ignoring it.
- **June 2026 update:** Motion Sequence steps now support `startAtMs` for
  absolute timeline placement on time-based sequences. Owners can overlap logo,
  headline, media, nav, and CTA steps from the Interactions panel; validation
  rejects negative offsets and scroll-scene offsets, and the Runtime Hydrator
  schedules steps by absolute timeline position instead of forcing every step
  to serialize.
- **June 2026 update:** Full Motion Sequence cards now render a styled
  Timeline overview that maps step start/duration into visible bars, giving
  owners choreography-level inspection before editing individual step fields.
- **June 2026 update:** The Timeline overview now groups steps into target
  lanes and shows explicit snap handles, so overlapping element/text/section
  choreography is readable before field-level edits.
- **June 2026 update:** The Timeline overview now includes a scrub-preview
  slider. Moving it advances the playhead and applies interpolated Motion
  Sequence styles to the same editor canvas targets selected by the schema
  target relation; missing targets surface an editor error instead of silently
  doing nothing.
- **June 2026 update:** Time-based Motion Sequence bars can now be dragged in
  the timeline to set `startAtMs` directly. Scroll-scene sequences keep drag
  editing disabled because scroll progress, not absolute time, owns their
  replay relation.
- **June 2026 update:** Timeline bar handles can now be dragged to set
  `durationMs` directly, with invalid editor measurements reported through the
  status channel instead of ignored.
- **June 2026 update:** Timeline quick properties now edit common per-step
  timing/easing plus `from`/`to` opacity, transform, and filter values beside
  the visual timeline, using the same schema-owned Motion Sequence step fields
  as the detailed form.
- **June 2026 update:** Timeline quick properties now also expose advanced
  schema-owned step properties for clip-path reveals, variable font axes, and
  SVG stroke dash choreography beside the timeline instead of requiring a
  separate field-level pass.
- **June 2026 update:** Timeline quick properties now expose target binding
  controls beside the timeline: target type, page, section, element id, and
  text-split unit all write the same schema-owned `MotionSequenceStep.target`
  shape as the detailed editor.
- **June 2026 update:** Timeline quick properties now expose sequence-level
  playback direction, repeat count, and repeat mode beside the timeline, using
  the existing schema-owned `MotionSequence.playbackDirection` and
  `MotionSequence.repeat` fields. Scroll-scene sequences keep repeat/playback
  disabled rather than silently ignoring unsupported loops.
- **June 2026 update:** Timeline quick properties now expose per-step
  `startAtMs` and `waitAfterMs` controls beside duration, delay, stagger, and
  easing. Scroll-scene sequences keep time-only controls disabled rather than
  silently accepting unsupported offsets.

User-visible miss:

- Cannot yet edit every advanced property through a direct-manipulation
  timeline canvas; detailed target controls and multi-step visual choreography
  remain in the field-level editor.

Needed primitive:

- A schema-owned Motion Sequence: trigger, ordered steps, target selectors,
  properties, duration, easing, delay, stagger, and completion behaviour.
- Validation must reject unsupported targets/properties instead of silently
  dropping steps.
- Remaining next wave: richer direct-manipulation timeline affordances for
  multi-step visual choreography and detailed target editing.

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
  first scroll-story relation, but horizontal storytelling, multi-step timeline
  editing, and unified timeline canvas remain open.
- **June 2026 update:** Scroll Scene now supports schema-owned `snapPoints`
  as increasing progress stops from `0..1`. The Interactions panel exposes a
  Snap points control, validation rejects malformed stops, and the Runtime
  Hydrator quantizes shared scroll progress before Motion Sequence, Rich Motion
  image-sequence, or Rive scroll-progress consumers read it.
- **June 2026 update:** Scroll Scene now supports a schema-owned
  `horizontalTrack` relation. Owners can bind an element track from the
  Interactions panel, optionally author a fixed travel distance, and the
  Runtime Hydrator translates it from scene progress with named failures for
  unresolved or unmeasurable tracks. Velocity Athlete uses this instead of a
  template-only transform to prove horizontal storytelling is owner-editable.
- **June 2026 update:** Image-sequence Rich Motion Assets can now bind playback
  to a Scroll Scene from the Interactions panel. Owners can choose load playback
  with FPS/loop controls or scroll-scrub playback against a named Scroll Scene;
  missing scene relations are surfaced in the editor and blocked by validation.
- **June 2026 update:** Scroll Scene now supports a schema-owned
  `beforeAfterReveal` relation. Owners can bind before/after element IDs,
  choose horizontal or vertical clipping, author the active progress window,
  and set an explicit reduced-motion endpoint; the Runtime Hydrator clips the
  after element from scene progress and fails loudly for malformed relations.
- **June 2026 update:** Text Split Targets now include `textEffect =
  mask-reveal` in addition to deterministic `scramble`. The Interactions panel
  exposes it through the schema-owned text-effect catalog, validation keeps it
  on text-split targets, and the Runtime Hydrator clips split spans from
  Scroll Scene or time-based Motion Sequence progress.

User-visible miss:

- Scroll position can now drive pinned Motion Sequence progress with authored
  stops.
- Scroll-progress typography now supports split-text scramble and mask reveals.

Needed primitive:

- A Scroll Scene: trigger section, start/end bounds, optional pinning, scrubbed
  progress, snap points, optional horizontal track, optional before/after
  reveal, and a Motion Sequence bound to progress rather than time.

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
- **June 2026 update:** Behaviour Load Experience now has schema-owned progress
  choreography for hidden, bar, number, or bar+number displays. The renderer
  emits explicit progress metadata/nodes, the Behaviour runtime drives the
  counter and bar, and the Interactions panel exposes display, duration, and
  label controls.
- **June 2026 update:** Behaviour Load Experience now has owner-authored run
  policy for `every-visit` or `once-per-session`. The runtime uses
  `sessionStorage` only for the session policy and fails loudly when storage is
  unavailable instead of silently replaying or skipping.
- **June 2026 update:** Behaviour Load Experience now has owner-authored media
  readiness maps. The renderer emits explicit asset URLs and timeout metadata,
  the Behaviour runtime waits on same-origin fetches, blocks premature enter,
  and emits named readiness failures for missing URLs, fetch errors, or timeout.
- **June 2026 update:** Behaviour Load Experience now supports schema-owned
  logo/wordmark draw choreography. The renderer emits bounded SVG text, the
  Behaviour runtime measures and animates stroke dash with WAAPI, and the
  Interactions panel exposes text, duration, and stroke width.
- **June 2026 update:** Behaviour Load Experience now supports schema-owned
  handoff choreography for fade, mask-open, and slide-up. The renderer emits
  explicit handoff metadata, the Behaviour runtime applies the transition and
  emits named failures for missing or invalid metadata, and the Interactions
  panel exposes effect, duration, and easing controls.

User-visible miss:

- Cannot reproduce arbitrary branded preloader canvases or fully custom
  first-page reveal choreography.
- Custom arbitrary preloader canvas content remains intentionally out of scope;
  Behaviour Load Experience now covers label, enter action, progress, media
  readiness, run policy, bounded logo/wordmark draw, and bounded handoff
  transitions.

Needed primitive:

- Next wave: custom visual content and richer transition into the first page
  state. The failure path must stay explicit; do not silently skip the loader
  when an asset is late.

### 4. Route Transition V1 Exists, Shared-Element Navigation Does Not

Current state:

- Public navigation is multi-page HTML routing.
- The live-update script swaps snapshot HTML via `innerHTML` and now calls the
  Runtime Hydrator after the swap.
- `routeTransition` can enable fade, slide, wipe, crossfade, or mask
  transitions with outgoing/incoming Motion Sequence Lite hooks.
- **June 2026 update:** `crossfade` and `mask` route modes are schema-owned
  `routeTransition.mode` values exposed through the existing editor dropdown.
  The renderer emits the mode, the Route Transition runtime runs those modes
  through the browser View Transition API, and missing API support emits
  `opencanvas:route-transition-failed` with `phase: view-transition-api`
  instead of silently degrading to fade.
- **June 2026 update:** `routeTransition.sharedElements` stores owner-authored
  source/target element mappings and a view-transition name. The renderer emits
  `data-opencanvas-route-shared-elements`, the Runtime Hydrator applies View
  Transition API names during same-origin navigation, and unresolved mappings or
  missing API support emit `opencanvas:route-transition-failed` instead of
  degrading to a fade.

User-visible miss:

- Can now reproduce same-origin shared-element transitions between list/detail
  pages when both pages expose the mapped element ids.
- Can now animate between template pages with fade, slide, wipe, crossfade,
  mask, and mapped shared-element handoffs.
- Cannot yet express richer geometry policies such as multi-element FLIP
  continuity of the clicked card/image/title when the pages do not expose
  explicit shared-element mappings.
- Cannot guarantee interactive runtime hydration after page-state swaps.

Needed primitive:

- Next wave: FLIP handoff for non-route layout state, reduced-motion authoring
  preview, and richer geometry policies beyond native View Transition API
  mapping.

### 5. Overlay V1 Replaces Popup Sections, But Designer-Grade Modals Need More

Current state:

- Legacy popup-triggered sections migrate into `EditableSite.overlays` on
  editor load.
- Overlay v1 supports site/page scope, load/delay/scroll/exit-intent/
  element-click triggers, template-owned content sections, focus/scroll
  dismissal policy, open/close Motion Sequence Lite metadata, and editor
  preview.
- **June 2026 update:** Overlay presentation now includes a bounded chrome
  catalog: `standard`, `glass-panel`, or `editorial-frame`; backdrop styles
  `dim`, `blur`, or `solid`; and close placement `top-right`, `top-left`, or
  `inside`. Renderer/editor preview emit the same metadata and styling hooks,
  the Runtime Hydrator validates stale/malformed HTML, and the Interactions
  panel exposes the controls.
- **June 2026 update:** Overlay presentation now includes a bounded `lightbox`
  mode for gallery/media overlays. The same schema/editor/runtime path emits
  explicit presentation metadata, a lightbox styling hook, runtime validation,
  and public styles without custom owner scripts.
- **June 2026 update:** Overlay presentation now includes a bounded
  `command-palette` mode. Owners can select it from the Interactions panel,
  renderer/editor preview emit explicit presentation metadata and class hooks,
  the Runtime Hydrator validates the mode, and public styles provide the
  centered palette surface without arbitrary owner CSS.
- **June 2026 update:** Overlay presentation now includes a bounded
  `product-tour` mode. It provides a named tour-card presentation surface with
  validation, render metadata, Runtime Hydrator allow-listing, and public styles;
  multi-step tour state remains a future schema relation rather than custom JS.
- **June 2026 update:** Overlay presentation now includes bounded layout
  presets: `centered`, `split-rail`, and `mega-menu-grid`. Renderer/editor
  preview emit explicit layout metadata and styling hooks, the Runtime Hydrator
  rejects stale layout values with a named `overlay-layout` failure, and the
  Interactions panel exposes the owner control.

User-visible miss:

- Can now style modal/fullscreen chrome from a bounded Template-owned catalog
  and publish lightbox, command-palette, or product-tour overlay presentations.
- Richer entrance/exit variants and multi-step tour state are still missing.

Needed primitive:

- Next wave: multi-step tour state, iframe drill-in contracts, richer nested
  overlay-canvas editing affordances, and richer open/close sequences.

### 6. Pointer, Hover, And Cursor Effects Are Too Narrow

Current state:

- Pointer-fx exists as a runtime concept with `spotlight`, `tilt`, `magnetic`,
  `cursor-follow`, `reveal-mask`, `pointer-parallax`, `cursor-trail`, and
  `image-follow`, and `drag-inertia`.
- Only Form `spotlight` is attached to a shipped variant.
- Hover states are mostly fixed CSS inside component/style-kit selectors.
- **June 2026 update:** Marquee is no longer template-JSON-only. Any element
  can opt into a schema-owned continuous marquee with inspector controls,
  render metadata, editor/visitor Runtime Hydrator support, named failure
  events, explicit reduced-motion behaviour, and multi-row phase staggering.
- **June 2026 update:** Video Stream Hover is now first-class for video media.
  It is video-only, muted by contract for browser autoplay policy, focus-aware,
  reduced-motion-aware, and fails through `opencanvas:video-hover-failure`
  instead of silently ignoring rejected playback. Pointer scrub and alternate
  hover stream/poster assets are schema-owned and editor-exposed. Hover intent
  delay is schema-owned so accidental passes across card grids can be canceled
  before playback starts.
- **June 2026 update:** Pointer FX now has an element-level inspector catalog.
  Owners can apply `spotlight`, `tilt`, `magnetic`, `cursor-follow`,
  `reveal-mask`, `pointer-parallax`, `cursor-trail`, or `image-follow` to
  arbitrary elements; Form `spotlight` also emits explicit reduced-motion
  metadata; malformed runtime attributes fail through
  `opencanvas:pointer-fx-failure`.
- **June 2026 update:** Pointer FX now has schema-owned touch activation.
  Owners can choose `none`, `tap`, or `toggle`; the renderer emits
  `data-opencanvas-pointer-fx-touch`, Yjs preserves it, the inspector exposes
  it, and the Runtime Hydrator maps touch `pointerdown` to the same CSS
  variables used by pointer movement.
- **June 2026 update:** Pointer FX now includes `drag-inertia`. Owners can
  choose an axis and inertia flag; renderer metadata, Yjs persistence,
  inspector controls, CSS hooks, and Runtime Hydrator drag state are all
  schema-owned, with malformed drag relations rejected by validation/runtime
  failure gates.

User-visible miss:

- Richer collection slider controls such as snap presets and gallery navigation
  presets remain deferred beyond the drag-slider primitive.

June 2026 update: Marquee can now bind to a same-section Collection element as
a schema-owned ticker source (`title`, `excerpt`, or `all-text`) instead of
manual text only; validation fails if the relation is missing, points at a
non-Collection, or resolves no text values.

June 2026 update: Collection Gallery v2 can now batch-apply Video Stream Hover
to materialized video entries through `gallery.videoHover`; explicit per-entry
video hover still wins, renderer emits the existing video-hover metadata, and
Yjs preserves the gallery-level policy.

June 2026 update: Collection Gallery drag-slider can now show schema-owned
progress dots. The renderer emits progress metadata and one dot per entry, the
Runtime Hydrator keeps dots in sync with active-entry state, progress dots can
page the slider, keyboard arrows page the focused slider, the inspector exposes
a Show progress toggle, and validation/Yjs preserve the policy.

Needed primitive:

- Pointer FX and Hover State as schema-owned presets with component-neutral
  targets and inspector controls. `tilt` should either become a real catalogued
  option or remain internal; unused primitives should not be presented as
  capability.

### 7. Component Styling Still Stops Short Of Template Fidelity

Current state:

- Forms, accordions, tabs, carousels, and collections have typed sparse
  Component Style objects (`formStyle`, `accordionStyle`, `tabsStyle`,
  `carouselStyle`, and `collectionStyle`).
- ADR 0067 is accepted and shipped with validator, render, Yjs, agent, and
  inspector smoke coverage.
- Editor/public DOM parity is in place for the styled component parts covered
  by ADR 0067.
- **June 2026 update:** Collection Component Style now includes default-card
  typography controls for title, excerpt, and CTA parts. The modeled fields
  validate/Yjs-round-trip through the shared Component Style catalog, render as
  CSS variables on the collection wrapper, public styles consume those
  variables on the built-in card parts, and the generic inspector exposes the
  controls.

User-visible miss:

- A template author can now tune the first ADR 0067 field catalog without raw
  `pinnedStyle`.
- Template fidelity still stops short of reusable saved Component Style
  recipes, arbitrary unit controls, and Component Style objects for unrelated
  elements such as shape, container, table, nav, chart, code, text, media, and
  embed.

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
- **June 2026 update:** Collection Search is now schema-owned. Owners can
  enable search on a Collection, author placeholder/empty-state copy, choose
  explicit reduced-motion behaviour, preview filtering in the editor, and
  publish runtime-owned entry visibility without custom scripts.
- **June 2026 update:** Collection filter chips are now schema-owned. The
  materializer writes ordered entry metadata, owners can configure chip
  field/options/default/reduced-motion policy, renderer/editor preview emit
  filter buttons and entry metadata, and the Runtime Hydrator combines filter
  and search visibility.
- **June 2026 update:** Collection grid/list view toggles are now
  schema-owned. Owners can enable the switch, choose the default view and
  reduced-motion policy, and the Runtime Hydrator publishes active view state
  in editor and visitor contexts.

User-visible miss:

- Basic published collection cards, custom templates, gallery reveal/slider
  states, text search, taxonomy filter chips, and grid/list view toggles are
  real, but premium CMS experiences still lack editorial states, drafts,
  scheduling, and full detail workflow.

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
- **June 2026 update:** `layoutTransitions` now stores schema-owned same-page
  trigger/source/target element relations. The behaviour payload hydrates them
  through the Runtime Hydrator, uses native View Transition API continuity for
  the mapped pair, and emits `opencanvas:behaviour-failure` with
  layout-specific codes when the trigger/source/target relation or API is
  unavailable. Reduced-motion `instant` is explicit owner-authored behaviour,
  not silent degradation.
- **June 2026 update:** Layout Transitions now support an optional
  `reverseTriggerElementId` relation for target-state close affordances. The
  validator gates the reverse trigger reference, Yjs/payload preserve it, the
  Runtime Hydrator hides/reveals the close trigger with the target state and
  drives the reverse transition, and the Interactions panel exposes the
  relation.

User-visible miss:

- Same-page card/detail expansion no longer has to be template-only when both
  states are represented by elements and open/close triggers exist.
- Grid/list view switches are schema-owned for Collections with explicit
  reduced-motion policy.
- Cannot yet morph one element into another across tabs, filters, or overlays
  without a richer FLIP/layout-state model. Page routes use the separate
  shared-element Route Transition relation.

Needed primitive:

- Next wave: layout-state groups, FLIP geometry capture for non-View-Transition
  surfaces, and collection-driven detail states.

### 10. Text Animation Is Not First-Class

Current state:

- Text elements support rich inline runs and some typography fields.
- Motion targets the whole positioned element wrapper.
- **June 2026 update:** Text elements now expose a Text Split Target inspector
  control that writes schema-owned Motion Sequence targets for word, line, or
  character splitting. The visitor runtime generates presentational split spans
  with `aria-hidden="true"` and preserves the full semantic text on the host
  with `aria-label`.
- **June 2026 update:** Motion Sequence steps can now apply a schema-owned
  `textEffect = scramble` to text-split targets. The Interactions panel exposes
  the effect catalog, validation rejects unsupported/non-text/repeating
  relations, and the Runtime Hydrator applies deterministic scroll-scrubbed
  scramble text while restoring final text at completion.
- **June 2026 update:** The text-effect catalog now includes `mask-reveal`.
  It preserves the final semantic text, clips generated split spans from
  Motion Sequence progress, and is available to owners from the same Text
  effect control as `scramble`.
- **June 2026 update:** The text-effect catalog now also includes
  `blur-reveal` and `wave-rise`. These effects remain schema-owned
  `MotionSequenceStep.textEffect` values, validate as text-split-only
  relations, and run through the Behaviour runtime for scroll-scrubbed or
  time-based split text without owner-authored JavaScript.

User-visible miss:

- Can reproduce bounded scramble, mask, blur, and wave split-text effects from
  Motion Sequence steps.
- Cannot yet reproduce arbitrary custom kinetic headline systems or multi-step
  text timelines from a unified timeline canvas.

Needed primitive:

- Text Split targets as an explicit render mode: by character, word, or line,
  with semantic HTML preserved and the Motion Sequence targeting generated
  spans. Accessibility must define what screen readers see.
- Remaining next wave: visual multi-step editing of split targets and custom
  per-glyph choreography beyond the bounded text-effect catalog.

### 11. Rich Media / 3D / Shader Surfaces Are Missing

Current state:

- Media supports images and videos.
- Sections support background video assets.
- Embeds are iframe-based and CSP-gated.
- Charts render static SVG.
- Rich Motion supports image sequences, Rive `.riv` assets, Lottie JSON assets,
  and bounded `model-3d` GLB scenes. Rive/Lottie/3D support is schema-owned
  and runtime-owned: no owner JS blobs, with explicit runtime loading/init
  failures and reduced-motion policy.
- **June 2026 update:** Rive assets can now carry schema-owned state-machine
  input bindings for pointer enter/leave, focus/blur, click, and scroll
  progress. Validation rejects impossible input/event relations, Yjs preserves
  the bindings, the behaviour payload serializes them, and the Runtime
  Hydrator fails through named Rive input errors when the state machine,
  input, type, API, or scroll target cannot resolve. The Interactions panel
  exposes Rive asset metadata and input-binding controls for existing or
  manually added Rive assets.
- **June 2026 update:** Rich Motion now includes a bounded `shader-scene`
  kind for WebGL/canvas-class motion presets (`aurora-flow`, `racing-lines`,
  `particle-field`). Owners choose preset, colours, speed, density, and
  reduced-motion behaviour; the runtime owns the shader source and emits named
  failures for missing WebGL context, invalid colours/presets, size, shader
  program, or initialization errors.
- **June 2026 update:** Rich Motion also includes a `video-stream` kind for
  hover/focus, click-toggle, or load-driven video streams inside Rich Motion
  surfaces. Owners choose video/poster asset ids, fit inherits from the
  Rich Motion element, hover/load triggers are muted by contract, reduced
  motion can freeze to the poster, and the Runtime Hydrator emits named
  failures for missing sources, unsupported triggers, unsafe mute relations,
  reset errors, or rejected playback.

User-visible miss:

- Can now reproduce basic Lottie/Rive/model surfaces, Rive button and
  scroll-progress state-machine control when the underlying asset exposes the
  named inputs, and bounded WebGL-style shader/particle fields from fixed
  presets.
- Can now mount schema-owned Rich Motion video streams for hover-preview
  surfaces beyond ordinary video media elements.
- Cannot yet reproduce arbitrary WebGL/Three.js scenes, custom shader
  distortion, Spline-like embeds as editable first-class media, or owner-coded
  canvas particle systems.
- `model-3d` covers bounded GLB-style product/helmet scenes, not custom shader
  pipelines or owner-authored Three.js code.
- Rive input bindings are schema/runtime-owned and panel-editable. Rich Motion
  elements now expose an inspector asset picker backed by
  `state.richMotionAssets`, so owners can bind an element to authored
  image-sequence, Rive, Lottie, model, shader, or video-stream assets without
  hand-editing JSON.
- Rich Motion asset metadata controls now cover the runtime-supported
  `image-sequence`, `rive`, `lottie`, `model-3d`, `shader-scene`, and
  `video-stream` kinds in the Interactions panel, so these surfaces are no
  longer template-JSON-only.

Needed primitive:

- A deliberate media-extension decision. Do not add arbitrary "animation file"
  blobs without defining asset type, playback controls, CSP, editor preview,
  reduced-motion handling, and publish-time failure behaviour.
- Remaining next wave: upload/storage management UI for rich motion source
  files, Rive/Lottie/model events, custom shader authoring decision, CSP
  policy hardening, and production management support for rich motion asset
  files.

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
- **June 2026 update:** shared editor/visitor hydration surfaces are now listed
  in `RUNTIME_HYDRATOR_SURFACES`, and the parity smoke checks every manifest
  entry against both dispatchers. Adding a shared surface without both runtime
  paths now fails CI instead of relying on reviewer memory.
- **June 2026 update (Unified Registry Slice):** Partially unified the visitor
  and editor hydration dispatch layers under a shared, registry-backed model.
  Editor hydration in `src/editor-client/hydrate-interactives.ts` now dispatches
  dynamically via a typed `EDITOR_REGISTRY` mapping of
  `RUNTIME_HYDRATOR_SURFACES`. Visitor hydration in `src/interactive/runtime.ts`
  generates its dispatch loop dynamically from the exact same surface list,
  eliminating duplicate dispatch code paths, though the underlying visitor
  string fragments and TS editor adapters remain separate implementation nodes.

User-visible miss:

- Every new premium interaction doubles the chance that the editor preview and
  published site drift.
- Template authors cannot trust a behaviour unless both runtimes and their
  parity tests are updated.

Needed primitive:

- One interaction runtime source that can be consumed by both visitor output
  and editor preview. The shared registry mapping slice in
  `RUNTIME_HYDRATOR_SURFACES` and `EDITOR_REGISTRY` partially resolves this by
  sharing dispatch/registry layers; underlying visitor string fragments and TS
  editor adapters remain separate implementation nodes.

### 14. Motion Authoring UX Is Too Thin

Current state:

- Element inspector exposes Motion Preset, delay, and replay.
- Section inspector exposes Entrance Preset and Popup Trigger.
- The Interactions sidebar tab exposes Load Experience, Route Transition,
  Overlays, and Motion Sequence Lite step lists.
- Full Motion Sequence cards include a Timeline overview with visual bars,
  target lanes, snap handles, scrub preview, draggable start-time bars for step
  start/duration, and timeline-adjacent quick property controls for opacity,
  transform, filter values, advanced properties, target binding, repeat, and
  playback direction.

User-visible miss:

- Template authors can inspect, scrub, reposition, resize, and edit common
  transform/opacity/filter properties and target binding directly beside the
  timeline overview.
- Long sequences still require field-level editing for less common per-step
  details and multi-step visual choreography.

Needed primitive:

- A Motion panel that shows triggers, targets, sequence steps, delays, preview,
  replay, reduced-motion state, and validation errors in one place.

### 15. Nav Theme On Scroll Was Template-Only

Current state:

- **June 2026 update:** sections can carry `navThemeTarget`, nav elements can
  enable `themeOnScroll`, and the renderer emits explicit
  `data-opencanvas-nav-theme-*` metadata. The behaviour payload hydrates the
  relation through the Runtime Hydrator in both visitor and editor preview.
- Validation rejects unsupported theme tokens and reduced-motion modes instead
  of letting malformed scroll-theme relations publish.
- The section inspector exposes the target selector; the nav inspector exposes
  enable/default-theme/reduced-motion controls.
- **June 2026 update:** Nav Component Style now includes bounded recipe
  presets (`glass-float`, `race-strip`, `editorial-tabs`). The recipe is stored
  as schema-owned `navStyle.recipe`, validation rejects unsupported values,
  renderer/editor preview emit explicit metadata and class hooks, and visitor
  and editor CSS share the same recipe selectors.

User-visible miss:

- Owners can now reproduce designer-site nav inversion across scroll regions
  without custom JavaScript.
- Remaining next wave: richer token catalog and visual preview controls for
  reduced-motion media queries.

Needed primitive:

- Nav Theme On Scroll remains a schema-owned relation: section target signal ->
  nav theme state. Do not replace it with arbitrary scroll listeners or raw CSS
  snippets.
### 16. Smooth Scroll Was Native-Only

Current state:

- **June 2026 update:** `scrollBehavior` now owns native and inertial scroll modes.
  Inertial mode emits explicit `data-opencanvas-smooth-scroll` metadata, a
  `smoothScroll` behaviour payload, Runtime Hydrator execution, Yjs projection,
  validator gates, and Interactions panel controls. Reduced-motion handling is
  authored as `native` or `disabled` and is marked on the document rather than
  degrading silently.
- Browser-native smooth scrolling remains available through the same
  `scrollBehavior` node for existing sites.

Needed primitive:

- Smooth Scroll remains a schema-owned relation from site scroll intent ->
  Runtime Hydrator execution. Do not replace it with Lenis API calls or raw
  owner-authored scripts.

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
8. **Import animation inventory.** 2026-06-19 update: imported animation facts are preserved as `importAnimationInventory` with mapped Open Canvas primitives or explicit unsupported findings. The importer no longer silently drops invalid source motion presets; richer coverage still depends on scraper source facts for duration/easing/trigger/property metadata.
   Once the runtime vocabulary exists, import
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

### 17. Overlay v2 Fullscreen Menu Presentation

Status: addressed for the schema-owned fullscreen menu presentation and choreography slices. Owners can set an Overlay presentation to `fullscreen-menu`, choose bounded choreography presets (`none`, `stagger-rise`, `mask-sweep`, `slide-stack`), set explicit choreography reduced-motion behaviour, keep authoring the content through the existing `Overlay.content` Canvas Section, preview it from the Interactions panel, and publish explicit overlay presentation/content-canvas/choreography metadata consumed by the Runtime Hydrator. Unsupported presentation or choreography modes now fail validation instead of degrading to modal behaviour.

Intentional deferral: richer nested overlay-canvas editing affordances remain outside this slice; Motion Sequence Lite can still animate the overlay surface/backdrop for custom sequencing. Later chrome and layout slices added bounded overlay chrome/backdrop/close placement and layout presets without introducing raw CSS blobs.

### 18. Collection Gallery v2 Hover Reveal Detail

Status: addressed for the schema-owned Collection gallery v2 slice. A Collection can now opt into `gallery.mode = hover-reveal-detail` with explicit inline detail and reduced-motion policies, or `gallery.mode = drag-slider` with owner-authored axis, inertia, and progress-dot policy. Collection Search adds an owner-authored search relation with placeholder/empty-state copy and explicit reduced-motion policy. Collection filter chips add owner-authored field/options/default policy backed by materialized entry metadata. Collection view toggles add owner-authored grid/list active-state switching. The renderer emits collection/entry/search/filter/view metadata, the Runtime Hydrator owns active-entry, progress-dot, drag-slider offset, search visibility, filter visibility, and active view state, the inspector exposes owner controls, Yjs preserves the gallery/search/filter/view policy, and invalid gallery, slider, search, filter, or view relations fail validation.

Intentional deferral: this does not add a 3D helmet viewer, editorial workflow manager, drafts/scheduling UI, or marketplace media inventory; gallery entries continue to be materialized Collection content and can compose existing media/text/card primitives.

### 19. Iframe Drill-in Overlay

Status: addressed for the schema-owned Embed drill-in slice. Embed elements can opt into `drillInEnabled` with an explicit reduced-motion policy; render output emits drill-in metadata and a keyboard-accessible trigger, the Runtime Hydrator opens a controlled fullscreen iframe shell, invalid reduced-motion values fail validation, and the generic inspector exposes the owner controls.

Intentional deferral: this does not reintroduce legacy popup-section click wiring. Owners who need authored overlay content beyond the iframe should use the schema-owned Overlay primitive.

### 20. Component Style Wave 2 — Action Buttons

Status: addressed for the Action + Nav style slices. `ActionElement` now owns sparse `actionStyle` fields for modeled button chrome, including explicit border color/width shorthand and compound X/Y padding controls. `NavElement` now owns sparse `navStyle` fields for nav surface, link, wordmark, slot gap, and primary CTA chrome. The generic Component Style inspector exposes the controls, validator gates unknown fields and pinnedStyle conflicts, Yjs preserves the objects, agent patches can set them, and style-kit variants consume the modeled variables so Component Style wins without raw CSS.

Intentional deferral: broader per-component style waves remain separate slices. This wave deliberately avoids widening pinnedStyle or adding arbitrary owner CSS.
