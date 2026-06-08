// src/canvas/elements/collection.ts
//
// Collection element — ADR 0063.
//
// A Collection binds to a single named source (`collectionSlug` on the
// element itself), optionally narrowed by `folder`, ordered by `sort`, and
// rendered via a `display` mode. The materializer (Phase 2B) reads these
// fields plus the `collection_entry` table to produce per-entry card DOM
// at publish time and per-entry placeholder DOM in the editor.
//
// Source binding lives on the element (not the page) so realistic homepages
// can compose "Latest blog" + "Recent case studies" + "Featured projects"
// as three Collection elements on one page (ADR 0063 dec 1).
//
// `entries: CanvasElement[][]` is load-bearing: the materializer WRITES
// per-entry cloned templates into this slot at publish time, and downstream
// renderers (`canvas/render.ts`, `interactive/inject.ts`) iterate the matrix.
// Per-entry instances are materializer output, not authorable elements
// (ADR 0063 dec 6).

import type { BaseElement, CanvasElement } from '../schema.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, styleFromEntries } from './render-utils.js';

/**
 * Display mode for the materializer's per-entry render path (ADR 0063 dec 4,
 * extended by ADR 0065 D1).
 *
 *  - `'image-only'` — renders one `<a><img></a>` per entry inside the
 *    Collection's frame. No template required.
 *  - `'card'` — default on insert; clones a built-in default card template
 *    per entry (image + title + excerpt + CTA). Default template lives at
 *    `src/canvas/elements/collection-defaults.ts`.
 *  - `'custom'` — ADR 0065 D1: clones the per-Collection `customTemplate`
 *    per entry instead of `DEFAULT_CARD_TEMPLATE`. Substitution semantics
 *    and click-bubble behaviour are otherwise identical to `'card'`.
 */
export const COLLECTION_DISPLAYS = ['image-only', 'card', 'custom'] as const;
export type CollectionDisplay = (typeof COLLECTION_DISPLAYS)[number];

/**
 * Sort order for the materialized entry list (ADR 0063 dec 1 + dec 8).
 *
 *  - `'date-desc'` — default on insert; entries newest-first by
 *    `collection_entry.published_date`.
 *  - `'date-asc'` — entries oldest-first.
 *  - `'manual'` — entries appear in `manualOrder` (a list of entry IDs the
 *    Owner curates via the inspector's reel UI).
 */
export const COLLECTION_SORTS = ['date-desc', 'date-asc', 'manual'] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export interface CollectionElement extends BaseElement {
  type: 'collection';

  // -- ADR 0063 canonical fields ---------------------------------------------
  /**
   * Source binding — names the `collection_entry.collection_slug` to pull
   * entries from. Absent (or `undefined`) means "unbound": the editor
   * renders placeholder cards plus an inline "Pick a source" prompt
   * (ADR 0063 dec 5); the publish-time materializer emits zero cards plus
   * a warning line. The ADR contract reads `string | undefined`; the
   * `?: string` form is the same shape under TypeScript's
   * `exactOptionalPropertyTypes`.
   */
  collectionSlug?: string;
  /**
   * Optional folder filter. When set, only entries whose
   * `collection_entry.folder` column matches are included. Absent = all
   * entries in the slug (ADR 0063 dec 7).
   */
  folder?: string;
  /**
   * Entry ordering (ADR 0063 dec 1 + dec 8). Optional during the multi-commit
   * Phase 1 transition so legacy fixtures without `sort` keep type-checking;
   * the materializer treats absence as `'date-desc'`.
   */
  sort?: CollectionSort;
  /**
   * Ordered list of `collection_entry.id` values. Present iff
   * `sort === 'manual'`. Entries added to the source after `manualOrder` was
   * last set are appended at materialization time; entries removed from the
   * source are stripped lazily on the next inspector render (ADR 0063 dec 8).
   */
  manualOrder?: string[];
  /**
   * Per-entry render mode. Default `'card'` on insert (ADR 0063 dec 4).
   * Optional during the transition so Phase 2 rewrites can land in
   * isolated commits; required at runtime by the validator once Phase 2B
   * tightens.
   */
  display?: CollectionDisplay;

  /**
   * Per-entry instances written by the materializer (ADR 0063 dec 6).
   * The materializer is the only writer; downstream renderers
   * (`canvas/render.ts`, `interactive/inject.ts`) iterate the matrix to
   * emit per-entry DOM. NOT authorable — clicks on per-entry DOM bubble to
   * the parent Collection (ADR 0063 dec 6).
   */
  entries?: CanvasElement[][];

  /**
   * ADR 0065 D2 — per-Collection custom card template. When
   * `display === 'custom'`, the materializer clones this array per entry
   * (substituting `{{title}}` / `{{excerpt}}` / `{{slug}}` /
   * `{{ogImageAssetId}}` / `{{author}}` / `{{publishedDate}}` /
   * `{{category}}` / `{{tag}}` / `{{body}}`) instead of
   * `DEFAULT_CARD_TEMPLATE`.
   *
   * Absent when `display` has never been `'custom'` for this Collection.
   * Once set, persists across mode switches (ADR 0065 D4 — silent keep):
   * toggling back to `'card'` or `'image-only'` does NOT clear the field;
   * the only path to discard is the inspector's "Reset template" affordance
   * (Phase 2C).
   *
   * Validator recurses into this array the same way it recurses into a
   * page's section elements; Yjs encodes/decodes it like any other
   * `CanvasElement[]` subtree.
   */
  customTemplate?: CanvasElement[];
}

export interface CollectionRenderCtx {
  styleKit: string;
  assetBasePath: string;
  /**
   * @deprecated ADR 0063 dec 6 — the new Collection renderer does not emit
   * per-child wrappers (per-entry DOM is materializer output). Kept on the
   * ctx so the existing `RENDER_DISPATCH` wiring in `elements/index.ts`
   * compiles unchanged until the index rewires the dispatch shape.
   */
  renderChild?: (element: CanvasElement) => string;
}

/**
 * Server-side render for a published Collection element. The materializer
 * (Phase 2B) is what turns `collectionSlug` + entry rows into card DOM
 * inside this frame; this function only emits the frame itself plus a
 * data-attr trail so the public renderer can hydrate per-entry content
 * during the materialization pass.
 *
 * Both `sort` and `display` are explicitly narrowed to their string-enum
 * shapes at this boundary. Legacy in-DB rows (pre-ADR-0063 F5) sometimes
 * carry the deprecated `sort: { field, order }` object — the validator
 * rejects those at write time, but the publish/thumb paths re-render
 * historical JSONB without re-running the validator, so the renderer
 * must guard the type itself. We throw a descriptive error rather than
 * silently coercing because the no-fallback principle (CLAUDE.md) wants
 * the caller to see exactly which element is malformed.
 */
export function renderCollection(el: CollectionElement, _ctx: CollectionRenderCtx): string {
  const frameStyle = styleFromEntries([
    ['display', 'block'],
    ['position', 'relative'],
  ]);
  const slugAttr = el.collectionSlug !== undefined ? escapeAttr(el.collectionSlug) : '';
  const folderAttr = el.folder !== undefined ? escapeAttr(el.folder) : '';
  const sortAttr = readSortString(el);
  const displayAttr = readDisplayString(el);
  return (
    `<div class="opencanvas-collection" data-opencanvas-interactive="collection"` +
    ` data-collection-display="${escapeAttr(displayAttr)}"` +
    ` data-collection-sort="${escapeAttr(sortAttr)}"` +
    ` data-collection-slug="${slugAttr}"` +
    ` data-collection-folder="${folderAttr}"` +
    ` style="${escapeAttr(frameStyle)}"></div>`
  );
}

function readSortString(el: CollectionElement): CollectionSort {
  if (el.sort === undefined) return 'date-desc';
  if ((COLLECTION_SORTS as readonly string[]).includes(el.sort)) {
    return el.sort;
  }
  throw new Error(
    `Collection element ${el.id}: sort has malformed value ${JSON.stringify(el.sort)}; ` +
      `expected one of ${COLLECTION_SORTS.join(' | ')}. ` +
      `Legacy in-DB rows from pre-ADR-0063 carry sort as an object — ` +
      `open the page in the editor to let the migration normalise it, ` +
      `or backfill the JSONB to a string enum.`,
  );
}

function readDisplayString(el: CollectionElement): CollectionDisplay {
  if (el.display === undefined) return 'card';
  if ((COLLECTION_DISPLAYS as readonly string[]).includes(el.display)) {
    return el.display;
  }
  throw new Error(
    `Collection element ${el.id}: display has malformed value ${JSON.stringify(el.display)}; ` +
      `expected one of ${COLLECTION_DISPLAYS.join(' | ')}.`,
  );
}

export const COLLECTION_RECIPE_ID = 'collection-grid' as const;

// Collection has no per-type agent surface: the LLM cannot directly add or
// update a collection via the cross-element tools. Shared fields (box,
// motion, elementStyle) still apply via updateElement at canvas-tools.ts.
// The empty spec exists so the dispatch can satisfy its mapped-type contract
// without forcing the canvas-tools merger to special-case "missing entry."
export const collectionAgentToolSpec: AgentToolSpec = {
  patchProperties: {},
  parsePatch: () => ({}),
};

// Collection has no per-element sidebar command: bare CollectionElement
// instances would orphan without an index page, template page, and at least
// one entry. The Add panel surfaces a dedicated "+ New Collection" button
// that calls the full scaffold flow (src/editor-client/collection-scaffold.ts
// + POST /api/sites/:siteId/collections) instead. The empty commands array
// satisfies the dispatch's mapped-type contract.
// Sidebar entry for Collection is added by Phase 2D (ADR 0063 dec 9).
// The empty commands array keeps the SidebarDispatch mapped-type contract
// satisfied without surfacing a button this commit can't fully wire.
export const collectionSidebarSpec: SidebarSpec = {
  commands: [],
};
