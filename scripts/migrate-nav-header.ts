// scripts/migrate-nav-header.ts
//
// One-off data migration: consolidate the legacy 4-element home-template
// header (text logo + two ghost actions + one solid CTA action, all
// absolute-positioned siblings) into one `nav` element carrying siteTitle,
// links, and primaryAction. The fixture migration shipped in commit
// d64d4a9; this script brings already-existing sites onto the same shape.
//
// Targets sites cloned from the pre-d64d4a9 home.json seed. Detection is
// strict-on-identity, not strict-on-shape: a row qualifies only when
// `state.header.elements` contains at least one of the canonical seed ids
// `header-logo` / `header-cta` AND no element of type `nav` is already
// present. Sites with a hand-rolled header (different ids, or already on
// a nav) are left untouched — there is no safe automatic interpretation
// for arbitrary header contents, and the renderer continues to display
// the old four elements correctly until an owner edits them by hand.
//
// Walks `site.editableState` and `site.publishedSnapshot` jsonb columns.
// Yjs snapshots in `site_snapshot` are NOT rewritten (per ADR 0007 they
// are historical record; the next save from a live editor overwrites them
// anyway). The Owner-facing header on the dashboard route ships from the
// editor's autosaved state, so the next edit after this migration carries
// the consolidated nav forward into Yjs.
//
// Idempotent: re-running on a clean DB is a no-op (the detection rule
// fails once the nav element exists in `state.header.elements`).
//
// Usage:
//   bun run scripts/migrate-nav-header.ts            # rewrite every site
//   bun run scripts/migrate-nav-header.ts --dry-run  # report only
//
// Requires DATABASE_URL in the environment (.dev.vars works).

import { eq } from 'drizzle-orm';

import { db } from '../src/db/client.js';
import { site } from '../src/db/schema.js';
import type {
  ActionElement,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  InlineRun,
  PublishedSnapshot,
  TextElement,
} from '../src/canvas/schema.js';
import type { NavElement, NavLink, NavLinkKind } from '../src/canvas/elements/nav.js';

const CANONICAL_LOGO_ID = 'header-logo';
const CANONICAL_CTA_ID = 'header-cta';
const CANONICAL_LINK_ID_RE = /^header-nav-\d+$/;
const CANONICAL_ID_RE = /^header-(logo|nav-\d+|cta)$/;

const NEW_NAV_ELEMENT_ID = 'header-nav';

interface ConversionCounts {
  sitesTouched: number;
  headersConverted: number;
  linksMigrated: number;
  primaryActionsMigrated: number;
  siteTitlesExtracted: number;
  logosExtracted: number;
}

function emptyCounts(): ConversionCounts {
  return {
    sitesTouched: 0,
    headersConverted: 0,
    linksMigrated: 0,
    primaryActionsMigrated: 0,
    siteTitlesExtracted: 0,
    logosExtracted: 0,
  };
}

function addCounts(into: ConversionCounts, from: ConversionCounts): void {
  into.sitesTouched += from.sitesTouched;
  into.headersConverted += from.headersConverted;
  into.linksMigrated += from.linksMigrated;
  into.primaryActionsMigrated += from.primaryActionsMigrated;
  into.siteTitlesExtracted += from.siteTitlesExtracted;
  into.logosExtracted += from.logosExtracted;
}

function inlineRunsToPlainText(runs: InlineRun[] | undefined): string {
  if (!Array.isArray(runs)) return '';
  let out = '';
  for (const run of runs) {
    if (run && typeof run.text === 'string') out += run.text;
  }
  return out.trim();
}

function findPageBySlug(pages: CanvasPage[], slug: string): CanvasPage | undefined {
  return pages.find((p) => p.slug === slug);
}

function findPageById(pages: CanvasPage[], pageId: string): CanvasPage | undefined {
  return pages.find((p) => p.id === pageId);
}

/**
 * Convert an action element's href + label into a NavLink. Returns null when
 * the element cannot be expressed as a NavLink (no href / behaviour-only
 * action / empty label).
 */
function actionToNavLink(
  action: ActionElement,
  pages: CanvasPage[],
): NavLink | null {
  const label = inlineRunsToPlainText(action.label);
  if (label.length === 0) return null;
  if (action.href === undefined) return null;

  if (action.href.type === 'page') {
    const target = findPageById(pages, action.href.pageId);
    if (!target) return null;
    const path = '/' + target.slug.replace(/^\/+/, '');
    return { label, href: path, kind: 'internal' };
  }

  // 'external' carries an arbitrary URL string. Map it to the right NavLink
  // kind by inspecting the URL shape — anchor (#frag), internal slug (/seg),
  // or external (http/https/mailto/tel).
  const url = typeof action.href.url === 'string' ? action.href.url.trim() : '';
  if (url.length === 0) return null;
  if (url.charAt(0) === '#') {
    return { label, href: url, kind: 'anchor' };
  }
  let kind: NavLinkKind = 'external';
  if (url.charAt(0) === '/') {
    const slug = url.slice(1).split(/[/?#]/, 1)[0] ?? '';
    if (slug.length > 0 && findPageBySlug(pages, slug)) {
      kind = 'internal';
    } else {
      kind = 'external';
    }
  }
  return { label, href: url, kind };
}

interface DetectedHeader {
  logo: TextElement | null;
  links: ActionElement[];
  cta: ActionElement | null;
  /** Elements in header.elements that don't match the canonical seed ids.
   *  Preserved as-is in the rewritten section so user customizations stay
   *  visible on the canvas. */
  passthrough: CanvasElement[];
}

function classifyHeaderElements(section: CanvasSection): DetectedHeader {
  const out: DetectedHeader = { logo: null, links: [], cta: null, passthrough: [] };
  for (const el of section.elements) {
    if (!CANONICAL_ID_RE.test(el.id)) {
      out.passthrough.push(el);
      continue;
    }
    if (el.id === CANONICAL_LOGO_ID) {
      if (el.type === 'text') out.logo = el;
      continue;
    }
    if (el.id === CANONICAL_CTA_ID) {
      if (el.type === 'action') out.cta = el;
      continue;
    }
    if (CANONICAL_LINK_ID_RE.test(el.id)) {
      if (el.type === 'action') out.links.push(el);
      continue;
    }
  }
  return out;
}

function shouldConvertHeader(section: CanvasSection): boolean {
  if (!Array.isArray(section.elements) || section.elements.length === 0) return false;
  if (section.elements.some((el) => el.type === 'nav')) return false;
  const hasCanonical = section.elements.some(
    (el) => el.id === CANONICAL_LOGO_ID || el.id === CANONICAL_CTA_ID,
  );
  return hasCanonical;
}

function buildNavElement(
  detected: DetectedHeader,
  pages: CanvasPage[],
  sectionHeight: number,
  counts: ConversionCounts,
): NavElement {
  const links: NavLink[] = [];
  for (const action of detected.links) {
    const navLink = actionToNavLink(action, pages);
    if (navLink) {
      links.push(navLink);
      counts.linksMigrated += 1;
    }
  }

  const nav: NavElement = {
    id: NEW_NAV_ELEMENT_ID,
    type: 'nav',
    box: { x: 0, y: 0, w: 1440, h: sectionHeight, z: 2 },
    links,
    layout: 'left-right',
    sticky: false,
    pinnedStyle: { padding: '0 80px' },
  };

  if (detected.logo) {
    const wordmark = inlineRunsToPlainText(detected.logo.content);
    if (wordmark.length > 0) {
      nav.siteTitle = wordmark;
      counts.siteTitlesExtracted += 1;
    }
  }

  if (detected.cta) {
    const primary = actionToNavLink(detected.cta, pages);
    if (primary) {
      nav.primaryAction = primary;
      counts.primaryActionsMigrated += 1;
    }
  }

  return nav;
}

export function rewriteHeaderInState(
  state: EditableSite | PublishedSnapshot,
): ConversionCounts {
  const counts = emptyCounts();
  const header = state.header;
  if (!header) return counts;
  if (!shouldConvertHeader(header)) return counts;

  const detected = classifyHeaderElements(header);
  const pages = Array.isArray(state.pages) ? state.pages : [];
  const nav = buildNavElement(detected, pages, header.height, counts);
  header.elements = [nav as CanvasElement, ...detected.passthrough];
  counts.headersConverted = 1;
  counts.sitesTouched = 1;
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
    `[migrate-nav-header] scanning ${String(rows.length)} site${rows.length === 1 ? '' : 's'}${dryRun ? ' (dry-run)' : ''}`,
  );

  const totals = emptyCounts();

  for (const row of rows) {
    const editableCounts = rewriteHeaderInState(row.editableState);
    const publishedCounts = row.publishedSnapshot
      ? rewriteHeaderInState(row.publishedSnapshot)
      : emptyCounts();
    const rowTouched =
      editableCounts.headersConverted + publishedCounts.headersConverted > 0;
    if (!rowTouched) continue;

    totals.sitesTouched += 1;
    totals.headersConverted += editableCounts.headersConverted + publishedCounts.headersConverted;
    totals.linksMigrated += editableCounts.linksMigrated + publishedCounts.linksMigrated;
    totals.primaryActionsMigrated +=
      editableCounts.primaryActionsMigrated + publishedCounts.primaryActionsMigrated;
    totals.siteTitlesExtracted +=
      editableCounts.siteTitlesExtracted + publishedCounts.siteTitlesExtracted;
    totals.logosExtracted +=
      editableCounts.logosExtracted + publishedCounts.logosExtracted;

    console.log(
      `  ${row.subdomain} (${row.id}) — editable: ${editableCounts.headersConverted} header / ${editableCounts.linksMigrated} links / ${editableCounts.primaryActionsMigrated} cta / ${editableCounts.siteTitlesExtracted} title, published: ${publishedCounts.headersConverted} header / ${publishedCounts.linksMigrated} links / ${publishedCounts.primaryActionsMigrated} cta / ${publishedCounts.siteTitlesExtracted} title`,
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
    `[migrate-nav-header] ${dryRun ? 'WOULD UPDATE' : 'UPDATED'} ${String(totals.sitesTouched)} site${totals.sitesTouched === 1 ? '' : 's'} — ${String(totals.headersConverted)} header${totals.headersConverted === 1 ? '' : 's'}, ${String(totals.linksMigrated)} link${totals.linksMigrated === 1 ? '' : 's'}, ${String(totals.primaryActionsMigrated)} primary CTA${totals.primaryActionsMigrated === 1 ? '' : 's'}, ${String(totals.siteTitlesExtracted)} site title${totals.siteTitlesExtracted === 1 ? '' : 's'}`,
  );
}

if (import.meta.main) {
  await main();
}
