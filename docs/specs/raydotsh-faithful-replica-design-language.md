# Raydotsh Faithful Replica Design-Language Gaps

**Status:** Proposed design-language backlog
**Date:** 2026-06-20

## User-Visible Done State

An Owner starts from the Raydotsh Portfolio Template Seed and gets a site that a
Visitor recognizes as the source portfolio's experience, not merely its content
order. The first load should feel like a mint-on-navy developer/writer
portfolio: the greeting types in, the ASCII portrait assembles and reacts to the
pointer, sections reveal with a steady rhythm, the side anchor rail is present on
desktop, projects and books keep their responsive layouts, and the optional robot
game mode behaves like a contained mini-game layered over the portfolio.

The current `raydotsh-portfolio` Template Seed is useful but not faithful. A
Visitor sees the right broad sections and source media, but the most distinctive
source behaviours are either static approximations or omitted.

## Why This Exists

The Raydotsh conversion exposed a narrower problem than the general designer
template fidelity catalogue: Open Canvas can compose a credible static portfolio,
but it cannot yet express several small, source-specific behaviours as
builder-owned vocabulary. If those behaviours are copied as raw React or custom
scripts, the editor cannot inspect them, validation cannot reject broken
relations, and published/editor runtime parity becomes guesswork.

The product problem is therefore: "which Open Canvas nodes and directed
relations are missing before this source can be converted faithfully without
leaving the schema-owned builder model?"

## Success Criteria

- The Raydotsh template can be described as faithful only when every listed
  source behaviour is either represented by an existing primitive, represented by
  a new builder-native primitive, or explicitly rejected as out of scope.
- Existing primitives are reused when they already cover the behaviour:
  `MotionSequence`, `RichMotionAsset`, `RouteTransition`, `Action.iconKind`,
  `tabsStyle`, `scrollBehavior`, `pointerFx`, `responsive`, and site metadata.
- New primitives define schema shape, validation, editor inspector controls,
  editor preview, published runtime, reduced-motion policy, failure behaviour,
  and smokes before any template claims the behaviour.
- Unsupported source behaviours fail loudly during template smoke or import
  reporting. They are not silently downgraded to static sections.
- The Raydotsh template remains a Template Seed composed from Section Library
  entries and seed assets. No raw source React component, source CSS bundle, or
  arbitrary custom script becomes the template answer.

## Non-Goals

- Re-polishing the current static approximation.
- Embedding `AsciiPortrait.jsx`, `RobotGame.jsx`, MUI components, Bootstrap
  components, or source CSS files directly in a Template Seed.
- Adding an arbitrary game runtime or arbitrary JavaScript escape hatch.
- Solving all portfolio, animation, or website-import fidelity gaps.
- Changing the Section Library composition model from ADR 0061.
- Copying source assets whose license or permission has not been cleared.

## Hard Constraints

- Existing Section Library and Template Seed composition stay canonical.
- New behaviour must be schema-owned, validator-owned, editor-previewed, and
  published through the Runtime Hydrator.
- Reduced motion must be an explicit authored policy, not an incidental browser
  outcome.
- Missing assets, unresolved behaviour targets, unsupported modes, and runtime
  initialization failures must throw or emit named failure events with enough
  context to debug.
- No fallback approximations: if a primitive cannot render faithfully, the
  template smoke or import report must say so.
- Design-language names must be conceptual, not implementation-branded.

## Source Evidence

Source repository inspected locally:

- `C:/Users/Aayushman/AppData/Local/Temp/raydotsh.github.io`

Important source files:

- `src/App.jsx`: two routes, fixed game toggle, side navigation, game overlay.
- `src/components/Intro.jsx`: typewriter greeting and ASCII portrait mount.
- `src/components/AsciiPortrait.jsx`: canvas particle portrait with pointer
  repulsion and responsive particle density.
- `src/components/RobotGame.jsx`: fixed canvas platformer overlay with keyboard
  input, DOM-derived collision surfaces, collectibles, win/death state, and
  resize handling.
- `src/components/FadeInSection.jsx`: IntersectionObserver reveal wrapper with
  per-item delay.
- `src/components/SidebarNav.jsx`: desktop slash-styled same-page anchor rail.
- `src/components/Projects.jsx`: desktop spotlight plus separate mobile card
  subtree.
- `src/components/Books.jsx` and `src/components/BooksGallery.jsx`: masonry-like
  cover grids and a dedicated `/books` route.
- `src/components/JobList.jsx`: MUI vertical/horizontal tabs.

## Existing Capability Check

Open Canvas already has several relevant primitives. The Raydotsh gap list
should not duplicate them.

| Source behaviour | Existing Open Canvas node | Current fit |
| --- | --- | --- |
| Page routes `/` and `/books` | Canvas Page, Template Seed pages, Route Transition | Pages exist; route transition is likely authoring/config work. |
| Anchor links and top nav | `nav` element with anchor/internal/external links | Top nav exists; side rail and active-section state do not. |
| Icon buttons/links | `ActionElement.iconKind`, icon library | Action icons exist; nav-link icon slots are still limited. |
| MUI-like tabs | `tabs` element, `tabsStyle`, variants | Likely style/template-authoring gap, not a new primitive. |
| Scroll/section entrances | section/element motion, full `MotionSequence` | Single element delays exist; reusable reveal sequencing is missing. |
| Text split effects | `MotionSequenceStep.textEffect` catalog | Covers scramble/mask/blur/wave, not substring typewriter. |
| Pointer visual effects | `pointerFx` | Covers pointer visuals, not ASCII particle physics or simple hover transform style. |
| Rich animated media | `RichMotionAsset` kinds, including `shader-scene` `particle-field` | Current shader particle field is preset-based, not image-sampled ASCII portrait. |
| Responsive element overrides | `BaseElement.responsive` and responsive CSS emitter | Covers per-element box overrides, not alternate child tree substitution. |
| Font loading | `src/fonts`, `siteFont`, custom Style Kit font tokens | Site-owned fonts exist; built-in Template Seed font asset binding needs verification/design. |
| Favicon/site metadata | `faviconAssetId`, page SEO fields | Likely template authoring gap when seed assets can bind metadata. |

## Conceptual System

Nodes:

- **Source Behaviour:** a visitor-visible behaviour observed in the source repo.
- **Design-Language Gap:** a source behaviour that cannot be represented by the
  current Open Canvas vocabulary without static approximation or raw code.
- **Behaviour Primitive:** a schema-owned interaction relation executed by the
  Runtime Hydrator.
- **Visual Recipe:** a curated arrangement of existing elements and styles that
  needs no new runtime.
- **Repeated Content Source:** a project, book, job, or link list that can feed
  alternate visual renderings.
- **Responsive Layout Variant:** a breakpoint-specific visual tree selected from
  the same content source.
- **Particle Field:** a Rich Motion surface whose particles are generated from
  an asset or point map and react to time and pointer state.
- **Playable Widget:** a bounded interactive canvas/runtime surface with explicit
  input, state, render, and failure contracts.
- **Template Fidelity Ledger:** a template-owned report that records native,
  approximate, missing, and intentionally omitted behaviours.

Directed relations:

- Source Behaviour constrains Design-Language Gap.
- Design-Language Gap is closed by an existing primitive, a new Behaviour
  Primitive, a Visual Recipe, or an explicit omission.
- Template Seed references Section Library entries and optional site-level
  behaviour nodes.
- Section Library entries reference Content Elements, seed assets, Component
  Styles, and Behaviour Primitives.
- Repeated Content Source feeds Visual Recipes and Responsive Layout Variants.
- Responsive Layout Variant selects a visual tree from viewport breakpoint.
- Particle Field samples a source asset or point map into render particles.
- Pointer state, elapsed time, and viewport size update Particle Field state.
- Playable Widget receives input, advances bounded game state, renders to a
  canvas, and emits status UI.
- Runtime Hydrator executes Behaviour Primitives in editor and visitor contexts.
- Validator rejects malformed relations before publish.

Reduction checks:

- `Responsive Layout Variant` is justified only where the source genuinely uses
  alternate structure, such as projects desktop spotlight versus mobile cards.
- `Particle Field` should live under Rich Motion if it can share asset binding,
  reduced-motion policy, and hydrator payloads; it should not become a one-off
  hero element.
- `Playable Widget` should not be a general app embed. It exists only if the
  input/state/render contract is bounded enough for validation and editor
  preview.
- `Reveal Sequence` should extend Motion Sequence semantics rather than add a
  parallel animation system.

## Gap Table

| # | Source behaviour | Current approximation | Missing node or relation | Candidate answer | Verification |
| --- | --- | --- | --- | --- | --- |
| 1 | ASCII particle portrait assembles from point data, breathes, and pointer-repels | Static ASCII-style text panel | `asset/point map -> particle field`, `pointer -> local force`, `viewport -> density`, `reduced motion -> settled portrait` | Extend Rich Motion with `particle-field` mode `ascii-portrait`, or add `Particle Field` asset subtype | Canvas render smoke, behaviour runtime smoke, reduced-motion smoke, template smoke asserts no static placeholder |
| 2 | Greeting types `rehana` with a separate blinking cursor | Static text plus cursor glyph | `text run -> visible substring`, `clock -> substring`, `cursor policy -> blink`, `reduced motion -> full text` | Add `typewriter` to bounded text effects | Validator rejects empty sequence; runtime smoke checks character reveal and final state |
| 3 | Robot game mode overlays a platformer on the portfolio | Omitted | `toggle -> mounted widget`, `keyboard -> game state`, `game state -> canvas render`, `status -> UI`, `resize -> board` | Separate ADR for `Playable Widget`; first instance can be `collectible-platformer` | ADR, runtime smoke with deterministic tick loop, keyboard test, publish/editor parity |
| 4 | Desktop slash side anchor rail with staged reveal and same-page links | Top nav only | `section anchor -> rail item`, `scroll -> active item`, `breakpoint -> hidden` | `anchor-rail-nav` Visual Recipe or `nav` variant if active-section state is generalized | Nav render smoke with active-section metadata; responsive smoke hides under breakpoint |
| 5 | Repeated scroll reveal wrapper with child delays | Per-element motion delays | `group visibility -> sequence start`, `child index -> delay` | `revealSequence` relation backed by Motion Sequence targets | Motion Sequence smoke asserts child-index stagger and reduced-motion final layout |
| 6 | Projects desktop spotlight differs structurally from mobile cards | Positioned desktop-like cards | `breakpoint -> alternate visual tree`, `same content -> alternate variant` | `Responsive Layout Variant` for containers/sections | Responsive smoke asserts desktop/mobile DOM tree selection and no duplicate visible controls |
| 7 | Projects and books render repeated data as cards/covers | Hand-authored positioned elements | `content list -> repeated card`, `container width -> columns`, `item hover -> style state` | Collection-backed card/cover-grid recipes | Collection/render smoke asserts repeated items, masonry columns, hover metadata |
| 8 | Book covers use masonry columns and hover lift | Real covers, brittle positioned media | Same as #7, plus item aspect policy | `cover-grid` recipe using repeated content source | Visual smoke for desktop/tablet/phone columns |
| 9 | MUI tabs with vertical desktop and horizontal mobile | Native tabs with partial styling | `breakpoint -> tabs orientation`, `active tab -> indicator style` | Existing `tabsStyle` plus orientation/responsive authoring if missing | Tabs smoke asserts indicator colour/orientation at breakpoints |
| 10 | Exact NTR typography | Style Kit names NTR but does not prove loaded font | `Template Seed -> font asset/url`, `font readiness -> measurement` | Template Font Asset binding using existing font subsystem | Font smoke asserts `@font-face` or official font link renders in preview and publish |
| 11 | SPA route feel between home and books | Multi-page Canvas route | `page navigation -> route transition` | Existing `routeTransition` configuration | Template smoke asserts route transition metadata |
| 12 | MUI/GitHub/social/external icons in nav/cards/buttons | Some action icons; nav icons limited | `semantic action kind -> icon glyph`, `nav link -> icon slot` | Extend icon support to nav links or model social links as icon-only Actions | Render smoke asserts accessible icon-only labels and no arbitrary SVG blobs |
| 13 | Hover lift/colour transitions across cards, covers, links, image | Static/basic styling | `hover/focus/touch -> visual state` | Bounded `interactionStyle` fields on Component Style or recipes | Component style smoke asserts hover metadata and reduced/touch policy |
| 14 | Favicon/logo/PWA metadata | Not wired in current template | `seed asset -> favicon/site icon metadata` | Use existing `faviconAssetId`; add PWA only if product needs it | Template smoke asserts favicon asset id and preview asset route |

## Priority Slices

### Slice 0: Fidelity Ledger And Existing Primitive Audit

Write a Raydotsh-specific fidelity ledger smoke that records which behaviours
are native, approximate, missing, and intentionally omitted. Then update the
current template only where existing primitives already cover the behaviour:
route transition, scroll padding, favicon, action icons, tabs styling, and
template metadata. This slice should not add new schema.

### Slice 1: Typewriter Text And Reveal Sequence

Add the smallest text/motion vocabulary needed for the hero greeting and staged
section reveals. This is the safest runtime slice because it extends existing
text and Motion Sequence concepts.

### Slice 2: Responsive Variants And Repeated Grids

Add a model for alternate visual trees driven by the same content source. Use it
for projects and book covers, because faithful responsive behaviour is not just
box scaling.

### Slice 3: Anchor Rail And Interaction Style

Model the desktop side rail and bounded hover/focus/touch visual states. Keep it
inside nav/component style vocabulary unless an actual new element type proves
necessary.

### Slice 4: ASCII Particle Portrait

Extend Rich Motion with an image/point-map sampled particle field that can
render the Raydotsh portrait faithfully without embedding source React.

### Slice 5: Playable Widget ADR

Do not implement the robot game as part of the first template polish. Write an
ADR that decides whether `Playable Widget` belongs in Open Canvas at all, then
prototype only a bounded `collectible-platformer` if the answer is yes.

### Slice 6: Raydotsh Template Re-authoring

After the primitives land, update Section Library entries and Template Seed
configuration to use them. The final claim can then change from "useful static
conversion" to "faithful builder-native replica."

## Implementation Issue Backlog

### Issue 1: Raydotsh Fidelity Ledger Smoke

**Type:** test/docs

Create a smoke under `src/templates/` that instantiates `raydotsh-portfolio`,
renders it, and asserts an explicit ledger for the source behaviours above. The
smoke should distinguish `native`, `approximate`, `missing`, and `omitted`.

Acceptance:

- The smoke passes for the current template only when approximations are named.
- The smoke fails if a missing behaviour is silently removed from the ledger.
- The final report says the template is not faithful yet.

### Issue 2: Existing Primitive Activation For Raydotsh

**Type:** template authoring

Use current schema only. Add or adjust route transition metadata, scroll padding,
favicon binding, action icons, tabs styling, and header/social icon treatment
where the existing model supports it.

Acceptance:

- `bun run raydotsh-portfolio:smoke`
- `bun run template-preview:smoke`
- `bun run section-library-composition:smoke`
- `bun run seed:assets`
- `bun run assets:smoke`
- `bun run typecheck`

### Issue 3: Typewriter Text Effect

**Type:** schema/runtime/editor

Add a bounded text effect for ordered substring reveal and cursor policy. It
should be a Text Element effect or Motion Sequence text effect, not a raw script.

Acceptance:

- Validator rejects unsupported cursor policies and empty reveal text.
- Editor preview and published runtime use the same Hydrator path.
- Reduced motion renders the full text immediately.

### Issue 4: Reveal Sequence

**Type:** schema/runtime/editor

Add group-level stagger semantics so repeated children can reveal from
visibility without hand-authored per-element delays.

Acceptance:

- Child index determines delay.
- Reduced motion leaves final layout stable.
- The primitive maps to the existing Motion Sequence model rather than a second
  animation system.

### Issue 5: Responsive Layout Variant

**Type:** schema/render/editor

Allow a section/container to choose alternate child trees at breakpoints while
sharing one content source.

Acceptance:

- Desktop projects render spotlight/card structure.
- Mobile projects render the mobile card structure.
- Hidden inactive variants do not duplicate accessible controls.
- Validation rejects variants without a content-source relation.

### Issue 6: Collection Card And Cover Grid Recipes

**Type:** element recipe/render/editor

Represent projects and books as repeated content rendered through card and
cover-grid recipes.

Acceptance:

- Project data feeds spotlight and card variants.
- Book list feeds preview and gallery grids.
- Masonry/cover-grid columns respond to container width.
- Hover state is bounded and accessible.

### Issue 7: Anchor Rail Navigation

**Type:** nav recipe/runtime/editor

Add a side-rail navigation recipe or nav variant with section-anchor binding,
desktop-only visibility, slash prefix styling, and active-section state.

Acceptance:

- Rail items derive from section anchors.
- Active section updates from scroll position.
- Breakpoint hides the rail cleanly under `800px`.

### Issue 8: Interaction Style For Hover/Focus/Touch

**Type:** component style/runtime/editor

Add bounded hover/focus/touch visual state fields for transforms, colour, shadow,
and touch activation where Component Style owns the affected part.

Acceptance:

- Cards, covers, links, and about image can express hover lift/colour changes.
- Focus-visible has an accessible equivalent.
- Touch devices do not rely on invisible hover-only behaviour.

### Issue 9: ASCII Particle Portrait

**Type:** Rich Motion asset/runtime/editor

Add a Rich Motion particle field mode that samples an image or point map into
ASCII particles and applies time, pointer, viewport, and reduced-motion
relations.

Acceptance:

- The particle field renders from seed asset or point-map data.
- Pointer/touch repels particles.
- Resize recalculates density deterministically.
- Reduced motion renders a static settled portrait.
- Runtime failures emit named behaviour failure events.

### Issue 10: Playable Widget ADR

**Type:** ADR/spec

Decide whether the robot game belongs in Open Canvas as a bounded primitive. If
yes, define the `Playable Widget` contract: allowed input events, deterministic
state machine, render surface, status UI, persistence policy, editor preview,
and failure behaviour.

Acceptance:

- ADR rejects arbitrary source app embedding.
- ADR identifies the first allowed game shape or rejects the feature.
- No implementation begins before the ADR is accepted.

### Issue 11: Template Font Asset Binding

**Type:** font/template pipeline

Verify the current font subsystem can bind Template Seed fonts for built-in
global templates. If not, add a Template Font Asset relation using the existing
font routes and validation.

Acceptance:

- NTR loads in dashboard preview, created sites, and published pages.
- Font readiness does not clip or mismeasure hero text.
- The template does not depend on a silent system-font approximation.

### Issue 12: Final Raydotsh Re-authoring

**Type:** template conversion

After Issues 3-11 land, update the Raydotsh Section Library entries and
Template Seed to use the new primitives.

Acceptance:

- `bun run raydotsh-portfolio:smoke`
- `bun run template-preview:smoke`
- `bun run section-library-composition:smoke`
- `bun run seed:assets`
- `bun run assets:smoke`
- `bun run typecheck`
- A visual/e2e smoke verifies desktop and mobile first viewport, projects,
  books, and reduced-motion mode.

## Validation Rules

- Every new primitive must be represented in `src/canvas/schema.ts` or a
  colocated element module exported into the schema.
- `validateEditableSite` and `validatePublishedSnapshot` must reject malformed
  primitive payloads.
- Yjs projection must preserve new fields that owners can edit.
- The editor inspector must expose the primitive or explicitly mark it
  template-only until a later owner-facing slice.
- Renderer output must include explicit data attributes for the Runtime
  Hydrator.
- Runtime failures must use named failure events and include ids for the site,
  primitive, target, and asset where applicable.

## Final Claim Rule

Do not call `raydotsh-portfolio` faithful until Issues 1-9 and 11-12 are closed
or until the Product decision explicitly omits the unresolved behaviours. The
robot game remains a separate fidelity dimension until Issue 10 is accepted and
implemented.
