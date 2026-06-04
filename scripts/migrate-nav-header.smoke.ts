// scripts/migrate-nav-header.smoke.ts
//
// Pure-logic smoke for the nav-header consolidation transform. Exercises
// the canonical 4-element seed shape, the no-op cases (already migrated,
// hand-rolled header, no header at all), the page-slug resolution branch,
// and the passthrough behaviour for non-canonical sibling elements.
// Bun runs this without a DB connection — the script imports only the pure
// `rewriteHeaderInState` export, never the `main()` entry point.

import type {
  ActionElement,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  InlineRun,
  TextElement,
} from '../src/canvas/schema.js';
import type { NavElement } from '../src/canvas/elements/nav.js';
import { rewriteHeaderInState } from './migrate-nav-header.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[migrate-nav-header:smoke] ${message}`);
}

function textRun(text: string, bold = false): InlineRun {
  return bold ? { text, marks: [{ type: 'bold' }] } : { text };
}

function logoElement(content: InlineRun[]): TextElement {
  return {
    id: 'header-logo',
    type: 'text',
    box: { x: 80, y: 16, w: 200, h: 40, z: 2 },
    content,
    role: 'label',
    fontSize: 22,
    fontWeight: 700,
    align: 'left',
  };
}

function ghostAction(id: string, label: string, url: string): ActionElement {
  return {
    id,
    type: 'action',
    box: { x: 1020, y: 18, w: 100, h: 36, z: 2 },
    label: [{ text: label }],
    href: { type: 'external', url },
    variant: 'ghost',
  } as ActionElement;
}

function solidCta(label: string, url: string): ActionElement {
  return {
    id: 'header-cta',
    type: 'action',
    box: { x: 1260, y: 18, w: 120, h: 36, z: 2 },
    label: [{ text: label }],
    href: { type: 'external', url },
    variant: 'solid',
  } as ActionElement;
}

function pageRef(id: string, slug: string): CanvasPage {
  return {
    id,
    slug,
    title: slug,
    width: 1440,
    sections: [],
  };
}

function siteWithHeader(elements: CanvasElement[], pages: CanvasPage[] = []): EditableSite {
  const header: CanvasSection = {
    id: 'section-header',
    recipeId: 'custom',
    name: 'Header',
    height: 72,
    elements,
  };
  return { styleKit: 'charcoal', header, pages };
}

// -- Case 1: canonical 4-element seed converts cleanly ---------------------
{
  const state = siteWithHeader([
    logoElement([textRun('Open Canvas', true)]),
    ghostAction('header-nav-1', 'Features', '#features'),
    ghostAction('header-nav-2', 'Pricing', '#pricing'),
    solidCta('Get started', '/edit'),
  ]);
  const counts = rewriteHeaderInState(state);
  assert(counts.headersConverted === 1, `expected one header conversion, got ${counts.headersConverted}`);
  assert(counts.linksMigrated === 2, `expected two links, got ${counts.linksMigrated}`);
  assert(
    counts.primaryActionsMigrated === 1,
    `expected one primary action, got ${counts.primaryActionsMigrated}`,
  );
  assert(
    counts.siteTitlesExtracted === 1,
    `expected one site title, got ${counts.siteTitlesExtracted}`,
  );

  const nav = state.header?.elements[0] as NavElement | undefined;
  assert(nav?.type === 'nav', 'expected first element to be nav');
  assert(nav?.siteTitle === 'Open Canvas', `expected siteTitle 'Open Canvas', got ${String(nav?.siteTitle)}`);
  assert(nav?.layout === 'left-right', `expected layout left-right, got ${String(nav?.layout)}`);
  assert(nav?.links.length === 2, `expected 2 links, got ${nav?.links.length}`);
  assert(nav?.links[0]?.kind === 'anchor', `expected first link anchor, got ${String(nav?.links[0]?.kind)}`);
  assert(nav?.links[0]?.href === '#features', `expected '#features', got ${String(nav?.links[0]?.href)}`);
  assert(nav?.primaryAction?.label === 'Get started', `expected 'Get started' CTA label`);
  assert(
    nav?.primaryAction?.href === '/edit',
    `expected '/edit' CTA href, got ${String(nav?.primaryAction?.href)}`,
  );
  // '/edit' is not a page slug — should land as external.
  assert(
    nav?.primaryAction?.kind === 'external',
    `expected '/edit' CTA kind external, got ${String(nav?.primaryAction?.kind)}`,
  );
}

// -- Case 2: idempotent — second pass over a converted site is a no-op ----
{
  const state = siteWithHeader([
    logoElement([textRun('Open Canvas', true)]),
    ghostAction('header-nav-1', 'Features', '#features'),
    solidCta('Get started', '/edit'),
  ]);
  rewriteHeaderInState(state);
  const second = rewriteHeaderInState(state);
  assert(
    second.headersConverted === 0,
    `expected idempotent second pass, got ${second.headersConverted} more conversions`,
  );
}

// -- Case 3: page-typed href resolves to /<slug> with kind internal -------
{
  const ctaToPage: ActionElement = {
    id: 'header-cta',
    type: 'action',
    box: { x: 1260, y: 18, w: 120, h: 36, z: 2 },
    label: [{ text: 'Read blog' }],
    href: { type: 'page', pageId: 'page-blog' },
    variant: 'solid',
  } as ActionElement;
  const state = siteWithHeader(
    [logoElement([textRun('My Site', true)]), ctaToPage],
    [pageRef('page-blog', 'blog')],
  );
  rewriteHeaderInState(state);
  const nav = state.header?.elements[0] as NavElement | undefined;
  assert(nav?.primaryAction?.href === '/blog', `expected '/blog', got ${String(nav?.primaryAction?.href)}`);
  assert(
    nav?.primaryAction?.kind === 'internal',
    `expected internal kind, got ${String(nav?.primaryAction?.kind)}`,
  );
}

// -- Case 4: hand-rolled header (no canonical ids) is left alone ----------
{
  const state = siteWithHeader([
    {
      id: 'my-custom-banner',
      type: 'text',
      box: { x: 0, y: 0, w: 600, h: 50, z: 1 },
      content: [{ text: 'Custom banner' }],
      role: 'label',
    } as TextElement,
  ]);
  const counts = rewriteHeaderInState(state);
  assert(
    counts.headersConverted === 0,
    `expected hand-rolled header to be skipped, got ${counts.headersConverted}`,
  );
}

// -- Case 5: non-canonical sibling alongside canonical seed is preserved --
{
  const sibling: TextElement = {
    id: 'custom-tagline',
    type: 'text',
    box: { x: 500, y: 30, w: 400, h: 30, z: 2 },
    content: [{ text: 'taglines stay' }],
    role: 'label',
  };
  const state = siteWithHeader([
    logoElement([textRun('Brand', true)]),
    sibling,
    solidCta('Go', '/edit'),
  ]);
  rewriteHeaderInState(state);
  const elements = state.header?.elements ?? [];
  assert(elements.length === 2, `expected 2 elements (nav + sibling), got ${elements.length}`);
  assert(elements[0]?.type === 'nav', 'expected nav first');
  assert(elements[1]?.id === 'custom-tagline', `expected sibling preserved, got ${String(elements[1]?.id)}`);
}

// -- Case 6: site with no header is left alone ----------------------------
{
  const state: EditableSite = { styleKit: 'charcoal', pages: [] };
  const counts = rewriteHeaderInState(state);
  assert(
    counts.headersConverted === 0,
    `expected no-header site to be skipped, got ${counts.headersConverted}`,
  );
}

// -- Case 7: nav already present — skipped --------------------------------
{
  const existingNav: NavElement = {
    id: 'header-nav',
    type: 'nav',
    box: { x: 0, y: 0, w: 1440, h: 72, z: 2 },
    siteTitle: 'Already migrated',
    links: [],
    layout: 'left-right',
    sticky: false,
  };
  const state = siteWithHeader([existingNav as CanvasElement, logoElement([textRun('residue')])]);
  const counts = rewriteHeaderInState(state);
  assert(
    counts.headersConverted === 0,
    `expected nav-present header to be skipped, got ${counts.headersConverted}`,
  );
}

console.log('[migrate-nav-header:smoke] OK');
