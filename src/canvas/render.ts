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
  // CSS variable read by the kit's [data-motion-preset] rules to drive
  // animation-delay. Without this, every element animation on a page started
  // at t=0 regardless of the Owner's per-element delayMs, which made staggered
  // entrances visually indistinguishable from a single simultaneous flash.
  if (element.motion !== undefined) {
    const delay = element.motion.delayMs ?? 0;
    if (delay > 0) entries.push(['--opencanvas-motion-delay', `${String(delay)}ms`]);
  }
  return styleFromEntries(entries);
}

// Decorative-by-default invariant: shape and surface (container) wrappers are
// always emitted with `aria-hidden="true" role="presentation"` so assistive
// tech skips them. Media gets `aria-hidden="true"` only when `alt === ''`
// (the canonical decorative-image signal); when alt is non-empty, the native
// `<img alt>` attribute does the work and we do NOT also hide the wrapper.
// Text and action elements never get ARIA overrides — their defaults are
// semantically correct (headings/paragraphs, anchor tags). Every other
// element type carries its own semantics and inherits no decorative status.
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
  return `<div class="opencanvas-element" data-opencanvas-element="${escapeAttr(element.id)}" data-element-type="${escapeAttr(element.type)}"${variant}${motionAttrs}${ariaAttrs}${esAttrs} style="${wrapperStyle}">${inner}</div>`;
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
        return ` data-opencanvas-popup="true" data-opencanvas-trigger-type="${escapeAttr(t.type)}" data-opencanvas-trigger-value="${escapeAttr(value)}"`;
      })()
    : '';
  const bgVideoHtml = section.backgroundVideoAssetId
    ? `<video autoplay loop muted playsinline aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none"><source src="${escapeAttr(`${ctx.assetBasePath}/${section.backgroundVideoAssetId}`)}" type="video/mp4"></video>`
    : '';
  return `<section class="opencanvas-section" data-opencanvas-section="${escapeAttr(section.id)}" data-recipe="${escapeAttr(section.recipeId)}"${roleAttr}${triggerAttrs} data-bg-effect="${escapeAttr(bgEffect)}" data-entrance="${escapeAttr(entrance)}" style="${style}">${bgVideoHtml}${elementsHtml}</section>`;
}

function renderPage(
  page: CanvasPage,
  ctx: Omit<ElementRenderCtx, 'pageSlug'>,
  header?: CanvasSection,
  footer?: CanvasSection,
): string {
  const renderWidth = Math.min(page.maxWidth ?? Infinity, page.width);
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
  return `<article class="opencanvas-page" data-opencanvas-page="${escapeAttr(page.id)}"${motionAttr}${entranceAttr}${triggerAttr} style="${style}">${headerHtml}${sectionsHtml}${footerHtml}</article>`;
}

/**
 * Renderer options collected into one object so callers don't bloat the
 * positional signature each time a new optional hook lands. New optional
 * fields should be added here rather than as positional params.
 */
export interface RenderSnapshotOptions {
  /**
   * Cloudflare Turnstile public site key. Required, non-empty. Callers resolve
   * it from env via requireTurnstileSiteKey(); a missing or empty env var
   * fails at that boundary, not here.
   */
  turnstileSiteKey: string;
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
  siteId: string,
  opts: RenderSnapshotOptions,
): string {
  // siteId feeds form action URLs (/__opencanvas/forms/<siteId>/<formId>). An empty
  // string would silently produce a broken double-slash action that POSTs to
  // a 404. Fail loudly at the boundary instead of emitting broken HTML.
  if (!siteId) {
    throw new Error(
      'renderCanvasSnapshot: siteId is required and must be non-empty; got empty string',
    );
  }
  // Belt-and-braces: even though the validator rejects unknown kits at the API
  // boundary, the renderer refuses to emit HTML for a kit that has no preset
  // — there is no default. A missing token must never silently degrade.
  //
  // ADR 0012 dec 6: the preset is now resolved once and emits its accent
  // colour as `--opencanvas-kit-accent` on the root `<main>`, so the lookup is
  // load-bearing in the rendered output rather than a belt-and-braces side
  // effect. The renderer still throws loudly on an unknown kit (the
  // canvas:smoke "not-a-kit" assertion), because the natural-path call to
  // getStyleKitPreset (or resolveStyleKitWithCustom for custom kits) is the
  // throw site.
  const preset: StyleKitPreset =
    snapshot.styleKit === 'custom'
      ? resolveStyleKitWithCustom(snapshot)
      : getStyleKitPreset(snapshot.styleKit);
  const customPreset: StyleKitPreset | null =
    snapshot.styleKit === 'custom' ? preset : null;
  const baseCtx: Omit<ElementRenderCtx, 'pageSlug'> = {
    assetBasePath,
    styleKit: snapshot.styleKit,
    customPreset,
    siteId,
    pages: snapshot.pages,
    turnstileSiteKey: opts.turnstileSiteKey,
    renderElement,
  };
  const pagesToRender = opts.renderPages ?? snapshot.pages;
  const pagesHtml = pagesToRender
    .map((page) => renderPage(page, baseCtx, snapshot.header, snapshot.footer))
    .join('');
  const responsiveStyle = renderResponsiveCss(snapshot);
  const rootStyle = `--opencanvas-kit-accent:${preset.accent}`;
  return `<main class="opencanvas-site" data-style-kit="${escapeAttr(snapshot.styleKit)}" style="${escapeAttr(rootStyle)}">${responsiveStyle}${pagesHtml}</main>`;
}
