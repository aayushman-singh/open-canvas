// src/canvas/collections-scaffold.ts
//
// ADR 0060 F3 — pure scaffold for the "+ New collection" wizard.
//
// Given an `EditableSite` and a desired collection slug, this returns the
// two new canvas pages and one sample entry needed to make the collection
// "work" end-to-end: an index page (lists entries via a page-bound
// CollectionElement), a template page (cloned per entry at publish), and a
// sample entry so the Owner sees a non-empty preview the moment they click
// publish.
//
// Pure: does not touch the database, the editor, or the network. The caller
// (the `/api/sites/:siteId/collections` POST handler) is responsible for
// persisting the new pages onto `site.editableState.pages[]` and the
// sample entry into `collection_entry`.
//
// Slug rules mirror `ENTRY_SLUG_RE` in `routes/api/entries.ts` — lowercase
// letters, digits, hyphens, 1..80 chars. The collection slug must not
// collide with an existing page slug, an existing pageKind binding, or any
// of the slugs the materializer would produce for the sample entry.

import type { CanvasPage, CanvasSection, EditableSite } from './schema.js';
import type { CollectionElement, CollectionMode } from './elements/collection.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export interface CollectionScaffoldSampleEntry {
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
  status: 'published';
}

export interface CollectionScaffoldOk {
  ok: true;
  /** Two new pages to append to `EditableSite.pages`: [index, template]. */
  newPages: [CanvasPage, CanvasPage];
  /** Sample entry to insert into `collection_entry` so the Owner sees
   *  something the moment they hit publish. Caller fills siteId/createdAt. */
  sampleEntry: CollectionScaffoldSampleEntry;
}
export interface CollectionScaffoldErr {
  ok: false;
  error: string;
}
export type CollectionScaffoldResult = CollectionScaffoldOk | CollectionScaffoldErr;

function titleCase(slug: string): string {
  // 'blog' → 'Blog'. 'case-studies' → 'Case Studies'.
  return slug
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function todayISO(): string {
  // ISO date without time, matches the column shape.
  return new Date().toISOString().slice(0, 10);
}

const SAMPLE_ENTRY_SLUG = 'sample-post';

function findSlugConflict(
  pages: readonly CanvasPage[],
  collectionSlug: string,
): string | null {
  const templatePageSlug = `${collectionSlug}/template`;
  const sampleExpandedSlug = `${collectionSlug}/${SAMPLE_ENTRY_SLUG}`;
  for (const page of pages) {
    if (page.slug === collectionSlug) {
      return `a page with slug "${collectionSlug}" already exists`;
    }
    if (page.slug === templatePageSlug) {
      return `a page with slug "${templatePageSlug}" already exists`;
    }
    if (page.slug === sampleExpandedSlug) {
      return `a page with slug "${sampleExpandedSlug}" already exists`;
    }
    if (page.collectionSlug === collectionSlug) {
      return `a collection "${collectionSlug}" is already set up on page "${page.id}"`;
    }
  }
  return null;
}

function findIdConflict(pages: readonly CanvasPage[], ids: readonly string[]): string | null {
  const existing = new Set(pages.map((p) => p.id));
  for (const id of ids) {
    if (existing.has(id)) return `a page with id "${id}" already exists`;
  }
  return null;
}

function buildIndexPage(slug: string): CanvasPage {
  const heading: CanvasSection['elements'][number] = {
    id: `coll-${slug}-heading`,
    type: 'text',
    box: { x: 80, y: 40, w: 1200, h: 60, z: 2 },
    content: [{ text: titleCase(slug) }],
    role: 'heading',
    fontSize: 40,
    fontWeight: 600,
    align: 'left',
  };
  const collection: CollectionElement = {
    id: `coll-${slug}-grid`,
    type: 'collection',
    box: { x: 80, y: 140, w: 1280, h: 600, z: 1 },
    mode: 'page-bound' satisfies CollectionMode,
    entryTemplate: [],
    entries: [],
    sort: { field: 'publishedDate', order: 'desc' },
    fieldBindings: {
      [`coll-${slug}-card-title`]: 'title',
      [`coll-${slug}-card-excerpt`]: 'description',
      [`coll-${slug}-card-date`]: 'publishedDate',
    },
    cardTemplate: [
      {
        id: `coll-${slug}-card-bg`,
        type: 'container',
        box: { x: 0, y: 0, w: 400, h: 260, z: 1 },
        variant: 'raised',
        elementStyle: { borderRadius: 16 },
      },
      {
        id: `coll-${slug}-card-title`,
        type: 'text',
        box: { x: 24, y: 32, w: 352, h: 60, z: 3 },
        content: [{ text: '{{title}}' }],
        role: 'heading',
        fontSize: 22,
        fontWeight: 600,
        align: 'left',
      },
      {
        id: `coll-${slug}-card-excerpt`,
        type: 'text',
        box: { x: 24, y: 104, w: 352, h: 80, z: 3 },
        content: [{ text: '{{excerpt}}' }],
        role: 'body',
        fontSize: 14,
        fontWeight: 400,
        align: 'left',
      },
      {
        id: `coll-${slug}-card-date`,
        type: 'text',
        box: { x: 24, y: 208, w: 352, h: 22, z: 3 },
        content: [{ text: '{{publishedDate}}' }],
        role: 'label',
        fontSize: 12,
        fontWeight: 400,
        align: 'left',
      },
    ],
    layout: { columns: 3, gap: 24 },
  };
  const section: CanvasSection = {
    id: `coll-${slug}-index-section`,
    recipeId: 'custom',
    name: 'Collection list',
    height: 800,
    elements: [heading, collection],
  };
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

function buildTemplatePage(slug: string): CanvasPage {
  const titleEl: CanvasSection['elements'][number] = {
    id: `coll-${slug}-tmpl-title`,
    type: 'text',
    box: { x: 80, y: 80, w: 1280, h: 80, z: 3 },
    content: [{ text: '{{title}}' }],
    role: 'heading',
    fontSize: 48,
    fontWeight: 600,
    align: 'left',
  };
  const meta: CanvasSection['elements'][number] = {
    id: `coll-${slug}-tmpl-meta`,
    type: 'text',
    box: { x: 80, y: 176, w: 1280, h: 24, z: 3 },
    content: [{ text: '{{author}} · {{publishedDate}}' }],
    role: 'label',
    fontSize: 13,
    fontWeight: 500,
    align: 'left',
  };
  const body: CanvasSection['elements'][number] = {
    id: `coll-${slug}-tmpl-body`,
    type: 'text',
    box: { x: 80, y: 240, w: 1000, h: 600, z: 3 },
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
    height: 900,
    elements: [titleEl, meta, body],
  };
  return {
    id: `page-collection-${slug}-template`,
    slug: `${slug}/template`,
    title: '{{title}}',
    width: 1440,
    sections: [section],
    pageKind: 'collection-item-template',
    collectionSlug: slug,
  };
}

function buildSampleEntry(slug: string): CollectionScaffoldSampleEntry {
  return {
    collectionSlug: slug,
    slug: SAMPLE_ENTRY_SLUG,
    title: `Welcome to ${titleCase(slug)}`,
    excerpt:
      'This is a sample entry. Edit or delete it from the dashboard — it does not come back.',
    body:
      'This is a sample entry. Open the Entries tab in the dashboard to edit or delete it.\n\nWhen you publish, every entry in this collection appears at /' +
      slug +
      '/<entry-slug> on your live site, and the index page at /' +
      slug +
      ' lists them all.',
    publishedDate: todayISO(),
    author: '',
    category: '',
    tags: [],
    ogImageAssetId: null,
    status: 'published',
  };
}

/** Build the two new canvas pages + sample entry for a new collection. Pure.
 *  Returns `{ok: false}` when the slug is malformed or would collide with an
 *  existing page slug / pageKind binding. */
export function scaffoldCollection(
  state: EditableSite,
  slug: string,
): CollectionScaffoldResult {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    return {
      ok: false,
      error: 'collection slug must be 1..80 lowercase letters, digits, or dashes',
    };
  }
  const slugConflict = findSlugConflict(state.pages, slug);
  if (slugConflict !== null) {
    return { ok: false, error: slugConflict };
  }
  const indexPage = buildIndexPage(slug);
  const templatePage = buildTemplatePage(slug);
  const idConflict = findIdConflict(state.pages, [indexPage.id, templatePage.id]);
  if (idConflict !== null) {
    return { ok: false, error: idConflict };
  }
  return {
    ok: true,
    newPages: [indexPage, templatePage],
    sampleEntry: buildSampleEntry(slug),
  };
}
