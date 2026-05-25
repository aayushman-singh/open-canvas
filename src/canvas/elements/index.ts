// src/canvas/elements/index.ts
//
// Phase 0 element registry — frozen contract.
//
// CHOICE (Phase 0 scaffold): the five original element interfaces
// (text, media, action, shape, container) stay defined inline in
// `src/canvas/schema.ts`. Their render functions used to be inline in
// `src/canvas/render.ts`; in Phase 0 they were moved into per-element files
// under this directory (text.ts, media.ts, action.ts, shape.ts,
// container.ts) so that every element type has the SAME shape on disk —
// "one element, one file, one render fn, optional recipe constant."
//
// The nine new ElementType files (form, embed, chart, accordion, carousel,
// table, code, nav, symbol-instance) follow the same shape; their render
// fns throw `Error('TODO: implement in Wave N')` until the owning wave
// agent fills them in.
//
// Render dispatch — `RENDER_DISPATCH[el.type](el, ctx)` — is consumed by
// `src/canvas/render.ts`. That file is frozen after Phase 0 so wave agents
// add their entry by editing the element file, not the renderer.
//
// The dispatch signature uniformly takes `(el, ctx)`. `ctx` is the
// `ElementRenderCtx` declared below — a single shape every render fn reads
// from, regardless of whether it cares about every field.

import type { CanvasElement } from '../schema.js';

import { renderAccordion } from './accordion.js';
import { renderAction } from './action.js';
import { renderCarousel } from './carousel.js';
import { renderChart } from './chart.js';
import { renderCode } from './code.js';
import { renderCollection } from './collection.js';
import { renderContainer } from './container.js';
import { renderEmbed } from './embed.js';
import { renderForm } from './form.js';
import { renderMedia } from './media.js';
import { renderNav } from './nav.js';
import { renderShape } from './shape.js';
import { renderSymbolInstance } from './symbol-instance.js';
import { renderTable } from './table.js';
import { renderText } from './text.js';

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
export type { SymbolInstanceElement, SymbolInstanceOverrides } from './symbol-instance.js';
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
  /** Current site id, needed by form render to wire form action URL. */
  siteId: string;
  /** Slug of the page currently being rendered. */
  pageSlug: string;
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

function renderElementBody(element: CanvasElement, ctx: ElementRenderCtx): string {
  const fn = RENDER_DISPATCH[element.type] as (el: CanvasElement, ctx: ElementRenderCtx) => string;
  return fn(element, ctx);
}

export const RENDER_DISPATCH: RenderDispatch = {
  text: (el) => renderText(el),
  media: (el, ctx) => renderMedia(el, { assetBasePath: ctx.assetBasePath }),
  action: (el) => renderAction(el),
  shape: (el) => renderShape(el),
  container: (el) => renderContainer(el),
  // Phase 0 stubs — each throws until its wave agent lands.
  'symbol-instance': (el, ctx) =>
    renderSymbolInstance(el, {
      styleKit: ctx.styleKit,
      assetBasePath: ctx.assetBasePath,
    }),
  form: (el, ctx) =>
    renderForm(el, {
      siteId: ctx.siteId,
      pageSlug: ctx.pageSlug,
      styleKit: ctx.styleKit,
    }),
  embed: (el, ctx) => renderEmbed(el, { styleKit: ctx.styleKit }),
  chart: (el, ctx) => renderChart(el, { styleKit: ctx.styleKit }),
  accordion: (el, ctx) => renderAccordion(el, { styleKit: ctx.styleKit }),
  carousel: (el, ctx) =>
    renderCarousel(el, {
      styleKit: ctx.styleKit,
      assetBasePath: ctx.assetBasePath,
    }),
  table: (el, ctx) => renderTable(el, { styleKit: ctx.styleKit }),
  code: (el, ctx) => renderCode(el, { styleKit: ctx.styleKit }),
  nav: (el, ctx) =>
    renderNav(el, {
      styleKit: ctx.styleKit,
      assetBasePath: ctx.assetBasePath,
    }),
  collection: (el, ctx) =>
    renderCollection(el, {
      styleKit: ctx.styleKit,
      assetBasePath: ctx.assetBasePath,
      renderChild: (child) => renderElementBody(child, ctx),
    }),
};
