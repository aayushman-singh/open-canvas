// src/editor-client/site-load-migration.smoke.ts
//
// ADR 0063 dec 2 — pins the one-shot legacy
// pageKind === 'collection-index' migration that runs against the
// loaded EditableSite the first time the editor boots after the ADR
// ships.
//
// Coverage:
//   (1) Happy path: one page with pageKind === 'collection-index',
//       collectionSlug === 'blog', and exactly one Collection element
//       → element gains collectionSlug + default display + default sort;
//       page loses pageKind + collectionSlug; scheduleSave fires exactly
//       once.
//   (2) Multi-Collection page: pageKind + collectionSlug stay; element
//       slugs are NOT touched; a one-line banner is enqueued via
//       setStatus with the expected wording; scheduleSave does NOT fire
//       for this page alone.
//   (3) Zero-Collection page (legacy index page where the Owner deleted
//       the Collection element): pageKind + collectionSlug stay; banner
//       is enqueued.
//   (4) Missing-slug defensive: page has pageKind ===
//       'collection-index' but collectionSlug is undefined → skipped
//       with a console.warn (we capture warns), no crash, error-tone
//       banner enqueued.
//   (5) Idempotence on subsequent loads: rerunning the migration after
//       a happy-path migration is a no-op (no pages match the legacy
//       pageKind anymore).
//   (6) Wiring: createEditor calls migrateLegacyCollectionIndexPagesImpl
//       AFTER ctx.migrateState and BEFORE ctx.renderAll.
//   (7) ADR 0063 F3 audit shape — pwtest-engineer's affected page has
//       the Collection nested inside a section with sibling non-
//       Collection elements (NOT at page top-level). The migration must
//       find it inside section[].elements and migrate cleanly.
//   (8) Cross-section count — two sections, one Collection each, single
//       page → total count is 2 → multi-Collection branch fires.
//   (9) Tabs-nested Collection — Collection lives inside a Tabs
//       element's panel. Migration recurses into Tabs and counts the
//       inner Collection toward the total.
//
// Run with `bun run site-load-migration:smoke`.

import type { EditableSite, CanvasPage } from '../canvas/schema.js';
import type { SiteLoadMigrationCtx } from './site-load-migration.js';
import { migrateLegacyCollectionIndexPagesImpl } from './site-load-migration.js';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[site-load-migration:smoke] ' + message);
}

interface RecordedStatus {
  text: string;
  tone: 'ok' | 'error' | 'info' | undefined;
}

// ADR 0063 F5 narrowed `CollectionPageKind` so the type union no longer
// includes the retired `'collection-index'` value, but this smoke needs
// to construct fixtures carrying the dead value to verify the migration
// recognises them. The helper takes the kind as `string` and stamps it
// through an unknown-cast so legacy literals stay constructible.
function makePage(opts: {
  id: string;
  pageKind?: string;
  collectionSlug?: string;
  collectionElementCount: number;
  collectionElementSlugs?: (string | undefined)[];
}): CanvasPage {
  const collectionElements = [];
  for (let i = 0; i < opts.collectionElementCount; i++) {
    const slug = opts.collectionElementSlugs ? opts.collectionElementSlugs[i] : undefined;
    const el: Record<string, unknown> = {
      type: 'collection',
      id: opts.id + '-coll-' + i,
      box: { x: 0, y: 0, w: 800, h: 600 },
    };
    if (slug !== undefined) el.collectionSlug = slug;
    collectionElements.push(el);
  }
  const page: CanvasPage = {
    id: opts.id,
    slug: opts.id,
    title: opts.id,
    width: 1440,
    sections: [
      {
        id: opts.id + '-sec',
        recipeId: 'custom',
        name: 'sec',
        height: 600,
        elements: collectionElements as never,
      },
    ],
  };
  if (opts.pageKind !== undefined) {
    (page as { pageKind?: string }).pageKind = opts.pageKind;
  }
  if (opts.collectionSlug !== undefined) page.collectionSlug = opts.collectionSlug;
  return page;
}

/** Read `page.pageKind` as `string | undefined` so smoke assertions can
 *  still compare against the F5-retired `'collection-index'` literal. */
function rawPageKind(page: CanvasPage): string | undefined {
  return (page as { pageKind?: string }).pageKind;
}

function makeCtx(state: EditableSite | null): {
  ctx: SiteLoadMigrationCtx;
  statuses: RecordedStatus[];
  saveCalls: { count: number };
} {
  const statuses: RecordedStatus[] = [];
  const saveCalls = { count: 0 };
  return {
    ctx: {
      state,
      scheduleSave(): void {
        saveCalls.count += 1;
      },
      setStatus(text: string, tone): void {
        statuses.push({ text, tone });
      },
    },
    statuses,
    saveCalls,
  };
}

function makeSite(pages: CanvasPage[]): EditableSite {
  return {
    styleKit: 'charcoal',
    pages,
  };
}

// (1) Happy path.
{
  const page = makePage({
    id: 'page-blog-index',
    pageKind: 'collection-index',
    collectionSlug: 'blog',
    collectionElementCount: 1,
  });
  const site = makeSite([page]);
  const { ctx, statuses, saveCalls } = makeCtx(site);
  migrateLegacyCollectionIndexPagesImpl(ctx);
  assert(page.pageKind === undefined, '(1) page.pageKind must be cleared');
  assert(page.collectionSlug === undefined, '(1) page.collectionSlug must be cleared');
  const collEl = page.sections[0]!.elements[0]! as unknown as Record<string, unknown>;
  assert(collEl.collectionSlug === 'blog', '(1) element gains slug "blog"');
  assert(collEl.display === 'card', '(1) element default display = "card"');
  assert(collEl.sort === 'date-desc', '(1) element default sort = "date-desc"');
  assert(saveCalls.count === 1, '(1) scheduleSave fires exactly once');
  assert(statuses.length === 0, '(1) no banner for a clean migration');
}

// (2) Multi-Collection page.
{
  const page = makePage({
    id: 'page-multi',
    pageKind: 'collection-index',
    collectionSlug: 'blog',
    collectionElementCount: 2,
  });
  const site = makeSite([page]);
  const { ctx, statuses, saveCalls } = makeCtx(site);
  migrateLegacyCollectionIndexPagesImpl(ctx);
  assert(rawPageKind(page) === 'collection-index', '(2) multi-Collection: pageKind must persist');
  assert(page.collectionSlug === 'blog', '(2) multi-Collection: collectionSlug must persist');
  const coll0 = page.sections[0]!.elements[0]! as unknown as Record<string, unknown>;
  const coll1 = page.sections[0]!.elements[1]! as unknown as Record<string, unknown>;
  assert(
    coll0.collectionSlug === undefined,
    '(2) multi-Collection: element 0 slug must NOT be auto-set',
  );
  assert(
    coll1.collectionSlug === undefined,
    '(2) multi-Collection: element 1 slug must NOT be auto-set',
  );
  assert(saveCalls.count === 0, '(2) no save fires for multi-Collection page alone');
  assert(statuses.length === 1, '(2) banner enqueued exactly once');
  assert(
    statuses[0]!.text.includes('multiple Collections'),
    '(2) banner mentions "multiple Collections" but got: ' + statuses[0]!.text,
  );
  assert(
    statuses[0]!.text.includes('set the source'),
    '(2) banner instructs Owner to "set the source"',
  );
  assert(statuses[0]!.tone === 'info', '(2) banner tone is info');
}

// (3) Zero-Collection page.
{
  const page = makePage({
    id: 'page-empty',
    pageKind: 'collection-index',
    collectionSlug: 'orphan',
    collectionElementCount: 0,
  });
  const site = makeSite([page]);
  const { ctx, statuses, saveCalls } = makeCtx(site);
  migrateLegacyCollectionIndexPagesImpl(ctx);
  assert(rawPageKind(page) === 'collection-index', '(3) zero-Collection: pageKind must persist');
  assert(saveCalls.count === 0, '(3) no save fires for zero-Collection page');
  assert(statuses.length === 1, '(3) banner enqueued');
  assert(
    statuses[0]!.text.includes('multiple Collections'),
    '(3) zero-Collection takes the same banner path as multi-Collection (both = "Owner must resolve manually")',
  );
}

// (4) Missing-slug defensive.
{
  const originalWarn = console.warn;
  const warns: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warns.push(args);
  };
  try {
    const page = makePage({
      id: 'page-no-slug',
      pageKind: 'collection-index',
      collectionElementCount: 1,
    });
    // Force the invalid combination (pageKind without collectionSlug)
    // — Phase 1's validator rejects this, but legacy DB rows may carry it.
    const site = makeSite([page]);
    const { ctx, statuses } = makeCtx(site);
    migrateLegacyCollectionIndexPagesImpl(ctx);
    assert(
      rawPageKind(page) === 'collection-index',
      '(4) missing-slug: pageKind must persist (cannot migrate)',
    );
    assert(warns.length >= 1, '(4) console.warn must fire for missing slug');
    const warnText = warns.map((args) => args.join(' ')).join(' | ');
    assert(
      warnText.includes('page-no-slug'),
      '(4) warn must name the page id but got: ' + warnText,
    );
    assert(statuses.length === 1, '(4) banner enqueued');
    assert(statuses[0]!.tone === 'error', '(4) missing-slug banner tone is error');
    assert(
      statuses[0]!.text.includes('legacy collection-index'),
      '(4) banner mentions legacy collection-index pages',
    );
  } finally {
    console.warn = originalWarn;
  }
}

// (5) Idempotence on subsequent loads.
{
  const page = makePage({
    id: 'page-blog-index',
    pageKind: 'collection-index',
    collectionSlug: 'blog',
    collectionElementCount: 1,
  });
  const site = makeSite([page]);
  const { ctx, saveCalls } = makeCtx(site);
  migrateLegacyCollectionIndexPagesImpl(ctx);
  assert(saveCalls.count === 1, '(5) first run: scheduleSave fires');
  migrateLegacyCollectionIndexPagesImpl(ctx);
  assert(saveCalls.count === 1, '(5) second run: scheduleSave does NOT fire again (no-op)');
  migrateLegacyCollectionIndexPagesImpl(ctx);
  assert(saveCalls.count === 1, '(5) third run: still a no-op');
}

// (7) ADR 0063 F3 audit shape — pwtest-engineer's affected page.
//
// The prod audit (F3, 2026-06-05) found exactly one site
// (pwtest-engineer, site_id a525e78b-4f21-4618-ba2c-3a1dbff5fbdf) with
// a `pageKind === 'collection-index'` page. Its single Collection
// element is NESTED IN A SECTION alongside non-Collection siblings —
// not at page top-level. This fixture pins that the migration walks
// section.elements (not just top-level page-element surfaces) and
// successfully migrates the realistic prod shape. F5's hard-reject
// validator depends on this migration sweeping the affected page
// cleanly.
{
  const sibling: Record<string, unknown> = {
    type: 'text',
    id: 'pwtest-text-hero',
    box: { x: 0, y: 0, w: 800, h: 80 },
    content: [{ text: 'Blog' }],
    role: 'heading',
    fontSize: 32,
    fontWeight: 600,
    align: 'left',
  };
  const collection: Record<string, unknown> = {
    type: 'collection',
    id: 'pwtest-blog-collection',
    box: { x: 0, y: 100, w: 800, h: 600 },
  };
  const page: CanvasPage = {
    id: 'page-collection-blog-index',
    slug: 'blog',
    title: 'Blog',
    width: 1440,
    sections: [
      {
        id: 'pwtest-section',
        recipeId: 'custom',
        name: 'sec',
        height: 800,
        elements: [sibling, collection] as never,
      },
    ],
    collectionSlug: 'blog',
  };
  // F5 narrowed the union so `'collection-index'` is no longer
  // assignable to `page.pageKind`; the smoke stamps the legacy literal
  // through an unknown-cast so the migration can recognise it on the
  // raw JSONB shape.
  (page as { pageKind?: string }).pageKind = 'collection-index';
  const site = makeSite([page]);
  const { ctx, statuses, saveCalls } = makeCtx(site);
  migrateLegacyCollectionIndexPagesImpl(ctx);
  assert(page.pageKind === undefined, '(7) pwtest-engineer page.pageKind must be cleared');
  assert(
    page.collectionSlug === undefined,
    '(7) pwtest-engineer page.collectionSlug must be cleared',
  );
  const sib = page.sections[0]!.elements[0]! as unknown as Record<string, unknown>;
  const col = page.sections[0]!.elements[1]! as unknown as Record<string, unknown>;
  assert(sib.type === 'text', '(7) non-Collection sibling is untouched');
  assert(col.collectionSlug === 'blog', '(7) section-nested Collection gains slug "blog"');
  assert(col.display === 'card', '(7) section-nested Collection default display');
  assert(col.sort === 'date-desc', '(7) section-nested Collection default sort');
  assert(saveCalls.count === 1, '(7) scheduleSave fires exactly once for the prod-shape page');
  assert(statuses.length === 0, '(7) no banner for the clean prod-shape migration');
}

// (8) Cross-section count — a single Collection in section A plus a
// single Collection in section B totals two Collections on the page.
// The "single Collection" migration rule applies across the union of
// every section.elements list, so this page must hit the multi-
// Collection branch (no auto-migration, banner enqueued).
{
  const collA: Record<string, unknown> = {
    type: 'collection',
    id: 'cross-coll-a',
    box: { x: 0, y: 0, w: 800, h: 600 },
  };
  const collB: Record<string, unknown> = {
    type: 'collection',
    id: 'cross-coll-b',
    box: { x: 0, y: 0, w: 800, h: 600 },
  };
  const page: CanvasPage = {
    id: 'page-cross-section',
    slug: 'cross',
    title: 'Cross',
    width: 1440,
    sections: [
      {
        id: 'sec-a',
        recipeId: 'custom',
        name: 'A',
        height: 600,
        elements: [collA] as never,
      },
      {
        id: 'sec-b',
        recipeId: 'custom',
        name: 'B',
        height: 600,
        elements: [collB] as never,
      },
    ],
    collectionSlug: 'blog',
  };
  // F5 narrowed the union; stamp the legacy literal via cast.
  (page as { pageKind?: string }).pageKind = 'collection-index';
  const site = makeSite([page]);
  const { ctx, statuses, saveCalls } = makeCtx(site);
  migrateLegacyCollectionIndexPagesImpl(ctx);
  assert(
    rawPageKind(page) === 'collection-index',
    '(8) cross-section multi-Collection: pageKind must persist',
  );
  assert(saveCalls.count === 0, '(8) cross-section multi-Collection: no save fires');
  assert(statuses.length === 1, '(8) cross-section multi-Collection: banner enqueued');
  assert(
    statuses[0]!.text.includes('multiple Collections'),
    '(8) cross-section banner mentions multiple Collections',
  );
  const a = page.sections[0]!.elements[0]! as unknown as Record<string, unknown>;
  const b = page.sections[1]!.elements[0]! as unknown as Record<string, unknown>;
  assert(a.collectionSlug === undefined, '(8) section A Collection slug not auto-set');
  assert(b.collectionSlug === undefined, '(8) section B Collection slug not auto-set');
}

// (9) Tabs-nested Collection — Collection lives inside a tab panel.
// The walker recurses into Tabs (the only standard container that
// hosts Collections — Containers and Carousels do not per the Phase 1
// validator). One Collection total → migrates cleanly.
{
  const innerCollection: Record<string, unknown> = {
    type: 'collection',
    id: 'tabs-inner-coll',
    box: { x: 0, y: 0, w: 800, h: 600 },
  };
  const tabsEl: Record<string, unknown> = {
    type: 'tabs',
    id: 'tabs-host',
    box: { x: 0, y: 0, w: 1280, h: 800 },
    tabs: [
      {
        id: 'tab-1',
        label: 'Posts',
        elements: [innerCollection],
      },
    ],
    activeTabId: 'tab-1',
  };
  const page: CanvasPage = {
    id: 'page-tabs-collection',
    slug: 'tabs-coll',
    title: 'Tabs Collection',
    width: 1440,
    sections: [
      {
        id: 'tabs-section',
        recipeId: 'custom',
        name: 'sec',
        height: 800,
        elements: [tabsEl] as never,
      },
    ],
    collectionSlug: 'notes',
  };
  // F5 narrowed the union; stamp the legacy literal via cast.
  (page as { pageKind?: string }).pageKind = 'collection-index';
  const site = makeSite([page]);
  const { ctx, statuses, saveCalls } = makeCtx(site);
  migrateLegacyCollectionIndexPagesImpl(ctx);
  assert(page.pageKind === undefined, '(9) tabs-nested: pageKind must be cleared');
  assert(page.collectionSlug === undefined, '(9) tabs-nested: collectionSlug must be cleared');
  // Drill into the tabs panel to inspect the migrated Collection.
  const tabs = page.sections[0]!.elements[0]! as unknown as Record<string, unknown>;
  const tabsArr = tabs.tabs as { elements: unknown[] }[];
  const inner = tabsArr[0]!.elements[0]! as Record<string, unknown>;
  assert(inner.collectionSlug === 'notes', '(9) tabs-nested Collection gains slug "notes"');
  assert(inner.display === 'card', '(9) tabs-nested Collection default display');
  assert(inner.sort === 'date-desc', '(9) tabs-nested Collection default sort');
  assert(saveCalls.count === 1, '(9) tabs-nested: scheduleSave fires exactly once');
  assert(statuses.length === 0, '(9) tabs-nested: no banner');
}

// (10) Legacy sort-object normalisation on a non-`collection-index` page.
//
// The pwtest-engineer fixture has a Collection element whose `sort` is
// the pre-ADR-0063 object `{ field, order }` instead of the current
// string enum. `renderCollection` now throws on this shape, so the
// dashboard thumb stays red until the migration normalises it. The
// migration sweeps every page (not just `pageKind === 'collection-index'`)
// for the legacy sort object and rewrites it in place.
{
  const collection: Record<string, unknown> = {
    type: 'collection',
    id: 'legacy-sort-coll',
    box: { x: 0, y: 0, w: 800, h: 600 },
    collectionSlug: 'blog',
    display: 'card',
    sort: { field: 'publishedDate', order: 'desc' },
  };
  const page: CanvasPage = {
    id: 'page-with-legacy-sort',
    slug: 'misc',
    title: 'Misc',
    width: 1440,
    sections: [
      {
        id: 'misc-sec',
        recipeId: 'custom',
        name: 'sec',
        height: 600,
        elements: [collection] as never,
      },
    ],
  };
  const site = makeSite([page]);
  const { ctx, statuses, saveCalls } = makeCtx(site);
  migrateLegacyCollectionIndexPagesImpl(ctx);
  const migrated = page.sections[0]!.elements[0]! as unknown as Record<string, unknown>;
  assert(
    migrated.sort === 'date-desc',
    '(10) legacy sort {order:"desc"} normalises to "date-desc"; got ' + JSON.stringify(migrated.sort),
  );
  assert(saveCalls.count === 1, '(10) scheduleSave fires once when only sort normalises');
  assert(statuses.length === 0, '(10) no banner for a clean sort normalisation');
}

// (11) Legacy sort-object asc variant.
{
  const collection: Record<string, unknown> = {
    type: 'collection',
    id: 'legacy-sort-asc',
    box: { x: 0, y: 0, w: 800, h: 600 },
    sort: { field: 'publishedDate', order: 'asc' },
  };
  const page: CanvasPage = {
    id: 'page-legacy-asc',
    slug: 'asc',
    title: 'Asc',
    width: 1440,
    sections: [
      {
        id: 'asc-sec',
        recipeId: 'custom',
        name: 'sec',
        height: 600,
        elements: [collection] as never,
      },
    ],
  };
  const site = makeSite([page]);
  const { ctx, saveCalls } = makeCtx(site);
  migrateLegacyCollectionIndexPagesImpl(ctx);
  const migrated = page.sections[0]!.elements[0]! as unknown as Record<string, unknown>;
  assert(
    migrated.sort === 'date-asc',
    '(11) legacy sort {order:"asc"} normalises to "date-asc"; got ' + JSON.stringify(migrated.sort),
  );
  assert(saveCalls.count === 1, '(11) scheduleSave fires once for asc variant');
}

// (6) Wiring source guard — createEditor calls the migrator in the right
// place (after migrateState, before renderAll).
const indexSrc = await Bun.file(new URL('./index.ts', import.meta.url)).text();
assert(
  indexSrc.includes(
    "import { migrateLegacyCollectionIndexPagesImpl } from './site-load-migration.js';",
  ),
  '(6) index.ts must import migrateLegacyCollectionIndexPagesImpl',
);
const migrateStateIdx = indexSrc.indexOf('ctx.state = ctx.migrateState(ctx.state);');
const migrateLegacyIdx = indexSrc.indexOf('migrateLegacyCollectionIndexPagesImpl(ctx)');
const renderAllIdx = indexSrc.indexOf('ctx.renderAll();');
assert(migrateStateIdx >= 0, '(6) marker ctx.migrateState(ctx.state) must exist');
assert(migrateLegacyIdx > 0, '(6) call to migrateLegacyCollectionIndexPagesImpl must exist');
assert(renderAllIdx > 0, '(6) ctx.renderAll() call must exist');
assert(migrateStateIdx < migrateLegacyIdx, '(6) legacy migration must run AFTER ctx.migrateState');
assert(
  migrateLegacyIdx < renderAllIdx,
  '(6) legacy migration must run BEFORE ctx.renderAll() so the first paint reflects post-migration shape',
);

console.log('[site-load-migration:smoke] OK');
