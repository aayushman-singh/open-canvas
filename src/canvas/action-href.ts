// src/canvas/action-href.ts
//
// Resolver for ActionElement.href references. Split out of schema.ts so the
// schema module stays declaration-only (zero runtime, zero bundle weight when
// imported for types).

import type { ActionHref } from './elements/action.js';
import type { CanvasPage } from './schema.js';

/**
 * Compute the rendered URL for an `ActionHref`.
 *
 * - `external` arms pass through their `url` verbatim.
 * - `page` arms resolve to `/<slug>` (with an optional `#anchor`) against the
 *   provided page list. Throws if the referenced page id is missing; the
 *   caller should validate before render.
 */
export function resolveActionHref(href: ActionHref, pages: CanvasPage[]): string {
  if (href.type === 'external') return href.url;
  const page = pages.find((p) => p.id === href.pageId);
  if (!page) {
    throw new Error(`action href references missing page id ${JSON.stringify(href.pageId)}`);
  }
  const base = '/' + page.slug;
  return href.anchor ? base + '#' + href.anchor : base;
}
