// src/canvas/render.ts
//
// Pure HTML renderer for a Published Snapshot. Emits a self-contained <main>
// block; the caller wraps it in the full document.
//
// Per-element render logic lives in `src/canvas/elements/*.ts`. This file
// composes those element renderers with page + section wrappers and threads
// `ElementRenderCtx` through. New element types are registered by editing
// the matching file under `elements/`, never this dispatcher.
//
// All user-controlled strings are escaped at the boundary. The function is
// pure — no DOM access, no I/O. The caller passes an assetBasePath so the
// renderer never has to know how Owner Assets are addressed.

import { renderElementBody, type ElementRenderCtx } from './elements/index.js';
import {
  escapeAttr,
  escapeCssValue,
  sanitiseCssKey,
  styleFromEntries,
} from './elements/render-utils.js';
import { renderResponsiveCss } from './responsive/index.js';
import { getStyleKitPreset, resolveStyleKitWithCustom } from './style-kits.js';
import type { CanvasElement, CanvasPage, CanvasSection, ElementStyle, PublishedSnapshot, StyleKitPreset } from './schema.js';

function applyElementStyle(
  entries: Array<[string, string]>,
  es: ElementStyle,
  assetBasePath: string,
): void {
  if (es.backgroundColor) {
    const v = escapeCssValue(es.backgroundColor);
    if (v) entries.push(['background-color', v]);
  }
  if (es.backgroundImageAssetId) {
    const url = escapeAttr(`${assetBasePath}/${es.backgroundImageAssetId}`);
    entries.push(['background-image', `url(${url})`]);
    entries.push(['background-size', es.backgroundSize === 'contain' ? 'contain' : 'cover']);
    entries.push(['background-position', 'center']);
  }
  if (typeof es.borderRadius === 'number') {
    entries.push(['border-radius', `${String(es.borderRadius)}px`]);
  }
  if (es.borderColor || typeof es.borderWidth === 'number') {
    const col = es.borderColor ? escapeCssValue(es.borderColor) : '';
    const w = typeof es.borderWidth === 'number' ? es.borderWidth : 1;
    if (col) {
      entries.push(['border', `${String(w)}px solid ${col}`]);
    } else {
      entries.push(['border-width', `${String(w)}px`]);
      entries.push(['border-style', 'solid']);
    }
  }
  if (es.boxShadow) {
    const v = escapeCssValue(es.boxShadow);
    if (v) entries.push(['box-shadow', v]);
  }
  if (typeof es.opacity === 'number') {
    entries.push(['opacity', String(es.opacity)]);
  }
  if (es.color) {
    const v = escapeCssValue(es.color);
    if (v) entries.push(['color', v]);
  }
  if (es.overflow) {
    entries.push(['overflow', es.overflow]);
  }
}

function buildElementStyleDataAttrs(es: ElementStyle | undefined): string {
  if (!es) return '';
  let attrs = '';
  if (es.backgroundColor || es.backgroundImageAssetId) attrs += ' data-es-bg';
  if (typeof es.borderRadius === 'number') attrs += ' data-es-radius';
  if (es.borderColor || typeof es.borderWidth === 'number') attrs += ' data-es-border';
  if (es.boxShadow) attrs += ' data-es-shadow';
  return attrs;
}

function buildElementWrapperStyle(element: CanvasElement, assetBasePath: string): string {
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
  if (element.elementStyle) {
    applyElementStyle(entries, element.elementStyle, assetBasePath);
  }
  if (element.pinnedStyle) {
    // Pinned style wins — append after elementStyle and defaults.
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
    case 'form':
    case 'embed':
    case 'chart':
    case 'accordion':
    case 'carousel':
    case 'table':
    case 'code':
    case 'nav':
    case 'collection':
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
    case 'form':
    case 'embed':
    case 'accordion':
    case 'carousel':
    case 'table':
    case 'nav':
    case 'collection':
      return '';
  }
}

function renderElement(element: CanvasElement, ctx: ElementRenderCtx): string {
  const inner = renderElementBody(element, ctx);
  const wrapperStyle = buildElementWrapperStyle(element, ctx.assetBasePath);
  const motionAttrs =
    element.motion !== undefined
      ? ` data-motion-preset="${escapeAttr(element.motion.preset)}" data-motion-delay-ms="${escapeAttr(String(element.motion.delayMs ?? 0))}"`
      : '';
  const ariaAttrs = buildAriaWrapperAttrs(element);
  const variant = variantAttr(element);
  const esAttrs = buildElementStyleDataAttrs(element.elementStyle);
  return `<div class="rev01-element" data-rev01-element="${escapeAttr(element.id)}" data-element-type="${escapeAttr(element.type)}"${variant}${motionAttrs}${ariaAttrs}${esAttrs} style="${wrapperStyle}">${inner}</div>`;
}

function renderSection(section: CanvasSection, pageWidth: number, ctx: ElementRenderCtx): string {
  const bgEffect = section.backgroundEffect ?? 'none';
  const entrance = section.entrance ?? 'none';
  const styleEntries: Array<[string, string]> = [
    ['position', 'relative'],
    ['width', `${String(pageWidth)}px`],
    ['height', `${String(section.height)}px`],
  ];
  if (section.trigger) {
    styleEntries.push(['display', 'none']);
  }
  const style = styleFromEntries(styleEntries);
  // Reading order = `section.elements[]` storage order. The renderer is the
  // contract: whatever order elements appear in the array is the order DOM
  // emits them, which is what assistive tech reads. Owner-side reorder tools
  // (T5.7) are the Owner's lever for changing it independent of visual z/x/y.
  const elementsHtml = section.elements.map((element) => renderElement(element, ctx)).join('');
  const roleAttr = section.role && section.role !== 'body' ? ` data-section-role="${escapeAttr(section.role)}"` : '';
  const triggerAttrs = section.trigger
    ? (() => {
        const t = section.trigger;
        const value = t.type === 'exit-intent' ? '' : String(t.value);
        return ` data-rev01-popup="true" data-rev01-trigger-type="${escapeAttr(t.type)}" data-rev01-trigger-value="${escapeAttr(value)}"`;
      })()
    : '';
  const bgVideoHtml = section.backgroundVideoAssetId
    ? `<video autoplay loop muted playsinline aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none"><source src="${escapeAttr(`${ctx.assetBasePath}/${section.backgroundVideoAssetId}`)}" type="video/mp4"></video>`
    : '';
  return `<section class="rev01-section" data-rev01-section="${escapeAttr(section.id)}" data-recipe="${escapeAttr(section.recipeId)}"${roleAttr}${triggerAttrs} data-bg-effect="${escapeAttr(bgEffect)}" data-entrance="${escapeAttr(entrance)}" style="${style}">${bgVideoHtml}${elementsHtml}</section>`;
}

function renderPage(
  page: CanvasPage,
  ctx: Omit<ElementRenderCtx, 'pageSlug'>,
  header?: CanvasSection,
  footer?: CanvasSection,
): string {
  const renderWidth = page.maxWidth != null && page.maxWidth < page.width ? page.maxWidth : page.width;
  const entries: Array<[string, string]> = [
    ['width', `${String(renderWidth)}px`],
    ['margin', '0 auto'],
  ];
  if (page.pageBackground) {
    const safeBackground = escapeCssValue(page.pageBackground);
    if (safeBackground) entries.push(['background', safeBackground]);
  }
  if (page.sectionGap != null) {
    entries.push(
      ['display', 'flex'],
      ['flex-direction', 'column'],
      ['gap', `${String(page.sectionGap)}px`],
    );
  }
  if (page.maxWidth != null) entries.push(['max-width', `${String(page.maxWidth)}px`]);
  const style = styleFromEntries(entries);
  const pageCtx: ElementRenderCtx = { ...ctx, pageSlug: page.slug };
  const headerHtml = header ? renderSection(header, renderWidth, pageCtx) : '';
  const sectionsHtml = page.sections
    .map((section) => renderSection(section, renderWidth, pageCtx))
    .join('');
  const footerHtml = footer ? renderSection(footer, renderWidth, pageCtx) : '';
  const hasEntrance = page.entranceAnimation !== undefined && page.entranceAnimation !== 'none';
  const triggerMode = page.scrollTriggerMode ?? 'on-load';
  const motionAttr =
    hasEntrance && triggerMode === 'on-load'
      ? ` data-motion-preset="${escapeAttr(page.entranceAnimation as string)}"`
      : '';
  const entranceAttr =
    hasEntrance && triggerMode === 'on-scroll'
      ? ` data-entrance-animation="${escapeAttr(page.entranceAnimation as string)}"`
      : '';
  const triggerAttr = hasEntrance ? ` data-scroll-trigger="${escapeAttr(triggerMode)}"` : '';
  return `<article class="rev01-page" data-rev01-page="${escapeAttr(page.id)}"${motionAttr}${entranceAttr}${triggerAttr} style="${style}">${headerHtml}${sectionsHtml}${footerHtml}</article>`;
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
   * Cloudflare Turnstile public site key. Required, non-empty. Callers resolve
   * it from env via requireTurnstileSiteKey(); a missing or empty env var
   * fails at that boundary, not here.
   */
  turnstileSiteKey: string;
  /**
   * Per-page `<head>` meta emitter. When provided, the renderer calls this
   * for each page in the snapshot. The body wrapper produced by
   * `renderCanvasSnapshot` is a `<main>` element with no `<head>`, so the
   * emitted strings are NOT spliced into the body — the renderer
   * concatenates them and returns them via the return value's structure.
   * The visitor-facing route owns the actual `<head>` envelope and calls
   * `renderCanvasHead` (sibling exported from `src/seo/meta-emit.ts`) for
   * the page the visitor is reading; this hook exists so future renderers
   * (e.g. multi-page static export) can wire head emission per page through
   * the same seam.
   */
  emitHeadMeta?: (page: CanvasPage) => string;
  /**
   * Optional body-page subset. Link resolution, responsive CSS, and other
   * whole-site context still come from `snapshot`; only the emitted
   * `<article>` list is narrowed.
   */
  renderPages?: CanvasPage[];
}

/**
 * Render the body of a Published Snapshot. The returned string is a
 * self-contained `<main>` block — the caller wraps it in the document
 * envelope (`<html>…<head>…</head><body>` etc.).
 */
export function renderCanvasSnapshot(
  snapshot: PublishedSnapshot,
  assetBasePath: string,
  siteId: string = '',
  opts: RenderSnapshotOptions,
): string {
  // Belt-and-braces: even though the validator rejects unknown kits at the API
  // boundary, the renderer refuses to emit HTML for a kit that has no preset
  // — there is no default. A missing token must never silently degrade.
  //
  // Custom kits are site-owned data carried on the snapshot. Validate them
  // here even though the public route also emits CSS from them, so every
  // render entry point has the same fail-loud boundary.
  const customPreset: StyleKitPreset | null =
    snapshot.styleKit === 'custom' ? resolveStyleKitWithCustom(snapshot) : null;
  if (snapshot.styleKit !== 'custom') {
    getStyleKitPreset(snapshot.styleKit);
  }
  const baseCtx: Omit<ElementRenderCtx, 'pageSlug'> = {
    assetBasePath,
    styleKit: snapshot.styleKit,
    customPreset,
    siteId,
    pages: snapshot.pages,
    turnstileSiteKey: opts.turnstileSiteKey,
  };
  const pagesToRender = opts.renderPages ?? snapshot.pages;
  const pagesHtml = pagesToRender
    .map((page) => renderPage(page, baseCtx, snapshot.header, snapshot.footer))
    .join('');
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
    for (const page of pagesToRender) {
      // Drop the result — see note above. We invoke the hook for the side
      // effect of validating its shape and giving future renderers a place
      // to hook in.
      void opts.emitHeadMeta(page);
    }
  }
  return `<main class="rev01-site" data-style-kit="${escapeAttr(snapshot.styleKit)}">${responsiveStyle}${pagesHtml}</main>`;
}
