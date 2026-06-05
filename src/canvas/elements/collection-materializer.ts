// src/canvas/elements/collection-materializer.ts
//
// ADR 0060 + ADR 0063 — publish-time materialization pass applied to an
// `EditableSite` before publish.
//
// Two distinct expansion paths run here:
//   1. Pages with `pageKind === 'collection-item-template'` are cloned once
//      per matching published entry. Each clone inherits the entry's metadata
//      (title, description, publishedDate, author, category, tags,
//      ogImageAssetId) and has `{{field}}` placeholders substituted across
//      every string field of every element. ADR 0060 path, unchanged.
//   2. CollectionElements inside ordinary pages (and header/footer) are
//      hydrated per ADR 0063 dec 4 + dec 7 + dec 8: filter by
//      `el.collectionSlug` (+ optional `el.folder`), order by `el.sort`
//      (with `el.manualOrder` overriding when `sort === 'manual'`), then
//      either clone the built-in `DEFAULT_CARD_TEMPLATE` per entry
//      (`display === 'card'`) or emit one Image-wrapped-in-a-linked-Container
//      per entry (`display === 'image-only'`). Per-entry instances are
//      written into the deprecated-but-load-bearing `el.entries` slot so
//      downstream consumers (editor preview at `body-builders-data.ts`, and
//      the renderer rewrite that lands alongside ADR 0063 dec 6's click-
//      handling change) can traverse them with the existing matrix shape.
//
// Failure modes (loud, per ADR 0063 + CLAUDE.md):
//   * `collectionSlug === undefined` or zero matches → `el.entries = []` and
//     a `warnings` string is appended: `"Collection element <id> on page
//     <slug> matched 0 entries (source=<slug or 'unset'>, folder=<folder>)."`.
//     The new `materializeCollectionsWithReport` export surfaces warnings to
//     callers; the existing `materializeCollections` discards them so the
//     publish.ts migration to consume warnings can land in a separate commit.
//   * Stale ids in `manualOrder` (entry deleted from CMS) → silently skipped
//     at materialization. Inspector lazy-strip lives in editor-client.
//
// Contract guarantees:
//   * Pure: the input `site` is deep-cloned and never mutated.
//   * Caller filters drafts. This module trusts the entry list it receives;
//     only `status: 'published'` rows should be passed in by the caller
//     (see ADR 0060 §3 — "Draft entries are excluded").
//   * Template-page clone ids are deterministic — `${page.id}--${entry.slug}`
//     — and per-entry card ids follow the same rule
//     (`${baseElement.id}--${entry.slug}`) so re-running materialization on
//     the same input produces byte-equal pages (good for snapshot replay
//     smokes).
//   * Legacy CollectionElement fields (`mode`, `cardTemplate`, `fieldBindings`,
//     `filter`, the object-shaped `sort`) are read-skipped per Phase 2B's
//     migration discipline. Only the new fields (`collectionSlug`, `folder`,
//     `sort` as string, `manualOrder`, `display`) are read.

import type {
  ActionElement,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  ContainerElement,
  EditableSite,
  ImageMediaElement,
  TextElement,
} from '../schema.js';
import type { CollectionElement, CollectionSort } from './collection.js';
import {
  DEFAULT_CARD_SIBLINGS,
  DEFAULT_CARD_TEMPLATE,
} from './collection-defaults.js';

/** Row shape consumed by the materializer. Mirrors the published projection of
 *  the `collection_entry` table (ADR 0060 §1 + ADR 0063 dec 7). The caller is
 *  responsible for excluding `status: 'draft'` rows before passing in this
 *  array. */
export interface MaterializerEntry {
  /** Stable entry id (matches `collection_entry.id`). Used by `manualOrder`
   *  resolution; optional during the multi-commit publish-path migration. */
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
  /** ADR 0063 dec 7 — optional sub-grouping value. `null` = ungrouped. */
  folder?: string | null;
}

/** Report shape exposed by `materializeCollectionsWithReport`. Warnings are
 *  human-readable strings shaped per ADR 0063 dec 1 / dec 7 — callers (publish
 *  report emitter, dashboard preflight) surface them verbatim. */
export interface MaterializerReport {
  site: EditableSite;
  warnings: string[];
}

type PlaceholderField =
  | 'title'
  | 'excerpt'
  | 'body'
  | 'publishedDate'
  | 'author'
  | 'category'
  | 'tag'
  | 'slug'
  | 'ogImageAssetId';

const PLACEHOLDER_FIELDS: readonly PlaceholderField[] = [
  'title',
  'excerpt',
  'body',
  'publishedDate',
  'author',
  'category',
  'tag',
  'slug',
  'ogImageAssetId',
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
    case 'ogImageAssetId':
      return entry.ogImageAssetId ?? '';
  }
}

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

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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

function sortEntriesByDateAsc(entries: MaterializerEntry[]): MaterializerEntry[] {
  return entries
    .map((entry, idx) => ({ entry, idx }))
    .sort((a, b) => {
      if (a.entry.publishedDate < b.entry.publishedDate) return -1;
      if (a.entry.publishedDate > b.entry.publishedDate) return 1;
      return a.idx - b.idx;
    })
    .map(({ entry }) => entry);
}

/** Apply `manualOrder` to a candidate entry list. Stale ids (entry deleted
 *  upstream) are dropped silently per ADR 0063 dec 8 failure path. Entries
 *  not named in `manualOrder` are appended in date-desc order so newly added
 *  posts surface predictably until the Owner re-curates. */
function sortEntriesManual(
  entries: MaterializerEntry[],
  manualOrder: readonly string[],
): MaterializerEntry[] {
  const byId = new Map<string, MaterializerEntry>();
  for (const entry of entries) {
    if (entry.id !== undefined) byId.set(entry.id, entry);
  }
  const ordered: MaterializerEntry[] = [];
  const claimed = new Set<string>();
  for (const id of manualOrder) {
    const hit = byId.get(id);
    if (hit === undefined) continue;
    ordered.push(hit);
    claimed.add(id);
  }
  const tail = entries.filter((entry) => entry.id === undefined || !claimed.has(entry.id));
  ordered.push(...sortEntriesByDateDesc(tail));
  return ordered;
}

/** ADR 0063 dec 4 + dec 6 — assemble one entry's worth of canvas elements.
 *  Outer Container links the whole surface; siblings carry the visible chrome.
 *  Ids are suffixed with the entry slug so replay produces byte-equal output. */
function buildCardEntryInstance(
  entry: MaterializerEntry,
  collectionSlug: string,
): CanvasElement[] {
  const detailUrl = `/${collectionSlug}/${entry.slug}`;
  const containerSeed = deepClone(DEFAULT_CARD_TEMPLATE as ContainerElement);
  const substitutedContainer = substituteInValue(containerSeed, entry);
  const container: ContainerElement = {
    ...substitutedContainer,
    id: `${DEFAULT_CARD_TEMPLATE.id}--${entry.slug}`,
    linkHref: { type: 'external', url: detailUrl },
  };
  const siblings: CanvasElement[] = DEFAULT_CARD_SIBLINGS.map((sib): CanvasElement => {
    const seed = deepClone(sib);
    const substituted = substituteInValue(seed, entry);
    if (substituted.type === 'action') {
      const action: ActionElement = {
        id: `${sib.id}--${entry.slug}`,
        type: 'action',
        box: substituted.box,
        label: substituted.label,
        variant: substituted.variant,
        href: { type: 'external', url: detailUrl },
      };
      return action;
    }
    if (substituted.type === 'media' && substituted.mediaKind === 'image') {
      const image: ImageMediaElement = {
        ...substituted,
        id: `${sib.id}--${entry.slug}`,
      };
      return image;
    }
    const text: TextElement = {
      ...(substituted as TextElement),
      id: `${sib.id}--${entry.slug}`,
    };
    return text;
  });
  return [container, ...siblings];
}

/** ADR 0063 dec 4 — image-only mode. Per-entry instance is a single Container
 *  with `linkHref` set to the detail URL plus a single ImageMediaElement
 *  sibling carrying the entry's ogImageAssetId. The Container wraps the
 *  surface as the link (matching the card-as-link pattern from dec 6); the
 *  Image is positioned identically so it fills the linked area. */
function buildImageOnlyEntryInstance(
  entry: MaterializerEntry,
  collectionSlug: string,
): CanvasElement[] {
  const detailUrl = `/${collectionSlug}/${entry.slug}`;
  const assetId = entry.ogImageAssetId ?? '__placeholder__';
  const container: ContainerElement = {
    id: `collection-image-link--${entry.slug}`,
    type: 'container',
    box: { x: 0, y: 0, w: 320, h: 200, z: 1 },
    variant: 'flat',
    linkHref: { type: 'external', url: detailUrl },
    linkLabel: entry.title,
  };
  const image: ImageMediaElement = {
    id: `collection-image-asset--${entry.slug}`,
    type: 'media',
    mediaKind: 'image',
    box: { x: 0, y: 0, w: 320, h: 200, z: 2 },
    assetId,
    alt: entry.title,
    fit: 'cover',
  };
  return [container, image];
}

function readSortMode(el: CollectionElement): CollectionSort {
  if (typeof el.sort === 'string') return el.sort;
  return 'date-desc';
}

function clonePageForEntry(template: CanvasPage, entry: MaterializerEntry): CanvasPage {
  const cloned = deepClone(template);
  cloned.sections = substituteInValue(cloned.sections, entry);
  cloned.id = `${template.id}--${entry.slug}`;
  cloned.slug = `${template.collectionSlug ?? ''}/${entry.slug}`;
  cloned.title = entry.title;
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
  delete cloned.pageKind;
  delete cloned.collectionSlug;
  return cloned;
}

/** Resolve the entry list for one Collection element. Returns the ordered,
 *  filtered list plus a warning string when the result is empty (ADR 0063
 *  dec 1 / dec 7 failure path). The warning string includes the page slug
 *  so the publish report can pinpoint the offending surface. */
function resolveEntriesForCollection(
  el: CollectionElement,
  entries: readonly MaterializerEntry[],
  pageSlug: string,
): { ordered: MaterializerEntry[]; warning: string | null } {
  const collectionSlug = el.collectionSlug;
  if (collectionSlug === undefined) {
    return {
      ordered: [],
      warning:
        `Collection element ${el.id} on page ${pageSlug} matched 0 entries ` +
        `(source=unset, folder=${el.folder ?? 'unset'}).`,
    };
  }
  const matchesSlug = entries.filter((entry) => entry.collectionSlug === collectionSlug);
  const matched =
    el.folder === undefined
      ? matchesSlug
      : matchesSlug.filter((entry) => (entry.folder ?? null) === el.folder);
  if (matched.length === 0) {
    return {
      ordered: [],
      warning:
        `Collection element ${el.id} on page ${pageSlug} matched 0 entries ` +
        `(source=${collectionSlug}, folder=${el.folder ?? 'unset'}).`,
    };
  }
  const sortMode = readSortMode(el);
  let ordered: MaterializerEntry[];
  if (sortMode === 'date-asc') {
    ordered = sortEntriesByDateAsc(matched);
  } else if (sortMode === 'manual') {
    ordered = sortEntriesManual(matched, el.manualOrder ?? []);
  } else {
    ordered = sortEntriesByDateDesc(matched);
  }
  return { ordered, warning: null };
}

/** Hydrate one Collection element in place. Writes per-entry instances into
 *  `el.entries` (the matrix shape downstream consumers already iterate); on
 *  zero matches `el.entries` is set to `[]` (no placeholder content per
 *  ADR 0063 dec 5 — publish renderer emits empty, editor preview owns the
 *  placeholder UI separately). */
function hydrateCollectionElement(
  el: CollectionElement,
  entries: readonly MaterializerEntry[],
  pageSlug: string,
  warnings: string[],
): void {
  const { ordered, warning } = resolveEntriesForCollection(el, entries, pageSlug);
  if (warning !== null) warnings.push(warning);
  const collectionSlug = el.collectionSlug ?? '';
  const display = el.display ?? 'card';
  const built: CanvasElement[][] = ordered.map((entry) =>
    display === 'image-only'
      ? buildImageOnlyEntryInstance(entry, collectionSlug)
      : buildCardEntryInstance(entry, collectionSlug),
  );
  el.entries = built;
}

function hydrateCollectionsInSection(
  section: CanvasSection,
  entries: readonly MaterializerEntry[],
  pageSlug: string,
  warnings: string[],
): void {
  const visitElement = (el: CanvasElement): void => {
    if (el.type === 'tabs') {
      for (const tab of el.tabs) {
        for (const child of tab.elements) visitElement(child);
      }
      return;
    }
    if (el.type === 'collection') {
      hydrateCollectionElement(el, entries, pageSlug, warnings);
    }
  };
  for (const el of section.elements) visitElement(el);
}

function hydrateCollectionsInPage(
  page: CanvasPage,
  entries: readonly MaterializerEntry[],
  warnings: string[],
): void {
  for (const section of page.sections) {
    hydrateCollectionsInSection(section, entries, page.slug, warnings);
  }
}

/** ADR 0060 + ADR 0063 publish-time materialization pass.
 *  Returns a new `EditableSite` with template pages expanded into one page
 *  per matching entry, plus every CollectionElement on every ordinary page
 *  (and site header/footer) hydrated with per-entry instances.
 *
 *  Warnings raised during the pass are discarded by this entry point — call
 *  `materializeCollectionsWithReport` instead to surface them. The shape is
 *  split so the existing publish.ts call site stays source-compatible while
 *  the new report-consuming wiring lands in a separate commit.
 *
 *  The caller must pre-filter `entries` to published rows. */
export function materializeCollections(
  site: EditableSite,
  entries: MaterializerEntry[],
): EditableSite {
  return materializeCollectionsWithReport(site, entries).site;
}

/** Materialization pass with the warning list exposed. New consumers (publish
 *  report emitter, dashboard preflight) call this; legacy callers stay on
 *  `materializeCollections`. */
export function materializeCollectionsWithReport(
  site: EditableSite,
  entries: MaterializerEntry[],
): MaterializerReport {
  const cloned = deepClone(site);
  const warnings: string[] = [];
  const out: CanvasPage[] = [];
  for (const page of cloned.pages) {
    if (page.pageKind === 'collection-item-template') {
      const collectionSlug = page.collectionSlug;
      if (collectionSlug === undefined) {
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
    hydrateCollectionsInPage(page, entries, warnings);
    out.push(page);
  }
  if (cloned.header !== undefined) {
    hydrateCollectionsInSection(cloned.header, entries, '__header__', warnings);
  }
  if (cloned.footer !== undefined) {
    hydrateCollectionsInSection(cloned.footer, entries, '__footer__', warnings);
  }
  cloned.pages = out;
  return { site: cloned, warnings };
}
