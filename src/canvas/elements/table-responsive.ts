// src/canvas/elements/table-responsive.ts
//
// Phone-collapse CSS helper for `TableElement`.
//
// ─── Strategy (inline scoped CSS) ──────────────────────────────────────────
//
// The Wave 1 #1 responsive subsystem (`src/canvas/responsive/css.ts`) emits a
// `<style data-rev01-responsive>` block per Published Snapshot. Its rules
// govern element-box dimensions ONLY — `left/top/width/height` per breakpoint,
// `display: none` when an Owner hides an element on a breakpoint. It does not,
// and should not, carry per-element-type semantics like "collapse a table to
// stacked rows on phone." That is a TableElement-specific concern.
//
// So Table emits its own `<style>` block alongside its HTML, scoped tightly to
// `[data-rev01-element="<id>"]`, and uses the SAME phone media-query breakpoint
// (`max-width: 767px`, matching `PHONE_MAX_PX` in `responsive/css.ts`) so the
// two layers fire together. Visitors at a phone-band viewport see both the
// box-scale (from the responsive subsystem) and the row-stack collapse (from
// here) take effect at once.
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

const PHONE_MAX_PX = 767;

/**
 * Build the phone-collapse CSS rules for a single Table element. Returns the
 * full `@media` block (with the outer `@media (max-width: 767px) { ... }`
 * wrapper); the caller composes it into a per-element `<style>` body
 * alongside the table's other CSS.
 *
 * Scoped by `[data-rev01-element="<elementId>"]` so two tables on the same
 * page collapse independently and the rules can never leak to anything else.
 */
export function buildTablePhoneCollapseCss(elementId: string): string {
  const escaped = elementId.replace(/[\\"]/g, '\\$&');
  const scope = `[data-rev01-element="${escaped}"]`;
  const inner = [
    // Strip native table layout.
    `${scope} table.rev01-table,`,
    `${scope} table.rev01-table thead,`,
    `${scope} table.rev01-table tbody,`,
    `${scope} table.rev01-table tr,`,
    `${scope} table.rev01-table td {`,
    `  display: block;`,
    `  width: 100%;`,
    `}`,
    // Hide the header row — each <td> carries its column header inline via
    // `data-label`. See file-header comment for the accessibility note.
    `${scope} table.rev01-table thead {`,
    `  display: none;`,
    `}`,
    // Each <tr> becomes a stacked card, separated by margin and a soft
    // divider. The kit's panel / radius tokens keep the look on-brand.
    `${scope} table.rev01-table tbody tr {`,
    `  margin-bottom: 12px;`,
    `  border: var(--rev01-kit-border-width, 1px) solid var(--rev01-kit-muted, #ccc);`,
    `  border-radius: var(--rev01-kit-radius, 6px);`,
    `  padding: 4px 0;`,
    `}`,
    // Each <td> prints its column header inline before the cell value.
    // `attr(data-label)` projects the header attribute as visual text — no
    // JS required.
    `${scope} table.rev01-table tbody td {`,
    `  border-bottom: 0;`,
    `  padding: 6px 12px;`,
    `  text-align: left;`,
    `}`,
    `${scope} table.rev01-table tbody td::before {`,
    `  content: attr(data-label) ": ";`,
    `  font-weight: 600;`,
    `  color: var(--rev01-kit-muted, #666);`,
    `  margin-right: 6px;`,
    `}`,
  ].join('\n');
  return `@media (max-width: ${String(PHONE_MAX_PX)}px) {\n${inner}\n}`;
}
