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
// ----------------------------------------------------------------------------
// Retired fields kept as optional during the Phase 1 transition
// ----------------------------------------------------------------------------
// `mode`, `entryTemplate`, `entries`, `cardTemplate`, `fieldBindings`,
// `filter`, and `layout` belonged to the page-bound model ADR 0063 retires.
// They are still declared (optional, `_legacy*` typed) so the Phase 2D
// `collections-scaffold.ts` and other queued rewrites still compile against
// the new schema during the multi-commit migration. The validator does not
// require them; the new materializer (Phase 2B) does not read them. They
// will be removed in a follow-up cleanup commit on this branch.

import type { BaseElement, CanvasElement } from '../schema.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, styleFromEntries } from './render-utils.js';

/**
 * Display mode for the materializer's per-entry render path (ADR 0063 dec 4).
 *
 *  - `'image-only'` — renders one `<a><img></a>` per entry inside the
 *    Collection's frame. No template required.
 *  - `'card'` — default on insert; clones a built-in default card template
 *    per entry (image + title + excerpt + CTA). Default template lives at
 *    `src/canvas/elements/collection-defaults.ts` (Phase 2B).
 *
 * `'custom'` is a follow-up (ADR 0063 F1) and is not part of this union.
 */
export const COLLECTION_DISPLAYS = ['image-only', 'card'] as const;
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

// ----------------------------------------------------------------------------
// Legacy fields — retired by ADR 0063, kept structurally during transition
// ----------------------------------------------------------------------------

/** @deprecated ADR 0063 retired the page-bound mode. Carry-over only so the
 *  Phase 2D collections-scaffold rewrite can still reference the name. */
export const PAGE_METADATA_FIELDS = [
  'title',
  'description',
  'ogImage',
  'publishedDate',
  'author',
  'tags',
  'category',
] as const;
/** @deprecated ADR 0063 — see PAGE_METADATA_FIELDS. */
export type PageMetadataField = (typeof PAGE_METADATA_FIELDS)[number];

/** @deprecated ADR 0063 dec 1 — the page-bound binding model is retired. */
export type CollectionMode = 'manual' | 'page-bound';

/** @deprecated ADR 0063 dec 1 — superseded by element-level `collectionSlug` + `folder`. */
export interface CollectionFilter {
  category?: string;
  tags?: string[];
  limit?: number;
}

/** @deprecated ADR 0063 dec 4 — superseded by built-in card defaults. */
export interface CollectionLayout {
  columns: number;
  gap: number;
}

/** @deprecated ADR 0063 dec 1 — superseded by the string-union `sort` field. */
export interface LegacyCollectionSortObject {
  field: 'publishedDate' | 'title';
  order: 'asc' | 'desc';
}

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
   * `exactOptionalPropertyTypes` and lets the Phase 2D scaffolding
   * compile without re-declaring the field on every constructor.
   */
  collectionSlug?: string;
  /**
   * Optional folder filter. When set, only entries whose
   * `collection_entry.folder` column matches are included. Absent = all
   * entries in the slug (ADR 0063 dec 7).
   */
  folder?: string;
  /**
   * Entry ordering. The new shape defaults to `'date-desc'` on insert via
   * `collection-defaults.ts`; the legacy object form `{ field, order }` is
   * accepted at the type level during the multi-commit migration so
   * Phase 2D's collections-scaffold and pre-ADR-0063 fixtures still compile.
   * Optional during the transition so legacy fixtures without `sort` keep
   * type-checking; the new validator only accepts the string-union form
   * when present.
   */
  sort?: CollectionSort | LegacyCollectionSortObject;
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

  // -- Legacy fields (retired by ADR 0063, structurally kept) ----------------
  /** @deprecated ADR 0063 dec 1. */
  mode?: CollectionMode;
  /** @deprecated ADR 0063 dec 1. */
  entryTemplate?: CanvasElement[];
  /** @deprecated ADR 0063 dec 6 — materializer output, not authorable. */
  entries?: CanvasElement[][];
  /** @deprecated ADR 0063 dec 1 — superseded by `folder`. */
  filter?: CollectionFilter;
  /** @deprecated ADR 0063 dec 4 — superseded by built-in card defaults. */
  cardTemplate?: CanvasElement[];
  /** @deprecated ADR 0063 dec 4 — bindings are built into the default card. */
  fieldBindings?: Record<string, PageMetadataField>;
  /** @deprecated ADR 0063 — layout is now derived from the display mode. */
  layout?: CollectionLayout;
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
 */
export function renderCollection(el: CollectionElement, _ctx: CollectionRenderCtx): string {
  const frameStyle = styleFromEntries([
    ['display', 'block'],
    ['position', 'relative'],
  ]);
  const slugAttr = el.collectionSlug !== undefined ? escapeAttr(el.collectionSlug) : '';
  const folderAttr = el.folder !== undefined ? escapeAttr(el.folder) : '';
  const sortAttr =
    el.sort === undefined
      ? 'date-desc'
      : typeof el.sort === 'string'
        ? el.sort
        : `${el.sort.field}-${el.sort.order}`;
  const displayAttr = el.display ?? 'card';
  return (
    `<div class="opencanvas-collection" data-opencanvas-interactive="collection"` +
    ` data-collection-display="${escapeAttr(displayAttr)}"` +
    ` data-collection-sort="${escapeAttr(sortAttr)}"` +
    ` data-collection-slug="${slugAttr}"` +
    ` data-collection-folder="${folderAttr}"` +
    ` style="${escapeAttr(frameStyle)}"></div>`
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

// Sidebar entry for Collection is added by Phase 2D (ADR 0063 dec 9).
// The empty commands array keeps the SidebarDispatch mapped-type contract
// satisfied without surfacing a button this commit can't fully wire.
export const collectionSidebarSpec: SidebarSpec = {
  commands: [],
};
