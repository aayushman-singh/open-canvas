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

function makePage(opts: {
  id: string;
  pageKind?: 'collection-index' | 'collection-item-template';
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
  if (opts.pageKind !== undefined) page.pageKind = opts.pageKind;
  if (opts.collectionSlug !== undefined) page.collectionSlug = opts.collectionSlug;
  return page;
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
  assert(page.pageKind === 'collection-index', '(2) multi-Collection: pageKind must persist');
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
  assert(page.pageKind === 'collection-index', '(3) zero-Collection: pageKind must persist');
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
      page.pageKind === 'collection-index',
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
