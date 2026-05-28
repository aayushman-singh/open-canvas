// src/i18n/render-hook.ts
//
// Main-thread integration helper for `src/routes/public.ts`.
//
// The public router resolves a (locale, page) pair and renders the canvas
// snapshot. Both steps want the i18n decisions in one place: which page is
// being served, what `<html lang dir>` to stamp on the envelope, and
// whether to mirror element x-coordinates before handing the snapshot to
// `renderCanvasSnapshot`. This module exposes that decision as one
// function so the router doesn't sprinkle i18n logic.

import type { CanvasPage, PublishedSnapshot } from '../canvas/schema.js';
import { applyRtlMirror } from './mirror.js';
import { resolveLocale, type ResolveLocaleResult } from './locale-resolve.js';
import { isRtl } from './rtl-rules.js';

/**
 * Combined output of {@link prepareRender}. The router takes this object
 * and pipes its parts into the existing render pipeline:
 *
 *   - `renderSnapshot` → fed to `renderCanvasSnapshot()`. When the
 *     resolved page is RTL, this is the mirrored deep-clone returned by
 *     {@link applyRtlMirror}; for LTR it is the original snapshot
 *     reference (no allocation).
 *   - `page`           → which page to use for `renderCanvasHead` and
 *     for the `<html lang>` envelope. `null` ⇒ caller produces 404.
 *   - `locale`         → BCP-47 tag for `<html lang>`.
 *   - `dir`            → `'rtl'` or `'ltr'` for the `<html dir>`
 *     attribute. LTR is omitted from the envelope by convention but the
 *     router can choose; we always return an explicit value.
 *   - `pageSlug`       → the slug the resolver matched on. Forwarded to
 *     `renderCanvasHead`'s `pageSlug` option so the head meta is for the
 *     same page being rendered.
 */
export interface PreparedRender {
  renderSnapshot: PublishedSnapshot;
  page: CanvasPage | null;
  locale: string;
  dir: 'ltr' | 'rtl';
  pageSlug: string;
}

/**
 * Resolve the request path to a (page, locale, dir) tuple and pre-apply
 * the RTL mirror transform when needed. Returns a ready-to-render
 * snapshot reference.
 *
 * - Calls {@link resolveLocale} for the path lookup.
 * - When the matched page is RTL, returns `applyRtlMirror(snapshot)` so
 *   the renderer sees mirrored x-coordinates without knowing about i18n.
 * - When no page matches, returns the original snapshot unchanged and
 *   `page: null` — the caller is expected to respond 404 in that case.
 */
export function prepareRender(path: string, snapshot: PublishedSnapshot): PreparedRender {
  const { locale, pageSlug, page }: ResolveLocaleResult = resolveLocale(path, snapshot);

  if (page === null) {
    return {
      renderSnapshot: snapshot,
      page: null,
      locale,
      dir: isRtl(locale) ? 'rtl' : 'ltr',
      pageSlug,
    };
  }

  const pageLocale = typeof page.locale === 'string' && page.locale.length > 0 ? page.locale : locale;
  const dir: 'ltr' | 'rtl' = isRtl(pageLocale) ? 'rtl' : 'ltr';

  // Only mirror when the resolved page is RTL. LTR pages pass through
  // with no allocation — `applyRtlMirror` would still clone the snapshot
  // shell unnecessarily, so we short-circuit here.
  const renderSnapshot = dir === 'rtl' ? applyRtlMirror(snapshot) : snapshot;

  return {
    renderSnapshot,
    page,
    locale: pageLocale,
    dir,
    pageSlug,
  };
}
