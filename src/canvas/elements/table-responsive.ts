// src/canvas/elements/table-responsive.ts
//
// Phone-collapse CSS helper for `TableElement`.
//
// ─── Strategy (inline scoped CSS) ──────────────────────────────────────────
//
// The responsive subsystem (`src/canvas/responsive/css.ts`) emits a
// `<style data-opencanvas-responsive>` block per Published Snapshot. Its rules
// govern element-box dimensions ONLY — `left/top/width/height` per breakpoint,
// `display: none` when an Owner hides an element on a breakpoint. It does not,
// and should not, carry per-element-type semantics like "collapse a table to
// stacked rows on phone." That is a TableElement-specific concern.
//
// So Table emits its own `<style>` block alongside its HTML, scoped tightly to
// `[data-opencanvas-element="<id>"]`, and uses the SAME phone media-query breakpoint
// (`PHONE_MAX_PX` from `responsive/breakpoints.ts`) so the two layers fire
// together. Visitors at a phone-band viewport see both the box-scale (from
// the responsive subsystem) and the row-stack collapse (from here) take
// effect at once.
//
// ─── Why `display: block` (not `display: grid` / `flex`) ────────────────────
//
// `display: block` on `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<td>` strips
// the native table layout and lets each `<tr>` flow as a card stacked
// vertically. The `data-label` attribute on each `<td>` carries the header
// text the gamma reference renders before each cell value; CSS `content:
// attr(data-label)` projects it into the markup without JS.
//
// `<thead>` is visually hidden (`display: none`) at this breakpoint because
// each card already prints its header inline next to the cell value. Hiding
// `<thead>` with `display: none` is acceptable for assistive tech here — the
// `data-label` text is not a screen-reader replacement (it's purely visual);
// the semantic `<th scope="col">` in `<thead>` is what an SR reads, and that
// element still exists in the DOM even when not visually rendered. Most modern
// SR (NVDA/VoiceOver) keep table semantics across `display: none` on `<thead>`
// when descended `<tr>` carry `<th scope>` references — the visual collapse
// does not change the accessible name of each cell.

import { PHONE_MAX_PX } from '../responsive/breakpoints.js';
import { escapeCssAttrId } from './render-utils.js';

/**
 * Build the phone-collapse CSS rules for a single Table element. Returns the
 * full `@media` block (with the outer `@media (max-width: 767px) { ... }`
 * wrapper); the caller composes it into a per-element `<style>` body
 * alongside the table's other CSS.
 *
 * Scoped by `[data-opencanvas-element="<elementId>"]` so two tables on the same
 * page collapse independently and the rules can never leak to anything else.
 */
export function buildTablePhoneCollapseCss(elementId: string): string {
  const scope = `[data-opencanvas-element="${escapeCssAttrId(elementId)}"]`;
  const inner = [
    // Strip native table layout.
    `${scope} table.opencanvas-table,`,
    `${scope} table.opencanvas-table thead,`,
    `${scope} table.opencanvas-table tbody,`,
    `${scope} table.opencanvas-table tr,`,
    `${scope} table.opencanvas-table td {`,
    `  display: block;`,
    `  width: 100%;`,
    `}`,
    // Hide the header row — each <td> carries its column header inline via
    // `data-label`. See file-header comment for the accessibility note.
    `${scope} table.opencanvas-table thead {`,
    `  display: none;`,
    `}`,
    // Each <tr> becomes a stacked card, separated by margin and a soft
    // divider. The kit's panel / radius tokens keep the look on-brand.
    `${scope} table.opencanvas-table tbody tr {`,
    `  margin-bottom: 12px;`,
    `  border: var(--opencanvas-kit-border-width, 1px) solid var(--opencanvas-kit-muted, #ccc);`,
    `  border-radius: var(--opencanvas-kit-radius, 6px);`,
    `  padding: 4px 0;`,
    `}`,
    // Each <td> prints its column header inline before the cell value.
    // `attr(data-label)` projects the header attribute as visual text — no
    // JS required.
    `${scope} table.opencanvas-table tbody td {`,
    `  border-bottom: 0;`,
    `  padding: 6px 12px;`,
    `  text-align: left;`,
    `}`,
    `${scope} table.opencanvas-table tbody td::before {`,
    `  content: attr(data-label) ": ";`,
    `  font-weight: 600;`,
    `  color: var(--opencanvas-kit-muted, #666);`,
    `  margin-right: 6px;`,
    `}`,
  ].join('\n');
  return `@media (max-width: ${String(PHONE_MAX_PX)}px) {\n${inner}\n}`;
}
