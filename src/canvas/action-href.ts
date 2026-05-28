// src/canvas/action-href.ts
//
// Resolver + allowlist for ActionElement.href references. Split out of
// schema.ts so the schema module stays declaration-only (zero runtime, zero
// bundle weight when imported for types).
//
// This is the single source of truth for href allowlisting on the
// Cloudflare-Worker side. validate.ts re-exports `isAllowedHref` so existing
// consumers (agent/tool-parsers, agent/design-section-parser) keep working.
// The editor IIFE in src/editor/canvas-client.ts carries a hand-mirrored copy
// because it runs in the browser as a template-literal payload and cannot
// import this module directly; if you change the allowlist here, update the
// IIFE copy too.

import type { ActionHref } from './elements/action.js';
import type { CanvasPage } from './schema.js';

const ALLOWED_HREF_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'] as const;

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

/**
 * The single source of truth for href allowlisting. Used by both
 * ActionElement.href and inline link marks inside TextElement.content so the
 * two paths cannot drift.
 */
export function isAllowedHref(href: string): boolean {
  // In-page anchor or root-relative path are allowed without scheme.
  if (href.startsWith('#') || href.startsWith('/')) return true;
  // Reject the javascript: scheme explicitly even when oddly cased or padded.
  const trimmed = href.trim().toLowerCase();
  if (trimmed.startsWith('javascript:')) return false;
  // Anything else must parse as one of the allow-listed schemes.
  try {
    const url = new URL(href);
    return (ALLOWED_HREF_SCHEMES as readonly string[]).includes(url.protocol);
  } catch {
    return false;
  }
}
