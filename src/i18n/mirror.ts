// src/i18n/mirror.ts
//
// Wishlist #25 — position-mirror helpers for the RTL render path.
//
// Given a Positioned Element box on a canvas of total width `canvasWidth`,
// returns a NEW box with the x-coordinate flipped: `x' = canvasWidth - x - w`.
// Width, height, y, z, and rotation are preserved. Bi-di mixed runs inside a
// single TextElement are out of scope — the browser's bidi algorithm flips
// glyph order; we only flip element-level layout coordinates.
//
// `applyRtlMirror` deep-clones a Published Snapshot and applies the
// transform to every Positioned Element of every RTL page (per
// {@link isRtl}). LTR pages are copied through unchanged. The function is
// pure — the input snapshot is never mutated, so callers can hand the same
// snapshot to the renderer and to other subsystems without worrying about
// shared mutation.

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  PositionedBox,
  PublishedSnapshot,
} from '../canvas/schema.js';
import { isRtl } from './rtl-rules.js';

/**
 * Return a new {@link PositionedBox} with the x-coordinate mirrored across
 * the canvas width. y / z / rotation / w / h are preserved.
 *
 * Formula: `x' = canvasWidth - x - w`. Negative results are allowed — an
 * element that overflowed the canvas to the right pre-mirror overflows to
 * the left post-mirror, which is the intended visual outcome.
 *
 * The `rotation` field is left untouched: a 30° rotation in LTR remains a
 * 30° rotation in RTL. Mirror-rotation (negating the angle) would compose
 * with the position flip to produce a true reflection, which is *not* what
 * RTL layout means — RTL is "right edge becomes leading edge," not "flip
 * the whole canvas as if held to a mirror."
 */
export function mirrorElementBox(box: PositionedBox, canvasWidth: number): PositionedBox {
  const mirroredX = canvasWidth - box.x - box.w;
  const next: PositionedBox = {
    x: mirroredX,
    y: box.y,
    w: box.w,
    h: box.h,
    z: box.z,
  };
  if (box.rotation !== undefined) {
    next.rotation = box.rotation;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Snapshot-wide mirror
// ---------------------------------------------------------------------------

function mirrorElement(element: CanvasElement, canvasWidth: number): CanvasElement {
  // The element variants form a discriminated union by `type`; the box is
  // declared on `BaseElement` so all variants carry it identically. Cloning
  // via spread + replacing the box is structurally safe — none of the
  // variant-specific fields reference the box.
  const cloned = { ...element, box: mirrorElementBox(element.box, canvasWidth) };
  return cloned;
}

function mirrorSection(section: CanvasSection, canvasWidth: number): CanvasSection {
  return {
    ...section,
    elements: section.elements.map((el) => mirrorElement(el, canvasWidth)),
  };
}

function mirrorPage(page: CanvasPage): CanvasPage {
  return {
    ...page,
    sections: page.sections.map((s) => mirrorSection(s, page.width)),
  };
}

/**
 * Return a copy of `snapshot` where every Positioned Element on every RTL
 * page has its x-coordinate mirrored across that page's canvas width.
 *
 * - LTR pages pass through structurally identical (still a shallow clone of
 *   the page object, but the underlying section / element arrays are
 *   reused — the renderer does not mutate them).
 * - RTL pages are deep-cloned down to the box level so the input snapshot
 *   is never mutated.
 * - The decision uses {@link isRtl} against `page.locale ?? defaultLocale`.
 */
export function applyRtlMirror(snapshot: PublishedSnapshot): PublishedSnapshot {
  // Structural probe for `defaultLocale` — same pattern used in
  // `src/seo/meta-emit.ts`. The snapshot type does not yet declare it.
  const snapAny = snapshot as PublishedSnapshot & { defaultLocale?: unknown };
  const defaultLocale =
    typeof snapAny.defaultLocale === 'string' && snapAny.defaultLocale.length > 0
      ? snapAny.defaultLocale
      : 'en';

  const pages = snapshot.pages.map((page) => {
    const localeForPage =
      typeof page.locale === 'string' && page.locale.length > 0 ? page.locale : defaultLocale;
    if (!isRtl(localeForPage)) {
      // LTR — return the page as-is. The shallow identity is fine: the
      // renderer is read-only with respect to its input snapshot.
      return page;
    }
    return mirrorPage(page);
  });

  // Reconstruct the snapshot, preserving any extra fields attached via the
  // structural-probe pattern (e.g. `defaultLocale`, `siteNoIndex`,
  // `darkModeEnabled`). `Object.assign` carries those through without us
  // having to name each one.
  const next: PublishedSnapshot = { ...snapshot, pages };
  // Re-attach any non-typed properties (siteNoIndex, defaultLocale, darkModeEnabled, …).
  const extras = snapshot as unknown as Record<string, unknown>;
  for (const key of Object.keys(extras)) {
    if (key === 'pages') continue;
    if (key in next) continue;
    (next as unknown as Record<string, unknown>)[key] = extras[key];
  }
  return next;
}
