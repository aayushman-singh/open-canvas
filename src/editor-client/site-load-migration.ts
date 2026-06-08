// src/editor-client/site-load-migration.ts
//
// ADR 0063 dec 2 — one-shot migration of legacy
// pageKind === 'collection-index' pages.
//
// ADR 0060 introduced a page-level binding model: a page declared
// `pageKind = 'collection-index'` with `collectionSlug = 'blog'` and any
// Collection element on that page implicitly bound to the page's slug.
// ADR 0063 retires that model — `collectionSlug` now lives on the
// Collection element itself. Existing sites carry the old shape in
// JSONB and need a one-shot rewrite the first time the editor loads
// them post-deploy.
//
// Behaviour:
//   * For each page where `pageKind === 'collection-index'`:
//       - If the page has EXACTLY ONE Collection element: copy the
//         page's `collectionSlug` onto that element, default the
//         element's `display` to 'card' and `sort` to 'date-desc' when
//         absent, then clear the page's `pageKind` and `collectionSlug`.
//         Mark the site dirty so the normal autosave persists the
//         transform.
//       - If the page has ZERO or TWO+ Collection elements: leave the
//         page untouched so the Owner can resolve the bindings manually,
//         and enqueue an editor banner via ctx.setStatus.
//   * On every subsequent load, no page has `pageKind ===
//     'collection-index'` anymore, so the loop is a no-op. The absence
//     of legacy pageKind values IS the "have we migrated" signal —
//     adding a separate boolean flag would duplicate the same
//     information in two places.
//
// Failure modes (loud, per CLAUDE.md no-fallback rule):
//   * A page with `pageKind === 'collection-index'` but missing
//     `collectionSlug` skips with a console.warn naming the page id and
//     surfaces a banner. Phase 1's validator already rejects this
//     combination at the API write boundary, but we stay defensive at
//     runtime because old data may have slipped through.
//   * A page with multiple Collections persists the banner across
//     loads (the next load sees the same `pageKind === 'collection-
//     index'` and re-enqueues the banner) until the Owner resolves each
//     Collection's source. Intentional — silent guessing would create
//     contradictory single-source-of-truth pages per ADR 0063 dec 2.

import type { CanvasElement, CanvasPage, CanvasSection } from '../canvas/schema.js';
import type { CollectionElement } from '../canvas/elements/collection.js';

/** Narrow ctx shape the migration depends on. Mirrors the
 *  CollectionScaffoldCtx pattern in collection-scaffold.ts — the smoke's
 *  mock ctx only has to populate these fields, not the full ~150-field
 *  EditorContext surface. */
export interface SiteLoadMigrationCtx {
  state: import('../canvas/schema.js').EditableSite | null;
  scheduleSave(): void;
  setStatus(text: string, tone?: 'ok' | 'error' | 'info'): void;
}

/** Walk every Collection element on a page (including nested via Tabs).
 *  Post-ADR-0059 the body's elements live exclusively in
 *  `page.sections[].elements` — `CanvasPage` has no top-level `elements`
 *  field. The F3 audit (2026-06-05, Neon) confirmed every prod page
 *  carrying `pageKind === 'collection-index'` has its Collection nested
 *  inside a section, so the section walk is the load-bearing path.
 *  Collections cannot be nested inside Carousel / Container per the
 *  Phase 1 validator, so the only nesting surface to recurse into is
 *  Tabs (the standard container exception). The "single Collection"
 *  rule applies across the union of every section.elements list, so a
 *  page with one Collection in section A and one in section B totals
 *  two and falls through to the multi-Collection banner path. */
function findCollectionsInPage(page: CanvasPage): CollectionElement[] {
  const out: CollectionElement[] = [];
  const visitElement = (el: CanvasElement): void => {
    if (el.type === 'collection') {
      out.push(el);
      return;
    }
    if (el.type === 'tabs') {
      for (const tab of el.tabs) {
        for (const child of tab.elements) visitElement(child);
      }
      return;
    }
  };
  const visitSection = (section: CanvasSection): void => {
    for (const el of section.elements) visitElement(el);
  };
  for (const section of page.sections) visitSection(section);
  return out;
}

/** Apply ADR 0063 dec 2 to a single CollectionElement: stamp the
 *  page's slug onto the element and default display/sort when absent.
 *  Pure on the element — mutation happens on the caller's reference.
 *  Returns true if anything changed, so the caller can mark the page
 *  migrated even when the only fix was an in-place sort coercion. */
function applyLegacyBindingToElement(
  element: CollectionElement,
  pageCollectionSlug: string,
): boolean {
  let changed = false;
  // Element-level slug wins if the Owner already set one (unusual
  // pre-migration but possible if they hand-edited JSONB). Otherwise
  // copy from the page. The ADR's wording is "copies the page's
  // collectionSlug onto that element" — interpreted as "fills in the
  // missing element-level binding", not "overwrites any existing one".
  if (element.collectionSlug === undefined) {
    element.collectionSlug = pageCollectionSlug;
    changed = true;
  }
  if (element.display === undefined) {
    element.display = 'card';
    changed = true;
  }
  if (normaliseLegacySort(element)) {
    changed = true;
  }
  return changed;
}

/** Normalise the legacy `sort: { field, order }` object — the pre-ADR-0063
 *  shape that lingered in JSONB — into the current string-enum form.
 *  `{ field:'publishedDate', order:'desc' }` → 'date-desc';
 *  `{ ..., order:'asc' }` → 'date-asc'; anything else (including a sort that
 *  is already a valid string) is left alone. Returns true iff the element
 *  was mutated so the caller can route to scheduleSave().
 *
 *  The renderer's per-boundary guard now throws when it sees the legacy
 *  object, so without this normalisation pass the dashboard thumb stays
 *  red until an explicit backfill. The migration runs on first editor load
 *  of the affected site and writes the canonical shape back via the
 *  existing autosave path. */
function normaliseLegacySort(element: CollectionElement): boolean {
  const raw = (element as { sort?: unknown }).sort;
  if (raw === undefined) {
    element.sort = 'date-desc';
    return true;
  }
  if (typeof raw === 'string') return false;
  if (raw === null || typeof raw !== 'object') return false;
  const order = (raw as { order?: unknown }).order;
  element.sort = order === 'asc' ? 'date-asc' : 'date-desc';
  return true;
}

/** Run ADR 0063 dec 2 against the loaded site. Mutates ctx.state in
 *  place when a page can be migrated; calls ctx.scheduleSave() exactly
 *  once at the end if any page actually changed. Enqueues a banner via
 *  ctx.setStatus for the un-migratable multi-Collection case.
 *
 *  Also sweeps every page (regardless of pageKind) for Collection
 *  elements that still carry the deprecated `sort: { field, order }`
 *  object shape so they normalise into the current string enum on first
 *  editor load. Without this second pass, sites that were authored
 *  pre-ADR-0063 but never carried `pageKind: collection-index` could
 *  still throw at render time. */
export function migrateLegacyCollectionIndexPagesImpl(ctx: SiteLoadMigrationCtx): void {
  if (!ctx.state || !Array.isArray(ctx.state.pages)) return;

  let migrated = 0;
  let normalisedLegacySort = 0;
  let multiCollectionPages = 0;
  let missingSlugPages = 0;

  for (const page of ctx.state.pages) {
    // ADR 0063 F5 narrowed COLLECTION_PAGE_KINDS to drop
    // `'collection-index'`, so `page.pageKind` typechecks as
    // `'collection-item-template' | undefined`. Legacy in-DB rows still
    // carry the dead string value at runtime — JSONB is byte-for-byte
    // what the editor saved before the union narrowed — so the
    // migration must read it through `string | undefined` to recognise
    // the legacy shape and sweep it. This is the one place the literal
    // is read after F5 (the migration code itself is the legacy-
    // awareness boundary).
    const rawPageKind = (page as { pageKind?: string }).pageKind;
    if (!page) continue;

    if (rawPageKind === 'collection-index') {
      const pageSlug = page.collectionSlug;
      if (pageSlug === undefined || pageSlug.length === 0) {
        // Defensive — Phase 1 validator rejects this combination, but
        // legacy DB rows may have drifted. Skip without crashing.
        missingSlugPages += 1;
        console.warn(
          '[site-load-migration] page',
          page.id,
          'has pageKind=collection-index but no collectionSlug; cannot migrate',
        );
        continue;
      }

      const collections = findCollectionsInPage(page);
      if (collections.length === 1) {
        applyLegacyBindingToElement(collections[0]!, pageSlug);
        delete (page as { pageKind?: unknown }).pageKind;
        delete page.collectionSlug;
        migrated += 1;
        continue;
      }

      // 0 or multiple Collections — leave the page untouched. The banner
      // below tells the Owner what to do.
      multiCollectionPages += 1;
      continue;
    }

    // Non-index pages: still sweep their Collection elements for the
    // legacy sort-object shape so a thumb/publish render does not blow
    // up on a single mis-shaped element.
    for (const element of findCollectionsInPage(page)) {
      if (normaliseLegacySort(element)) normalisedLegacySort += 1;
    }
  }

  if (migrated > 0 || normalisedLegacySort > 0) {
    ctx.scheduleSave();
  }

  // Banner messaging. We compose one line per failure class, in priority
  // order: multi-collection (most actionable), then missing-slug
  // (validator-level corruption surfacing). The 'info' tone matches the
  // existing collection-scaffold "Creating collection…" toast — see
  // collection-scaffold.ts setStatus calls.
  if (multiCollectionPages > 0) {
    const noun = multiCollectionPages === 1 ? 'page has' : 'pages have';
    ctx.setStatus(
      `This ${noun} multiple Collections — set the source on each one in the inspector.`,
      'info',
    );
  } else if (missingSlugPages > 0) {
    const noun = missingSlugPages === 1 ? 'page' : 'pages';
    ctx.setStatus(
      `Skipped ${missingSlugPages} legacy collection-index ${noun} with no source slug.`,
      'error',
    );
  }
}
