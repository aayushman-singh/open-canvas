// src/canvas/collections-scaffold.smoke.ts
//
// ADR 0060 F3 — pins the "+ New collection" wizard's pure scaffold:
//
//   1. Valid slug produces an index page + template page + sample entry.
//   2. The two new pages carry the correct pageKind/collectionSlug, slugs,
//      and unique element ids.
//   3. The materializer expands the template + sample entry into a concrete
//      page at <slug>/<sampleEntrySlug>.
//   4. The resulting site validates end-to-end.
//   5. Slug rule failures (uppercase, empty, too long, bad chars) error.
//   6. Slug already in use as a page slug / collectionSlug errors with the
//      conflict surfaced in the message.
//
// Run with `bun run collections-scaffold:smoke`.

import type { EditableSite } from './schema.js';
import {
  materializeCollections,
  type MaterializerEntry,
} from './elements/collection-materializer.js';
import { validateEditableSite } from './validate.js';
import { scaffoldCollection } from './collections-scaffold.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[collections-scaffold:smoke] ${message}`);
}

function emptySite(): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'index',
        title: 'Home',
        width: 1440,
        sections: [
          {
            id: 'sec-home-empty',
            recipeId: 'custom',
            name: 'Home',
            height: 600,
            elements: [
              {
                id: 'home-headline',
                type: 'text',
                box: { x: 80, y: 80, w: 600, h: 60, z: 1 },
                content: [{ text: 'Hi' }],
                role: 'heading',
                fontSize: 48,
                fontWeight: 600,
                align: 'left',
              },
            ],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// (1) Valid slug → index + template + sample entry
// ---------------------------------------------------------------------------

{
  const result = scaffoldCollection(emptySite(), 'blog');
  assert(result.ok, `(1) valid slug should succeed (got ${result.ok ? 'ok' : result.error})`);
  if (!result.ok) throw new Error('unreachable');

  const [indexPage, templatePage] = result.newPages;
  assert(indexPage.pageKind === 'collection-index', '(1) index page pageKind');
  assert(indexPage.collectionSlug === 'blog', '(1) index page collectionSlug');
  assert(indexPage.slug === 'blog', '(1) index page slug = "blog"');
  assert(templatePage.pageKind === 'collection-item-template', '(1) template pageKind');
  assert(templatePage.collectionSlug === 'blog', '(1) template collectionSlug');
  assert(templatePage.slug === 'blog/template', '(1) template page slug');

  const entry = result.sampleEntry;
  assert(entry.collectionSlug === 'blog', '(1) sample entry collectionSlug');
  assert(entry.status === 'published', '(1) sample entry ships published');
  assert(entry.body.length > 0, '(1) sample entry body non-empty');
}

// ---------------------------------------------------------------------------
// (2) Element ids on the two new pages are unique within their page
// ---------------------------------------------------------------------------

{
  const result = scaffoldCollection(emptySite(), 'blog');
  if (!result.ok) throw new Error('(2) unreachable');
  for (const page of result.newPages) {
    const ids = new Set<string>();
    for (const section of page.sections) {
      for (const el of section.elements) {
        assert(!ids.has(el.id), `(2) page ${page.id} has duplicate element id ${el.id}`);
        ids.add(el.id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// (3) Materializer expands the template + sample entry into one concrete page
// ---------------------------------------------------------------------------

{
  const baseState = emptySite();
  const result = scaffoldCollection(baseState, 'blog');
  if (!result.ok) throw new Error('(3) unreachable');
  const updatedState: EditableSite = {
    ...baseState,
    pages: [...baseState.pages, ...result.newPages],
  };
  const materializerEntry: MaterializerEntry = {
    collectionSlug: result.sampleEntry.collectionSlug,
    slug: result.sampleEntry.slug,
    title: result.sampleEntry.title,
    excerpt: result.sampleEntry.excerpt,
    body: result.sampleEntry.body,
    publishedDate: result.sampleEntry.publishedDate,
    author: result.sampleEntry.author,
    category: result.sampleEntry.category,
    tags: result.sampleEntry.tags,
    ogImageAssetId: result.sampleEntry.ogImageAssetId,
  };
  const materialized = materializeCollections(updatedState, [materializerEntry]);
  const expandedSlug = `blog/${result.sampleEntry.slug}`;
  const expanded = materialized.pages.find((p) => p.slug === expandedSlug);
  assert(expanded !== undefined, `(3) materializer must produce a page at ${expandedSlug}`);
  assert(expanded!.pageKind === undefined, '(3) materialized clone strips pageKind');
}

// ---------------------------------------------------------------------------
// (4) End-to-end: scaffolded + materialized site validates
// ---------------------------------------------------------------------------

{
  const baseState = emptySite();
  const result = scaffoldCollection(baseState, 'blog');
  if (!result.ok) throw new Error('(4) unreachable');
  const updatedState: EditableSite = {
    ...baseState,
    pages: [...baseState.pages, ...result.newPages],
  };
  const editValidation = validateEditableSite(updatedState);
  assert(
    editValidation.valid,
    `(4) updated site must validate (errors: ${editValidation.valid ? '' : editValidation.errors.join('; ')})`,
  );

  const materializerEntry: MaterializerEntry = {
    collectionSlug: result.sampleEntry.collectionSlug,
    slug: result.sampleEntry.slug,
    title: result.sampleEntry.title,
    excerpt: result.sampleEntry.excerpt,
    body: result.sampleEntry.body,
    publishedDate: result.sampleEntry.publishedDate,
    author: result.sampleEntry.author,
    category: result.sampleEntry.category,
    tags: result.sampleEntry.tags,
    ogImageAssetId: result.sampleEntry.ogImageAssetId,
  };
  const materialized = materializeCollections(updatedState, [materializerEntry]);
  const publishValidation = validateEditableSite(materialized);
  assert(
    publishValidation.valid,
    `(4) materialized site must validate (errors: ${publishValidation.valid ? '' : publishValidation.errors.join('; ')})`,
  );
}

// ---------------------------------------------------------------------------
// (5) Slug shape failures
// ---------------------------------------------------------------------------

{
  for (const bad of ['', 'Blog', 'a'.repeat(81), 'has space', '-leading', 'trailing-', 'sp ace']) {
    const result = scaffoldCollection(emptySite(), bad);
    assert(!result.ok, `(5) slug ${JSON.stringify(bad)} must fail`);
    if (!result.ok) {
      assert(
        result.error.toLowerCase().includes('slug'),
        `(5) error must mention slug for ${JSON.stringify(bad)} (got ${result.error})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (6) Slug conflict failures
// ---------------------------------------------------------------------------

{
  const baseState = emptySite();
  const first = scaffoldCollection(baseState, 'blog');
  if (!first.ok) throw new Error('(6a) unreachable');
  const afterFirst: EditableSite = {
    ...baseState,
    pages: [...baseState.pages, ...first.newPages],
  };
  const second = scaffoldCollection(afterFirst, 'blog');
  assert(!second.ok, '(6a) same slug twice should fail');
  if (!second.ok) {
    assert(
      second.error.toLowerCase().includes('blog'),
      `(6a) conflict error must mention the slug (got ${second.error})`,
    );
  }
}

{
  // Existing page with the proposed slug as its literal `slug` field.
  const baseState = emptySite();
  baseState.pages.push({
    id: 'page-existing-blog',
    slug: 'blog',
    title: 'Blog (manual)',
    width: 1440,
    sections: [
      {
        id: 'sec-existing-blog',
        recipeId: 'custom',
        name: 'Body',
        height: 400,
        elements: [
          {
            id: 'existing-blog-heading',
            type: 'text',
            box: { x: 80, y: 80, w: 600, h: 60, z: 1 },
            content: [{ text: 'Manual' }],
            role: 'heading',
            fontSize: 32,
            fontWeight: 600,
            align: 'left',
          },
        ],
      },
    ],
  });
  const result = scaffoldCollection(baseState, 'blog');
  assert(!result.ok, '(6b) existing page at /blog should block');
  if (!result.ok) {
    assert(
      result.error.includes('blog'),
      `(6b) error must mention conflicting slug (got ${result.error})`,
    );
  }
}

console.log('[collections-scaffold:smoke] OK');
