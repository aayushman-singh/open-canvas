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
  buildBehaviourPayload,
  serializeBehaviourPayload,
  snapshotHasBehaviourPrimitives,
} from './behaviour-payload.js';
import type {
  BehaviourLoadExperience,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  ElementStyle,
  MotionSequenceLite,
  MotionSequenceLiteTarget,
  PublishedSnapshot,
  StyleKitPreset,
} from './schema.js';
import { isPremiumLoadExperience } from './schema.js';
import { componentStyleEntriesForElement } from './elements/component-style.js';
import {
  escapeAttr,
  escapeCssValue,
  escapeHtml,
  sanitiseCssKey,
  styleFromEntries,
} from './elements/render-utils.js';
import { renderResponsiveCss } from './responsive/index.js';
import { resolveActionHref } from './action-href.js';
import { getStyleKitPreset, resolveStyleKitWithCustom } from './style-kits.js';

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
    // Inline opacity covers elements without an entrance animation; the
    // custom property is what the kit's fade-up/fade-in/etc. keyframes
    // resolve at their `to` stop, so animated elements settle at the
    // authored opacity instead of being pinned to 1 by fill-mode: both.
    entries.push(['opacity', String(es.opacity)]);
    entries.push(['--opencanvas-element-opacity', String(es.opacity)]);
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

function appendAuthoredElementStyleEntries(
  entries: Array<[string, string]>,
  element: CanvasElement,
  assetBasePath: string,
): void {
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
  for (const [key, value] of componentStyleEntriesForElement(element)) {
    entries.push([key, value]);
  }
  // CSS variable read by the kit's [data-motion-preset] rules to drive
  // animation-delay. Without this, every element animation on a page started
  // at t=0 regardless of the Owner's per-element delayMs, which made staggered
  // entrances visually indistinguishable from a single simultaneous flash.
  if (element.motion !== undefined) {
    const delay = element.motion.delayMs ?? 0;
    if (delay > 0) entries.push(['--opencanvas-motion-delay', `${String(delay)}ms`]);
  }
}

function buildElementWrapperStyle(element: CanvasElement, assetBasePath: string): string {
  const { box } = element;
  const stickyOffset =
    element.stickyOffset !== undefined && Number.isFinite(element.stickyOffset)
      ? element.stickyOffset
      : null;
  // ADR 0054 dec 1 — sticky elements drop out of absolute layout and use
  // margins for the authored initial offset, reserving `top` for the sticky
  // viewport offset. Non-sticky elements continue to use absolute layout.
  const entries: Array<[string, string]> =
    stickyOffset !== null
      ? [
          ['position', 'sticky'],
          ['margin-left', `${String(box.x)}px`],
          ['margin-top', `${String(box.y)}px`],
          ['top', `${String(stickyOffset)}px`],
          ['width', `${String(box.w)}px`],
          ['height', `${String(box.h)}px`],
          ['z-index', String(box.z)],
        ]
      : [
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
  appendAuthoredElementStyleEntries(entries, element, assetBasePath);
  return styleFromEntries(entries);
}

function buildHostedElementWrapperStyle(element: CanvasElement, assetBasePath: string): string {
  const entries: Array<[string, string]> = [
    ['position', 'relative'],
    ['width', '100%'],
    ['height', '100%'],
    ['box-sizing', 'border-box'],
  ];
  appendAuthoredElementStyleEntries(entries, element, assetBasePath);
  return styleFromEntries(entries);
}

// Decorative-by-default invariant: shape and surface (container) wrappers are
// always emitted with `aria-hidden="true" role="presentation"` so assistive
// tech skips them, except linked containers: the wrapper is the interactive
// link and must stay exposed with an accessible name. Media gets
// `aria-hidden="true"` only when `alt === ''`
// (the canonical decorative-image signal); when alt is non-empty, the native
// `<img alt>` attribute does the work and we do NOT also hide the wrapper.
// Text and action elements never get ARIA overrides — their defaults are
// semantically correct (headings/paragraphs, anchor tags). Every other
// element type carries its own semantics and inherits no decorative status.
function buildAriaWrapperAttrs(element: CanvasElement): string {
  switch (element.type) {
    case 'shape':
      return ' aria-hidden="true" role="presentation"';
    case 'container':
      return element.linkHref === undefined ? ' aria-hidden="true" role="presentation"' : '';
    case 'media':
      return element.alt === '' ? ' aria-hidden="true"' : '';
    case 'rich-motion':
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
    case 'tabs':
    case 'flow-container':
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
    // ADR 0066 — the interactive components also mirror their variant onto the
    // OUTER wrapper (the same element `pinnedStyle` lands on). The variant CSS
    // *sets* its `--opencanvas-<component>-*` custom properties here, so an
    // inline `pinnedStyle` override on the wrapper beats the stylesheet arm on
    // the same element — making the kit-token < variant < granular cascade
    // actually hold (it would not if the vars were set on a child element,
    // because proximity would let the child arm win over the wrapper's inline
    // value). Default to the first arm so the attribute is always present.
    case 'form':
      return ` data-variant="${escapeAttr(element.variant ?? 'classic')}"`;
    case 'accordion':
      return ` data-variant="${escapeAttr(element.variant ?? 'list')}"`;
    case 'carousel':
      return ` data-variant="${escapeAttr(element.variant ?? 'classic')}"`;
    case 'tabs':
      return ` data-variant="${escapeAttr(element.variant ?? 'classic')}"`;
    case 'rich-motion':
    case 'media':
    case 'embed':
    case 'table':
    case 'nav':
    case 'collection':
    case 'flow-container':
      return '';
  }
}

/**
 * Gap #17 — resolve `ContainerElement.tint` against `StyleKitPreset.tintTokens`
 * when the value is a token identifier; otherwise treat it as a raw CSS colour.
 * Returns null when the tint cannot be safely emitted (escape rejection).
 */
function resolveTintColour(
  tint: string,
  customPreset: StyleKitPreset | null | undefined,
): string | null {
  if (/^[a-z][a-z0-9-]*$/.test(tint)) {
    const token = customPreset?.tintTokens?.[tint];
    if (typeof token === 'string' && token.length > 0) {
      const safe = escapeCssValue(token);
      return safe === '' ? null : safe;
    }
    // Unknown token — fall through to literal interpretation so authors who
    // typo a token don't render a broken style silently. escapeCssValue
    // catches the literal at the next gate.
  }
  const safe = escapeCssValue(tint);
  return safe === '' ? null : safe;
}

function applyContainerTint(
  element: CanvasElement,
  ctx: ElementRenderCtx,
  wrapperStyle: string,
): { wrapperStyle: string; tintAttr: string } {
  if (
    element.type !== 'container' ||
    typeof element.tint !== 'string' ||
    element.tint.length === 0
  ) {
    return { wrapperStyle, tintAttr: '' };
  }
  const colour = resolveTintColour(element.tint, ctx.customPreset);
  if (colour === null) {
    return { wrapperStyle, tintAttr: '' };
  }
  return {
    wrapperStyle:
      wrapperStyle +
      `;--opencanvas-tint:${colour}` +
      `;background-image:linear-gradient(135deg,color-mix(in oklab,var(--opencanvas-tint) 25%,transparent) 0%,transparent 70%)`,
    tintAttr: ` data-tint="${escapeAttr(element.tint)}"`,
  };
}

function buildElementCommonAttrs(element: CanvasElement, tintAttr: string): string {
  const motionAttrs =
    element.motion !== undefined
      ? ` data-motion-preset="${escapeAttr(element.motion.preset)}" data-motion-delay-ms="${escapeAttr(String(element.motion.delayMs ?? 0))}"`
      : '';
  const marqueeAttrs =
    element.marquee?.enabled === true
      ? ` data-opencanvas-marquee="true" data-opencanvas-marquee-direction="${escapeAttr(element.marquee.direction)}" data-opencanvas-marquee-speed="${escapeAttr(String(element.marquee.speedPxPerSecond))}" data-opencanvas-marquee-pause="${escapeAttr(String(element.marquee.pauseOnHover === true))}" data-opencanvas-marquee-reduced-motion="${escapeAttr(element.marquee.reducedMotion)}"`
      : '';
  const pointerFxAttrs =
    element.pointerFx?.enabled === true
      ? ` data-opencanvas-pointer-fx="${escapeAttr(element.pointerFx.primitive)}" data-opencanvas-pointer-fx-reduced-motion="${escapeAttr(element.pointerFx.reducedMotion)}"`
      : '';
  const ariaAttrs = buildAriaWrapperAttrs(element);
  const variant = variantAttr(element);
  const esAttrs = buildElementStyleDataAttrs(element.elementStyle);
  // ADR 0050 dec 2 — anchor ids emit as DOM id="..." on the wrapper.
  // Validator enforces the strict charset, so escapeAttr is belt-and-braces.
  const idAttr =
    typeof element.anchorId === 'string' && element.anchorId.length > 0
      ? ` id="${escapeAttr(element.anchorId)}"`
      : '';
  return `${idAttr}${tintAttr} data-opencanvas-element="${escapeAttr(element.id)}" data-element-type="${escapeAttr(element.type)}"${variant}${motionAttrs}${marqueeAttrs}${pointerFxAttrs}${ariaAttrs}${esAttrs}`;
}

function renderElement(element: CanvasElement, ctx: ElementRenderCtx): string {
  const inner = renderElementBody(element, ctx);
  let wrapperStyle = buildElementWrapperStyle(element, ctx.assetBasePath);
  const tinted = applyContainerTint(element, ctx, wrapperStyle);
  wrapperStyle = tinted.wrapperStyle;
  const commonAttrs = buildElementCommonAttrs(element, tinted.tintAttr);

  // ADR 0051 dec 5 — container with linkHref emits the outer wrapper as
  // <a href="…"> instead of <div>. Every other attribute, the inner body
  // (renderContainer's <div class="opencanvas-surface">), the wrapperStyle,
  // motion, anchorId, elementStyle — all unchanged.
  if (element.type === 'container' && element.linkHref !== undefined) {
    const resolved = resolveActionHref(element.linkHref, ctx.pages);
    const ariaLabelAttr =
      typeof element.linkLabel === 'string' && element.linkLabel.length > 0
        ? ` aria-label="${escapeAttr(element.linkLabel)}"`
        : '';
    return `<a class="opencanvas-element" href="${escapeAttr(resolved)}"${ariaLabelAttr}${commonAttrs} style="${wrapperStyle}">${inner}</a>`;
  }
  return `<div class="opencanvas-element"${commonAttrs} style="${wrapperStyle}">${inner}</div>`;
}

function renderHostedElement(element: CanvasElement, ctx: ElementRenderCtx): string {
  const inner = renderElementBody(element, ctx, 'flow-hosted');
  let wrapperStyle = buildHostedElementWrapperStyle(element, ctx.assetBasePath);
  const tinted = applyContainerTint(element, ctx, wrapperStyle);
  wrapperStyle = tinted.wrapperStyle;
  const commonAttrs = buildElementCommonAttrs(element, tinted.tintAttr);

  if (element.type === 'container' && element.linkHref !== undefined) {
    const resolved = resolveActionHref(element.linkHref, ctx.pages);
    const ariaLabelAttr =
      typeof element.linkLabel === 'string' && element.linkLabel.length > 0
        ? ` aria-label="${escapeAttr(element.linkLabel)}"`
        : '';
    return `<a class="opencanvas-element opencanvas-flow-content" href="${escapeAttr(resolved)}"${ariaLabelAttr}${commonAttrs} style="${wrapperStyle}">${inner}</a>`;
  }
  return `<div class="opencanvas-element opencanvas-flow-content"${commonAttrs} style="${wrapperStyle}">${inner}</div>`;
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
  // ADR 0062 — emit the accent-border variant as inline CSS on the section
  // wrapper so per-section state stays self-contained. The four variants
  // are mutually exclusive by construction, so we emit exactly one shape
  // of CSS per call. All variants use box-shadow when possible — solid
  // and top/left as `inset` shadows so they overlay any background-effect
  // without affecting layout; glow as an outer (non-inset) shadow.
  if (section.accentBorder) {
    const ab = section.accentBorder;
    const safeColor = escapeCssValue(ab.color);
    if (safeColor) {
      if (ab.type === 'solid') {
        styleEntries.push(['border', `${String(ab.width)}px solid ${safeColor}`]);
        styleEntries.push(['box-sizing', 'border-box']);
      } else if (ab.type === 'top') {
        styleEntries.push(['box-shadow', `inset 0 ${String(ab.thickness)}px 0 0 ${safeColor}`]);
      } else if (ab.type === 'left') {
        styleEntries.push(['box-shadow', `inset ${String(ab.thickness)}px 0 0 0 ${safeColor}`]);
      } else {
        const spread = ab.spread ?? 0;
        styleEntries.push([
          'box-shadow',
          `0 0 ${String(ab.radius)}px ${String(spread)}px ${safeColor}`,
        ]);
      }
    }
  }
  const style = styleFromEntries(styleEntries);
  // Reading order = `section.elements[]` storage order. The renderer is the
  // contract: whatever order elements appear in the array is the order DOM
  // emits them, which is what assistive tech reads. Owner-side reorder tools
  // (T5.7) are the Owner's lever for changing it independent of visual z/x/y.
  const elementsHtml = section.elements.map((element) => renderElement(element, ctx)).join('');
  const roleAttr =
    section.role && section.role !== 'body'
      ? ` data-section-role="${escapeAttr(section.role)}"`
      : '';
  const triggerAttrs = section.trigger
    ? (() => {
        const t = section.trigger;
        const value = t.type === 'exit-intent' ? '' : String(t.value);
        return ` data-opencanvas-popup="true" data-opencanvas-trigger-type="${escapeAttr(t.type)}" data-opencanvas-trigger-value="${escapeAttr(value)}"`;
      })()
    : '';
  const navThemeTargetAttr = section.navThemeTarget
    ? ` data-opencanvas-nav-theme-target="${escapeAttr(section.navThemeTarget)}"`
    : '';
  const bgVideoHtml = section.backgroundVideoAssetId
    ? `<video autoplay loop muted playsinline aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none"><source src="${escapeAttr(`${ctx.assetBasePath}/${section.backgroundVideoAssetId}`)}" type="video/mp4"></video>`
    : '';
  // ADR 0050 dec 2 — anchor ids emit as DOM id="..." on the section wrapper.
  const idAttr =
    typeof section.anchorId === 'string' && section.anchorId.length > 0
      ? ` id="${escapeAttr(section.anchorId)}"`
      : '';
  // ADR 0061 Decision 7 — Section Instance scope is exposed as a wrapper
  // attribute so anchor-rewriting and per-instance behaviour (e.g. two
  // hero instances on one page) can target the right subtree. The
  // attribute is omitted entirely for sections without a scope (Library
  // rows and pre-Phase-D persisted state).
  const scopeAttr =
    typeof section.instanceScope === 'string' && section.instanceScope.length > 0
      ? ` data-instance-scope="${escapeAttr(section.instanceScope)}"`
      : '';
  // ADR 0062 — accent-border type surfaces as a data attribute alongside
  // data-bg-effect so editor smokes and CSS hooks can target the variant
  // without re-parsing inline styles. Omitted when absent.
  const accentAttr = section.accentBorder
    ? ` data-accent-border="${escapeAttr(section.accentBorder.type)}"`
    : '';
  return `<section class="opencanvas-section"${idAttr} data-opencanvas-section="${escapeAttr(section.id)}" data-recipe="${escapeAttr(section.recipeId)}"${roleAttr}${triggerAttrs}${scopeAttr}${navThemeTargetAttr} data-bg-effect="${escapeAttr(bgEffect)}"${accentAttr} data-entrance="${escapeAttr(entrance)}" style="${style}">${bgVideoHtml}${elementsHtml}</section>`;
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
  // ADR 0059 — page may opt out of the site-level header/footer.
  const headerHtml =
    header && page.suppressHeader !== true ? renderSection(header, renderWidth, pageCtx) : '';
  const sectionsHtml = page.sections
    .map((section) => renderSection(section, renderWidth, pageCtx))
    .join('');
  const footerHtml =
    footer && page.suppressFooter !== true ? renderSection(footer, renderWidth, pageCtx) : '';
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

function motionTargetAttr(target: MotionSequenceLiteTarget): string {
  if (target.type === 'load-screen-part') return `load-screen-part:${target.part}`;
  return target.type;
}

function renderMotionSequenceLite(sequence: MotionSequenceLite | undefined): string {
  if (!sequence) return '';
  return sequence.steps
    .map(
      (step) =>
        `<span hidden data-opencanvas-motion-sequence-lite="${escapeAttr(sequence.id)}" data-opencanvas-motion-step="${escapeAttr(step.id)}" data-opencanvas-motion-target="${escapeAttr(motionTargetAttr(step.target))}" data-opencanvas-motion-effect="${escapeAttr(step.effect)}" data-opencanvas-motion-delay-ms="${escapeAttr(String(step.delayMs))}" data-opencanvas-motion-duration-ms="${escapeAttr(String(step.durationMs))}" data-opencanvas-motion-easing="${escapeAttr(step.easing)}"></span>`,
    )
    .join('');
}

function renderOverlays(
  snapshot: PublishedSnapshot,
  ctx: Omit<ElementRenderCtx, 'pageSlug'>,
  renderedPages: CanvasPage[],
): string {
  if (!snapshot.overlays || snapshot.overlays.length === 0) return '';
  const pageIds = new Set(renderedPages.map((page) => page.id));
  const renderPage = renderedPages[0] ?? snapshot.pages[0];
  if (!renderPage) return '';
  const renderWidth = Math.min(renderPage.maxWidth ?? Infinity, renderPage.width);
  const overlays = snapshot.overlays
    .filter((overlay) => {
      if (overlay.scope.type === 'site') return true;
      return overlay.scope.pageIds.some((pageId) => pageIds.has(pageId));
    })
    .map((overlay) => {
      const contentHtml = renderSection(overlay.content, renderWidth, {
        ...ctx,
        pageSlug: renderPage.slug,
      });
      const trigger = overlay.trigger;
      const triggerAttrs =
        trigger.type === 'delay' || trigger.type === 'scroll'
          ? ` data-opencanvas-overlay-trigger-value="${escapeAttr(String(trigger.value))}"`
          : trigger.type === 'element-click'
            ? ` data-opencanvas-overlay-trigger-target="${escapeAttr(trigger.targetElementId)}"`
            : '';
      const sequenceAttrs = `${overlay.openSequence ? ` data-opencanvas-overlay-open-sequence="${escapeAttr(overlay.openSequence.id)}"` : ''}${overlay.closeSequence ? ` data-opencanvas-overlay-close-sequence="${escapeAttr(overlay.closeSequence.id)}"` : ''}`;
      const presentation = overlay.presentation?.mode ?? 'modal';
      const chrome = overlay.presentation?.chrome ?? 'standard';
      const backdrop = overlay.presentation?.backdrop ?? 'dim';
      const closePlacement = overlay.presentation?.closePlacement ?? 'top-right';
      const overlayClass =
        presentation === 'fullscreen-menu'
          ? `opencanvas-overlay opencanvas-overlay--fullscreen-menu opencanvas-overlay--chrome-${escapeAttr(chrome)}`
          : `opencanvas-overlay opencanvas-overlay--chrome-${escapeAttr(chrome)}`;
      return `<div class="${overlayClass}" data-opencanvas-overlay="${escapeAttr(overlay.id)}" data-opencanvas-overlay-presentation="${escapeAttr(presentation)}" data-opencanvas-overlay-chrome="${escapeAttr(chrome)}" data-opencanvas-overlay-backdrop-style="${escapeAttr(backdrop)}" data-opencanvas-overlay-close-placement="${escapeAttr(closePlacement)}" data-opencanvas-overlay-content-canvas="${escapeAttr(overlay.content.id)}" data-opencanvas-overlay-trigger-type="${escapeAttr(trigger.type)}"${triggerAttrs}${sequenceAttrs} data-opencanvas-overlay-close-button="${String(overlay.dismissal.closeButton)}" data-opencanvas-overlay-escape="${String(overlay.dismissal.escape)}" data-opencanvas-overlay-backdrop-click="${String(overlay.dismissal.backdropClick)}" data-opencanvas-overlay-body-scroll-lock="${String(overlay.dismissal.bodyScrollLock)}" data-opencanvas-overlay-focus-trap="${String(overlay.dismissal.focusTrap)}" data-opencanvas-overlay-return-focus="${String(overlay.dismissal.returnFocus)}" hidden><div class="opencanvas-overlay-backdrop" data-opencanvas-overlay-backdrop></div><div class="opencanvas-overlay-surface" data-opencanvas-overlay-surface role="dialog" aria-modal="true" aria-label="${escapeAttr(overlay.name)}">${contentHtml}</div>${renderMotionSequenceLite(overlay.openSequence)}${renderMotionSequenceLite(overlay.closeSequence)}</div>`;
    })
    .join('');
  if (!overlays) return '';
  return `<div data-opencanvas-overlays-root>${overlays}</div>`;
}

function renderLoadExperience(snapshot: PublishedSnapshot): string {
  const load = snapshot.loadExperience;
  if (!isPremiumLoadExperience(load) || load.enabled !== true) return '';
  const sequenceAttr = load.handoffSequence
    ? ` data-opencanvas-load-handoff-sequence="${escapeAttr(load.handoffSequence.id)}"`
    : '';
  return `<div class="opencanvas-load-experience" data-opencanvas-load-experience="${escapeAttr(load.id)}" data-opencanvas-load-part="shell" data-opencanvas-load-preset="${escapeAttr(load.preset)}" data-opencanvas-load-run-policy="${escapeAttr(load.runPolicy)}" data-opencanvas-load-gates="${escapeAttr(load.gates.join(' '))}" data-opencanvas-load-timeout-ms="${escapeAttr(String(load.timeoutMs))}"${sequenceAttr}><div class="opencanvas-load-brand" data-opencanvas-load-part="brand">${escapeAttr(snapshot.pages[0]?.title ?? 'Loading')}</div><div class="opencanvas-load-progress" data-opencanvas-load-part="progress"><span></span></div><div class="opencanvas-load-error" data-opencanvas-load-part="error" hidden>Loading failed</div>${renderMotionSequenceLite(load.handoffSequence)}</div>`;
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
  const customPreset: StyleKitPreset | null = snapshot.styleKit === 'custom' ? preset : null;
  const baseCtx: Omit<ElementRenderCtx, 'pageSlug'> = {
    assetBasePath,
    styleKit: snapshot.styleKit,
    customPreset,
    siteId,
    pages: snapshot.pages,
    turnstileSiteKey: opts.turnstileSiteKey,
    renderElement,
    renderHostedElement,
  };
  const pagesToRender = opts.renderPages ?? snapshot.pages;
  const pagesHtml = pagesToRender
    .map((page) => renderPage(page, baseCtx, snapshot.header, snapshot.footer))
    .join('');
  const responsiveStyle = renderResponsiveCss(snapshot);
  const scrollStyle = renderScrollBehaviourCss(snapshot.scrollBehavior);
  const copyScript = renderCopyHandlerScript(snapshot);
  const tabsScript = renderTabsHandlerScript(snapshot);
  const behaviourLoadExperience =
    snapshot.loadExperience && 'sequenceId' in snapshot.loadExperience
      ? snapshot.loadExperience
      : undefined;
  const loadExperienceHtml = behaviourLoadExperience
    ? renderLoadExperienceChrome(behaviourLoadExperience)
    : '';
  const behaviourPayloadScript = renderBehaviourPayloadScript(snapshot, assetBasePath);
  const importAnimationInventoryScript = renderImportAnimationInventoryScript(snapshot);
  const rootStyle = `--opencanvas-kit-accent:${preset.accent}`;
  const routeAttrs =
    snapshot.routeTransition?.enabled === true
      ? ` data-opencanvas-route-transition="${escapeAttr(snapshot.routeTransition.id)}" data-opencanvas-route-mode="${escapeAttr(snapshot.routeTransition.mode)}" data-opencanvas-route-duration-ms="${escapeAttr(String(snapshot.routeTransition.durationMs))}" data-opencanvas-route-easing="${escapeAttr(snapshot.routeTransition.easing)}"${snapshot.routeTransition.sharedElements && snapshot.routeTransition.sharedElements.length > 0 ? ` data-opencanvas-route-shared-elements="${escapeAttr(JSON.stringify(snapshot.routeTransition.sharedElements))}"` : ''}${snapshot.routeTransition.outgoingSequence ? ` data-opencanvas-route-outgoing-sequence="${escapeAttr(snapshot.routeTransition.outgoingSequence.id)}"` : ''}${snapshot.routeTransition.incomingSequence ? ` data-opencanvas-route-incoming-sequence="${escapeAttr(snapshot.routeTransition.incomingSequence.id)}"` : ''}`
      : '';
  const smoothScrollAttrs = renderSmoothScrollAttrs(snapshot.scrollBehavior);
  return `<main class="opencanvas-site" data-style-kit="${escapeAttr(snapshot.styleKit)}" data-opencanvas-route-container${routeAttrs}${smoothScrollAttrs} style="${escapeAttr(rootStyle)}">${scrollStyle}${responsiveStyle}${loadExperienceHtml}${pagesHtml}${snapshot.routeTransition ? `${renderMotionSequenceLite(snapshot.routeTransition.outgoingSequence)}${renderMotionSequenceLite(snapshot.routeTransition.incomingSequence)}` : ''}${renderOverlays(snapshot, baseCtx, pagesToRender)}${renderLoadExperience(snapshot)}${importAnimationInventoryScript}${behaviourPayloadScript}${copyScript}${tabsScript}</main>`;
}

/**
 * ADR 0051 dec 4 — emit a tiny delegated copy-to-clipboard handler at the
 * end of `<main>` IFF at least one action element in the snapshot uses the
 * `copy` behaviour. Zero-cost when unused (no script tag), one script when
 * needed. The handler reads the copy value from the `data-opencanvas-copy`
 * attribute at click time — values never get baked into JS source, so HTML
 * attribute escaping is the entire safety story.
 */
function renderCopyHandlerScript(snapshot: PublishedSnapshot): string {
  if (!snapshotHasCopyAction(snapshot)) return '';
  const script =
    "document.addEventListener('click',function(e){var n=e.target;if(!n||typeof n.closest!=='function')return;var t=n.closest('[data-opencanvas-copy]');if(!t)return;var v=t.getAttribute('data-opencanvas-copy');if(v===null)return;var w=t.closest('[data-opencanvas-element]');var id=w?w.getAttribute('data-opencanvas-element'):null;if(!navigator.clipboard||typeof navigator.clipboard.writeText!=='function'){console.error('[opencanvas-copy] clipboard API unavailable',{elementId:id});t.setAttribute('data-opencanvas-copy-failed','');return;}navigator.clipboard.writeText(v).then(function(){t.removeAttribute('data-opencanvas-copy-failed');t.setAttribute('data-opencanvas-copied','');setTimeout(function(){t.removeAttribute('data-opencanvas-copied')},2000)}).catch(function(err){console.error('[opencanvas-copy] clipboard write failed',{error:err,elementId:id});t.setAttribute('data-opencanvas-copy-failed','')})});";
  return `<script data-opencanvas-copy-handler>${script}</script>`;
}

function snapshotHasCopyAction(snapshot: PublishedSnapshot): boolean {
  return walkElements(snapshot, (el) => el.type === 'action' && el.behavior !== undefined);
}

/**
 * ADR 0052 dec 4 — emit a tiny delegated tab-switch handler at the end of
 * `<main>` IFF at least one TabsElement exists in the snapshot. Same pattern
 * as `renderCopyHandlerScript`. The handler toggles `data-tab-active` on the
 * matching bar button and panel; the style kit's CSS (or default) hides
 * `[data-opencanvas-tab-panel-id]:not([data-tab-active])`. Graceful
 * degradation per ADR 0052 dec 5: no JS means all panels visible, not none.
 */
function renderTabsHandlerScript(snapshot: PublishedSnapshot): string {
  if (!snapshotHasTabsElement(snapshot)) return '';
  const script =
    "document.addEventListener('click',function(e){var n=e.target;if(!n||typeof n.closest!=='function')return;var btn=n.closest('[data-opencanvas-tab-id]');if(!btn||btn.tagName!=='BUTTON')return;var root=btn.closest('[data-opencanvas-tabs]');if(!root)return;var id=btn.getAttribute('data-opencanvas-tab-id');root.querySelectorAll('[data-opencanvas-tab-id]').forEach(function(b){if(b.closest('[data-opencanvas-tabs]')!==root)return;b.toggleAttribute('data-tab-active',b.getAttribute('data-opencanvas-tab-id')===id)});root.querySelectorAll('[data-opencanvas-tab-panel-id]').forEach(function(p){if(p.closest('[data-opencanvas-tabs]')!==root)return;p.toggleAttribute('data-tab-active',p.getAttribute('data-opencanvas-tab-panel-id')===id)})});";
  return `<script data-opencanvas-tabs-handler>${script}</script>`;
}

function snapshotHasTabsElement(snapshot: PublishedSnapshot): boolean {
  return walkElements(snapshot, (el) => el.type === 'tabs');
}

/**
 * Walk every element in the snapshot (header, footer, each page's sections,
 * plus nested children inside collection entries and tabs panels) and
 * short-circuit when `pred` returns true. Handles the recursion both ADR
 * 0052 dec 4 (tabs nesting tabs is allowed) and the existing collection
 * nesting need without a per-call-site bespoke walk.
 */
function walkElements(snapshot: PublishedSnapshot, pred: (el: CanvasElement) => boolean): boolean {
  const sections: CanvasSection[] = [];
  if (snapshot.header) sections.push(snapshot.header);
  if (snapshot.footer) sections.push(snapshot.footer);
  for (const page of snapshot.pages) {
    sections.push(...page.sections);
  }
  const visit = (el: CanvasElement): boolean => {
    if (pred(el)) return true;
    if (el.type === 'tabs') {
      for (const tab of el.tabs) {
        for (const child of tab.elements) {
          if (visit(child)) return true;
        }
      }
    } else if (el.type === 'collection') {
      // ADR 0063 dec 6 — `entries` is the materializer's per-entry output;
      // walked so nested interactive elements (e.g. tabs inside a card)
      // still trigger runtime injection.
      for (const entry of el.entries ?? []) {
        for (const child of entry) {
          if (visit(child)) return true;
        }
      }
    } else if (el.type === 'flow-container') {
      for (const item of el.items) {
        if (visit(item.element)) return true;
      }
    }
    return false;
  };
  for (const section of sections) {
    for (const element of section.elements) {
      if (visit(element)) return true;
    }
  }
  return false;
}

/**
 * ADR 0050 dec 3 — emit a single global `<style>` block when the site sets
 * `scrollBehavior`. The rule targets `html` so anchor jumps land below a
 * sticky header instead of under it. Absence (or all-fields-absent) emits
 * nothing — there is no zero-padding default.
 */
function renderSmoothScrollAttrs(scrollBehavior: PublishedSnapshot['scrollBehavior']): string {
  if (!scrollBehavior || scrollBehavior.mode !== 'inertial') return '';
  return ` data-opencanvas-smooth-scroll="inertial" data-opencanvas-smooth-scroll-duration-ms="${escapeAttr(String(scrollBehavior.durationMs))}" data-opencanvas-smooth-scroll-reduced-motion="${escapeAttr(String(scrollBehavior.reducedMotion))}"`;
}

function renderScrollBehaviourCss(scrollBehavior: PublishedSnapshot['scrollBehavior']): string {
  if (!scrollBehavior) return '';
  const rules: string[] = [];
  if (scrollBehavior.smooth === true || scrollBehavior.mode === 'native') {
    rules.push('scroll-behavior:smooth');
  }
  if (typeof scrollBehavior.paddingTop === 'number' && scrollBehavior.paddingTop >= 0) {
    rules.push(`scroll-padding-top:${String(scrollBehavior.paddingTop)}px`);
  }
  if (rules.length === 0) return '';
  return `<style data-opencanvas-scroll-behavior>html{${rules.join(';')}}</style>`;
}

function renderLoadExperienceChrome(load: BehaviourLoadExperience): string {
  const background = escapeCssValue(load.background) || load.background;
  const foreground = escapeCssValue(load.foreground) || load.foreground;
  const style = styleFromEntries([
    ['position', 'fixed'],
    ['inset', '0'],
    ['z-index', '100001'],
    ['display', 'grid'],
    ['place-items', 'center'],
    ['align-content', 'center'],
    ['gap', '24px'],
    ['background', background],
    ['color', foreground],
  ]);
  return `<div class="opencanvas-load-experience" data-opencanvas-load-experience="${escapeAttr(load.id)}" data-opencanvas-load-sequence="${escapeAttr(load.sequenceId)}" style="${style}"><div class="opencanvas-load-label" data-opencanvas-load-part="label">${escapeHtml(load.label)}</div><button type="button" class="opencanvas-load-enter" data-opencanvas-load-enter>${escapeHtml(load.enterLabel)}</button></div>`;
}

function serializeJsonScriptData(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new Error('renderCanvasSnapshot: JSON script data must be serializable');
  }
  return json.replace(/</g, '\u003c').replace(/\u2028/g, '\u2028').replace(/\u2029/g, '\u2029');
}

function renderImportAnimationInventoryScript(snapshot: PublishedSnapshot): string {
  if (snapshot.importAnimationInventory === undefined) return '';
  return `<script type="application/json" data-opencanvas-import-animation-inventory>${serializeJsonScriptData(snapshot.importAnimationInventory)}</script>`;
}
function renderBehaviourPayloadScript(
  snapshot: PublishedSnapshot,
  assetBasePath: string,
): string {
  if (!snapshotHasBehaviourPrimitives(snapshot)) return '';
  const payload = buildBehaviourPayload(snapshot, assetBasePath);
  if (!payload) return '';
  return `<script type="application/json" data-opencanvas-behaviour-payload>${serializeBehaviourPayload(payload)}</script>`;
}
