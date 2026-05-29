// src/canvas/elements/index.ts
//
// Element registry — single import point for every element interface and the
// dispatch table consumed by `src/canvas/render.ts`. The five originals
// (text, media, action, shape, container) are defined inline in
// `src/canvas/schema.ts`; the rest live in per-element files in this
// directory. Each render fn has the uniform signature `(el, ctx)`.

import type { CanvasElement, CanvasPage, StyleKitPreset } from '../schema.js';

import { renderAccordion } from './accordion.js';
import { renderAction } from './action.js';
import { renderCarousel } from './carousel.js';
import { renderChart } from './chart.js';
import { codeInspectorSpec, renderCode } from './code.js';
import { renderCollection } from './collection.js';
import { containerInspectorSpec, renderContainer } from './container.js';
import { embedInspectorSpec, renderEmbed } from './embed.js';
import { renderForm } from './form.js';
import type { InspectorSpec } from './inspector-spec.js';
import { renderMedia } from './media.js';
import { renderNav } from './nav.js';
import { renderShape, shapeInspectorSpec } from './shape.js';
import { renderTable } from './table.js';
import { renderText, textInspectorSpec } from './text.js';

// Re-export every element interface so downstream code has a single import
// point. The five originals come from `schema.ts` (legacy location); the
// nine new ones come from per-element files in this directory.
export type {
  ActionElement,
  ContainerElement,
  MediaElement,
  ShapeElement,
  TextElement,
} from '../schema.js';
export type { AccordionElement, AccordionItem } from './accordion.js';
export type { CarouselElement, CarouselSlide } from './carousel.js';
export type { ChartElement, ChartKind, ChartSeries } from './chart.js';
export type { CodeElement, CodeLanguage } from './code.js';
export type { EmbedElement } from './embed.js';
export type { FormElement, FormFieldDef, FormFieldKind } from './form.js';
export type { NavElement, NavLayout, NavLink, NavLinkKind } from './nav.js';
export type { TableColumn, TableElement, TableRow } from './table.js';
export type {
  CollectionElement,
  CollectionFilter,
  CollectionLayout,
  CollectionMode,
  CollectionSort,
  PageMetadataField,
} from './collection.js';

// Re-export recipe id constants so the recipes module + smoke tests can
// reference them without depending directly on individual element files.
export { ACCORDION_RECIPE_ID } from './accordion.js';
export { CAROUSEL_RECIPE_ID } from './carousel.js';
export { CHART_RECIPE_ID } from './chart.js';
export { CODE_RECIPE_ID } from './code.js';
export { EMBED_RECIPE_ID } from './embed.js';
export { FORM_RECIPE_ID } from './form.js';
export { NAV_RECIPE_ID } from './nav.js';
export { TABLE_RECIPE_ID } from './table.js';
export { COLLECTION_RECIPE_ID } from './collection.js';

/**
 * Single shared context shape passed to every render function. Element files
 * are free to read only the fields they care about and ignore the rest.
 */
export interface ElementRenderCtx {
  /** Canonical asset URL prefix — e.g. '/assets'. Required for media + nav + carousel. */
  assetBasePath: string;
  /** Active style kit name on the current snapshot. Used by chart palette, code theme, etc. */
  styleKit: string;
  /** Resolved custom style kit tokens when styleKit === 'custom'. */
  customPreset?: StyleKitPreset | null;
  /** Current site id, needed by form render to wire form action URL. */
  siteId: string;
  /** Slug of the page currently being rendered. */
  pageSlug: string;
  /** All pages in the snapshot — needed by action element to resolve page links. */
  pages: CanvasPage[];
  /**
   * Cloudflare Turnstile public site key. Required, non-empty. Callers resolve
   * it from env via requireTurnstileSiteKey() and fail loudly at that boundary
   * if the env var is missing.
   */
  turnstileSiteKey: string;
  /**
   * Wrapper-emitting renderer for a single element. Threaded through ctx so
   * the collection dispatch can render children with the same `rev01-element`
   * wrapper, aria/variant/motion/elementStyle attrs as top-level elements —
   * a body-only child wrapper would silently strip accessibility, kit-CSS
   * variant matching, and motion. The function reference lives on the ctx
   * (not as a direct import) to break the renderer/dispatch import cycle.
   */
  renderElement: (element: CanvasElement, ctx: ElementRenderCtx) => string;
}

/**
 * Type guard — every key of this map must be a member of `CanvasElement['type']`.
 * The mapped type below enforces that statically: missing a case fails compile.
 */
export type RenderDispatch = {
  [K in CanvasElement['type']]: (
    el: Extract<CanvasElement, { type: K }>,
    ctx: ElementRenderCtx,
  ) => string;
};

/**
 * Dispatch one element to its registered renderer. `element.type` comes from
 * JSONB at runtime, so an out-of-union value (legacy data, failed migration)
 * is possible — surface it explicitly with the element id + type rather than
 * letting the implicit `undefined()` minify to "fn is not a function" and
 * tell you neither. `callerLabel` distinguishes top-level dispatch from the
 * collection child-render seam in the thrown message.
 */
export function renderElementBody(
  element: CanvasElement,
  ctx: ElementRenderCtx,
  callerLabel?: string,
): string {
  const fn = Object.hasOwn(RENDER_DISPATCH, element.type)
    ? (RENDER_DISPATCH as Record<string, (el: CanvasElement, ctx: ElementRenderCtx) => string>)[
        element.type
      ]
    : undefined;
  if (typeof fn !== 'function') {
    const label = callerLabel !== undefined ? ` (${callerLabel})` : '';
    throw new Error(
      `renderElementBody${label}: no RENDER_DISPATCH entry for element type=${JSON.stringify(element.type)} id=${JSON.stringify(element.id)}`,
    );
  }
  return fn(element, ctx);
}

export const RENDER_DISPATCH: RenderDispatch = {
  text: (el) => renderText(el),
  media: (el, ctx) => renderMedia(el, { assetBasePath: ctx.assetBasePath }),
  action: (el, ctx) => renderAction(el, { pages: ctx.pages }),
  shape: (el) => renderShape(el),
  container: (el) => renderContainer(el),
  form: (el, ctx) =>
    renderForm(el, {
      siteId: ctx.siteId,
      pageSlug: ctx.pageSlug,
      styleKit: ctx.styleKit,
      turnstileSiteKey: ctx.turnstileSiteKey,
    }),
  embed: (el, ctx) => renderEmbed(el, { styleKit: ctx.styleKit }),
  chart: (el, ctx) =>
    renderChart(el, {
      styleKit: ctx.styleKit,
      customAccent: ctx.customPreset?.accent ?? null,
    }),
  accordion: (el, ctx) => renderAccordion(el, { styleKit: ctx.styleKit }),
  carousel: (el, ctx) =>
    renderCarousel(el, {
      styleKit: ctx.styleKit,
      assetBasePath: ctx.assetBasePath,
    }),
  table: (el, ctx) => renderTable(el, { styleKit: ctx.styleKit }),
  code: (el, ctx) =>
    renderCode(el, {
      styleKit: ctx.styleKit,
      ...(ctx.customPreset !== undefined ? { customPreset: ctx.customPreset } : {}),
    }),
  nav: (el, ctx) =>
    renderNav(el, {
      styleKit: ctx.styleKit,
      assetBasePath: ctx.assetBasePath,
    }),
  collection: (el, ctx) =>
    renderCollection(el, {
      styleKit: ctx.styleKit,
      assetBasePath: ctx.assetBasePath,
      renderChild: (child) => ctx.renderElement(child, ctx),
    }),
};

// ---------------------------------------------------------------------------
// Inspector dispatch (ADR 0011 Step 1)
// ---------------------------------------------------------------------------
//
// Declarative spec per element type. The editor client at
// `src/editor/canvas-client.ts` interpolates this table as JSON at
// script-emit time and walks the spec with a single generic interpreter,
// replacing the per-type `buildXInspector` functions that previously fanned
// out inside the IIFE.
//
// Partial during migration per ADR 0011 dec 3: this PR migrates shape,
// container, code, embed as the proof-of-pattern. Unmigrated element types
// fall through to their existing `buildXInspector` function inside
// canvas-client.ts. The cutover ADR flips this to a full
// `Record<CanvasElement['type'], InspectorSpec>` once every element has a
// spec — at which point the mapped-type enforcement matches RENDER_DISPATCH
// above and "added a type, forgot the spec" becomes a compile error.
//
// `collection` is intentionally never in this dispatch: it has no inspector
// fields of its own (the children's inspectors render when the visitor
// selects a child element).
export const INSPECTOR_DISPATCH: Partial<Record<CanvasElement['type'], InspectorSpec>> = {
  shape: shapeInspectorSpec,
  container: containerInspectorSpec,
  code: codeInspectorSpec,
  embed: embedInspectorSpec,
  text: textInspectorSpec,
};
