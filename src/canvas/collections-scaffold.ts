// src/canvas/collections-scaffold.ts
//
// ADR 0063 Decision 11 — pure scaffold for the "+ New Collection" wizard.
//
// Given an `EditableSite` plus a desired collection slug, this returns:
//   * Two new canvas pages — [indexPage, templatePage] — to append to
//     `EditableSite.pages`.
//   * Two seed `collection_entry` rows so the index page renders a real
//     two-card grid the moment the Owner lands on it (no placeholder
//     banner).
//
// Pure: does not touch the database, the editor, or the network. The caller
// (`POST /api/sites/:siteId/collections`) atomically persists the new pages
// onto `site.editableState.pages[]` and inserts the seed rows into
// `collection_entry` inside one DB transaction (drizzle `batch`). If any
// sub-step fails the entire batch rolls back per ADR 0063 dec 11 §f.
//
// Slug rules mirror `ENTRY_SLUG_RE` in `routes/api/entries.ts` — 1..80
// lowercase letters, digits, hyphens, no leading/trailing dash. The
// collection slug must not collide with an existing page slug, an existing
// page's `collectionSlug` binding, the materializer's per-entry slug shape
// (`<collectionSlug>/<entrySlug>` for either seed entry), or the template
// page slug (`<collectionSlug>/_template`).
//
// ADR 0063 dec 1 moved source binding from the page to the element, so the
// index page's single Collection element carries `collectionSlug`,
// `display: 'card'`, `sort: 'date-desc'`, no `folder`, no `manualOrder`.
// The page itself still carries `pageKind: 'collection-index'` +
// `collectionSlug` during the transition window (decision 2's migration is
// E2's responsibility; F5 removes the field). The validator currently
// requires `pageKind` and `collectionSlug` to be set together, so we set
// both — the materializer reads the element's binding for card output
// regardless.

import type {
  CanvasPage,
  CanvasSection,
  EditableSite,
  ImageMediaElement,
  TextElement,
} from './schema.js';
import type { CollectionElement } from './elements/collection.js';
import type { SeedEntryRow } from '../templates/portfolio-seed-entries.js';
import { wizardSeedEntries } from '../templates/portfolio-seed-entries.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** Maximum number of `collection-N` fallbacks attempted by
 *  `resolveAvailableSlug`. Hitting this means the site already carries 99
 *  collections named `collection-1`..`collection-99` plus a `blog` — the
 *  wizard fails loudly rather than looping forever. */
const SLUG_FALLBACK_MAX = 99;

/** Default slug attempted before any fallback (ADR 0063 dec 11 §a). */
export const WIZARD_DEFAULT_SLUG = 'blog';

const WIZARD_SEED_ENTRY_SLUGS = ['welcome-to-your-blog', 'your-second-post'] as const;

export interface CollectionScaffoldOk {
  ok: true;
  /** Two new pages to append to `EditableSite.pages`: [index, template]. */
  newPages: [CanvasPage, CanvasPage];
  /** Two seed rows to insert into `collection_entry`. The caller annotates
   *  each with `siteId` before passing to the DB driver. */
  seedEntries: SeedEntryRow[];
  /** Echo of the slug actually used — equals the input slug; included so
   *  callers don't have to re-derive it from `newPages`. */
  collectionSlug: string;
}
export interface CollectionScaffoldErr {
  ok: false;
  /** Failure step name (`'slug-format'` | `'slug-conflict'` | `'id-conflict'`).
   *  ADR 0063 dec 11 §f surfaces this in the dashboard toast. */
  step: 'slug-format' | 'slug-conflict' | 'id-conflict';
  error: string;
}
export type CollectionScaffoldResult = CollectionScaffoldOk | CollectionScaffoldErr;

/** Type alias for callers transitioning from the pre-ADR-0063 single-entry
 *  shape. Same underlying row contract as the site-create-time seed. */
export type CollectionScaffoldSeedEntry = SeedEntryRow;

function titleCase(slug: string): string {
  // 'blog' → 'Blog'. 'case-studies' → 'Case Studies'.
  return slug
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** True if `slug` collides with any existing page slug, page-bound
 *  collection binding, or the slugs the materializer would produce for the
 *  two seed entries / template page. The pure version used by both the
 *  fallback resolver and the final shape check. */
function slugIsTaken(pages: readonly CanvasPage[], slug: string): boolean {
  const templatePageSlug = `${slug}/_template`;
  const seedSlugs = WIZARD_SEED_ENTRY_SLUGS.map((s) => `${slug}/${s}`);
  for (const page of pages) {
    if (page.slug === slug) return true;
    if (page.slug === templatePageSlug) return true;
    if (seedSlugs.includes(page.slug)) return true;
    if (page.collectionSlug === slug) return true;
  }
  return false;
}

/** Pick the slug to scaffold against. If `requested === WIZARD_DEFAULT_SLUG`
 *  ("blog") and it collides, walk `collection-1`..`collection-N` until one
 *  is free. Custom slugs do NOT auto-fallback — the wizard returns the
 *  collision verbatim so the Owner sees what they picked is taken.
 *
 *  Returns `{ok: true, slug}` on success or `{ok: false, error}` if the
 *  fallback pool is exhausted (treated as a pool-exhaustion failure, never
 *  silent). */
export function resolveAvailableSlug(
  pages: readonly CanvasPage[],
  requested: string,
):
  | { ok: true; slug: string }
  | { ok: false; error: string } {
  if (requested !== WIZARD_DEFAULT_SLUG) {
    // Custom slug — no fallback; collisions surface as a hard error from
    // the caller via slugIsTaken / scaffoldCollection's own collision check.
    return { ok: true, slug: requested };
  }
  if (!slugIsTaken(pages, requested)) {
    return { ok: true, slug: requested };
  }
  for (let i = 1; i <= SLUG_FALLBACK_MAX; i += 1) {
    const candidate = `collection-${i}`;
    if (!slugIsTaken(pages, candidate)) {
      return { ok: true, slug: candidate };
    }
  }
  return {
    ok: false,
    error:
      'Collection slug pool exhausted (blog and collection-1..collection-' +
      SLUG_FALLBACK_MAX +
      ' are all taken)',
  };
}

function findIdConflict(pages: readonly CanvasPage[], ids: readonly string[]): string | null {
  const existing = new Set(pages.map((p) => p.id));
  for (const id of ids) {
    if (existing.has(id)) return `a page with id "${id}" already exists`;
  }
  return null;
}

/** Build the index page — a normal page with one Collection element bound
 *  to the collection at the element level (ADR 0063 dec 1). Layout: a 60px
 *  heading at the top, then the Collection element filling the content
 *  width with 600px height (ADR 0063 dec 11 §b). */
function buildIndexPage(slug: string): CanvasPage {
  const heading: TextElement = {
    id: `coll-${slug}-heading`,
    type: 'text',
    box: { x: 80, y: 40, w: 1280, h: 60, z: 2 },
    content: [{ text: titleCase(slug) }],
    role: 'heading',
    fontSize: 40,
    fontWeight: 600,
    align: 'left',
  };
  // ADR 0063 dec 1 + dec 4 + dec 11 §b — element-level binding, default
  // sort/display, no folder, no manualOrder. The materializer (Phase 2B)
  // reads `display === 'card'` and clones its built-in default card
  // template per entry; no per-element card template is embedded here.
  const collection: CollectionElement = {
    id: `coll-${slug}-grid`,
    type: 'collection',
    box: { x: 80, y: 140, w: 1280, h: 600, z: 1 },
    collectionSlug: slug,
    sort: 'date-desc',
    display: 'card',
  };
  const section: CanvasSection = {
    id: `coll-${slug}-index-section`,
    recipeId: 'custom',
    name: 'Collection list',
    height: 800,
    elements: [heading, collection],
  };
  // ADR 0063 dec 2 — `pageKind: 'collection-index'` is retired by the
  // migration (E2's responsibility). During Phase 2D's transition window
  // the validator still requires `pageKind` and `collectionSlug` to be set
  // together (validate.ts:1522-1534), so we set both. The element-level
  // binding above is what the materializer reads; the page-level fields
  // are deadweight until E2's migration sweeps them.
  return {
    id: `page-collection-${slug}-index`,
    slug,
    title: titleCase(slug),
    width: 1440,
    sections: [section],
    pageKind: 'collection-index',
    collectionSlug: slug,
  };
}

/** Build the per-entry template page. Cloned once per published entry at
 *  publish time by the materializer; the clones replace this page in the
 *  snapshot (`collection-item-template` pages never ship as real pages —
 *  the materializer drops them after expansion).
 *
 *  ADR 0063 dec 11 §c calls for hero image + h1 + byline + body. The hero
 *  is declared as a media element with `assetId: ''` (an unfilled slot —
 *  the validator allows empty assetId in editable state). Owners customise
 *  it via the inspector. Phase 2B's materializer is the layer that will
 *  eventually swap the empty slot for the entry's OG asset; today the
 *  page-level `ogImageAssetId` copy in collection-materializer.ts:195
 *  carries that signal to social cards. The hero element exists so the
 *  Owner has a slot to fill rather than an empty canvas to design from
 *  scratch. `noIndex: true` excludes the template from the sitemap
 *  (decision 11 §c "never appears in the public sitemap"); the
 *  materializer already drops template pages from publish output, so
 *  `noIndex` is belt-and-braces for any editor-preview or
 *  editableState-walking sitemap path. */
function buildTemplatePage(slug: string): CanvasPage {
  const hero: ImageMediaElement = {
    id: `coll-${slug}-tmpl-hero`,
    type: 'media',
    mediaKind: 'image',
    box: { x: 80, y: 64, w: 1280, h: 360, z: 2 },
    assetId: '',
    alt: '{{title}}',
    fit: 'cover',
    elementStyle: { borderRadius: 16, overflow: 'hidden' },
  };
  const titleEl: TextElement = {
    id: `coll-${slug}-tmpl-title`,
    type: 'text',
    box: { x: 80, y: 464, w: 1280, h: 80, z: 3 },
    content: [{ text: '{{title}}' }],
    role: 'heading',
    fontSize: 48,
    fontWeight: 600,
    align: 'left',
  };
  const meta: TextElement = {
    id: `coll-${slug}-tmpl-meta`,
    type: 'text',
    box: { x: 80, y: 560, w: 1280, h: 24, z: 3 },
    content: [{ text: '{{author}} · {{publishedDate}}' }],
    role: 'label',
    fontSize: 13,
    fontWeight: 500,
    align: 'left',
  };
  const body: TextElement = {
    id: `coll-${slug}-tmpl-body`,
    type: 'text',
    box: { x: 80, y: 624, w: 1000, h: 600, z: 3 },
    content: [{ text: '{{body}}' }],
    role: 'body',
    fontSize: 17,
    fontWeight: 400,
    align: 'left',
    lineHeight: 1.7,
  };
  const section: CanvasSection = {
    id: `coll-${slug}-template-section`,
    recipeId: 'custom',
    name: 'Entry body',
    height: 1280,
    elements: [hero, titleEl, meta, body],
  };
  return {
    id: `page-collection-${slug}-template`,
    slug: `${slug}/_template`,
    title: '{{title}}',
    width: 1440,
    sections: [section],
    pageKind: 'collection-item-template',
    collectionSlug: slug,
    noIndex: true,
  };
}

/** Build the two new canvas pages + two seed entries for a new collection.
 *  Pure. Returns `{ok: false}` when the slug is malformed or would collide
 *  with an existing page slug / pageKind binding.
 *
 *  `now` is the wall-clock used to date the seed entries (today + yesterday
 *  per ADR 0063 dec 11 §d). Defaults to `new Date()`; the smoke passes a
 *  fixed date to make assertions deterministic. */
export function scaffoldCollection(
  state: EditableSite,
  slug: string,
  now: Date = new Date(),
): CollectionScaffoldResult {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    return {
      ok: false,
      step: 'slug-format',
      error: 'collection slug must be 1..80 lowercase letters, digits, or dashes',
    };
  }
  if (slugIsTaken(state.pages, slug)) {
    return {
      ok: false,
      step: 'slug-conflict',
      error: `a page with slug "${slug}" already exists (or the slug is bound to another page)`,
    };
  }
  const indexPage = buildIndexPage(slug);
  const templatePage = buildTemplatePage(slug);
  const idConflict = findIdConflict(state.pages, [indexPage.id, templatePage.id]);
  if (idConflict !== null) {
    return { ok: false, step: 'id-conflict', error: idConflict };
  }
  return {
    ok: true,
    newPages: [indexPage, templatePage],
    seedEntries: wizardSeedEntries(slug, now),
    collectionSlug: slug,
  };
}
