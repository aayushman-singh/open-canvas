// src/canvas/elements/collection-materializer.ts
//
// ADR 0060 + ADR 0063 — publish-time materialization pass applied to an
// `EditableSite` before publish.
//
// Behaviour landed in this commit (Phase 1):
//   * Pages with `pageKind === 'collection-item-template'` are expanded — the
//     single ghost template page is replaced by N concrete pages, one per
//     matching published entry. Each clone inherits the entry's metadata
//     (title, description, publishedDate, author, category, tags,
//     ogImageAssetId) and has `{{field}}` placeholders substituted across
//     every string field of every element. The `pageKind` / `collectionSlug`
//     template metadata is stripped from the clones — they ship as ordinary
//     pages. This path is unchanged from ADR 0060; ADR 0063 only retires the
//     index-page mode (decision 2) and the page-bound element model.
//   * Pages without `pageKind` pass through unchanged.
//   * The new ADR 0063 `CollectionElement` shape (`collectionSlug`, `folder`,
//     `sort`, `manualOrder`, `display`) is read by the materializer ONLY
//     enough to compile against the new types in this commit. The per-
//     element card-cloning and folder-filter logic is Phase 2B's
//     responsibility — see the placeholder branch in
//     `hydrateCollectionElements`.
//
// Contract guarantees:
//   * Pure: the input `site` is deep-cloned and never mutated.
//   * Caller filters drafts. This module trusts the entry list it receives;
//     only `status: 'published'` rows should be passed in by the caller
//     (see ADR 0060 §3 — "Draft entries are excluded").
//   * Template-page clone ids are deterministic — `${page.id}--${entry.slug}`
//     — so re-running materialization on the same input produces byte-equal
//     pages (good for snapshot replay smokes).

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
} from '../schema.js';

/** Row shape consumed by the materializer. Mirrors the published projection of
 *  the `collection_entry` table (ADR 0060 §1 + ADR 0063 dec 7). The caller is
 *  responsible for excluding `status: 'draft'` rows before passing in this
 *  array.
 *
 *  ADR 0063 dec 7 added `folder` to the row shape, and `id` joined for
 *  Phase 2B's `manualOrder` resolution. Both are kept optional during the
 *  multi-commit migration so existing publish-path callers that haven't
 *  rolled their projection yet still typecheck. */
export interface MaterializerEntry {
  /** Stable entry id (matches `collection_entry.id`). Used by Phase 2B's
   *  manualOrder resolution; optional here so legacy callers compile. */
  id?: string;
  collectionSlug: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  publishedDate: string;
  author: string;
  category: string;
  tags: string[];
  ogImageAssetId: string | null;
  /** ADR 0063 dec 7 — optional sub-grouping value. `null` = ungrouped.
   *  Optional during transition so legacy publish-path callers compile. */
  folder?: string | null;
}

/** Placeholder fields the substitutor recognises. `{{tag}}` resolves to the
 *  entry's first tag (empty string when none). */
type PlaceholderField =
  | 'title'
  | 'excerpt'
  | 'body'
  | 'publishedDate'
  | 'author'
  | 'category'
  | 'tag'
  | 'slug';

const PLACEHOLDER_FIELDS: readonly PlaceholderField[] = [
  'title',
  'excerpt',
  'body',
  'publishedDate',
  'author',
  'category',
  'tag',
  'slug',
];

function placeholderValue(entry: MaterializerEntry, field: PlaceholderField): string {
  switch (field) {
    case 'title':
      return entry.title;
    case 'excerpt':
      return entry.excerpt;
    case 'body':
      return entry.body;
    case 'publishedDate':
      return entry.publishedDate;
    case 'author':
      return entry.author;
    case 'category':
      return entry.category;
    case 'tag':
      return entry.tags[0] ?? '';
    case 'slug':
      return entry.slug;
  }
}

/** Replace every `{{field}}` token in a single string with its entry value.
 *  Unknown tokens are left intact so unrelated mustache-shaped text (rare,
 *  but possible in user-authored copy) survives. */
function substituteString(input: string, entry: MaterializerEntry): string {
  let out = input;
  for (const field of PLACEHOLDER_FIELDS) {
    const token = `{{${field}}}`;
    if (out.includes(token)) {
      out = out.split(token).join(placeholderValue(entry, field));
    }
  }
  return out;
}

/** Recursively substitute placeholders in every string field of an arbitrary
 *  JSON-shaped value. The canvas document model is all-JSON (no functions, no
 *  class instances), so a structural walk is exhaustive across `BaseElement`,
 *  `InlineRun`, `ElementStyle`, `pinnedStyle`, etc. without per-element
 *  special-casing. Numbers/booleans/null/undefined pass through. */
function substituteInValue<T>(value: T, entry: MaterializerEntry): T {
  if (typeof value === 'string') {
    return substituteString(value, entry) as T;
  }
  if (Array.isArray(value)) {
    const mapped: unknown[] = value.map((item: unknown): unknown => substituteInValue(item, entry));
    return mapped as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteInValue(v, entry);
    }
    return out as T;
  }
  return value;
}

/** Deep-clone via structured JSON round-trip. The canvas model is JSON-only
 *  (validated upstream), so `JSON.parse(JSON.stringify(...))` is the
 *  canonical clone — no Dates, no Maps, no functions to lose. */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Stable sort that orders entries by published date in the requested
 *  direction, falling back to insertion order for ties. Used by the
 *  template-page expansion below. */
function sortEntriesByDateDesc(entries: MaterializerEntry[]): MaterializerEntry[] {
  return entries
    .map((entry, idx) => ({ entry, idx }))
    .sort((a, b) => {
      if (a.entry.publishedDate < b.entry.publishedDate) return 1;
      if (a.entry.publishedDate > b.entry.publishedDate) return -1;
      return a.idx - b.idx;
    })
    .map(({ entry }) => entry);
}

/** Build one concrete page from a template page + an entry. Strips
 *  `pageKind`/`collectionSlug` so the output is an ordinary canvas page. */
function clonePageForEntry(template: CanvasPage, entry: MaterializerEntry): CanvasPage {
  // Deep-clone the template first so substituteInValue can walk every string.
  const cloned = deepClone(template);
  // Substitute placeholders across the section/element subtree only — page
  // metadata fields are set explicitly below from the entry row.
  cloned.sections = substituteInValue(cloned.sections, entry);
  // Deterministic clone id keeps snapshot diffs stable across replays.
  cloned.id = `${template.id}--${entry.slug}`;
  cloned.slug = `${template.collectionSlug ?? ''}/${entry.slug}`;
  cloned.title = entry.title;
  // CanvasPage's optional metadata fields (`description`, `author`,
  // `category`) reject empty strings at validation time ("non-empty when
  // present"). The entry row uses an empty string to mean "unset" because
  // the DB column is NOT NULL with a `''` default. Translate that here: if
  // the entry value is empty, drop the field rather than set ''.
  if (entry.excerpt.length > 0) cloned.description = entry.excerpt;
  else delete cloned.description;
  cloned.publishedDate = entry.publishedDate;
  if (entry.author.length > 0) cloned.author = entry.author;
  else delete cloned.author;
  if (entry.category.length > 0) cloned.category = entry.category;
  else delete cloned.category;
  cloned.tags = [...entry.tags];
  if (entry.ogImageAssetId !== null) {
    cloned.ogImageAssetId = entry.ogImageAssetId;
  } else {
    delete cloned.ogImageAssetId;
  }
  // Strip template metadata — the published clone is an ordinary page.
  delete cloned.pageKind;
  delete cloned.collectionSlug;
  return cloned;
}

/** Walk every CollectionElement in a page and let Phase 2B fill in the per-
 *  element materialization (folder filter, sort selection, manualOrder
 *  resolution, default card-template cloning, `display === 'image-only'`
 *  short circuit). For this commit the walk is a no-op — the schema and
 *  type surface land first; the behaviour follows. */
function hydrateCollectionElements(page: CanvasPage, _entries: MaterializerEntry[]): void {
  const visitSection = (section: CanvasSection): void => {
    for (const el of section.elements) {
      visitElement(el);
    }
  };
  const visitElement = (el: CanvasElement): void => {
    if (el.type === 'tabs') {
      for (const tab of el.tabs) {
        for (const child of tab.elements) visitElement(child);
      }
      return;
    }
    if (el.type === 'collection') {
      // TODO(ADR-0063 Phase 2B): full implementation — read `el.collectionSlug`
      // and `el.folder`, filter the entry list, apply `el.sort` (date-desc /
      // date-asc / manual via `el.manualOrder`), then either clone the
      // built-in default card template per entry (`display === 'card'`) or
      // emit one image-anchor pair per entry (`display === 'image-only'`).
      // The Phase-2B handoff comment is the one TODO this Phase-1 commit
      // permits because the rewrite is real and queued (not aspirational).
      return;
    }
  };
  for (const section of page.sections) visitSection(section);
}

/** ADR 0060 publish-time materialization pass.
 *  Pure: returns a new `EditableSite` with template pages expanded into one
 *  page per matching entry. The input `site` is never mutated.
 *
 *  The caller must pre-filter `entries` to published rows. Draft entries
 *  passed in here will appear in the snapshot. */
export function materializeCollections(
  site: EditableSite,
  entries: MaterializerEntry[],
): EditableSite {
  const cloned = deepClone(site);
  const out: CanvasPage[] = [];
  for (const page of cloned.pages) {
    if (page.pageKind === 'collection-item-template') {
      const collectionSlug = page.collectionSlug;
      if (collectionSlug === undefined) {
        // The validator rejects this combination, so it should be unreachable
        // at publish time. Keep the template page intact rather than dropping
        // it silently — a fail-loud surface for the developer if validation
        // is ever bypassed.
        out.push(page);
        continue;
      }
      const matched = sortEntriesByDateDesc(
        entries.filter((entry) => entry.collectionSlug === collectionSlug),
      );
      for (const entry of matched) {
        out.push(clonePageForEntry(page, entry));
      }
      continue;
    }
    // Ordinary page — hydrate any CollectionElements it carries, then pass
    // through. (Phase 2B fills in `hydrateCollectionElements`.)
    hydrateCollectionElements(page, entries);
    out.push(page);
  }
  cloned.pages = out;
  return cloned;
}
