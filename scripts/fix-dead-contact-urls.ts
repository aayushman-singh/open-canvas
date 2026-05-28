// scripts/fix-dead-contact-urls.ts
//
// One-off data migration: rewrite all action elements whose external href
// points at the dead /contact route to mailto:hello@example.com. The
// enterprise-scale and apogee-showcase fixtures both shipped CTAs targeting
// /contact, but neither template instantiates a page at that slug — the
// fixture fixes (commits 041176b + the apogee patch in this push) only
// affect NEW sites. Sites already created from those templates still carry
// the dead URL in editableState (and publishedSnapshot, where present).
//
// Walks every site row, skips rows that already define a real /contact page,
// rewrites both editableState and publishedSnapshot in-place, and writes back
// via drizzle. Idempotent — re-running on a clean
// DB is a no-op.
//
// Usage:
//   bun run scripts/fix-dead-contact-urls.ts            # rewrite every site
//   bun run scripts/fix-dead-contact-urls.ts --dry-run  # report only
//
// Requires DATABASE_URL in the environment (.dev.vars works).

import { eq } from 'drizzle-orm';

import { db } from '../src/db/client.js';
import { site } from '../src/db/schema.js';
import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  CanvasSiteState,
  PublishedSnapshot,
} from '../src/canvas/schema.js';

const DEAD_URL = '/contact';
const REPLACEMENT_URL = 'mailto:hello@example.com';

function rewriteSection(section: CanvasSection): number {
  let touched = 0;
  for (const element of section.elements) {
    if (element.type !== 'action') continue;
    if (element.href.type !== 'external') continue;
    if (element.href.url !== DEAD_URL) continue;
    element.href.url = REPLACEMENT_URL;
    touched += 1;
  }
  return touched;
}

function rewritePage(page: CanvasPage): number {
  let touched = 0;
  for (const section of page.sections) {
    touched += rewriteSection(section);
  }
  return touched;
}

export function stateHasContactPage(
  state: CanvasSiteState | PublishedSnapshot,
): boolean {
  return state.pages.some(
    (page) => page.slug.trim().toLowerCase().replace(/^\/+|\/+$/g, '') === 'contact',
  );
}

export function rewriteDeadContactUrlsInState(
  state: CanvasSiteState | PublishedSnapshot,
): number {
  if (stateHasContactPage(state)) return 0;
  let touched = 0;
  for (const page of state.pages) {
    touched += rewritePage(page);
  }
  if (state.header) touched += rewriteSection(state.header);
  if (state.footer) touched += rewriteSection(state.footer);
  return touched;
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
    `[fix-dead-contact-urls] scanning ${String(rows.length)} site${rows.length === 1 ? '' : 's'}${dryRun ? ' (dry-run)' : ''}`,
  );

  let totalSitesTouched = 0;
  let totalUrlsRewritten = 0;

  for (const row of rows) {
    const hasContactPage =
      stateHasContactPage(row.editableState) ||
      (row.publishedSnapshot ? stateHasContactPage(row.publishedSnapshot) : false);
    if (hasContactPage) continue;

    const editableTouched = rewriteDeadContactUrlsInState(row.editableState);
    const publishedTouched = row.publishedSnapshot
      ? rewriteDeadContactUrlsInState(row.publishedSnapshot)
      : 0;
    const touched = editableTouched + publishedTouched;
    if (touched === 0) continue;

    totalSitesTouched += 1;
    totalUrlsRewritten += touched;
    console.log(
      `  ${row.subdomain} (${row.id}) — ${String(editableTouched)} editable, ${String(publishedTouched)} published`,
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
    `[fix-dead-contact-urls] ${dryRun ? 'WOULD UPDATE' : 'UPDATED'} ${String(totalSitesTouched)} site${totalSitesTouched === 1 ? '' : 's'}, ${String(totalUrlsRewritten)} URL${totalUrlsRewritten === 1 ? '' : 's'}`,
  );
}

if (import.meta.main) {
  await main();
}
