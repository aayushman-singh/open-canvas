// src/canvas/elements/index.ts
//
// Element registry — single import point for every element interface and the
// dispatch table consumed by `src/canvas/render.ts`. The five originals
// (text, media, action, shape, container) are defined inline in
// `src/canvas/schema.ts`; the rest live in per-element files in this
// directory. Each render fn has the uniform signature `(el, ctx)`.

import type { CanvasElement, CanvasPage, StyleKitPreset } from '../schema.js';

import {
  accordionAgentToolSpec,
  accordionInspectorSpec,
  accordionSidebarSpec,
  renderAccordion,
} from './accordion.js';
import {
  actionAgentToolSpec,
  actionInspectorSpec,
  actionSidebarSpec,
  renderAction,
} from './action.js';
import {
  carouselAgentToolSpec,
  carouselInspectorSpec,
  carouselSidebarSpec,
  renderCarousel,
} from './carousel.js';
import { chartAgentToolSpec, chartInspectorSpec, chartSidebarSpec, renderChart } from './chart.js';
import { codeAgentToolSpec, codeInspectorSpec, codeSidebarSpec, renderCode } from './code.js';
import { collectionAgentToolSpec, collectionSidebarSpec, renderCollection } from './collection.js';
import {
  containerAgentToolSpec,
  containerInspectorSpec,
  containerSidebarSpec,
  renderContainer,
} from './container.js';
import { embedAgentToolSpec, embedInspectorSpec, embedSidebarSpec, renderEmbed } from './embed.js';
import { formAgentToolSpec, formInspectorSpec, formSidebarSpec, renderForm } from './form.js';
import {
  flowContainerAgentToolSpec,
  flowContainerSidebarSpec,
  renderFlowContainer,
} from './flow-container.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { mediaAgentToolSpec, mediaInspectorSpec, mediaSidebarSpec, renderMedia } from './media.js';
import { navAgentToolSpec, navInspectorSpec, navSidebarSpec, renderNav } from './nav.js';
import {
  renderRichMotion,
  richMotionAgentToolSpec,
  richMotionInspectorSpec,
  richMotionSidebarSpec,
} from './rich-motion.js';
import { renderShape, shapeAgentToolSpec, shapeInspectorSpec, shapeSidebarSpec } from './shape.js';
import { renderTable, tableAgentToolSpec, tableInspectorSpec, tableSidebarSpec } from './table.js';
import { renderTabs, tabsAgentToolSpec, tabsInspectorSpec, tabsSidebarSpec } from './tabs.js';
import { renderText, textAgentToolSpec, textInspectorSpec, textSidebarSpec } from './text.js';

// Re-export every element interface so downstream code has a single import
// point. The five originals come from `schema.ts` (legacy location); the
// twelve newer ones come from per-element files in this directory.
export type {
  ActionElement,
  ContainerElement,
  MediaElement,
  RichMotionElement,
  ShapeElement,
  TextElement,
} from '../schema.js';
export type {
  AccordionElement,
  AccordionItem,
  AccordionStyle,
  AccordionVariant,
} from './accordion.js';
export { ACCORDION_VARIANTS } from './accordion.js';
export type { CarouselElement, CarouselSlide, CarouselStyle, CarouselVariant } from './carousel.js';
export { CAROUSEL_VARIANTS } from './carousel.js';
export type { ChartElement, ChartKind, ChartSeries } from './chart.js';
export type { CodeElement, CodeLanguage } from './code.js';
export type { EmbedElement } from './embed.js';
export type {
  FormElement,
  FormFieldDef,
  FormFieldKind,
  FormFontFamily,
  FormFontWeight,
  FormStyle,
  FormVariant,
} from './form.js';
export { FORM_FONT_FAMILIES, FORM_FONT_WEIGHTS, FORM_VARIANTS } from './form.js';
export type { NavElement, NavLayout, NavLink, NavLinkKind } from './nav.js';
export type { TableColumn, TableElement, TableRow } from './table.js';
export type {
  CollectionDisplay,
  CollectionElement,
  CollectionSort,
  CollectionStyle,
} from './collection.js';
export type { Tab, TabsElement, TabsStyle, TabsVariant } from './tabs.js';
export { TABS_DEFAULT_BAR_HEIGHT, TABS_VARIANTS } from './tabs.js';
export type {
  FlowAlign,
  FlowBreakpoint,
  FlowContainerElement,
  FlowItem,
  FlowItemResponsiveOverride,
  FlowJustify,
  FlowLayout,
  FlowLayoutMode,
  FlowLayoutResponsiveOverride,
  FlowPadding,
  FlowSpacing,
} from './flow-container.js';
export {
  FLOW_ALIGNMENTS,
  FLOW_BREAKPOINTS,
  FLOW_JUSTIFY_VALUES,
  FLOW_LAYOUT_MODES,
} from './flow-container.js';

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
export { TABS_RECIPE_ID } from './tabs.js';
export { FLOW_CONTAINER_RECIPE_ID } from './flow-container.js';

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
  /** When true, MotionPreset fields compile into behaviour payload sequences. */
  motionPresetsCompiled?: boolean;
  /** When true, render non-interactive thumbnail-safe element bodies. */
  staticPreview?: boolean;
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
   * the collection dispatch can render children with the same `opencanvas-element`
   * wrapper, aria/variant/motion/elementStyle attrs as top-level elements —
   * a body-only child wrapper would silently strip accessibility, kit-CSS
   * variant matching, and motion. The function reference lives on the ctx
   * (not as a direct import) to break the renderer/dispatch import cycle.
   */
  renderElement: (element: CanvasElement, ctx: ElementRenderCtx) => string;
  /**
   * Placement-neutral renderer for Content Elements hosted by Flow Items.
   * It preserves element attrs/body/style but deliberately omits section
   * absolute positioning; Flow Item owns placement.
   */
  renderHostedElement: (element: CanvasElement, ctx: ElementRenderCtx) => string;
  /** True when an element body is rendering inside a Flow Item host context. */
  flowHosted?: boolean;
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
  'rich-motion': (el) => renderRichMotion(el),
  action: (el, ctx) => renderAction(el, { pages: ctx.pages }),
  shape: (el) => renderShape(el),
  container: (el) => renderContainer(el),
  form: (el, ctx) =>
    renderForm(el, {
      siteId: ctx.siteId,
      pageSlug: ctx.pageSlug,
      styleKit: ctx.styleKit,
      turnstileSiteKey: ctx.turnstileSiteKey,
      ...(ctx.staticPreview === undefined ? {} : { staticPreview: ctx.staticPreview }),
    }),
  embed: (el, ctx) =>
    renderEmbed(el, {
      styleKit: ctx.styleKit,
      ...(ctx.staticPreview === undefined ? {} : { staticPreview: ctx.staticPreview }),
    }),
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
      pageSlug: ctx.pageSlug,
    }),
  collection: (el, ctx) =>
    renderCollection(el, {
      styleKit: ctx.styleKit,
      assetBasePath: ctx.assetBasePath,
      renderChild: (child) => ctx.renderElement(child, ctx),
    }),
  tabs: (el, ctx) =>
    renderTabs(el, {
      styleKit: ctx.styleKit,
      renderChild: (child) => ctx.renderElement(child, ctx),
    }),
  'flow-container': (el, ctx) =>
    renderFlowContainer(el, {
      renderHostedElement: (child) => ctx.renderHostedElement(child, ctx),
      hosted: ctx.flowHosted === true,
    }),
};

// ---------------------------------------------------------------------------
// Inspector dispatch (ADR 0011 Step 1, cutover)
// ---------------------------------------------------------------------------
//
// Declarative spec per element type. The editor client at
// `src/editor/canvas-client.ts` interpolates this table as JSON at
// script-emit time and walks the spec with a single generic interpreter,
// replacing the per-type `buildXInspector` functions that previously fanned
// out inside the IIFE.
//
// The mapped type below is `Record<Exclude<ElementType, 'collection'>,
// InspectorSpec>` — `collection` is the one element type that intentionally
// has no inspector of its own (the children's inspectors render when the
// Owner selects a child). Excluding it at the type level means "added a
// new element type, forgot the spec" is a TypeScript compile error rather
// than a runtime no-op, matching the failure mode RENDER_DISPATCH catches.
// A future element type that legitimately wants no inspector adds itself
// to the Exclude<...> list as an explicit opt-out.
export type InspectorDispatch = Record<
  Exclude<CanvasElement['type'], 'collection' | 'flow-container'>,
  InspectorSpec
>;

export const INSPECTOR_DISPATCH: InspectorDispatch = {
  shape: shapeInspectorSpec,
  container: containerInspectorSpec,
  code: codeInspectorSpec,
  embed: embedInspectorSpec,
  text: textInspectorSpec,
  action: actionInspectorSpec,
  media: mediaInspectorSpec,
  'rich-motion': richMotionInspectorSpec,
  accordion: accordionInspectorSpec,
  carousel: carouselInspectorSpec,
  table: tableInspectorSpec,
  nav: navInspectorSpec,
  chart: chartInspectorSpec,
  form: formInspectorSpec,
  tabs: tabsInspectorSpec,
};

// ---------------------------------------------------------------------------
// Agent tool dispatch (ADR 0011 Step 2)
// ---------------------------------------------------------------------------
//
// Per-element JSON-Schema + parser fragments for the cross-element
// `updateElement` / `addElement` LLM tools, plus optional standalone tools
// (`rewriteText`, `replaceMedia`) that target a single element type. See
// `agent-tool-spec.ts` for the spec shape.
//
// `AGENT_TOOL_DISPATCH` is a full `Record<CanvasElement['type'], AgentToolSpec>`
// — missing an entry is a TypeScript compile error, mirroring the
// `RenderDispatch` and `InspectorDispatch` guarantees from ADR 0011 dec 2.
// `collection` carries an empty spec (recipe-only creation; see
// `collectionAgentToolSpec` in `collection.ts`).
export type AgentToolDispatch = Record<CanvasElement['type'], AgentToolSpec>;

// ---------------------------------------------------------------------------
// Sidebar dispatch (ADR 0011 Step 3)
// ---------------------------------------------------------------------------
//
// Per-element sidebar + section-toolbar commands. `route.tsx` reads this
// dispatch directly to render the sidebar grid; `canvas-client.ts`
// interpolates it as JSON to wire `data-sidebar-add-component` clicks and
// the in-section toolbar. Named factories in canvas-client's
// `SIDEBAR_FACTORIES` registry build the default element JSON; the spec
// names a factory by string and the smoke catches drift.
//
// Full `Record<CanvasElement['type'], SidebarSpec>` — missing an entry is
// a TypeScript compile error, mirroring RenderDispatch / InspectorDispatch
// / AgentToolDispatch.
export type SidebarDispatch = Record<CanvasElement['type'], SidebarSpec>;

// Order is load-bearing: `Object.values(SIDEBAR_DISPATCH).flatMap(s =>
// s.commands)` drives the visible order in both the editor sidebar
// (route.tsx) and the per-section toolbar (canvas-client.ts). Preserving
// the legacy order — Text first (most common), then Image/Video, Button,
// layout primitives, Chart, then the less-common compound types — keeps
// the Owner's muscle memory intact through the migration.
export const SIDEBAR_DISPATCH: SidebarDispatch = {
  text: textSidebarSpec,
  media: mediaSidebarSpec,
  'rich-motion': richMotionSidebarSpec,
  action: actionSidebarSpec,
  shape: shapeSidebarSpec,
  container: containerSidebarSpec,
  chart: chartSidebarSpec,
  form: formSidebarSpec,
  embed: embedSidebarSpec,
  code: codeSidebarSpec,
  accordion: accordionSidebarSpec,
  carousel: carouselSidebarSpec,
  table: tableSidebarSpec,
  nav: navSidebarSpec,
  collection: collectionSidebarSpec,
  tabs: tabsSidebarSpec,
  'flow-container': flowContainerSidebarSpec,
};

export const AGENT_TOOL_DISPATCH: AgentToolDispatch = {
  shape: shapeAgentToolSpec,
  container: containerAgentToolSpec,
  code: codeAgentToolSpec,
  embed: embedAgentToolSpec,
  collection: collectionAgentToolSpec,
  text: textAgentToolSpec,
  action: actionAgentToolSpec,
  media: mediaAgentToolSpec,
  'rich-motion': richMotionAgentToolSpec,
  accordion: accordionAgentToolSpec,
  carousel: carouselAgentToolSpec,
  table: tableAgentToolSpec,
  nav: navAgentToolSpec,
  form: formAgentToolSpec,
  chart: chartAgentToolSpec,
  tabs: tabsAgentToolSpec,
  'flow-container': flowContainerAgentToolSpec,
};
