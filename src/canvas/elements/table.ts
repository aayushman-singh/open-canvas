// src/canvas/elements/table.ts
//
// Wishlist #18 — Table primitive (Wave 4).
//
// Renders a semantic `<table>` with `<thead>` / `<tbody>` / `<th>` / `<td>`
// nodes for a `TableElement`. Owner-controlled fields:
//
//   - columns:           ordered list, drives `<th>` order and per-cell mapping.
//   - rows:              ordered list, each row's `cells[columnId]` supplies
//                        the `<td>` text. Missing cells render empty (the
//                        Owner has not filled that intersection).
//   - zebra:             when true, every other `<tbody>` row carries a
//                        zebra-stripe background (`tbody tr:nth-child(2n)`).
//   - collapseOnPhone:   when true, the element emits a scoped `@media`
//                        block that turns each row into a stacked card on
//                        phone-band viewports (< 768px). Each `<td>` keeps
//                        a `data-label="<header>"` attribute so the
//                        stacked-card CSS can render `"Header" Value` rows.
//
// Per-column `align?: 'left' | 'center' | 'right'` is an additive field that
// produces a `text-align` declaration on both the `<th>` and matching `<td>`s.
//
// ─── Styling / Style Kit usage ─────────────────────────────────────────────
//
// The renderer emits a scoped `<style>` block alongside the table HTML. Why
// scoped + inline (instead of pushing rules into the global kit stylesheet or
// the responsive `<style>` block):
//
//   1. The responsive subsystem (src/canvas/responsive/css.ts) only emits box
//      dimensions (`left/top/width/height/display:none`) per element. It does
//      NOT carry table-collapse rules; that is a per-element-type concern.
//   2. Pushing table rules into the global kit stylesheet (src/canvas/style-kits.ts)
//      is forbidden for Wave 4 — that file is frozen.
//   3. Per-table inline `<style>` keeps the rules co-located with the markup
//      that needs them, scoped tightly by `[data-rev01-element="<id>"]` so two
//      tables on the same page never collide.
//
// Borders / padding / zebra colour pull from the live Style Kit tokens
// (`--rev01-kit-border-width`, `--rev01-kit-radius`, `--rev01-kit-panel`,
// `--rev01-kit-muted`, `--rev01-kit-text`, `--rev01-kit-action-padding`).
// Those tokens are emitted onto the `[data-style-kit]` page wrapper by the
// kit-CSS builder; we reference them via `var(...)` so the table inherits the
// active kit's look without re-declaring per-kit selectors.
//
// Defaults documented at the top of `renderTable`:
//   - border:       1px solid <muted> (via `var(--rev01-kit-muted, #ccc)`)
//   - cell padding: var(--rev01-kit-action-padding, 8px 12px)
//   - zebra colour: var(--rev01-kit-panel, rgba(0,0,0,0.04))
//   - radius:       var(--rev01-kit-radius, 6px) on the wrapping table

import type { BaseElement } from '../schema.js';

import { escapeAttr, escapeHtml } from './render-utils.js';
import { buildTablePhoneCollapseCss } from './table-responsive.js';

export interface TableColumn {
  id: string;
  header: string;
  /** Per-column text alignment. Absent = inherit (browser default = left). */
  align?: 'left' | 'center' | 'right';
}

export interface TableRow {
  id: string;
  /** column id → cell text. Cells absent from this record render as empty. */
  cells: Record<string, string>;
}

export interface TableElement extends BaseElement {
  type: 'table';
  columns: TableColumn[];
  rows: TableRow[];
  zebra: boolean;
  collapseOnPhone: boolean;
}

export interface TableRenderCtx {
  styleKit: string;
}

/**
 * CSS selector prefix used by every rule the table emits — keeps rules
 * scoped to this element only. The renderer wraps each element in
 * `<div class="rev01-element" data-rev01-element="<id>" ...>`, so this
 * selector matches that wrapper and only that wrapper.
 */
// REVIEW: `elementId` is interpolated directly into a CSS attribute selector without escaping. If an element ID contains `"]` or other selector-special characters, it can break the selector or inject CSS rules. Use CSS.escape() or the project's escapeCssValue() from render-utils.ts to sanitize.
function scopeSelector(elementId: string): string {
  return `[data-rev01-element="${elementId}"]`;
}

/**
 * The per-table base CSS. `var(...)` calls pull the active Style Kit's
 * tokens; the fallbacks are sensible neutral defaults that keep the table
 * legible when the kit-token block has not been emitted (e.g. an isolated
 * snapshot rendered without `[data-style-kit]` on the wrapper).
 *
 * - `border-collapse: collapse` so adjacent cell borders draw as a single
 *   stroke (`1px solid` x2 would otherwise paint a 2px stripe).
 * - `width: 100%` so the table fills its element box (the wrapper already
 *   carries the absolute width from the Owner's `box.w`).
 */
function buildBaseCss(elementId: string): string {
  const scope = scopeSelector(elementId);
  return [
    `${scope} table.rev01-table {`,
    `  border-collapse: collapse;`,
    `  width: 100%;`,
    `  font-family: var(--rev01-kit-font-body, system-ui, sans-serif);`,
    `  color: var(--rev01-kit-text, #111);`,
    `  border: var(--rev01-kit-border-width, 1px) solid var(--rev01-kit-muted, #ccc);`,
    `  border-radius: var(--rev01-kit-radius, 6px);`,
    `  overflow: hidden;`,
    `}`,
    `${scope} table.rev01-table th,`,
    `${scope} table.rev01-table td {`,
    `  padding: var(--rev01-kit-action-padding, 8px 12px);`,
    `  border-bottom: var(--rev01-kit-border-width, 1px) solid var(--rev01-kit-muted, #ccc);`,
    `  text-align: left;`,
    `}`,
    `${scope} table.rev01-table thead th {`,
    `  background: var(--rev01-kit-panel, rgba(0, 0, 0, 0.04));`,
    `  font-weight: 600;`,
    `}`,
    `${scope} table.rev01-table tbody tr:last-child td {`,
    `  border-bottom: 0;`,
    `}`,
  ].join('\n');
}

/**
 * Zebra-stripe CSS. Uses `2n+1` (= odd) on the body so the first row carries
 * the stripe; that matches the gamma.app visual convention and is what the
 * smoke test asserts.
 */
function buildZebraCss(elementId: string): string {
  const scope = scopeSelector(elementId);
  return [
    `${scope} table.rev01-table tbody tr:nth-child(2n+1) td {`,
    `  background: var(--rev01-kit-panel, rgba(0, 0, 0, 0.04));`,
    `}`,
  ].join('\n');
}

/**
 * Per-column text-align rules. Only emit a rule when the column declares an
 * explicit alignment — the default (`left`) is already covered by the base
 * CSS. Targeting by `nth-child` keeps the markup small (no extra class per
 * column) at the cost of one rule per non-default column.
 *
 * Column index is 1-based to match `nth-child`.
 */
function buildAlignmentCss(elementId: string, columns: TableColumn[]): string {
  const scope = scopeSelector(elementId);
  const rules: string[] = [];
  columns.forEach((col, idx) => {
    if (!col.align || col.align === 'left') return;
    const n = idx + 1;
    rules.push(
      `${scope} table.rev01-table th:nth-child(${String(n)}),`,
      `${scope} table.rev01-table td:nth-child(${String(n)}) {`,
      `  text-align: ${col.align};`,
      `}`,
    );
  });
  return rules.join('\n');
}

export function renderTable(el: TableElement, ctx: TableRenderCtx): string {
  void ctx; // styleKit reaches us via CSS custom properties on the page wrapper.

  // --- Build the scoped <style> block --------------------------------------
  const cssParts: string[] = [buildBaseCss(el.id)];
  if (el.zebra) cssParts.push(buildZebraCss(el.id));
  const alignmentCss = buildAlignmentCss(el.id, el.columns);
  if (alignmentCss) cssParts.push(alignmentCss);
  if (el.collapseOnPhone) cssParts.push(buildTablePhoneCollapseCss(el.id));
  const styleBlock = `<style data-rev01-table="${escapeAttr(el.id)}">${cssParts.join('\n')}</style>`;

  // --- Build the table body ------------------------------------------------
  const theadHtml = renderThead(el.columns);
  const tbodyHtml = renderTbody(el.columns, el.rows);

  // Note: when there are zero columns AND zero rows, we still emit a well-
  // formed (empty) `<table>` — the brief calls out "no rows / no columns
  // renders an empty `<table>` w/o crash."
  return (
    `${styleBlock}` +
    `<table class="rev01-table" data-rev01-zebra="${el.zebra ? 'true' : 'false'}" data-rev01-collapse-on-phone="${el.collapseOnPhone ? 'true' : 'false'}">` +
    `${theadHtml}` +
    `${tbodyHtml}` +
    `</table>`
  );
}

function renderThead(columns: TableColumn[]): string {
  if (columns.length === 0) return '';
  const cells = columns.map((col) => `<th scope="col">${escapeHtml(col.header)}</th>`).join('');
  return `<thead><tr>${cells}</tr></thead>`;
}

function renderTbody(columns: TableColumn[], rows: TableRow[]): string {
  // Always emit a `<tbody>` (even when empty) so the markup is structurally
  // stable. The smoke test counts `<tr>` and `<td>`, both of which are
  // produced inside this body when there are any rows.
  if (rows.length === 0) return '<tbody></tbody>';
  const trs = rows
    .map((row) => {
      const tds = columns
        .map((col) => {
          const value = row.cells[col.id] ?? '';
          // `data-label` carries the column header so the phone-collapse CSS
          // can render "Header: Value" stacked rows without JS. Escape as an
          // attribute, escape the body as HTML.
          return `<td data-label="${escapeAttr(col.header)}">${escapeHtml(value)}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<tbody>${trs}</tbody>`;
}

export const TABLE_RECIPE_ID = 'table-card' as const;
