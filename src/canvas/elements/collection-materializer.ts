// src/canvas/elements/collection-materializer.ts
//
// ADR 0060 — pure materialization pass applied to an `EditableSite` before
// publish. Hydrates collection surfaces from the entries table:
//
//   - Pages with `pageKind === 'collection-index'` get their page-bound
//     `CollectionElement.entries[]` populated. For each matching entry, the
//     element's `cardTemplate` is cloned and `{{field}}` placeholders inside
//     string fields of any child element are substituted.
//
//   - Pages with `pageKind === 'collection-item-template'` are expanded: the
//     single ghost template page is replaced by N concrete pages, one per
//     matching entry. Each clone inherits the entry's metadata (title,
//     description, publishedDate, author, category, tags, ogImageAssetId) and
//     has `{{field}}` placeholders substituted across every string field of
//     every element. The `pageKind`/`collectionSlug` template metadata is
//     stripped from the clones — they ship as ordinary pages.
//
//   - Pages without `pageKind` pass through unchanged.
//
// Contract guarantees:
//   * Pure: the input `site` is deep-cloned and never mutated.
//   * Caller filters drafts. This module trusts the entry list it receives;
//     only `status: 'published'` rows should be passed in by the caller
//     (see ADR 0060 §3 — "Draft entries are excluded").
//   * Entry → page binding rule: an entry matches a page when
//       entry.category === page.collectionSlug
//     (modulo a `CollectionElement.filter.category` override on index pages,
//     which takes precedence if the element pins a different category).
//   * Index-page entries are also filtered by `element.filter.tags` (entry
//     must include every listed tag) and capped by `element.filter.limit`.
//   * Default sort on index pages is `publishedDate desc` when no
//     `element.sort` is configured. ADR 0060 §3 leaves this implicit; the
//     materializer pins it so snapshot diffs stay deterministic.
//   * Template-page clone ids are deterministic — `${page.id}--${entry.slug}`
//     — so re-running materialization on the same input produces byte-equal
//     pages (good for snapshot replay smokes).

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
} from '../schema.js';
import type { CollectionElement } from './collection.js';

/** Row shape consumed by the materializer. Mirrors the published projection of
 *  the `collection_entry` table (ADR 0060 §1). The caller is responsible for
 *  excluding `status: 'draft'` rows before passing in this array. */
export interface MaterializerEntry {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  publishedDate: string;
  author: string;
  category: string;
  tags: string[];
  ogImageAssetId: string | null;
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
 *  special-casing. Numbers/booleans/null/undefined pass through.
 *
 *  Arrays are walked element-by-element. Plain objects are walked key-by-key.
 *  This intentionally substitutes inside both `key` values (e.g. text content,
 *  hrefs, alt text) and inside nested containers like `tabs[].elements[]`,
 *  `entryTemplate[]`, `cardTemplate[]`, `entries[][]`. */
function substituteInValue<T>(value: T, entry: MaterializerEntry): T {
  if (typeof value === 'string') {
    return substituteString(value, entry) as T;
  }
  if (Array.isArray(value)) {
    const mapped: unknown[] = value.map((item: unknown): unknown =>
      substituteInValue(item, entry),
    );
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

/** Apply an `element.sort` config to a list of entries. Default — used when
 *  `sort` is undefined — is `publishedDate desc`. Sort is stable: equal keys
 *  preserve incoming order, so deterministic upstream ordering (e.g. by id)
 *  flows through. */
function sortEntries(
  entries: MaterializerEntry[],
  sort: CollectionElement['sort'],
): MaterializerEntry[] {
  const field = sort?.field ?? 'publishedDate';
  const order = sort?.order ?? 'desc';
  const sign = order === 'asc' ? 1 : -1;
  // Decorate-sort-undecorate keeps the sort stable across Node engines.
  return entries
    .map((entry, idx) => ({ entry, idx }))
    .sort((a, b) => {
      const av = a.entry[field];
      const bv = b.entry[field];
      if (av < bv) return -1 * sign;
      if (av > bv) return 1 * sign;
      return a.idx - b.idx;
    })
    .map(({ entry }) => entry);
}

/** Filter and limit the entry list for an index-page collection element. */
function filterEntriesForElement(
  element: CollectionElement,
  pageCollectionSlug: string,
  entries: MaterializerEntry[],
): MaterializerEntry[] {
  // Element filter pins a category override; otherwise bind by the index
  // page's `collectionSlug`. The filter takes precedence so a single index
  // page can host multiple per-category strips (e.g. "blog" page with a
  // "design" strip and a "engineering" strip).
  const category = element.filter?.category ?? pageCollectionSlug;
  const requiredTags = element.filter?.tags ?? [];
  const limit = element.filter?.limit;

  const matched = entries.filter((entry) => {
    if (entry.category !== category) return false;
    if (requiredTags.length > 0) {
      for (const tag of requiredTags) {
        if (!entry.tags.includes(tag)) return false;
      }
    }
    return true;
  });

  const sorted = sortEntries(matched, element.sort);
  return limit !== undefined ? sorted.slice(0, limit) : sorted;
}

/** Walk all `CanvasElement` nodes in a section (and their nested children).
 *  Returns each element in a flat order so the index-page pass can find every
 *  `CollectionElement` regardless of nesting depth (collections inside tabs,
 *  collections inside collections via `entryTemplate`, etc.). */
function walkElements(
  elements: CanvasElement[],
  visit: (el: CanvasElement) => void,
): void {
  for (const el of elements) {
    visit(el);
    if (el.type === 'tabs') {
      const tabsEl = el;
      for (const tab of tabsEl.tabs) {
        walkElements(tab.elements, visit);
      }
      continue;
    }
    if (el.type === 'collection') {
      const collEl = el;
      walkElements(collEl.entryTemplate, visit);
      if (collEl.cardTemplate !== undefined) walkElements(collEl.cardTemplate, visit);
      for (const entry of collEl.entries) {
        walkElements(entry, visit);
      }
      continue;
    }
  }
}

/** Substitute placeholders for an entry across every string in a list of
 *  cloned cardTemplate elements. The clone has already been deep-cloned by
 *  the caller, so the substitution can mutate in place. */
function substituteCardTemplate(
  cardTemplate: CanvasElement[],
  entry: MaterializerEntry,
): CanvasElement[] {
  return substituteInValue(cardTemplate, entry);
}

/** Hydrate every page-bound CollectionElement under an index page. Mutates
 *  the (already-cloned) page in place. */
function hydrateIndexPage(
  page: CanvasPage,
  entries: MaterializerEntry[],
): void {
  const pageCollectionSlug = page.collectionSlug;
  if (pageCollectionSlug === undefined) return;
  for (const section of page.sections) {
    hydrateIndexSection(section, pageCollectionSlug, entries);
  }
}

function hydrateIndexSection(
  section: CanvasSection,
  pageCollectionSlug: string,
  entries: MaterializerEntry[],
): void {
  walkElements(section.elements, (el) => {
    if (el.type !== 'collection') return;
    const collEl = el;
    if (collEl.mode !== 'page-bound') return;
    if (collEl.cardTemplate === undefined || collEl.cardTemplate.length === 0) {
      // No card template means nothing to clone per entry; leave `entries`
      // empty. Validation upstream allows this (cardTemplate is optional);
      // the materializer is silent here because there is no failure mode —
      // the publisher renders an empty grid, which is the correct outcome
      // for an unconfigured page-bound collection.
      collEl.entries = [];
      return;
    }
    const matched = filterEntriesForElement(collEl, pageCollectionSlug, entries);
    collEl.entries = matched.map((entry) => {
      const cloned = deepClone(collEl.cardTemplate ?? []);
      return substituteCardTemplate(cloned, entry);
    });
  });
}

/** Build one concrete page from a template page + an entry. Strips
 *  `pageKind`/`collectionSlug` so the output is an ordinary canvas page. */
function clonePageForEntry(
  template: CanvasPage,
  entry: MaterializerEntry,
): CanvasPage {
  // Deep-clone the template first so substituteInValue can walk every string.
  const cloned = deepClone(template);
  // Substitute placeholders across the section/element subtree only — page
  // metadata fields are set explicitly below from the entry row.
  cloned.sections = substituteInValue(cloned.sections, entry);
  // Deterministic clone id keeps snapshot diffs stable across replays.
  cloned.id = `${template.id}--${entry.slug}`;
  cloned.slug = `${template.collectionSlug ?? ''}/${entry.slug}`;
  cloned.title = entry.title;
  cloned.description = entry.excerpt;
  cloned.publishedDate = entry.publishedDate;
  cloned.author = entry.author;
  cloned.category = entry.category;
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

/** ADR 0060 publish-time materialization pass.
 *  Pure: returns a new `EditableSite` with hydrated index-page collections
 *  and template pages expanded into one page per matching entry. The input
 *  `site` is never mutated.
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
    if (page.pageKind === 'collection-index') {
      hydrateIndexPage(page, entries);
      out.push(page);
      continue;
    }
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
      const matched = sortEntries(
        entries.filter((entry) => entry.category === collectionSlug),
        undefined,
      );
      for (const entry of matched) {
        out.push(clonePageForEntry(page, entry));
      }
      continue;
    }
    // Ordinary page — pass through unchanged.
    out.push(page);
  }
  cloned.pages = out;
  return cloned;
}
