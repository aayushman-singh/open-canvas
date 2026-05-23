# canvas/responsive

**Wishlist #:** 1  **Plan:** [`docs/superpowers/plans/2026-05-23-01-responsive-canvas.md`](../../../docs/superpowers/plans/2026-05-23-01-responsive-canvas.md)
**Status:** implemented in Wave 1.

Translates positioned-canvas px into fluid published layout across three
named breakpoints (desktop / tablet / phone). Honors optional per-Element
`responsive` overrides.

## Engine choice — `@media` over `@container`

The brief offered two CSS engines: viewport `@media` queries or container
queries on `.rev01-section`. We picked `@media`.

**Why not container queries.** A container query against a `.rev01-section`
requires the section to declare `container-type: inline-size`. The Phase 0
renderer (`src/canvas/render.ts`) already emits an inline
`style="position:relative; width:<pageWidth>px; height:<sectionHeight>px"` on
every section wrapper. Inline styles win over external rules; the fixed
desktop pixel width therefore freezes the container at the page's design
width and the `@container (max-width: ...)` rules NEVER fire below it. The
only escape is to either (a) edit the renderer's section-emit code to add
`container-type` and remove the fixed width — the brief forbids touching
`render.ts` beyond the single injection hook — or (b) override the inline
width via the responsive style block itself, which is the same level of
ergonomic complexity as just using `@media` to start with.

**Why `@media` works cleanly.** Viewport media queries against
`max-width: 1023px` and `max-width: 767px` fire based on the Visitor's
window size, completely independent of the inline section width. We
override the page/section/element pixel dimensions via element-id-keyed
selectors carrying the `!important` flag, which is the only mechanism that
can win over the renderer's inline `style="..."` declarations.

**Trade-off.** Container queries would let an Owner embed a Site inside an
iframe at any width and see the same breakpoint transitions. With viewport
queries the iframe always reports the host page's viewport width — a Site
embedded at 400px wide inside a 1440px window still renders desktop layout.
That edge case is not a Phase 1 user-visible outcome and is documented as a
known limitation; switching to container queries is a one-line engine flip
once the renderer-section-emit constraint relaxes.

## Scaling formula

Each named breakpoint has a fixed "design width" the page is rendered at
when the Visitor's viewport falls into that band:

```
desktop  = page.width             (source-of-truth, e.g. 1440)
tablet   = TABLET_DESIGN_WIDTH    (1023 — top edge of tablet band)
phone    = PHONE_DESIGN_WIDTH     (375  — typical iPhone width)
```

Scale factor at a breakpoint is `breakpointWidth / page.width`. Every
element box dimension at that breakpoint is the desktop value times the
scale, rounded to the nearest integer pixel:

```
resolved.x = round(box.x * scale)
resolved.y = round(box.y * scale)
resolved.w = round(box.w * scale)
resolved.h = round(box.h * scale)
```

An Owner-authored `ResponsiveBoxOverride` supersedes the scaled value
field-by-field. `hidden: true` collapses to `display: none` at that
breakpoint and the resolved box dimensions become irrelevant.

Why fixed design widths rather than true fluid interpolation? CSS media
queries cannot dynamically interpolate between viewport widths without
JavaScript. The brief forbids visitor-side JS, so we snap to three design
widths. Visitors at 400px (phone band) see the page rendered at 375px,
centred — the same behaviour as gamma.app's published sites.

## Public API

```ts
import { renderResponsiveCss } from './index.js';

renderResponsiveCss(snapshot); // → '<style data-rev01-responsive>...</style>'
                               //   or '' when the snapshot needs no overrides.
```

The renderer (`src/canvas/render.ts`) calls this once per snapshot and
injects the returned string verbatim ahead of `pagesHtml` inside the
`<main class="rev01-site">` wrapper. When the function returns `''`,
existing fixtures render byte-for-byte identical to the pre-responsive
output.

## Smoke

```sh
bun run responsive:smoke
```

Asserts: (1) one `<style data-rev01-responsive>` block per snapshot,
(2) tablet + phone `@media` markers present, (3) `display: none` for an
element with `responsive.phone.hidden = true`, (4) box scales proportionally
within ±1px tolerance, (5) zero `<script>` substring in the wrapped output.
