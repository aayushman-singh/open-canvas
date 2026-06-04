// src/canvas/elements/collection-per-entry-og.smoke.ts
//
// ADR 0060 F4 — per-entry OG image. The OG generation path is already
// per-page-aware (`onPublishGenerateOg` iterates `snapshot.pages`, skips
// render when `page.ogImageAssetId` is set; the OG route serves a 302
// redirect to the owner asset). The materializer already copies
// `entry.ogImageAssetId` onto the cloned template page. This smoke pins
// the contract end-to-end so a future refactor of either surface cannot
// silently regress per-entry OG cards.
//
// Coverage:
//   1. Entry with `ogImageAssetId` -> materialized page has matching value.
//   2. Entry with `ogImageAssetId: null` -> materialized page has the field
//      ABSENT (not present-but-empty), so the rendered-OG fallback kicks in.
//   3. Template page with its own `ogImageAssetId` is overwritten by the
//      entry's value (entry wins) for the materialized clone.
//   4. Mixed entries in the same collection produce mixed clones — the
//      override and rendered paths can coexist within one publish.
//
// Run with `bun run collection-per-entry-og:smoke`.

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  TextElement,
} from '../schema.js';
import {
  materializeCollections,
  type MaterializerEntry,
} from './collection-materializer.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[collection-per-entry-og:smoke] ${message}`);
}

function makeText(id: string, text: string): TextElement {
  return {
    id,
    type: 'text',
    box: { x: 0, y: 0, w: 600, h: 60, z: 1 },
    content: [{ text }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
  };
}

function makeSection(elements: CanvasElement[]): CanvasSection {
  return {
    id: 'sec',
    recipeId: 'custom',
    name: 'Section',
    height: 600,
    elements,
  };
}

function makeTemplatePage(opts: { ogImageAssetId?: string } = {}): CanvasPage {
  const page: CanvasPage = {
    id: 'page-blog-template',
    slug: 'blog-template',
    title: '{{title}}',
    width: 1200,
    sections: [makeSection([makeText('hero-title', '{{title}}')])],
    pageKind: 'collection-item-template',
    collectionSlug: 'blog',
  };
  if (opts.ogImageAssetId !== undefined) page.ogImageAssetId = opts.ogImageAssetId;
  return page;
}

function makeSite(pages: CanvasPage[]): EditableSite {
  return { styleKit: 'charcoal', pages };
}

function makeEntry(opts: Partial<MaterializerEntry> & { slug: string }): MaterializerEntry {
  return {
    collectionSlug: 'blog',
    title: 'Post',
    excerpt: 'Excerpt',
    body: 'Body',
    publishedDate: '2026-06-04T00:00:00.000Z',
    author: 'A',
    category: 'blog',
    tags: [],
    ogImageAssetId: null,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// (1) Entry with ogImageAssetId → materialized page carries it
// ---------------------------------------------------------------------------

{
  const site = makeSite([makeTemplatePage()]);
  const entry = makeEntry({ slug: 'with-image', ogImageAssetId: 'asset-abc123' });
  const out = materializeCollections(site, [entry]);
  const page = out.pages.find((p) => p.slug === 'blog/with-image');
  assert(page !== undefined, '(1) materialized page must exist');
  assert(
    page!.ogImageAssetId === 'asset-abc123',
    `(1) ogImageAssetId must propagate from entry (got ${String(page!.ogImageAssetId)})`,
  );
}

// ---------------------------------------------------------------------------
// (2) Entry without ogImageAssetId → field is ABSENT on materialized page
// ---------------------------------------------------------------------------

{
  const site = makeSite([makeTemplatePage()]);
  const entry = makeEntry({ slug: 'no-image', ogImageAssetId: null });
  const out = materializeCollections(site, [entry]);
  const page = out.pages.find((p) => p.slug === 'blog/no-image');
  assert(page !== undefined, '(2) materialized page must exist');
  // Absence — not empty string. The OG override check is
  // `page.ogImageAssetId !== undefined && page.ogImageAssetId.length > 0`,
  // so undefined is correct ("fall through to rendered card"). A
  // present-but-empty string would skip the render in `on-publish.ts` but
  // then crash the route's asset lookup. We want absence.
  assert(
    !('ogImageAssetId' in page!) || page.ogImageAssetId === undefined,
    `(2) ogImageAssetId must be absent when entry has null (got ${JSON.stringify(page!.ogImageAssetId)})`,
  );
}

// ---------------------------------------------------------------------------
// (3) Template's own ogImageAssetId is OVERWRITTEN by entry's value
//     (entry wins; template's image is a placeholder, never published as-is)
// ---------------------------------------------------------------------------

{
  const site = makeSite([makeTemplatePage({ ogImageAssetId: 'asset-template-default' })]);
  const entry = makeEntry({ slug: 'override', ogImageAssetId: 'asset-entry-specific' });
  const out = materializeCollections(site, [entry]);
  const page = out.pages.find((p) => p.slug === 'blog/override');
  assert(page !== undefined, '(3) materialized page must exist');
  assert(
    page!.ogImageAssetId === 'asset-entry-specific',
    `(3) entry's ogImageAssetId must win over template's (got ${String(page!.ogImageAssetId)})`,
  );
}

// ---------------------------------------------------------------------------
// (4) Mixed entries — one with override, one without — coexist correctly
// ---------------------------------------------------------------------------

{
  const site = makeSite([makeTemplatePage()]);
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'has-og', ogImageAssetId: 'asset-has-og' }),
    makeEntry({ slug: 'no-og', ogImageAssetId: null }),
  ];
  const out = materializeCollections(site, entries);
  const withOg = out.pages.find((p) => p.slug === 'blog/has-og');
  const withoutOg = out.pages.find((p) => p.slug === 'blog/no-og');
  assert(withOg !== undefined, '(4) override page exists');
  assert(withoutOg !== undefined, '(4) rendered page exists');
  assert(
    withOg!.ogImageAssetId === 'asset-has-og',
    `(4) override path carries entry's id (got ${String(withOg!.ogImageAssetId)})`,
  );
  assert(
    !('ogImageAssetId' in withoutOg!) || withoutOg.ogImageAssetId === undefined,
    `(4) rendered path has ogImageAssetId absent (got ${JSON.stringify(withoutOg!.ogImageAssetId)})`,
  );
}

console.log('[collection-per-entry-og:smoke] OK');
