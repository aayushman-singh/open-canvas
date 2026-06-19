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
import {
  COLLECTION_STYLE_SPEC,
  componentStylePatchProperty,
  parseComponentStylePatchValue,
} from './component-style.js';
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

export const COLLECTION_GALLERY_MODES = ['hover-reveal-detail'] as const;
export type CollectionGalleryMode = (typeof COLLECTION_GALLERY_MODES)[number];

export const COLLECTION_GALLERY_DETAIL_MODES = ['inline-panel'] as const;
export type CollectionGalleryDetailMode = (typeof COLLECTION_GALLERY_DETAIL_MODES)[number];

export const COLLECTION_GALLERY_REDUCED_MOTION_MODES = ['instant', 'allow'] as const;
export type CollectionGalleryReducedMotionMode =
  (typeof COLLECTION_GALLERY_REDUCED_MOTION_MODES)[number];

export interface CollectionGalleryBehaviour {
  mode: CollectionGalleryMode;
  detailMode: CollectionGalleryDetailMode;
  reducedMotion: CollectionGalleryReducedMotionMode;
}

export interface CollectionStyle {
  gridGap?: number;
  cardBackgroundColor?: string;
  cardBorderColor?: string;
  cardBorderWidth?: number;
  cardBorderRadius?: number;
  cardShadow?: string;
  cardPadding?: number;
  cardImageRadius?: number;
  imageOnlyGap?: number;
  imageOnlyRadius?: number;
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
   * Gallery v2 behaviour: hover/focus reveal plus active inline detail state.
   * Optional because absence means the Collection renders in its normal display mode.
   */
  gallery?: CollectionGalleryBehaviour;

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

  /** ADR 0067 — sparse host-level Collection Component Style overrides. */
  collectionStyle?: CollectionStyle;
}

export interface CollectionRenderCtx {
  styleKit: string;
  assetBasePath: string;
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
export function renderCollection(el: CollectionElement, ctx: CollectionRenderCtx): string {
  const displayAttr = readDisplayString(el);
  const frameStyle = styleFromEntries([
    ['display', 'flex'],
    ['flex-wrap', 'wrap'],
    [
      'gap',
      displayAttr === 'image-only'
        ? 'var(--opencanvas-collection-image-only-gap, var(--opencanvas-collection-grid-gap, 16px))'
        : 'var(--opencanvas-collection-grid-gap, 16px)',
    ],
    ['align-content', 'flex-start'],
    ['position', 'relative'],
  ]);
  const slugAttr = el.collectionSlug !== undefined ? escapeAttr(el.collectionSlug) : '';
  const folderAttr = el.folder !== undefined ? escapeAttr(el.folder) : '';
  const sortAttr = readSortString(el);
  const gallery = readGalleryBehaviour(el);
  const galleryAttrs = gallery
    ?
      ` data-opencanvas-collection-gallery="${escapeAttr(gallery.mode)}"` +
      ` data-opencanvas-collection-gallery-detail="${escapeAttr(gallery.detailMode)}"` +
      ` data-opencanvas-collection-gallery-reduced-motion="${escapeAttr(gallery.reducedMotion)}"`
    : '';
  const entriesHtml = renderCollectionEntries(el, ctx, gallery);
  return (
    `<div class="opencanvas-collection" data-opencanvas-interactive="collection"` +
    ` data-collection-display="${escapeAttr(displayAttr)}"` +
    ` data-collection-sort="${escapeAttr(sortAttr)}"` +
    ` data-collection-slug="${slugAttr}"` +
    ` data-collection-folder="${folderAttr}"` +
    galleryAttrs +
    ` style="${escapeAttr(frameStyle)}">${entriesHtml}</div>`
  );
}

function renderCollectionEntries(
  el: CollectionElement,
  ctx: CollectionRenderCtx,
  gallery: CollectionGalleryBehaviour | null,
): string {
  const entries = el.entries ?? [];
  if (entries.length === 0) return '';
  if (typeof ctx.renderChild !== 'function') {
    throw new Error(
      `Collection element ${el.id}: renderChild is required when entries are materialized.`,
    );
  }
  return entries
    .map((entry, idx) => {
      const bounds = entryBounds(entry);
      const entryStyle = styleFromEntries([
        ['position', 'relative'],
        ['width', `${String(bounds.w)}px`],
        ['height', `${String(bounds.h)}px`],
        ['flex', '0 0 auto'],
      ]);
      const childrenHtml = entry.map((child) => ctx.renderChild!(child)).join('');
      const galleryAttrs = gallery
        ?
          ` data-opencanvas-collection-entry-active="${idx === 0 ? 'true' : 'false'}"` +
          ` role="button" tabindex="0" aria-expanded="${idx === 0 ? 'true' : 'false'}"`
        : '';
      return (
        `<div class="opencanvas-collection-entry"` +
        ` data-opencanvas-collection-entry="${String(idx)}"` +
        galleryAttrs +
        ` style="${escapeAttr(entryStyle)}">${childrenHtml}</div>`
      );
    })
    .join('');
}

function entryBounds(entry: readonly CanvasElement[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const child of entry) {
    w = Math.max(w, child.box.x + child.box.w);
    h = Math.max(h, child.box.y + child.box.h);
  }
  return { w, h };
}

function readGalleryBehaviour(el: CollectionElement): CollectionGalleryBehaviour | null {
  if (el.gallery === undefined) return null;
  if (!(COLLECTION_GALLERY_MODES as readonly string[]).includes(el.gallery.mode)) {
    throw new Error(
      `Collection element ${el.id}: gallery.mode has malformed value ${JSON.stringify(
        el.gallery.mode,
      )}; expected one of ${COLLECTION_GALLERY_MODES.join(' | ')}.`,
    );
  }
  if (!(COLLECTION_GALLERY_DETAIL_MODES as readonly string[]).includes(el.gallery.detailMode)) {
    throw new Error(
      `Collection element ${el.id}: gallery.detailMode has malformed value ${JSON.stringify(
        el.gallery.detailMode,
      )}; expected one of ${COLLECTION_GALLERY_DETAIL_MODES.join(' | ')}.`,
    );
  }
  if (
    !(COLLECTION_GALLERY_REDUCED_MOTION_MODES as readonly string[]).includes(
      el.gallery.reducedMotion,
    )
  ) {
    throw new Error(
      `Collection element ${el.id}: gallery.reducedMotion has malformed value ${JSON.stringify(
        el.gallery.reducedMotion,
      )}; expected one of ${COLLECTION_GALLERY_REDUCED_MOTION_MODES.join(' | ')}.`,
    );
  }
  return el.gallery;
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

// The agent surface is intentionally narrow: it can set sparse host-level
// CollectionStyle fields, while source binding / entry management stay owned
// by the dashboard and Collection inspector workflows.
export const collectionAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    collectionStyle: componentStylePatchProperty(COLLECTION_STYLE_SPEC),
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.collectionStyle !== undefined) {
      patch.collectionStyle = parseComponentStylePatchValue(
        args.collectionStyle,
        COLLECTION_STYLE_SPEC,
      );
    }
    return patch;
  },
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
