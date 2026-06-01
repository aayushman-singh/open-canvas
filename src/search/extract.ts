// src/search/extract.ts
//
// Pure functions that walk a Published Snapshot and produce one search entry
// per text-bearing element. The Postgres FTS column (`tsv`, generated from
// `text` via `to_tsvector('english', text)`) is populated downstream by the
// indexer; this module only knows about flat strings.
//
// Element-text extraction rules (per the plan brief §"Scope in"):
//
//   text       → join each InlineRun's `text` with a single space.
//   action     → the `label` field.
//   embed      → the optional `title` field (skipped when absent).
//   chart      → `xAxisTitle` + `yAxisTitle` if present, joined by spaces.
//   code       → the first non-blank line of `source`. The brief asks for the
//                first line only — code bodies bloat the index and are rarely
//                what visitors search by. Leading blank lines are skipped so
//                an Owner who pads their snippet doesn't get an empty entry.
//   table      → each column.header, plus each cell of each row, joined by
//                spaces. One entry per table element (not per cell).
//
// The PAGE-LEVEL contributions (page.title, page.description) are emitted as
// synthetic entries keyed by `elementId = '__page'`. The double-underscore
// prefix is reserved by convention for this subsystem so a result consumer
// can tell page-level hits from element-level hits without an extra column.
// A pathological Owner who chose `__page` as a real element id would end up
// with two rows for the same (siteId, pageSlug, elementId) triple — the
// table has no DB-level unique on that triple — and both rows would hit on
// the same query; the result consumer would simply see two snippets.
//
// Output guarantees:
//   - One entry per text-bearing element, plus at most one synthetic
//     `__page` entry per page (carrying title + description joined by a
//     space). Element ids are taken verbatim from the snapshot; the indexer
//     does not de-dup beyond what the canvas validator already enforces
//     (element ids unique within a page).
//   - Empty `text` entries are skipped — they would just blow up the index
//     without contributing to any match.
//   - The output is deterministic given the same snapshot (entries are
//     emitted in page → section → element order).

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  PublishedSnapshot,
  TextElement,
} from '../canvas/schema.js';
import type { ChartElement } from '../canvas/elements/chart.js';
import type { CodeElement } from '../canvas/elements/code.js';
import type { EmbedElement } from '../canvas/elements/embed.js';
import type { TableElement } from '../canvas/elements/table.js';

export interface SearchEntryDraft {
  pageSlug: string;
  elementId: string;
  text: string;
}

/** Sentinel element id used for page-level metadata (title + description). */
export const PAGE_METADATA_ELEMENT_ID = '__page';

function joinPlainText(parts: ReadonlyArray<string | undefined | null>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ');
}

function extractTextElement(el: TextElement): string {
  // Inline runs concatenated by a space — preserves word boundaries between
  // adjacent runs that an Owner split for styling (e.g. "Ship a site that
  // feels " + "lived-in" + ".").
  const parts = el.content.map((run) => run.text);
  return joinPlainText(parts);
}

function extractChartElement(el: ChartElement): string {
  return joinPlainText([el.xAxisTitle, el.yAxisTitle]);
}

function extractCodeElement(el: CodeElement): string {
  // First non-blank line. Keeps the index focused on the snippet header
  // (typically a function signature or top-of-file comment).
  const lines = el.source.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}

function extractEmbedElement(el: EmbedElement): string {
  return typeof el.title === 'string' ? el.title.trim() : '';
}

function extractTableElement(el: TableElement): string {
  const headerParts = el.columns.map((c) => c.header);
  const cellParts: string[] = [];
  for (const row of el.rows) {
    for (const col of el.columns) {
      const cell = row.cells[col.id];
      if (typeof cell === 'string' && cell.length > 0) {
        cellParts.push(cell);
      }
    }
  }
  return joinPlainText([...headerParts, ...cellParts]);
}

/**
 * Extract searchable text from a single element. Returns `null` when the
 * element type is not text-bearing OR the element has no extractable text.
 */
export function extractElementText(el: CanvasElement): string | null {
  let raw: string;
  switch (el.type) {
    case 'text':
      raw = extractTextElement(el);
      break;
    case 'action':
      raw = el.label.map((run) => run.text).join('');
      break;
    case 'embed':
      raw = extractEmbedElement(el);
      break;
    case 'chart':
      raw = extractChartElement(el);
      break;
    case 'code':
      raw = extractCodeElement(el);
      break;
    case 'table':
      raw = extractTableElement(el);
      break;
    // The following element types intentionally do not contribute searchable
    // text:
    //   - media: alt/caption are handled by the a11y subsystem (#15).
    //   - shape, container: decorative.
    //   - accordion, carousel, form, nav: not part of the Wave-3 scope. The
    //     plan's scope list explicitly enumerates the supported types.
    default:
      return null;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractSectionEntries(
  pageSlug: string,
  section: CanvasSection,
  out: SearchEntryDraft[],
): void {
  for (const el of section.elements) {
    const text = extractElementText(el);
    if (text === null) continue;
    out.push({ pageSlug, elementId: el.id, text });
  }
}

function extractPageMetadata(page: CanvasPage): string {
  return joinPlainText([page.title, page.description]);
}

function extractPageEntries(page: CanvasPage, out: SearchEntryDraft[]): void {
  const metaText = extractPageMetadata(page);
  if (metaText.length > 0) {
    out.push({
      pageSlug: page.slug,
      elementId: PAGE_METADATA_ELEMENT_ID,
      text: metaText,
    });
  }
  for (const section of page.sections) {
    extractSectionEntries(page.slug, section, out);
  }
}

/**
 * Walk a Published Snapshot and produce one SearchEntryDraft per
 * text-bearing element, plus one synthetic per-page metadata entry. The
 * caller (indexer) is responsible for stamping `siteId` and
 * `publishedVersion` onto each row.
 */
export function extractSearchEntries(snapshot: PublishedSnapshot): SearchEntryDraft[] {
  const drafts: SearchEntryDraft[] = [];
  for (const page of snapshot.pages) {
    extractPageEntries(page, drafts);
  }
  return drafts;
}
