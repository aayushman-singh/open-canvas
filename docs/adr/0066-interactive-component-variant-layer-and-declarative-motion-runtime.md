# ADR 0066 — Interactive components gain the variant-preset layer, and pointer-reactive variants are powered by one fragment in the existing interactive runtime

**Status:** Accepted
**Date:** 2026-06-10 (accepted 2026-06-11)
**Author:** Aayushman Singh
**Implementing commit:** `47eb4cb6` (branch `feat/v4-variant-layer`)

## Context

The system already has two distinct styling layers, and they are applied unevenly across element types.

**The preset layer.** Action, container, and shape elements each carry a single `variant` enum — `ACTION_VARIANTS` (solid / outline / ghost / pill / glass / brutalist / underline), `SURFACE_VARIANTS` (flat / raised / glass / outlined / sticker / editorial-frame / soft-panel), `SHAPE_VARIANTS` (rect / pill / circle / line / badge / blob / icon) at [`src/canvas/schema.ts:56-79`](../../src/canvas/schema.ts#L56-L79). The renderer emits the chosen value as `data-variant="<x>"` ([`src/canvas/elements/action.ts:68-82`](../../src/canvas/elements/action.ts#L68-L82)) and a block of CSS in [`src/canvas/public-styles.ts`](../../src/canvas/public-styles.ts) paints the whole look from that one attribute. The Owner picks one dropdown value and gets a complete, designed result.

**The granular layer.** Every element carries `elementStyle` (background, border, radius, shadow, opacity, color) and `pinnedStyle` (arbitrary CSS custom-property overrides) at [`src/canvas/schema.ts:296-345`](../../src/canvas/schema.ts#L296-L345). Some components add a bespoke style object on top — `FormStyle` exposes 19 knobs at [`src/canvas/elements/form.ts:53-81`](../../src/canvas/elements/form.ts#L53-L81), serialised to `--opencanvas-form-*` CSS variables.

The interactive components — **form, carousel, accordion, tabs** — have the granular layer but **no preset layer**:

- **Accordion** ([`src/canvas/elements/accordion.ts`](../../src/canvas/elements/accordion.ts)) — zero visual variation. Semantic markup, one hard-coded `+`/`−` chevron, no `variant` field at all.
- **Tabs** ([`src/canvas/elements/tabs.ts`](../../src/canvas/elements/tabs.ts)) — a tab bar with no designed looks; only `tabBarHeight` is tunable.
- **Carousel** ([`src/canvas/elements/carousel.ts:82-92`](../../src/canvas/elements/carousel.ts#L82-L92)) — has `arrowPosition` / `arrowStyle` / `mode`, but those are mechanical knobs, not holistic looks.
- **Form** — has 19 granular `FormStyle` knobs but no opinionated preset, so reaching a polished result means hand-tuning every one.

The Owner-facing ask that surfaced this: **"let me add a form, carousel, accordion, or tabs and pick from at least three designed looks — the kind modern UI libraries ship — and have it look polished instantly, while still being able to fine-tune individual CSS underneath."** A button has this affordance today; an accordion does not. The gap is not that the interactive components are unstylable — it is that they have no *preset* layer, only the raw-knobs layer, so "designed look" is reachable only by labour.

A second constraint falls out of the reference looks. The library presets the Owner is pointing at (Aceternity-class) lean on pointer- and scroll-driven motion — a card that lights up under the cursor, a slide that drifts as it enters view, a panel that tilts. The render pipeline today is CSS-first with **one shared interactive runtime** injected once per snapshot ([`src/interactive/inject.ts`](../../src/interactive/inject.ts)), assembled from per-concern fragments (`ACCORDION_RUNTIME_SRC`, `CAROUSEL_RUNTIME_SRC`, `POPUP_RUNTIME_SRC`) concatenated into a single IIFE ([`src/interactive/build.ts`](../../src/interactive/build.ts)) and dispatched by the `data-opencanvas-interactive` attribute value ([`src/interactive/runtime.ts`](../../src/interactive/runtime.ts)). There is no per-element script and no provision for pointer/scroll state. A class of the requested looks cannot be reached by CSS alone; the runtime has to grow to publish that state — but it must grow without forking into a per-component pile of motion scripts.

Three shapes for the preset layer competed:

- **(A)** Give each interactive component its own bespoke styling fields (more `FormStyle`-like objects, a `CarouselStyle`, an `AccordionStyle`). Honest about each component's surface; but it multiplies the granular layer instead of adding the missing preset layer, leaves the Owner hand-tuning, and never delivers the "pick one, done" affordance the ask is about.
- **(B)** Extend the *existing* `variant` → `data-variant` → CSS preset mechanism — the one already proven on action/container/shape — to the four interactive components, keeping the granular layer beneath as the override. One conceptual mechanism, applied uniformly.
- **(C)** Build a separate "templates / theme" system that snapshots a bundle of granular values per component. Reintroduces a parallel styling vocabulary the Owner has to learn alongside variants, and couples presets to specific granular field sets so a new knob breaks old presets.

(B) is the choice. (A) deepens the wrong layer; (C) forks the styling vocabulary. (B) reuses the renderer's `data-variant` emission, the inspector's `select` field kind, the agent tool's enum pattern, and the `public-styles.ts` selector block — every consumer already knows this shape.

## Decisions

1. **Each interactive component — form, carousel, accordion, tabs — gains a single `variant` field of a component-specific closed enum, rendered as `data-variant="<value>"` on the component's existing root element and painted by a dedicated CSS block in `public-styles.ts`. This is the same preset mechanism action/container/shape already use; no new styling primitive is introduced.**

   **Why:** the preset layer is proven and load-bearing for three element types already, and the *only* reason the interactive components feel basic is that they never received it. Reusing `variant` / `data-variant` / a `public-styles.ts` selector block is the minimally complex way to close the gap — one mechanism the renderer, inspector, agent tool, and stylesheet all already speak. Inventing a second preset system (or deepening the per-component granular objects) would add nodes that duplicate an existing path. This would be wrong if the interactive components needed presets that *could not* be expressed as "one attribute selects a stylesheet block" — e.g. presets that change the DOM structure, not just its painting. Carousel `mode` already proves structural variation belongs in its own field; the `variant` field is strictly for look. The precise rule: **a variant never changes the markup the render fn emits; where a look needs spatial or input state that CSS cannot derive on its own, the runtime publishes that state as a CSS custom property and the variant CSS paints from it** (the same runtime-publishes-state / CSS-paints split decision 4 uses for pointer-fx, and decision 3's `coverflow` uses for per-slide offset). What a variant must never do is branch the rendered DOM per arm.

2. **A variant sets the base look; the granular layers override it. The resolution order is: style-kit token (lowest) < variant < granular override (highest). A variant never writes into the granular fields and a granular tweak never rewrites the variant — they compose at the CSS cascade, not at the data layer. The mechanism that makes this uniform across all four components: a variant never hard-codes a value it wants the Owner to be able to override. Every overridable value flows through a component-scoped CSS custom property (`--opencanvas-accordion-header-bg`, `--opencanvas-tab-active-fill`, `--opencanvas-form-input-radius`, …); the variant arm only *sets* those properties, and the inner-part CSS reads `var(--prop, <kit-token fallback>)`. The Owner's override path is `pinnedStyle` on the root today (custom properties inherit to inner parts, and an inline `pinnedStyle` declaration beats the stylesheet `[data-variant]` declaration, so the Owner's value wins) and richer per-component style objects later — both drive the same properties without touching the variants.**

   **Why:** the Owner asked for both "instant polish" and "full CSS control," and those are only simultaneously true if the two layers stack rather than replace. The custom-property rule is what makes the stack work *uniformly* — without it, the cascade is real only for Form, which already exposes 19 `--opencanvas-form-*` properties reaching its inner parts, while accordion / carousel / tabs expose only root-level `elementStyle`, which cannot reach an accordion header or a tab button. Authoring every variant against component-scoped properties means "pick `accordion: cards`, then recolour the header" is expressible (override `--opencanvas-accordion-header-bg` via `pinnedStyle`) instead of take-it-or-leave-it. It also keeps the data model honest — switching variants does not stomp the Owner's hand-set values, and clearing a hand-set value falls back to the variant, then to the kit token, never to bare browser default. The cost is deliberately accepted: variant CSS is more verbose because every overridable value is a `var()`, exactly as `FormStyle` already is. This would be wrong if a variant needed to *force* a property the Owner must not override; no requested variant does — the override is, by definition, what the Owner asked for, so it wins.

3. **Each component ships a curated, closed enum of at least four variants, each named for the look it produces — never for the library it was borrowed from. The first arm of every enum reproduces the component's current look verbatim and is the default, so existing snapshots render byte-identically until an Owner opts into another variant.**

   **Why:** "at least three designed looks" is the Owner's explicit bar, and a closed enum (not a free-form string) keeps the catalog coherent with the kit system, keeps the agent tool's enum bounded and self-documenting, and lets the inspector render a plain `select`. Naming arms conceptually (`underline`, `cards`, `coverflow`) rather than by source (`aceternity-spotlight`) follows the ADR authoring rule that decisions name *what* the system does, and means swapping the CSS implementation later does not strand a misleadingly-named arm. Making the first arm the current look, defaulted, is what guarantees this ADR is purely additive — no migration, no visual diff on any published site, until the Owner acts. The proposed initial catalogs (subject to refinement during implementation, but at least four each):

   - **Form** — `classic` (current default), `underline` (borderless, bottom-rule inputs, floating labels), `card` (each control on a raised surface, soft shadow), `brutalist` (thick borders, hard offset shadow, mono labels), `spotlight` (`card` plus a pointer-follow glow — *pointer-fx*, see decision 4).
   - **Carousel** — `classic` (current crossfade/paginate look), `coverflow` (adjacent slides peek and scale; the carousel runtime fragment publishes a per-slide `--opencanvas-slide-offset` from each slide's distance to the active index, and coverflow CSS positions/scales/dims from it — runtime publishes state, CSS paints, no DOM branch), `ken-burns` (slow CSS zoom on the active slide), `editorial` (full-bleed slide with a gradient caption scrim).
   - **Accordion** — `list` (current minimal), `bordered` (hairline-separated rows), `cards` (separated rounded cards with gap), `filled` (filled header bars that animate open).
   - **Tabs** — `underline` (animated active underline), `pill` (rounded active pill), `segmented` (enclosed segmented-control group), `vertical-rail` (tab bar on the leading edge).

   **Why these counts and not an open vocabulary:** a bounded set is what keeps every downstream consumer (validator enum check, inspector `select` options, agent-tool `enum`, the `public-styles.ts` block) finite and exhaustively testable. This would be wrong if Owners needed to author *their own* named variants; they do not — the granular layer (decision 2) already covers arbitrary per-instance looks, and a user-authored-variant system is a separate, larger ask (a "save this styling as a reusable variant" feature) deferred below.

4. **Pointer-reactive variants are driven by one new fragment *inside the existing interactive-runtime IIFE* (`src/interactive/build.ts`), alongside the accordion / carousel / popup fragments — not a new `<script>` and not a third runtime. The fragment reads a declarative `data-opencanvas-pointer-fx="<primitive>"` attribute and publishes pointer state as CSS custom properties on the element; the variant's CSS consumes that state. There is no per-component pointer script. The initial primitives are `spotlight` (publishes `--opencanvas-ptr-x` / `--opencanvas-ptr-y` from `pointermove`) and `tilt` (publishes `--opencanvas-tilt-x` / `--opencanvas-tilt-y` from pointer position). Scroll-triggered and entrance motion are explicitly NOT part of this fragment — they are already owned by the `motion.preset` + `data-scroll-trigger` system (`MOTION_PRESETS`, the `on-scroll` IntersectionObserver in `src/routes/public.ts`), and any variant wanting scroll-reveal composes with that existing system rather than getting a new mechanism.**

   **Why:** the codebase already owns the word "motion" — `MOTION_PRESETS` ([`src/canvas/schema.ts:81-100`](../../src/canvas/schema.ts#L81-L100)) is 17 entrance/scroll presets (`fade-up`, `slow-drift`, `parallax-soft`, `stagger-children`…) with a live `on-scroll` IntersectionObserver runtime. The genuinely missing capability is *pointer-reactive* motion: nothing in `MOTION_PRESETS` reacts to cursor position, because all 17 are time- or scroll-triggered. Naming the new concern `pointer-fx` (not "motion") keeps the glossary unambiguous and prevents a duplicate node — an earlier draft proposed a `reveal` primitive that was simply the existing `on-scroll` system re-invented, and it is cut. Pointer state cannot be read by CSS, so a small JS publisher is unavoidable; making it *one fragment that only publishes state and never paints* keeps the interactive runtime's existing "one fragment per concern" shape and leaves all painting in the variant CSS. Keying off `data-opencanvas-pointer-fx` (rather than element type) lets any element — a button, container, or form — opt into `spotlight` without the runtime knowing its type, matching the attribute-driven dispatch the runtime already uses for `data-opencanvas-interactive`. This would be wrong if pointer-fx needed per-element bespoke logic beyond "publish vars, let CSS react"; the initial two are each a stateless mapping from a pointer event to a CSS variable.

5. **Runtime injection trips on the presence of any `data-opencanvas-pointer-fx` attribute in the snapshot, in addition to the existing interactive-element-type scan. The `snapshotNeedsInteractiveRuntime` walk widens so that an element carrying a pointer-fx variant (including a non-interactive element such as a button with `spotlight`) injects the interactive IIFE.**

   **Why:** injection today keys purely off element *type* (`INTERACTIVE_ELEMENT_TYPES` at [`src/interactive/inject.ts:34-37`](../../src/interactive/inject.ts#L34-L37)), on the assumption that only accordions and carousels need JS. Pointer-fx variants break that assumption — a button with a spotlight effect needs the runtime but is not an "interactive element type." If the scan did not widen, that button would render its static base but the effect would silently never hydrate. Per the all-or-nothing stance, a promised effect that silently never runs is a broken contract, not an acceptable degrade, so the trigger must detect pointer-fx as a first-class injection reason. This would be wrong if pointer-fx variants were guaranteed to only ever appear on already-interactive elements; decision 4 deliberately allows pointer-fx on any element, so they are not.

6. **Pointer-fx is strictly additive over a complete static variant. Every pointer-fx variant is defined as a fully-formed static look *plus* a pointer-driven enhancement; when the fragment does not run (script blocked, hydration not yet fired), the element shows its authored static base. That static base is part of the variant's definition and is authored and smoke-tested deliberately — it is not a fallback the system silently substitutes.**

   **Why:** this is the no-fallbacks stance applied to progressive enhancement. The distinction the project draws is between a *silent degraded mode the system guesses at* (forbidden) and an *explicitly authored behaviour for a named condition* (acceptable, when loud). A pointer-fx variant's static base is the latter: it is the same designed look minus the cursor reaction, specified in the variant's CSS and covered by the variant's smoke, so "JS absent → static base" is a defined, tested state, not an accidental half-rendered widget. Concretely, `spotlight`'s base is the `card` look with a fixed centred glow; the pointer-follow is the enhancement. This would be wrong if a pointer-fx variant's *only* value were the cursor reaction — if the static base looked broken or unfinished. The rule that forbids that: a variant whose static base is not itself a shippable look does not qualify as a variant and must not enter the enum.

## Out of scope

- **User-authored variants.** Owners cannot define and name their own variants in this ADR. The granular layer (decision 2) already covers arbitrary per-instance looks; a "save this styling as a reusable named variant" feature is a separate, larger ask tracked in Follow-ups.
- **Pointer-fx primitives beyond `spotlight` / `tilt`.** Further cursor-reactive primitives (e.g. magnetic-pull, pointer-trail) are not in the initial set. They slot in as additional `data-opencanvas-pointer-fx` values without changing this ADR's shape.
- **Scroll / entrance motion.** Reveal-on-scroll, parallax, and entrance animation are owned by the pre-existing `motion.preset` + `data-scroll-trigger` system (`MOTION_PRESETS`), not by this ADR. A variant wanting scroll-reveal composes with that system; this ADR adds no scroll mechanism and re-invents none.
- **Per-variant DOM branching.** No variant changes the markup the render fn emits. Where a look needs spatial or input state CSS cannot derive (carousel `coverflow` offsets, pointer-fx cursor position), the runtime publishes that state as a CSS custom property and the variant CSS paints from it — the render output is identical across arms. A variant that genuinely needs *different markup* is a render-level decision needing its own ADR.
- **Style-kit-level variant defaults.** Whether a style kit can declare "all accordions in this kit default to `cards`" is not decided here; the per-element default stays the `classic`/`list`/`underline` first arm. Kit-level variant defaults are a Follow-up.
- **Migrating existing snapshots onto new variants.** No published site changes. Every component's default is its current look, byte-identical, until an Owner opts in.
- **Replacing or removing `FormStyle` / carousel arrow knobs.** The granular layer stays exactly as-is; variants layer over it. No granular field is deprecated by this ADR.

## Consequences

### Schema

- New optional `variant` field on `FormElement`, `CarouselElement`, `AccordionElement`, `TabsElement`, each typed to a new component-specific `*_VARIANTS` const tuple exported alongside the element interface (mirroring `ACTION_VARIANTS`). Absence resolves to the first arm (the current look), so the field is optional and back-compatible.
- New `*_VARIANTS` tuples and `*Variant` types in each element module.

### Validator

- Each element's validator gains a variant-enum membership check (reusing the existing enum-validation pattern action/container/shape already use). An unknown variant fails loudly per the write-gate rule (ADR 0012).

### Renderer

- Each component's render fn emits `data-variant="<value>"` on its root (defaulting to the first arm when the field is absent) and, for pointer-fx variants, the corresponding `data-opencanvas-pointer-fx="<primitive>"` attribute.
- `public-styles.ts` gains one selector block per component variant set. Inner-part CSS reads every overridable value as `var(--opencanvas-<component>-<part>-<prop>, <kit-token fallback>)`; each `[data-variant="x"]` arm only *sets* those custom properties (decision 2's cascade). New `--opencanvas-accordion-*`, `--opencanvas-tabs-*`, and `--opencanvas-carousel-*` custom-property namespaces are introduced to mirror the existing `--opencanvas-form-*` namespace.

### Interactive runtime

- New `src/interactive/pointer-fx.ts` fragment exporting `POINTER_FX_RUNTIME_SRC` with a `hydratePointerFx` pass that scans `[data-opencanvas-pointer-fx]` and wires `pointermove` listeners publishing `--opencanvas-ptr-x/y` and `--opencanvas-tilt-x/y` CSS custom properties. No IntersectionObserver — scroll-reveal stays with the existing `motion.preset` system.
- `build.ts` concatenates the pointer-fx fragment into the *existing* IIFE; `runtime.ts`'s `hydrateAll` runs the pointer-fx pass (document-wide, not per-`data-opencanvas-interactive` root) alongside the existing per-root dispatch. No new `<script>` tag.
- The existing carousel fragment (`src/interactive/carousel.ts`) gains per-slide offset publishing: on each slide change it sets `--opencanvas-slide-offset` on every slide from its distance to the active index, so the `coverflow` variant CSS can position/scale/dim neighbours. This rides the active-index tracking the fragment already does.
- `inject.ts` widens `snapshotNeedsInteractiveRuntime` to also return true on any `data-opencanvas-pointer-fx`-bearing element (decision 5).

### Yjs projection (co-edit)

- Each new `variant` field round-trips through `src/canvas/yjs-projection.ts` under the existing `decodeYDoc(encodeYDoc(state)) deepEqual state` invariant, mirroring the per-type `out.set('variant', el.variant)` / `map.get('variant')` pattern action/shape/container already use ([yjs-projection.ts:396,413,422](../../src/canvas/yjs-projection.ts#L396) encode, [:1108+](../../src/canvas/yjs-projection.ts#L1108) decode). The per-element encoders/decoders for form, carousel, accordion, and tabs each gain the `variant` leaf.
- Pointer-fx is not separate editable state — it is derived from the chosen variant by the renderer, so nothing extra is encoded for it.
- Concurrent edits to `variant` are last-writer-wins on the element map, consistent with how `variant` already behaves on action/shape/container; no per-field CRDT is introduced.

### Editor

- Each component's `InspectorSpec` gains a `{ kind: 'select', label: 'Style', path: 'variant', options: *_VARIANTS, defaultValue: <first arm> }` field — the same `select` field kind action already uses for its variant.
- No new inspector field kind is required.
- **Runtime mirror obligation.** The editor renders its canvas through `body-builders-data.ts` and hydrates it with the TS-native mirror in `src/editor-client/hydrate-interactives.ts`, which by contract mirrors every visitor runtime fragment line-by-line. So this ADR's two runtime additions must be mirrored there for faithful live preview: (a) a new pointer-fx pass wired into the editor's post-`renderAll` hook (pointer-fx is a document-wide `[data-opencanvas-pointer-fx]` scan, not a `data-opencanvas-interactive` dispatch `case`, so it is a new pass, not a new arm), and (b) the carousel `--opencanvas-slide-offset` publishing added to the editor's `hydrateCarousel`. Without the mirror the canvas silently diverges from the published site — unacceptable for a design tool whose whole value is seeing the chosen look.

### Agent tool

- Each component's `AgentToolSpec` gains a `variant` property with `enum: [...*_VARIANTS]`, parsed in `parsePatch` exactly like `action`'s `variant`.

### Smokes

- New per-component variant smokes asserting: render emits the right `data-variant` (and `data-opencanvas-pointer-fx` where applicable) for each arm, the default arm is visually the current look, and the validator rejects unknown variants.
- New pointer-fx smoke asserting `hydratePointerFx` publishes the expected `--opencanvas-ptr-*` / `--opencanvas-tilt-*` custom properties and that `inject` trips on a `data-opencanvas-pointer-fx` attribute with no interactive element present.
- New parity smoke asserting the editor mirror (`hydrate-interactives.ts`) and the visitor fragment agree on the pointer-fx and carousel-offset contracts — extending the existing `carousel-hydration.smoke.ts` that already guards the mirror — so the two implementations cannot drift silently.
- All wired into the `ci:smoke` chain.

## Implementation notes (2026-06-11)

Shipped on branch `feat/v4-variant-layer` (see `DECISIONS_V4.md`):

- Variant tuples + optional `variant` field on `FormElement` / `CarouselElement`
  / `AccordionElement` / `TabsElement`, re-exported via `elements/index.ts`.
- Render emits `data-variant` on each component root (default = first arm);
  Form `spotlight` also emits `data-opencanvas-pointer-fx="spotlight"`.
- `public-styles.ts` variant CSS block (custom-property cascade, first arm =
  current look); validator enum checks per component; Yjs `variant` leaf
  round-trips; inspector `Style` select + agent-tool `enum` per component.
- `src/interactive/pointer-fx.ts` fragment (`spotlight`, `tilt`) added to the
  existing IIFE; `inject.ts` widened to trip on `data-opencanvas-pointer-fx`;
  carousel runtime publishes `--opencanvas-slide-offset` for `coverflow`. Editor
  mirror (`hydrate-interactives.ts`) mirrors the pointer-fx pass + slide-offset.
- Smokes: `variant-presets`, `pointer-fx`, `variant-parity` (+ yjs/inspector
  fixtures), all wired into `ci:smoke` (green), `typecheck` + `lint` green.

**Catalogued arms** (dec 3, finalised): Form `classic`/`underline`/`card`/
`brutalist`/`spotlight`; Carousel `classic`/`coverflow`/`ken-burns`/`editorial`;
Accordion `list`/`bordered`/`cards`/`filled`; Tabs `classic`/`underline`/`pill`/
`segmented`. (The draft catalog's `vertical-rail` tab arm was dropped during
implementation — the tab panels carry an inline full-width box a CSS-only rail
cannot reflow; see the codex follow-up below. The draft's Tabs first arm was
`underline`, but the actual current look is a filled active-tab pill, so the
first/default arm is `classic` and `underline` is a real alternate.) The `tilt`
pointer-fx primitive is implemented + smoke-tested but not yet attached to a
catalogued arm (available for a future arm; see DECISIONS_V4 D5).

**Cascade (dec 2) note.** The variant VAR-SETTING arms are emitted on the OUTER
`.opencanvas-element` wrapper (`render.ts variantAttr`), the same element
`pinnedStyle` lands on, so an inline `pinnedStyle` override beats the stylesheet
arm and `formStyle` (inline on the inner `<form>`) beats the variant — kit <
variant < granular holds. (Setting the vars on the inner component root, as the
first cut did, lost to `pinnedStyle` by proximity; fixed per codex review.)

## Follow-ups

- **Editor static-variant CSS preview parity.** The editor preview maintains its
  own hand-written stylesheet (`src/editor-client/styles-build.ts`, ~3k lines)
  with preview-specific class names (`opencanvas-form-preview`,
  `opencanvas-accordion-preview`) rather than loading `canvasPublishedStyles`.
  This wave emits `data-variant` (+ pointer-fx) on the editor builder nodes and
  mirrors the *runtime* (pointer-fx + slide-offset), so the Owner's choice
  persists, hydrates, and publishes correctly — and a publish-preview shows each
  arm. Mirroring every static arm's CSS into the editor stylesheet (re-
  parameterising preview-class inner CSS with the same custom-property cascade)
  is deferred to its own change to avoid a large, regression-prone edit to the
  live editor's stylesheet. Tracked loudly here rather than left as a silent gap.
- **`vertical-rail` tabs.** Dropped from the catalog this wave: the tab panels are sized with an inline full-width box (`renderTabs` writes `width: <box.w>px`), which a CSS-only leading-edge rail cannot reflow without making panel sizing CSS-owned. Re-introduce once tab layout exposes width as a variable both the visitor and editor honour.
- **Live-broadcast re-hydration.** The `/__live` publish broadcast swaps HTML via `innerHTML`, whose inline scripts do not execute, so post-broadcast DOM is not hydrated. This is pre-existing (it already affects accordion/carousel/popup, which share the one-shot `hydrateAll` IIFE); ADR 0066's pointer-fx + slide-offset inherit it. The fix — expose an idempotent global re-hydrator the broadcast handler invokes — benefits every interactive and belongs with the runtime-dedup follow-up below.
- **User-authored variants.** A "save current styling as a named, reusable variant" feature — the open-vocabulary counterpart to this ADR's closed enums. Needs its own ADR; touches storage (where do user variants live?) and the inspector.
- **Additional pointer-fx primitives.** Magnetic-pull, pointer-trail, and similar cursor-reactive effects as further `data-opencanvas-pointer-fx` values, each additive.
- **Kit-level variant defaults.** Letting a style kit set the default variant per component, so a kit ships a coherent interactive look out of the box.
- **Variant preview in the inspector.** Rendering a thumbnail per variant in the `select` (the picker is text-only today); depends on the inspector gaining a preview-capable field kind.
- **Richer per-component style objects.** Today the granular override for accordion / carousel / tabs is `pinnedStyle` driving the new component-scoped custom properties. A future ADR can add typed `AccordionStyle` / `CarouselStyle` / `TabsStyle` objects (mirroring `FormStyle`) with inspector knobs that drive the same properties — no change to the variants, which already read them.
- **Collapse the visitor/editor runtime duplication.** The interactive runtime exists twice — visitor source-strings in `src/interactive/` and the TS mirror in `src/editor-client/hydrate-interactives.ts` — kept in sync by hand because of the worker-typed vs DOM-typed tsconfig split. This ADR widens that duplication (pointer-fx + carousel offset land in both). Collapsing it to a single source of truth is a pre-existing smell worth its own refactor ADR; the parity smoke above is the interim guard.

## References

- [ADR 0011](0011-canvas-element-registry.md) — the per-element registry pattern the new variant fields, inspector specs, and agent specs slot into.
- [ADR 0012](0012-validation-write-gate.md) — validator is the only write gate; the variant-enum membership check lands there and fails loudly.
- [ADR 0051](0051-action-expressiveness-rich-labels-icons-copy-container-links.md) — establishes the `variant` → `data-variant` → CSS preset pattern on the action element that this ADR extends to the interactive components.
- [ADR 0052](0052-tabs-as-element-with-embedded-panels.md) — defines the tabs element this ADR adds a variant layer to.
- [ADR 0054](0054-layout-v2-sticky-positioning-drill-in-overlay-scroll-snap-rail.md) — establishes carousel `mode` as the structural (not stylistic) knob; this ADR's carousel `variant` is the stylistic complement and does not touch `mode`.
- [ADR 0057](0057-canvas-element-dispatch-shape.md) — the render / inspector / agent-tool dispatch registries every consumer of the new variant field flows through.
