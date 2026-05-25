// src/canvas/elements/action.ts
//
// Render fn for the existing `ActionElement` element type. Interface still
// lives in `src/canvas/schema.ts`; this module owns rendering only.

import { escapeAttr, escapeHtml } from './render-utils.js';
import { resolveActionHref, type ActionElement, type ActionHref, type CanvasPage } from '../schema.js';

export function renderAction(element: ActionElement, ctx: { pages: CanvasPage[] }): string {
  // Legacy data may store href as a plain string; normalise to ActionHref.
  const href: ActionHref = typeof element.href === 'string'
    ? { type: 'external' as const, url: element.href }
    : element.href;
  const resolvedHref = resolveActionHref(href, ctx.pages);
  return `<a class="rev01-action" data-variant="${escapeAttr(element.variant)}" href="${escapeAttr(resolvedHref)}">${escapeHtml(element.label)}</a>`;
}
