# ADR 0052 — Tabs as a `TabsElement` with embedded panels

**Status:** Accepted
**Date:** 2026-06-02 (Accepted 2026-06-09)
**Author:** Aayushman Singh
**Drives:** gap #2 from [docs/portfolio-template-gaps.md](../portfolio-template-gaps.md). Bundle D in the gap-bundling plan agreed on 2026-06-01.

**As-built (2026-06-09):** all five decisions live in the canvas.
Decision 1 (`TabsElement` schema) at [`src/canvas/elements/tabs.ts`](../../src/canvas/elements/tabs.ts), wired into `ELEMENT_TYPES` and the element union in [`src/canvas/schema.ts`](../../src/canvas/schema.ts); smoke at [`src/canvas/tabs-element.smoke.ts`](../../src/canvas/tabs-element.smoke.ts).
Decision 2 (`Tab.label: InlineRun[]`) on the same module.
Decision 3 (panel-local coordinates) — `renderTabs` wraps each panel in `position: relative` ([`tabs.ts`](../../src/canvas/elements/tabs.ts)).
Decision 4 (delegated visitor JS) — render emits the click handler against the `[data-opencanvas-tabs]` root.
Decision 5 (graceful no-JS degradation) — corresponding rules in [`src/canvas/public-styles.ts`](../../src/canvas/public-styles.ts).

## Context

The portfolio's `Explore` section is a three-tab UI ([C:/Repo/portfolio/app/components/portfolio/PortfolioSection.tsx](C:/Repo/portfolio/app/components/portfolio/PortfolioSection.tsx)) — Tech Stack / Selected Work / Research & Articles — where clicking a tab swaps the visible panel without leaving the page. The 2026-06-01 port collapsed this into three back-to-back sections labelled `01 / 02 / 03`, losing the swap UX entirely. The canvas has no surface for tabs:

- `AccordionElement` collapses, doesn't swap.
- Multiple sections are siblings on the page, all permanently visible.
- No notion of "show one of these N children, hide the rest" exists in the schema.

The bundle survey identified three implementation shapes:

1. **Section displayMode `'tabs'`** — `CanvasSection.displayMode?: 'flow' | 'tabs'`. When `'tabs'`, the section interprets its first child as the tab bar and remaining children as panels. Lightest schema change but bleeds tab semantics into the section model (which currently has no notion of child roles).
2. **`TabBar` + `TabPanel` as separate element types, wired by group id** — most flexible (panels could live anywhere on the canvas) but most fragile (authors hand-wire cross-element references, validator must enforce reachability and uniqueness, missing-panel UX falls through silently).
3. **One `TabsElement` with embedded `tabs: Tab[]`, each `Tab` carrying its own `elements: CanvasElement[]` panel** — self-contained, matches `CollectionElement`'s precedent of nested children, validator + renderer handle one shape.

The canvas already has one element with deeply nested children — `CollectionElement` (`entryTemplate`, `entries`, `cardTemplate`). The recursive-validation infrastructure (`validateCollectionChildren`, `validateCollectionEntries`) is already factored out. A second element type with similar nesting reuses that same path.

This ADR also draws a line: **sticky positioning (gap #6), iframe drill-in overlay (gap #3), and scroll-snap rail (gap #14)** are NOT addressed here. Earlier conversation considered bundling them with tabs because all four touch layout regimes; on review, tabs are a *visibility-mode* concern (one child active at a time) while sticky / overlay / rail are *positioning* and *navigation* concerns. Folding them together would conflate two separate layout-engine surfaces. The deferred set becomes layout-v2 (ADR 0053+, when sized).

## Decisions

1. **Introduce `TabsElement` as a new element type.** Added to `ELEMENT_TYPES` and to the `CanvasElement` discriminated union. Shape:

   ```ts
   interface Tab {
     id: string;                 // anchor-id charset, unique within the TabsElement
     label: InlineRun[];         // rich-text tab label, same shape as TextElement.content
     elements: CanvasElement[];  // panel children, panel-local coordinates
   }

   interface TabsElement extends BaseElement {
     type: 'tabs';
     tabs: Tab[];                // length ≥ 2
     activeTabId: string;        // must reference one of tabs[].id
     tabBarHeight?: number;      // px; default 56
   }
   ```

   **Why nested `Tab.elements` instead of wiring panels separately.** Each tab is conceptually a *region* of the TabsElement's box. Panel children participate in absolute positioning relative to the panel origin, not to the page or the section — same way `CollectionElement.entries[]` cells are panel-local. Wiring panels as separate elements (option 2) would require authors to type the same group-id on every panel + every tab-bar entry and would force the validator to track cross-element references; both are escape hatches for "no element type can hold this composition," not a positive design.

   **Why `tabs.length ≥ 2`.** A single-tab `TabsElement` is a `Container` with a label — the surface adds no UX. The validator rejects single-tab to keep authors from creating one-tab "containers" that mean nothing structurally.

   **Why `activeTabId` is required and is a `string`, not an index.** Indices are positional and break when an author reorders tabs; ids are stable. Required (not optional with implicit "first tab") because the initial-visible tab is part of the design decision — leaving it implicit means the renderer guesses, which leaks into snapshot diffs and OG-image renders.

2. **Tab labels are `InlineRun[]`, not `string`.** Same shape as ADR 0051 dec 1's `ActionElement.label`. Authors can put `<strong>` / `<em>` / `<code>` / link marks inside a tab label without falling back to `pinnedStyle`. Validator reuses `validateTextContent` so the rules are identical to text and action.

3. **Panel children render with panel-local coordinates.** A child element at `box: { x: 80, y: 40, w: 600, h: 200 }` inside a panel renders at `(80, 40)` *from the panel origin*, not from the page. The renderer wraps each panel in a `position: relative` div whose dimensions are `TabsElement.box.w × (TabsElement.box.h - tabBarHeight)`; panel children are absolute-positioned within that box exactly as section children are absolute-positioned within their section.

   **Why this matches CollectionElement.** `CollectionElement.entries[][]` cells already use the same convention — `entry.elements[]` carry cell-local coordinates and the renderer wraps each entry in a `position: relative` container whose dimensions are derived from `layout.columns / gap`. Tabs reuses that exact pattern. New authors who learned the convention from Collection have nothing to relearn.

   **Why fixed `tabBarHeight` instead of measuring the rendered bar.** Measuring requires a DOM round-trip that this renderer (pure HTML stringification) cannot do. A fixed default (56 px, comfortable for a single line of bar buttons) with an authorable override keeps the contract pure-function. Tab bars that need more height (icon + label stack, two-line wrapping) set the field explicitly.

4. **Visitor-side tab handler ships as a single delegated click listener at the end of `<main>`, emitted only when a `TabsElement` exists in the snapshot.** Same pattern as ADR 0051 dec 4's copy handler.

   ```js
   document.addEventListener('click', function(e) {
     var btn = e.target.closest('[data-opencanvas-tab-id]');
     if (!btn || btn.tagName !== 'BUTTON') return;
     var root = btn.closest('[data-opencanvas-tabs]');
     if (!root) return;
     var id = btn.getAttribute('data-opencanvas-tab-id');
     root.querySelectorAll('[data-opencanvas-tab-id]').forEach(function(b) {
       b.toggleAttribute('data-tab-active', b.getAttribute('data-opencanvas-tab-id') === id);
     });
     root.querySelectorAll('[data-opencanvas-tab-panel-id]').forEach(function(p) {
       p.toggleAttribute('data-tab-active', p.getAttribute('data-opencanvas-tab-panel-id') === id);
     });
   });
   ```

   **Why delegated, not per-button inline.** Same rationale as ADR 0051 dec 4: one listener regardless of how many `TabsElement`s sit on the page, no per-element inline script source (which would balloon snapshot bytes), values read at click time from the attribute so escaping is HTML-attribute-level only.

   **Why DOM attributes (`data-tab-active`) instead of CSS classes.** Toggling an attribute is one DOM op per element; class-list manipulation is the same but its API surface (`add` / `remove` / `toggle`) is more state to track. Attribute-toggling lets the style-kit CSS key off `[data-tab-active]` selectors symmetrically with the bar buttons + the panels.

5. **Panel show/hide is rendered as opt-in CSS, not as `display: none` on inactive panels at HTML emission time.** The renderer emits every panel's HTML; the CSS in each style kit hides `[data-opencanvas-tab-panel-id]:not([data-tab-active])`. This means non-JS visitors see all panels stacked (degraded but readable) instead of a single panel with no way to access the others.

   **Why graceful degradation here, when CLAUDE.md bans fallbacks.** The fallback rule is about *silent degradation that hides a failure*. Tabs are an interaction primitive — if the visitor's browser cannot run the script (CSP block, JS disabled, very old browser), serving all panels is the correct behaviour: the *content* is present, only the *interaction* is missing. That's "fail loud, show content" rather than "fail silent, hide content." Identical reasoning to why the renderer emits anchor ids unconditionally even when scroll-behaviour CSS isn't set.

## Out of scope

- **Sticky positioning (gap #6), iframe drill-in overlay (gap #3), scroll-snap horizontal rail (gap #14).** Deferred to a layout-v2 ADR. Visibility-mode swap (this ADR) is a different layout regime than positional changes; folding them together would conflate the two.
- **Tabs that morph into an accordion at small viewports.** Common responsive pattern, but it requires the responsive-overrides system to address element-type changes, not just box overrides. Out of this ADR's scope; revisit when responsive overrides grow.
- **Keyboard navigation (arrow keys to move between tabs, Home/End to jump).** ARIA tabs pattern requires this. Documented as a follow-up; ships in the inspector-rows PR that already adds editor-side tab UX.
- **Tabs that lazy-load panel content.** Snapshots are fully-rendered HTML; lazy-load would require a separate runtime hydration model. Not in scope.
- **Stacked / vertical tab bars.** First version emits a horizontal bar at the top. Vertical layout would re-use the same TabsElement shape with a `barOrientation` field; landed if and when a template asks.
- **Inspector UI for TabsElement.** Ships in the inspector follow-up alongside the Bundle B + Bundle C inspector items.

## Consequences

**Positive:**
- The portfolio template's `Explore` section collapses from three back-to-back sections (currently `01 / 02 / 03`) into one section containing one `TabsElement`. The tab swap UX is restored; the `01 / 02 / 03` band labels can either move into the tab labels or drop entirely.
- The validator + renderer infrastructure already handles deeply-nested element children via Collection. Adding a second element with nesting reuses the same path — no new recursion machinery.
- The inline visitor handler matches ADR 0051's copy handler exactly in shape (delegated listener, attribute-driven, emitted only when needed). One mental model spans both interactive primitives.
- Graceful degradation rule (decision 5) means a tabs-bearing snapshot still serves usable content when the script can't run. Static-HTML readers (search engine crawlers, RSS-to-HTML pipelines, low-power browsers) get all panels.

**Negative:**
- `TabsElement` is the second element type to nest `CanvasElement[]` (after Collection). Three is the threshold at which "elements with nested children" should be factored into a base abstraction; if a third nesting element lands (Bundle E? layout-v2?), refactor at that point. Avoid premature.
- Panel-local coordinates are a real coordinate space that authors and the editor have to learn. Same convention as Collection, but Collection's authoring UI has matured for a year; the tabs authoring UX is brand new and will surface friction the editor follow-up must address.
- Visitor JS now ships **two** delegated handler scripts when a snapshot has both copy actions and tabs. They're each ~250 bytes minified, but the precedent says "every new interactive primitive ships its own script block." If a fourth interactive primitive lands, factor them into one shared script-emit helper that registers all listeners in one block.
- Validation requires a recursive call into `validateElement` for each panel child, with the panel's dimensions as `pageWidth` / `sectionHeight` substitutes. Mirrors `validateCollectionChildren`; verify the bounds-check semantics survive the recursion.

## Follow-ups

- **Inspector UI** — tab strip (drag-to-reorder), per-tab id + label rich-text editor, "Edit panel" mode that scopes the canvas editor to the active tab's element children. Ships in the post-bundle inspector PR.
- **ARIA + keyboard navigation** — `role="tablist"` on the bar, `role="tab"` on each button, `aria-selected`, arrow-key + Home/End navigation, focus management on tab change. Documented as the first inspector-PR's a11y follow-up.
- **CSS** — each built-in style kit gains rules for `[data-opencanvas-tabs]`, `[data-tab-bar]`, `[data-opencanvas-tab-id][data-tab-active]`, `[data-opencanvas-tab-panel-id]:not([data-tab-active])`. Custom kit picks them up via the same selector contract.
- **Portfolio fixture migration** — collapse pages.home.sections `pf-stack` + `pf-work` + `pf-notes` into a single `pf-explore` section containing one `TabsElement` with three tabs. Section anchor `'about'` moves to the TabsElement's `tab.id === 'about'` (so `<a href="#about">` still resolves to the Tech-Stack tab via the existing anchor-id emission rule).
- **Bundle gaps doc** — gap #2 closes against this ADR. Layout-v2 ADR queued for sticky + drill-in + scroll-snap rail.
- **Layout-v2 ADR** — separate ADR carrying sticky positioning (gap #6), iframe drill-in overlay (gap #3), scroll-snap rail (gap #14). Author after Bundle D ships and we've seen how the tabs visitor JS pattern actually behaves under real CSP / template-author use.
