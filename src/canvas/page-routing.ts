// src/canvas/page-routing.ts
//
// Page-selection helpers shared by public render and publish broadcast. The
// current contract is still one primary canvas page with an optional custom
// _404 page, so every render surface must choose one page before materialising
// HTML.

import type { CanvasPage, PublishedSnapshot } from './schema.js';

export const CUSTOM_404_PAGE_SLUG = '_404';

export function isCustom404Page(page: Pick<CanvasPage, 'slug'>): boolean {
  return page.slug === CUSTOM_404_PAGE_SLUG;
}

export function resolvePrimaryPage(snapshot: Pick<PublishedSnapshot, 'pages'>): CanvasPage {
  const page = snapshot.pages.find((candidate) => !isCustom404Page(candidate));
  if (!page) {
    throw new Error('published snapshot must contain one primary canvas page');
  }
  return page;
}

export function snapshotForPageSlug(
  snapshot: PublishedSnapshot,
  pageSlug: string,
): PublishedSnapshot {
  const page = snapshot.pages.find((candidate) => candidate.slug === pageSlug);
  if (!page) {
    throw new Error(`published snapshot is missing page slug ${JSON.stringify(pageSlug)}`);
  }
  return { ...snapshot, pages: [page] };
}
