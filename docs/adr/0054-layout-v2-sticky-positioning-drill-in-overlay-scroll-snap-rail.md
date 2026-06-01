# ADR 0054 — Layout v2: sticky positioning, drill-in overlay contract, scroll-snap rail

**Status:** Proposed (sticky + scroll-snap shipped; drill-in overlay documented as contract, implementation deferred)
**Date:** 2026-06-02
**Author:** Aayushman Singh
**Drives:** gaps 6, 3, and 14 from [docs/portfolio-template-gaps.md](../portfolio-template-gaps.md). Layout-v2 cluster called out in ADRs 0050, 0051, 0052 as the home for layout-engine-level work.

## Context

Three deferred gaps share a layout-engine concern that single-decision ADRs cannot cleanly resolve in isolation:

- **#6 Sticky positioning.** The portfolio's portrait card uses `position: sticky; top: 80px` so it pins inside the hero section during scroll. Canvas elements are absolute-positioned per [render.ts:83](../../src/canvas/render.ts#L83); `position: sticky` cannot coexist with `position: absolute` on the same element, so sticky needs a different layout regime.
- **#3 Iframe drill-in overlay.** The portfolio's project cards open a full-screen `<iframe>` overlay on click. The popup section primitive already exists (`CanvasSection.trigger` for `exit-intent` / `delay` / `scroll`), but no `element-click` trigger; an in-app overlay needs that plus an embed (iframe) element inside the popup.
- **#14 Scroll-snap horizontal rail.** The portfolio's "other work" rail uses CSS `scroll-snap-type: x mandatory`. The existing `CarouselElement` paginates; native scroll-snap is the more idiomatic primitive for tight horizontal carousels.

Two of three (#6 sticky, #14 scroll-snap) are bounded layout primitives that ship as opt-in flags on existing schema. #3 is a meaningfully larger surface — it needs a new trigger discriminant, visitor JS to wire element clicks to popups, and editor support for the "this element opens that popup" relationship. This ADR ships #6 and #14, documents #3's contract, and leaves implementation to a follow-up that pairs the trigger + popup renderer + visitor JS work.

## Decisions

1. **`BaseElement.stickyOffset?: number` opt-in switches the element to `position: sticky`.** When set, the renderer emits `position: sticky` instead of `position: absolute`, with `top: <stickyOffset>px` as the sticky offset, `margin-left: <box.x>px` + `margin-top: <box.y>px` to preserve the authored initial position, and `width: <box.w>px; height: <box.h>px`. The element stays in normal flow within its section (so the sticky context is the section), but absolute-positioned siblings ignore it visually — the canvas's existing absolute layout for non-sticky children continues to work.

   **Why `margin-*` instead of `left` / `top`.** With `position: sticky`, setting `left` and `top` both make the element stick on both axes. We only want vertical sticky (the portfolio use case). Using margins for the initial offset and reserving the `top` property exclusively for the sticky-offset value gives one-axis sticky cleanly. The `box.y` field continues to mean "initial y-offset from section top" in this regime; `stickyOffset` is a *separate* viewport offset.

   **Why `stickyOffset` instead of `sticky`.** `NavElement` already carries `sticky: boolean` for the existing sticky-nav toggle. Reusing that name for per-element pixel offsets creates a type and concept collision, so the layout-v2 primitive uses the more exact `stickyOffset` name. Future axes (`bottom`, `left`, `right`) should become explicit fields only when a real template needs them.

2. **`CarouselElement.mode: 'paginate' | 'scroll-snap'` ships, defaulting to `'paginate'` for backward compatibility.** When `'scroll-snap'`, the renderer emits `scroll-snap-type: x mandatory` on the carousel container and `scroll-snap-align: start` on each slide. The pagination dots / arrows are suppressed; the visitor swipes / scrolls horizontally and the native scroll-snap snaps each slide.

   **Why a mode field, not a new `RailElement`.** Carousel and scroll-snap rail share 80%+ of their shape (slides, optional caption, optional href). One element with a mode flag avoids a parallel surface (`Slide` vs `RailItem`) and keeps the inspector + agent-tool spec single-source. The 20% that differs (pagination UI vs scroll-snap CSS) is a per-mode renderer branch.

   **Default `'paginate'`.** Every existing carousel in every fixture continues to render as a paginated carousel without migration. The mode field is optional in the validator and reads `undefined → 'paginate'` at render time.

3. **Iframe drill-in overlay ships as a documented contract; implementation deferred.** The contract:

   ```ts
   // CanvasSection.trigger union extended:
   trigger?:
     | { type: 'exit-intent' }
     | { type: 'delay';        value: number }
     | { type: 'scroll';       value: number }
     | { type: 'element-click'; targetElementId: string };

   // Existing EmbedElement (already in the schema, wraps `<iframe>`) is the
   // panel content. Author places an EmbedElement inside the popup section's
   // elements array; the popup renders, the iframe loads on first show.

   // Visitor JS: one delegated click handler on document. When click target
   // closest('[data-opencanvas-element]') has id === any
   // section[trigger.type='element-click'].targetElementId, that section
   // surfaces (sets data-opencanvas-popup-open) and a backdrop appears. ESC
   // or backdrop click dismisses. Same delegated-handler pattern as ADRs
   // 0051 dec 4 and 0052 dec 4.
   ```

   **Why deferred.** The implementation surface spans (a) extended trigger validator, (b) new visitor JS handler, (c) editor inspector for "wire this card to that popup", (d) backdrop + close UX, (e) keyboard a11y (ESC + focus trap). Each is bounded but the bundle adds up to roughly Bundle-D scope. Ship the contract here so the layout-v2 family is documented; the implementation follows in a focused bundle when an actual template needs it (the portfolio template already routed cards to external URLs in Bundle C, so the urgency is low).

## Out of scope

- **Sticky `left` / `right` / `bottom`.** Only top-offset sticky ships in this ADR; additional axes land as explicit fields when needed.
- **Drill-in implementation** — documented contract only; the wiring lands when a template needs it.
- **Sticky-aware scroll-padding-top adjustment** — site-level `scrollBehavior.paddingTop` (ADR 0050 dec 3) covers the sticky-header-offset use case; sticky elements don't need additional padding configuration.
- **Vertical scroll-snap** — only horizontal carousel scroll-snap ships. Vertical scroll-snap is a section-level concern, not an element concern, and would land as a separate `CanvasSection.scrollSnap?: 'y'` flag if a template needs it.

## Consequences

**Positive:**
- Sticky positioning unlocks the portfolio's portrait-card pinning pattern and every future "sticky sidebar / sticky CTA / sticky header-inside-section" pattern without a layout-engine rewrite.
- The two-regime split (sticky elements drop out of absolute layout; non-sticky stays absolute) is opt-in, atomic per element, and doesn't churn any existing fixture.
- Carousel mode switch closes the rail gap with one field; every existing carousel renders unchanged.
- The drill-in contract is documented in-tree so the next bundle starts from a known shape.

**Negative:**
- Sticky elements no longer match the editor's absolute-position model exactly — the editor will need a follow-up UX that surfaces "this element is sticky; its initial position is here, its sticky offset is N" without overloading the box gizmo. Deferred to the inspector follow-up.
- Carousel renderer now has a per-mode branch in its output. Bounded, but adds a second exercise path that smoke tests must cover.
- Drill-in stays unimplemented; the gaps doc's gap #3 remains "documented contract, implementation deferred" status until a template needs it.

## Follow-ups

- **Sticky inspector UI.** Add a sticky-position group to the position inspector with one number input (`stickyOffset`). Ships in the broader inspector follow-up bundle.
- **Drill-in implementation bundle.** Extends `trigger` union, visitor JS for element-click, editor target-picker, backdrop CSS, ESC/focus a11y. Land when the next template needs it.
- **Sticky + responsive overrides.** Decide whether `sticky` participates in `ResponsiveOverrides` (drop sticky on phone? keep but change `top` for smaller header?). Defer until a real responsive use case lands.
- **Bundle gaps doc.** Gap #6 closes; gap #14 closes; gap #3 advances to "contract documented, implementation deferred."
