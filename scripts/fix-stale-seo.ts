// scripts/fix-stale-seo.ts
//
// One-off data migration: clear stale per-page SEO fields baked into already-
// published sites by the Apogee Showcase fixture before ADRs 0040 + 0041
// landed.
//
// Two leaks closed by the ADRs but still resident in `editableState`
// (and `publishedSnapshot`) for sites cloned from the pre-fix fixture:
//
//   - `canonical` URLs pointing at `apogee.rev01.aayushman.dev` (pre-apex
//     migration) or at the bare `opencanvas.aayushman.dev` apex (the
//     intermediate hot-fix, which is still wrong for any non-apex
//     publishing host like `briar.opencanvas.aayushman.dev`).
//   - `ogImageAssetId === "seed-feature-canvas-1"` — the Apogee fixture's
//     hero asset id, surfacing as the Twitter / LinkedIn unfurl image of
//     every site cloned from the template.
//
// Both fields are *deliberate-override* fields after the ADR: leaving them
// empty lets the runtime emit the correct per-host canonical and route the
// OG image through `/og/<siteId>/<slug>.png`. The Owner who explicitly set
// a cross-host canonical (umbrella site) or uploaded a custom OG image
// keeps that — we only clear values matching the known leak signatures.
//
// Stale signatures:
//
//   canonical:
//     - host === "apogee.rev01.aayushman.dev"
//     - host ends in ".rev01.aayushman.dev"
//     - host === "opencanvas.aayushman.dev"  (apex literal from the hot-fix)
//   ogImageAssetId:
//     - exact match "seed-feature-canvas-1"
//
// Walks every site row, mutates editableState (and publishedSnapshot, when
// present) in-place, writes back via drizzle. Idempotent — re-running on a
// clean DB is a no-op.
//
// Usage:
//   bun run scripts/fix-stale-seo.ts            # rewrite every site
//   bun run scripts/fix-stale-seo.ts --dry-run  # report only
//
// Requires DATABASE_URL in the environment (.dev.vars works).

import { eq } from 'drizzle-orm';

import { db } from '../src/db/client.js';
import { site } from '../src/db/schema.js';
import type {
  CanvasPage,
  EditableSite,
  PublishedSnapshot,
} from '../src/canvas/schema.js';

const STALE_OG_ASSET_ID = 'seed-feature-canvas-1';
const STALE_CANONICAL_HOSTS = new Set([
  'apogee.rev01.aayushman.dev',
  'opencanvas.aayushman.dev',
]);
const STALE_CANONICAL_SUFFIX = '.rev01.aayushman.dev';

interface PageTouchCounts {
  canonicalsCleared: number;
  ogAssetsCleared: number;
}

function isStaleCanonical(value: string): boolean {
  try {
    const host = new URL(value).host.toLowerCase();
    if (STALE_CANONICAL_HOSTS.has(host)) return true;
    if (host.endsWith(STALE_CANONICAL_SUFFIX)) return true;
    return false;
  } catch {
    // A malformed canonical isn't on our leak list — leave it alone so the
    // Owner sees the same input they saved and can fix it themselves.
    return false;
  }
}

function rewritePage(page: CanvasPage, counts: PageTouchCounts): void {
  if (typeof page.canonical === 'string' && page.canonical.length > 0) {
    if (isStaleCanonical(page.canonical)) {
      delete page.canonical;
      counts.canonicalsCleared += 1;
    }
  }
  if (
    typeof page.ogImageAssetId === 'string' &&
    page.ogImageAssetId === STALE_OG_ASSET_ID
  ) {
    delete page.ogImageAssetId;
    counts.ogAssetsCleared += 1;
  }
}

export function rewriteStaleSeoInState(
  state: EditableSite | PublishedSnapshot,
): PageTouchCounts {
  const counts: PageTouchCounts = { canonicalsCleared: 0, ogAssetsCleared: 0 };
  for (const page of state.pages) {
    rewritePage(page, counts);
  }
  return counts;
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required in the environment.');
  }
  const dryRun = process.argv.includes('--dry-run');

  const database = db({ DATABASE_URL: databaseUrl });

  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      editableState: site.editableState,
      publishedSnapshot: site.publishedSnapshot,
    })
    .from(site);

  console.log(
    `[fix-stale-seo] scanning ${String(rows.length)} site${rows.length === 1 ? '' : 's'}${dryRun ? ' (dry-run)' : ''}`,
  );

  let totalSitesTouched = 0;
  let totalCanonicalsCleared = 0;
  let totalOgAssetsCleared = 0;

  for (const row of rows) {
    const editableCounts = rewriteStaleSeoInState(row.editableState);
    const publishedCounts = row.publishedSnapshot
      ? rewriteStaleSeoInState(row.publishedSnapshot)
      : { canonicalsCleared: 0, ogAssetsCleared: 0 };
    const totalRowTouches =
      editableCounts.canonicalsCleared +
      editableCounts.ogAssetsCleared +
      publishedCounts.canonicalsCleared +
      publishedCounts.ogAssetsCleared;
    if (totalRowTouches === 0) continue;

    totalSitesTouched += 1;
    totalCanonicalsCleared +=
      editableCounts.canonicalsCleared + publishedCounts.canonicalsCleared;
    totalOgAssetsCleared +=
      editableCounts.ogAssetsCleared + publishedCounts.ogAssetsCleared;
    console.log(
      `  ${row.subdomain} (${row.id}) — editable: ${String(editableCounts.canonicalsCleared)} canonical / ${String(editableCounts.ogAssetsCleared)} OG, published: ${String(publishedCounts.canonicalsCleared)} canonical / ${String(publishedCounts.ogAssetsCleared)} OG`,
    );

    if (dryRun) continue;

    await database
      .update(site)
      .set({
        editableState: row.editableState,
        publishedSnapshot: row.publishedSnapshot,
        updatedAt: new Date(),
      })
      .where(eq(site.id, row.id));
  }

  console.log('');
  console.log(
    `[fix-stale-seo] ${dryRun ? 'WOULD UPDATE' : 'UPDATED'} ${String(totalSitesTouched)} site${totalSitesTouched === 1 ? '' : 's'}, ${String(totalCanonicalsCleared)} canonical${totalCanonicalsCleared === 1 ? '' : 's'} cleared, ${String(totalOgAssetsCleared)} OG asset${totalOgAssetsCleared === 1 ? '' : 's'} cleared`,
  );
}

if (import.meta.main) {
  await main();
}
