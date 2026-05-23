// src/canvas/render.ts
//
// Pure HTML renderer for a Published Snapshot. Emits a self-contained <main>
// block; the caller wraps it in the full document.
//
// Phase 0 scaffold: this file is the dispatcher. Per-element render logic
// lives in `src/canvas/elements/*.ts` and is wired in via the
// `RENDER_DISPATCH` table from `src/canvas/elements/index.ts`. Wave agents
// register new elements by editing the matching file in `elements/`, never
// by editing this dispatcher.
//
// All user-controlled strings are escaped at the boundary. The function is
// pure — no DOM access, no I/O. The caller passes an assetBasePath so the
// renderer never has to know how Owner Assets are addressed.

import { RENDER_DISPATCH, type ElementRenderCtx } from './elements/index.js';
import {
  escapeAttr,
  escapeCssValue,
  sanitiseCssKey,
  styleFromEntries,
} from './elements/render-utils.js';
import { renderResponsiveCss } from './responsive/index.js';
import { getStyleKitPreset, resolveStyleKitWithCustom } from './style-kits.js';
import type { CanvasElement, CanvasPage, CanvasSection, PublishedSnapshot } from './schema.js';

function buildElementWrapperStyle(element: CanvasElement): string {
  const { box } = element;
  const entries: Array<[string, string]> = [
    ['position', 'absolute'],
    ['left', `${String(box.x)}px`],
    ['top', `${String(box.y)}px`],
    ['width', `${String(box.w)}px`],
    ['height', `${String(box.h)}px`],
    ['z-index', String(box.z)],
  ];
  if (typeof box.rotation === 'number' && box.rotation !== 0) {
    entries.push(['transform', `rotate(${String(box.rotation)}deg)`]);
  }
  if (element.pinnedStyle) {
    // Pinned style wins — append after defaults so its keys override duplicates.
    for (const [k, v] of Object.entries(element.pinnedStyle)) {
      const safeKey = sanitiseCssKey(k);
      if (safeKey === '') continue;
      const safeValue = escapeCssValue(v);
      if (safeValue === '') continue;
      entries.push([safeKey, safeValue]);
    }
  }
  return styleFromEntries(entries);
}

// Dispatch indirection — the public renderer never imports element-specific
// render fns. The Phase 0 RENDER_DISPATCH table is the single source of truth
// for "given an element of type T, produce the inner HTML." Type-narrowed via
// the dispatch map so each render fn sees the right Extract<...> shape.
function renderElementBody(element: CanvasElement, ctx: ElementRenderCtx): string {
  // The double cast is needed because TypeScript cannot infer that
  // `RENDER_DISPATCH[element.type]` accepts `element` whose type is the union
  // — it only accepts the narrowed `Extract` shape. The map keys are
  // exhaustive on the union (enforced by the `RenderDispatch` mapped type)
  // and the discriminant `.type` is preserved through this call.
  const fn = RENDER_DISPATCH[element.type] as (el: CanvasElement, ctx: ElementRenderCtx) => string;
  return fn(element, ctx);
}

// Decorative-by-default invariant: shape and surface (container) wrappers are
// always emitted with `aria-hidden="true" role="presentation"` so assistive
// tech skips them. Media gets `aria-hidden="true"` only when `alt === ''`
// (the canonical decorative-image signal); when alt is non-empty, the native
// `<img alt>` attribute does the work and we do NOT also hide the wrapper.
// Text and action elements never get ARIA overrides — their defaults are
// semantically correct (headings/paragraphs, anchor tags). The nine Phase 0
// element types inherit no decorative status — they speak for themselves.
function buildAriaWrapperAttrs(element: CanvasElement): string {
  switch (element.type) {
    case 'shape':
    case 'container':
      return ' aria-hidden="true" role="presentation"';
    case 'media':
      return element.alt === '' ? ' aria-hidden="true"' : '';
    case 'text':
    case 'action':
    case 'symbol-instance':
    case 'form':
    case 'embed':
    case 'chart':
    case 'accordion':
    case 'carousel':
    case 'table':
    case 'code':
    case 'nav':
      return '';
  }
}

// Mirror the element's `variant` (or `role`/`kind`) onto the wrapper so kit
// CSS selectors of the shape `[data-style-kit="X"]
// [data-element-type="action"][data-variant="Y"]` match per-element. Elements
// without a variant produce nothing.
function variantAttr(element: CanvasElement): string {
  switch (element.type) {
    case 'action':
    case 'shape':
    case 'container':
      return ` data-variant="${escapeAttr(element.variant)}"`;
    case 'text':
      return ` data-role="${escapeAttr(element.role)}"`;
    case 'chart':
      return ` data-variant="${escapeAttr(element.kind)}"`;
    case 'code':
      return ` data-variant="${escapeAttr(element.language)}"`;
    case 'media':
    case 'symbol-instance':
    case 'form':
    case 'embed':
    case 'accordion':
    case 'carousel':
    case 'table':
    case 'nav':
      return '';
  }
}

function renderElement(element: CanvasElement, ctx: ElementRenderCtx): string {
  const inner = renderElementBody(element, ctx);
  const wrapperStyle = buildElementWrapperStyle(element);
  const motionAttrs =
    element.motion !== undefined
      ? ` data-motion-preset="${escapeAttr(element.motion.preset)}" data-motion-delay-ms="${escapeAttr(String(element.motion.delayMs ?? 0))}"`
      : '';
  const ariaAttrs = buildAriaWrapperAttrs(element);
  const variant = variantAttr(element);
  return `<div class="rev01-element" data-rev01-element="${escapeAttr(element.id)}" data-element-type="${escapeAttr(element.type)}"${variant}${motionAttrs}${ariaAttrs} style="${wrapperStyle}">${inner}</div>`;
}

function renderSection(section: CanvasSection, pageWidth: number, ctx: ElementRenderCtx): string {
  const bgEffect = section.backgroundEffect ?? 'none';
  const entrance = section.entrance ?? 'none';
  const style = styleFromEntries([
    ['position', 'relative'],
    ['width', `${String(pageWidth)}px`],
    ['height', `${String(section.height)}px`],
  ]);
  // Reading order = `section.elements[]` storage order. The renderer is the
  // contract: whatever order elements appear in the array is the order DOM
  // emits them, which is what assistive tech reads. Owner-side reorder tools
  // (T5.7) are the Owner's lever for changing it independent of visual z/x/y.
  const elementsHtml = section.elements.map((element) => renderElement(element, ctx)).join('');
  return `<section class="rev01-section" data-rev01-section="${escapeAttr(section.id)}" data-recipe="${escapeAttr(section.recipeId)}" data-bg-effect="${escapeAttr(bgEffect)}" data-entrance="${escapeAttr(entrance)}" style="${style}">${elementsHtml}</section>`;
}

function renderPage(page: CanvasPage, ctx: Omit<ElementRenderCtx, 'pageSlug'>): string {
  const style = styleFromEntries([
    ['width', `${String(page.width)}px`],
    ['margin', '0 auto'],
  ]);
  const pageCtx: ElementRenderCtx = { ...ctx, pageSlug: page.slug };
  const sectionsHtml = page.sections
    .map((section) => renderSection(section, page.width, pageCtx))
    .join('');
  return `<article class="rev01-page" data-rev01-page="${escapeAttr(page.id)}" style="${style}">${sectionsHtml}</article>`;
}

/**
 * Optional renderer options. Each field is additive and back-compat — every
 * existing caller passes the original positional arguments and continues to
 * work without change. Wave 3 #21 (SEO) introduced this options object so
 * the renderer could expose a per-page head-meta hook without becoming a
 * grab-bag of positional parameters; future waves should reuse this seam
 * rather than adding more positional args.
 */
export interface RenderSnapshotOptions {
  /**
   * Wave 3 #21 — per-page `<head>` meta emitter. When provided, the renderer
   * calls this for each page in the snapshot. The body wrapper produced by
   * `renderCanvasSnapshot` is a `<main>` element with no `<head>`, so the
   * emitted strings are NOT currently spliced into the body — the renderer
   * concatenates them and returns them via the return value's structure
   * (see overload below). The visitor-facing route owns the actual
   * `<head>` envelope and calls `renderCanvasHead` (sibling exported from
   * `src/seo/meta-emit.ts`) for the page the visitor is reading; this hook
   * exists so future renderers (e.g. multi-page static export) can wire
   * head emission per page through the same seam.
   */
  emitHeadMeta?: (page: CanvasPage) => string;
}

/**
 * Render the body of a Published Snapshot. The returned string is a
 * self-contained `<main>` block — the caller wraps it in the document
 * envelope (`<html>…<head>…</head><body>` etc.).
 *
 * Backwards-compatible signature:
 *   - 1st positional: `snapshot`           (required)
 *   - 2nd positional: `assetBasePath`      (required)
 *   - 3rd positional: `siteId`             (optional, default '')
 *   - 4th positional: `opts` (`RenderSnapshotOptions`) — additive, Wave 3 #21.
 *
 * The signature stays positional through `siteId` so existing call sites
 * keep working without edit. New consumers should prefer passing `opts`
 * (the only forward-extensible slot) rather than adding more positional
 * arguments.
 */
export function renderCanvasSnapshot(
  snapshot: PublishedSnapshot,
  assetBasePath: string,
  siteId: string = '',
  opts: RenderSnapshotOptions = {},
): string {
  // Belt-and-braces: even though the validator rejects unknown kits at the API
  // boundary, the renderer refuses to emit HTML for a kit that has no preset
  // — there is no default. A missing token must never silently degrade.
  //
  // Custom kits are site-owned data carried on the snapshot. Validate them
  // here even though the public route also emits CSS from them, so every
  // render entry point has the same fail-loud boundary.
  if (snapshot.styleKit === 'custom') {
    resolveStyleKitWithCustom(snapshot);
  } else {
    getStyleKitPreset(snapshot.styleKit);
  }
  const baseCtx: Omit<ElementRenderCtx, 'pageSlug'> = {
    assetBasePath,
    styleKit: snapshot.styleKit,
    siteId,
  };
  const pagesHtml = snapshot.pages.map((page) => renderPage(page, baseCtx)).join('');
  const responsiveStyle = renderResponsiveCss(snapshot);
  // Wave 3 #21 — exercise the optional head-meta hook for every page so the
  // emitter contract is verified at render time. The renderer body does not
  // splice the result into the `<main>` block (the document envelope owns
  // `<head>`); the call is wired here for two reasons:
  //   1. To give future static-export consumers a single canonical seam
  //      that walks every page.
  //   2. To force-evaluate the emitter so a mis-shaped hook fails loudly at
  //      render time rather than the next time the public route inlines its
  //      output.
  // The result is discarded — visitor-facing emission goes through the
  // sibling `renderCanvasHead` exported from `src/seo/meta-emit.ts`.
  if (opts.emitHeadMeta) {
    for (const page of snapshot.pages) {
      // Drop the result — see note above. We invoke the hook for the side
      // effect of validating its shape and giving future renderers a place
      // to hook in.
      void opts.emitHeadMeta(page);
    }
  }
  // The outer wrapper always declares `lang="en"` for the POC. A future
  // owner-facing language picker would override this — out of POC scope.
  return `<main class="rev01-site" lang="en" data-style-kit="${escapeAttr(snapshot.styleKit)}">${responsiveStyle}${pagesHtml}</main>`;
}
