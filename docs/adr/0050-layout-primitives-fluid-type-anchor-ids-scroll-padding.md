# ADR 0050 — Layout primitives: fluid type, anchor ids, site-level scroll behaviour

**Status:** Proposed
**Date:** 2026-06-01
**Author:** Aayushman Singh
**Drives:** gaps 1, 11, and 12 from [docs/portfolio-template-gaps.md](../portfolio-template-gaps.md) — the punch list produced by porting `C:/Repo/portfolio` into the canvas as `portfolio-showcase`. Bundle B in the gap-bundling plan agreed before the port (see conversation log 2026-06-01).

## Context

The canvas schema describes elements as absolutely-positioned boxes whose typography sits on `TextElement.fontSize: number` (px). When the portfolio template was ported in commit `<bundle-A>`, three real authoring needs surfaced that the schema couldn't express without `pinnedStyle` escape hatches:

1. **Fluid type.** The portfolio's hero name uses `clamp(64px, 9vw, 132px)` so the headline scales smoothly across viewports without the per-breakpoint staircase that `ResponsiveOverrides.tablet/phone` produces. The canvas has no analog: a TextElement either holds one fixed px or relies on responsive overrides to swap discrete pixel values at the breakpoint boundaries (visible "jumps").
2. **Anchor ids.** The portfolio nav uses `#about`, `#work`, `#contact` to deep-link sections within the home page. The canvas renderer emits `data-opencanvas-section="<id>"` and `data-opencanvas-element="<id>"` data attributes from `element.id` / `section.id`, but never an actual `id="..."` DOM attribute. Anchor links resolve to nothing at runtime. The `element.id` / `section.id` values are opaque storage keys (`pf-hero-name`) that an author wouldn't want as anchor targets even if they were emitted.
3. **Site-level scroll behaviour.** The portfolio uses `scroll-behavior: smooth` plus `scroll-padding-top: 80px` (the sticky nav's height) so anchor jumps land below the sticky header rather than under it. The canvas has no surface for site-wide page-scroll CSS; authors who want it write `pinnedStyle` on every text element or accept the broken jump.

Two adjacent gaps from the same punch list — **#6 sticky positioning** and **#17 per-element tint** — were considered for this bundle and pulled out on review. Sticky positioning collides with the absolute-positioning posture the renderer enforces at [src/canvas/render.ts:80-89](../../src/canvas/render.ts#L80-L89); the four implementation paths surveyed in the bundling discussion all reduce to either a layout-engine rewrite or a `box.y`-overload that gives an element two meanings depending on a flag. Per-element tint duplicates a problem that should be solved at the style-kit token layer once card-as-link (#9) settles. Both are explicit deferrals — recorded in **Out of scope** below and rolled into the layout-v2 ADR queue.

## Decisions

1. **Fluid font sizing via `TextElement.fluidSize`.** A TextElement that opts in carries an optional `fluidSize: { min: number; max: number; vw: number }`. When present, the renderer emits `font-size: clamp(<min>px, <vw>vw, <max>px)` and ignores `fontSize`. When absent, the renderer emits `font-size: <fontSize>px` exactly as today. `fontSize` remains required so static callers (collection cells, agent-emitted defaults, the rendered fallback when CSS clamp is unsupported) always have a concrete value.

   **Why a separate field, not `fontSize: number | object`.** `fontSize` is the structured-fallback contract that every consumer reads — the inspector's px input, the agent tool spec's `patchProperties.fontSize`, the existing validator bounds (`TEXT_FONT_SIZE_MIN`/`MAX`). Making it polymorphic forces every consumer to type-guard. An opt-in `fluidSize` keeps the existing surface intact and adds a discrete extension that the renderer consults only when present. ADR 0011's "one structured surface per concept" rule applies — the concept here is *fluid scaling*, distinct from *static px*.

   **Why three knobs, not a single CSS string.** Accepting a raw `clamp(...)` string requires re-parsing it in the inspector and the validator; both would need a CSS-grammar subset. Three numbers cover the only real authoring shape (a `clamp(min, vw, max)` triple) with zero parsing and trivial bounds (`min > 0`, `max > min`, `1 ≤ vw ≤ 30`).

2. **Anchor ids via opt-in `anchorId` on `BaseElement` and `CanvasSection`.** Both gain an optional `anchorId?: string`. When present, the renderer emits `id="<anchorId>"` on the corresponding wrapper. Validator enforces a strict format (`/^[a-z][a-z0-9-]*$/` — ASCII lowercase, digits, hyphens, must start with a letter) and uniqueness *within the page* across the union of all section + element anchor ids on that page. Cross-page collisions are allowed (anchors are page-local).

   **Why a new field, not auto-deriving from `id` or `slug`.** `element.id` / `section.id` are storage keys, owner-uneditable, machine-shaped (`pf-hero-name`). Emitting them as `id="..."` would expose internal naming as part of the public DOM contract and make rename-without-breaking-anchors impossible. `anchorId` is the author's deliberate, human-readable, public-DOM name; absence means "this element has no anchor target."

   **Why a strict charset.** DOM ids can technically be any non-whitespace string, but a stricter shape keeps validator errors actionable, keeps anchor URLs reader-friendly, and keeps editor URL-building code free of escaping concerns. Stricter than HTML's contract is fine; looser would force `encodeURIComponent` at every consumer.

   **Why "unique within the page, not across the site."** Each page emits its own DOM. A duplicate `id` across two different pages produces no DOM collision at any time — pages are rendered into separate documents. Enforcing site-wide uniqueness would block legitimate patterns (e.g. every page having a `#top` anchor on its hero) without preventing any real bug.

3. **Site-level scroll behaviour via `EditableSite.scrollBehavior`.** Optional `{ smooth?: boolean; paddingTop?: number }`. When set, the renderer emits a single `<style>` block at the head of `<main>` that targets `html { scroll-behavior: smooth; scroll-padding-top: Npx }` according to which fields are present. Both fields are independent — `smooth: true` without `paddingTop` is valid; `paddingTop: 80` without `smooth` is valid.

   **Why a typed pair, not a single `scrollPaddingTop` number.** Smooth scrolling and scroll padding are conceptually paired: an author who sets one usually sets the other. Bundling them under one optional object signals the relationship and gives one expansion slot (e.g. `paddingBottom`, `scrollSnapType`) without re-adding a `scrollBehavior` sibling at every step.

   **Why emit inside `<main>` rather than as a snapshot meta-field consumed by the document envelope.** The renderer's contract per ADR 0025 is "the renderer emits a self-contained `<main>`; the caller wraps it in `<html>/<head>/<body>`." Letting `scrollBehavior` leak into a separate meta-output would force every caller (the publish route, the editor preview, the OG image renderer, the SEO smoke) to wire it through. A `<style>` block inside `<main>` applies globally to `html` via the cascade regardless of where it sits in the body; the caller wraps `<main>` as-is and the rule lands.

4. **Validator enforces all three contracts in `validate.ts`; no consumer is allowed to read these fields without going through the validated path.** Per ADR 0012 dec 1 (`canvas/validate.ts` is the only write gate), the field-level checks live in one place. Renderer reads validated input; agent-tool parsePatch produces validated input; editor inspector writes through the same validators. There is no "lenient" reader.

## Out of scope

- **Sticky positioning** (gap #6 from [docs/portfolio-template-gaps.md](../portfolio-template-gaps.md)). Deferred to a layout-v2 ADR. Reason: every working implementation (sticky-via-box.y overload, sticky-with-flow-rewrite, sticky-via-CSS-grid-section) requires the absolute-positioning posture in [render.ts:83](../../src/canvas/render.ts#L83) to either change globally or split into two regimes inside one section. That belongs alongside Bundle D (tabs, gap #2) which has the same layout-engine pressure, not bolted onto a typography/identity/scroll bundle.
- **Per-element tint** (gap #17). Deferred to post-Bundle-C. Reason: the use case is "this card has a brand accent that themes against the style kit." Solved correctly, it adds tint tokens to `StyleKitPreset` and a resolved `tint` enum on `ContainerElement`. That's a style-kit redesign, not a one-off element field. Wait until card-as-link (#9) is in to know how containers are shaped.
- **Anchor-id auto-emission from `element.id`/`section.id`.** Deliberately rejected (decision 2 rationale). Storage keys stay private.
- **Cross-page anchor uniqueness.** Deliberately rejected (decision 2 rationale). Pages render to separate documents.
- **Looping motion presets**, **copy-to-clipboard action behaviour**, **card-as-link**, **icon system**, **tabs element**. All separate gaps with their own bundles.

## Consequences

**Positive:**
- Authors can express the three patterns the portfolio template demanded — fluid headlines, in-page anchors, sticky-header-aware scroll — without `pinnedStyle` escape hatches. Each lands as a typed field with validation and an inspector row (inspector rows ship in the follow-up PR per the bundling decision).
- The renderer's output gains a single global `<style>` block when `scrollBehavior` is set; previously the renderer never emitted any global rules of its own. The block is opt-in (zero overhead when unset) and structurally bounded.
- The `pinnedStyle` docstring rule from commit `<bundle-A-2>` ("promote at >3 fixture appearances") gets its first three exercises: each promoted field replaces 3+ pinnedStyle uses in the portfolio fixture.

**Negative:**
- `fluidSize` introduces a small "two paths to a font size" surface: an element may carry either the static `fontSize` or both `fontSize`+`fluidSize`. The fallback semantics (renderer uses `fluidSize` when present, ignores `fontSize`) need to be carried through the inspector + the agent tool spec.
- `anchorId`'s charset is stricter than HTML's. An author who tries to write `My Section` as an anchor gets a validator error instead of a fuzzy fix; the error message must spell out the format.
- `scrollBehavior` is a site-level field whose effect lives in the rendered `<main>`. A caller that bypasses the renderer (e.g. a unit test that synthesises HTML by hand) won't get the rule. No such caller exists today; the constraint is documented and the snapshot smoke covers the natural path.

## Follow-ups

- **Inspector rows** for `fluidSize` (three numbers), `anchorId` (one text, empty-omits), `scrollBehavior` (one boolean + one number on the site-settings panel). Ships as PR 6 per the bundling plan.
- **Bundle gaps doc** update: mark gaps 1/11/12 closed in [docs/portfolio-template-gaps.md](../portfolio-template-gaps.md), mark 6 + 17 deferred with cross-references to the layout-v2 ADR queue.
- **Fixture wiring** in `portfolio-showcase.json`: hero name → `fluidSize: { min: 64, max: 132, vw: 9 }`, hero section + stack section + work section + notes section → `anchorId: 'hero' | 'about' | 'work' | 'notes'`, site → `scrollBehavior: { smooth: true, paddingTop: 80 }`. Footer cta-text "let's talk →" already targets `#contact`; add `anchorId: 'contact'` on the footer.
- **Layout-v2 ADR.** Carries gap #6 sticky positioning + gap #2 tabs together, since both need the absolute-positioning posture to change or split. Author when Bundle D is ready, not before.
