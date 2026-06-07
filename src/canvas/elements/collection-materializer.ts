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
//   * Reads only the ADR 0063 canonical fields (`collectionSlug`, `folder`,
//     `sort`, `manualOrder`, `display`); legacy CollectionElement fields were
//     removed in F5b.

import type {
  ActionElement,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  ContainerElement,
  EditableSite,
  ImageMediaElement,
  TabsElement,
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

/** ADR 0065 D8 — shared per-entry clone-and-substitute helper used by both the
 *  `'card'` arm (template = `[DEFAULT_CARD_TEMPLATE, ...DEFAULT_CARD_SIBLINGS]`)
 *  and the `'custom'` arm (template = `el.customTemplate`).
 *
 *  For each element in `template` (and recursively for every nested child
 *  inside a Tabs panel — codex review pass 3 finding 3):
 *    1. Deep-clone the element so the source constants / Owner-authored
 *       customTemplate are never mutated.
 *    2. Walk every string field substituting the nine placeholders against the
 *       entry (`substituteInValue`).
 *    3. Suffix the element's `id` with `--<entry.slug>` so replay produces
 *       byte-equal output AND nested ids do not collide across N materialized
 *       cards (the validator's anchor-uniqueness rule was previously tripped
 *       by un-suffixed Action ids inside a Tabs panel).
 *    4. Force the per-entry link target: the OUTER element, when it's a
 *       Container, has its `linkHref` overwritten to the canonical detail URL
 *       (`/<collectionSlug>/<entry.slug>`). Any ActionElement anywhere in the
 *       template — including ones nested inside a Tabs panel — has its `href`
 *       overwritten to the same URL. This matches the ADR 0063 dec 6 "card
 *       surface links to detail page" rule and is the one behaviour the
 *       materializer asserts on top of whatever the template author wrote.
 *
 *  Codex review pass 3 finding 3 — the recursion was previously top-level
 *  only. A custom template with a Tabs element wrapping Actions therefore:
 *    (a) emitted nested Actions whose `href` kept the template's placeholder
 *        URL (e.g. `/template-default`) instead of resolving per entry, and
 *    (b) emitted nested Actions whose `id` was identical across every
 *        materialized card, tripping the validator's anchor-uniqueness check.
 *  Tabs is the only canvas element type with nested `CanvasElement[]`
 *  children (container/accordion children are DOM siblings at section level,
 *  not nested in the element tree — see ContainerElement + AccordionElement
 *  schemas), so the recursion only needs to dive through `tabs[].elements`.
 *  When the schema gains a new nested-children type, extend `substituteOne`'s
 *  Tabs branch with the analogous walk.
 *
 *  Behavioural identity between `'card'` and `'custom'`: passing
 *  `[DEFAULT_CARD_TEMPLATE, ...DEFAULT_CARD_SIBLINGS]` as `template` produces
 *  output byte-equal to the `'custom'` arm with the same array on
 *  `el.customTemplate` (asserted by smoke). */
function cloneAndSubstituteTemplate(
  template: readonly CanvasElement[],
  entry: MaterializerEntry,
  collectionSlug: string,
): CanvasElement[] {
  const detailUrl = `/${collectionSlug}/${entry.slug}`;
  /** Per-element transform with no awareness of position in the top-level
   *  array. Recurses through Tabs panels so a nested Action gets the same
   *  per-entry id suffix + detail-page href overwrite as a top-level one.
   *  The outer-Container link-target overwrite is owned by the caller (it
   *  applies ONLY to the index-0 element of the template), so this helper
   *  treats every Container uniformly — the caller layers the outer rule
   *  on top. */
  function substituteOne(source: CanvasElement): CanvasElement {
    const seed = deepClone(source);
    const substituted = substituteInValue(seed, entry);
    const suffixedId = `${source.id}--${entry.slug}`;
    if (substituted.type === 'action') {
      // Codex review pass 1 — spread-and-override preserves Owner-authored
      // fields (`iconKind`, `motion`, `elementStyle`, `responsive`,
      // `anchorId`, pinned styles, etc.); the materializer only asserts the
      // per-entry id suffix + canonical detail-page href. ActionElement is a
      // discriminated union over `href` vs `behavior` (exactly one present);
      // strip a possibly-present `behavior` so the result lands cleanly on
      // the `href` arm.
      const { behavior: _behavior, ...rest } = substituted;
      void _behavior;
      const action: ActionElement = {
        ...rest,
        type: 'action',
        id: suffixedId,
        href: { type: 'external', url: detailUrl },
      };
      return action;
    }
    if (substituted.type === 'tabs') {
      // Codex review pass 3 finding 3 — recurse through every panel's
      // children so a nested Action inside a Tab gets the per-entry id
      // suffix + detail-page href overwrite. The Tabs element itself is
      // id-suffixed too; its `tabs[].elements[]` children pass through the
      // same `substituteOne` transform so every level lands consistent.
      const tabs: TabsElement = {
        ...substituted,
        id: suffixedId,
        tabs: substituted.tabs.map((tab) => ({
          ...tab,
          elements: tab.elements.map(substituteOne),
        })),
      };
      return tabs;
    }
    if (substituted.type === 'media' && substituted.mediaKind === 'image') {
      const image: ImageMediaElement = {
        ...substituted,
        id: suffixedId,
      };
      return image;
    }
    if (substituted.type === 'text') {
      const text: TextElement = {
        ...substituted,
        id: suffixedId,
      };
      return text;
    }
    return { ...substituted, id: suffixedId };
  }

  return template.map((source, idx): CanvasElement => {
    const out = substituteOne(source);
    if (idx === 0 && out.type === 'container') {
      // The outer Container (when present at index 0) carries the per-entry
      // link surface. ContainerElement is the only top-level type that
      // earns the linkHref overwrite; nested Containers (none in today's
      // schema, but defensive against future surfaces) keep whatever the
      // template author wrote.
      const container: ContainerElement = {
        ...out,
        linkHref: { type: 'external', url: detailUrl },
      };
      return container;
    }
    return out;
  });
}

/** Flat template array consumed by the `'card'` arm — the outer Container plus
 *  its sibling chrome assembled in one shape so the shared helper can iterate
 *  them uniformly. The order matters: the Container sits at index 0 so the
 *  helper's "first element gets the outer linkHref" rule applies. */
const DEFAULT_CARD_TEMPLATE_ARRAY: readonly CanvasElement[] = [
  DEFAULT_CARD_TEMPLATE,
  ...DEFAULT_CARD_SIBLINGS,
];

/** ADR 0063 dec 4 + dec 6 — assemble one entry's worth of canvas elements for
 *  the `'card'` display arm. Delegates to `cloneAndSubstituteTemplate` so the
 *  `'card'` and `'custom'` arms (ADR 0065 D8) share one code path. */
function buildCardEntryInstance(
  entry: MaterializerEntry,
  collectionSlug: string,
): CanvasElement[] {
  return cloneAndSubstituteTemplate(DEFAULT_CARD_TEMPLATE_ARRAY, entry, collectionSlug);
}

/** ADR 0065 D8 — `'custom'` display arm. Reads the per-Collection
 *  `customTemplate` and delegates to `cloneAndSubstituteTemplate`. */
function buildCustomEntryInstance(
  template: readonly CanvasElement[],
  entry: MaterializerEntry,
  collectionSlug: string,
): CanvasElement[] {
  return cloneAndSubstituteTemplate(template, entry, collectionSlug);
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
  return el.sort ?? 'date-desc';
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
 *  placeholder UI separately).
 *
 *  ADR 0065 D8 — `'custom'` arm failure paths (loud, no fallback to
 *  `DEFAULT_CARD_TEMPLATE`):
 *    - `display === 'custom'` AND `customTemplate === undefined` → zero cards
 *      + warning: `"Collection element <id> display='custom' but customTemplate
 *      is not set."`.
 *    - `display === 'custom'` AND `customTemplate.length === 0` → zero cards
 *      + warning: `"Collection element <id> display='custom' but customTemplate
 *      has zero elements."`.
 *  The Owner's intent (an empty customTemplate is preserved across mode
 *  switches per ADR 0065 D4) is honoured exactly — a visually broken Collection
 *  + a loud signal explaining why. */
function hydrateCollectionElement(
  el: CollectionElement,
  entries: readonly MaterializerEntry[],
  pageSlug: string,
  warnings: string[],
): void {
  const display = el.display ?? 'card';
  let customTemplate: readonly CanvasElement[] | undefined;
  if (display === 'custom') {
    if (el.customTemplate === undefined) {
      warnings.push(
        `Collection element ${el.id} display='custom' but customTemplate is not set.`,
      );
      el.entries = [];
      return;
    }
    if (el.customTemplate.length === 0) {
      warnings.push(
        `Collection element ${el.id} display='custom' but customTemplate has zero elements.`,
      );
      el.entries = [];
      return;
    }
    customTemplate = el.customTemplate;
  }
  const { ordered, warning } = resolveEntriesForCollection(el, entries, pageSlug);
  if (warning !== null) warnings.push(warning);
  const collectionSlug = el.collectionSlug ?? '';
  const built: CanvasElement[][] = ordered.map((entry) => {
    if (display === 'image-only') return buildImageOnlyEntryInstance(entry, collectionSlug);
    if (display === 'custom' && customTemplate !== undefined) {
      return buildCustomEntryInstance(customTemplate, entry, collectionSlug);
    }
    return buildCardEntryInstance(entry, collectionSlug);
  });
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
