// src/canvas/responsive/index.ts
//
// Public entry for the responsive subsystem (Wishlist #1, Wave 1).
//
// One function, `renderResponsiveCss(snapshot)`, consumed by
// `src/canvas/render.ts`. It returns a complete `<style>...</style>` block
// (or the empty string when no responsive CSS is needed). The renderer
// injects the result verbatim ahead of the `pagesHtml` body — see the
// single-hook insertion in `renderCanvasSnapshot`.
//
// The empty-string return is the all-or-nothing failure rule applied to
// "nothing to do": when no element has an override AND every page already
// fits a phone viewport, emitting a style block would be incidental noise.
// We return '' so existing fixtures render byte-for-byte identical to the
// pre-responsive output.

import type { CanvasElement, PublishedSnapshot } from '../schema.js';

import { buildResponsiveCssBody, wrapInStyleBlock } from './css.js';
import { resolveSnapshotLayout } from './translate.js';

export { resolveElementBox, scaleFactor } from './translate.js';
export type {
  ResolvedBox,
  ResolvedElementLayout,
  ResolvedPageLayout,
  ResolvedSectionLayout,
} from './translate.js';

/**
 * Build the responsive `<style>` block for a Published Snapshot.
 *
 * Returns the empty string when the snapshot has zero `responsive` overrides
 * AND every page is narrow enough to already fit a phone viewport — emitting
 * a block in that case would only add noise without changing rendered
 * behaviour.
 */
// Cache the rendered CSS by snapshot identity. The publish path calls this
// once per page (via `buildPublishBroadcastPayload`'s loop) with the same
// snapshot object — without memoization that produces O(pages × elements)
// duplicate work and on big sites blows past the 30 s Worker CPU budget.
// Identity-keyed: callers that mutate a snapshot in place must build a new
// object, which they already do (PublishedSnapshot is constructed once per
// publish at publish.ts:219 and never mutated after).
const responsiveCssCache = new WeakMap<PublishedSnapshot, string>();

export function renderResponsiveCss(snapshot: PublishedSnapshot): string {
  const cached = responsiveCssCache.get(snapshot);
  if (cached !== undefined) return cached;
  const layouts = resolveSnapshotLayout(snapshot);
  const hasOverride = snapshotHasResponsiveOverride(snapshot);
  const body = buildResponsiveCssBody(layouts, hasOverride);
  const result = wrapInStyleBlock(body);
  responsiveCssCache.set(snapshot, result);
  return result;
}

function snapshotHasResponsiveOverride(snapshot: PublishedSnapshot): boolean {
  for (const page of snapshot.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (elementHasResponsiveOverride(element)) return true;
      }
    }
  }
  return false;
}

function elementHasResponsiveOverride(element: CanvasElement): boolean {
  const r = element.responsive;
  if (r === undefined) return false;
  return r.tablet !== undefined || r.phone !== undefined;
}
