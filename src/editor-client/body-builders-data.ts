// src/editor-client/body-builders-data.ts
//
// ADR 0058 Phase 2q.d — body builders for the eleven data-heavy element
// types: chart, form, embed, code, accordion, carousel, table, nav,
// collection, tabs, rich-motion. Plus the buildElementBody dispatch that
// routes every CanvasElement to its per-type builder.
//
// Extracted from canvas-client.ts:3095-3648. The inline IIFE twin remains
// the production source-of-truth until ADR 0015 Phase 3 atomic cutover.
//
// Cross-module dependencies:
//   - buildCollectionBody and buildTabsBody build child nodes by calling
//     ctx.buildElementNode (lives in element-menu.ts). Routing through ctx
//     avoids the cycle body-builders-data ↔ element-menu ↔ body-builders-data.
//   - buildTabsBody mutates the active tab id and re-renders the element
//     via ctx.rebuildElement — the inline IIFE calls the closure-resident
//     rebuildElement; we route through ctx for the same reason.
//   - The chart preview reads ctx.mainEl (for the computed kit accent) and
//     calls previewPaletteFromAccent from palette.ts (server canonical).
//   - The nav preview routes click navigation through ctx.goToHrefOnCanvas
//     (forward-declared on ctx; impl remains inline in canvas-client.ts
//     until a later phase extracts the URL-to-page-id resolver).

import type { CanvasElement, TabsElement } from '../canvas/schema.js';
import type { AccordionElement } from '../canvas/elements/accordion.js';
import type { CarouselElement } from '../canvas/elements/carousel.js';
import type { ChartElement } from '../canvas/elements/chart.js';
import type { CodeElement } from '../canvas/elements/code.js';
import type { CollectionElement } from '../canvas/elements/collection.js';
import type { EmbedElement } from '../canvas/elements/embed.js';
import type {
  FlowAlign,
  FlowContainerElement,
  FlowItem,
  FlowLayout,
  FlowJustify,
} from '../canvas/elements/flow-container.js';
import type { FormElement } from '../canvas/elements/form.js';
import { formPointerFx } from '../canvas/elements/form.js';
import type { NavElement } from '../canvas/elements/nav.js';
import type { RichMotionElement } from '../canvas/elements/rich-motion.js';
import type { TableElement } from '../canvas/elements/table.js';

import type { DomContext, EditorContext, PersistContext, RenderContext } from './editor-context.js';
import { isAllowedHref } from './href-utils.js';
import { previewPaletteFromAccent } from './palette.js';
import {
  buildActionBodyImpl,
  buildContainerBodyImpl,
  buildMediaBodyImpl,
  buildShapeBodyImpl,
  buildTextBodyImpl,
  type BuildActionBodyContext,
  type BuildContainerBodyContext,
  type BuildMediaBodyContext,
  type BuildShapeBodyContext,
  type BuildTextBodyContext,
} from './body-builders-basic.js';

// ADR 0064 — chart preview reads the kit accent off `ctx.mainEl`'s
// computed style; the helper + the public builder share this single-DOM
// read surface so they ride DomContext alone.
export type BuildChartBodyContext = DomContext;

// ADR 0064 — form preview is pure DOM scaffolding from the FormElement.
// Empty Pick honestly states "this builder touches no editor surface."
export type BuildFormBodyContext = Pick<EditorContext, never>;

// ADR 0064 — embed preview ignores ctx; only the element shape drives
// the DOM. Empty Pick keeps the dispatcher signature uniform.
export type BuildEmbedBodyContext = Pick<EditorContext, never>;

// ADR 0064 — code preview ignores ctx; the <pre> body comes purely from
// `element.source`. Empty Pick keeps the dispatcher signature uniform.
export type BuildCodeBodyContext = Pick<EditorContext, never>;

// ADR 0064 — accordion preview ignores ctx; <details>/<summary> markup
// is driven entirely off `element.items`. Empty Pick keeps the
// dispatcher signature uniform.
export type BuildAccordionBodyContext = Pick<EditorContext, never>;

// ADR 0064 — carousel preview composes per-slide image URLs from
// `ctx.siteBase`; the local hydrate-preview helper only mutates the
// wrapper DOM, not ctx. Single-field surface, no canonical alias yet.
export type BuildCarouselBodyContext = Pick<EditorContext, 'siteBase'>;

// ADR 0064 — table preview ignores ctx; the <table> body is built from
// `element.columns` + `element.rows`. Empty Pick keeps the dispatcher
// signature uniform.
export type BuildTableBodyContext = Pick<EditorContext, never>;

// ADR 0064 — private nav-link anchor helper routes internal clicks
// through `ctx.goToHrefOnCanvas`. Single-verb surface; no canonical
// alias owns it, so an inline `Pick` declares the contract honestly.
export type BuildNavLinkAnchorContext = Pick<EditorContext, 'goToHrefOnCanvas'>;

// ADR 0064 — nav preview composes the logo URL from `ctx.siteBase` and
// reuses the link helper's `goToHrefOnCanvas` verb for every nav-link +
// the primary action. Intersection of the two narrow shapes.
export type BuildNavBodyContext = BuildNavLinkAnchorContext & Pick<EditorContext, 'siteBase'>;

// ADR 0064 — collection preview reads the template-edit pin
// (`editingCollectionTemplate`) and recurses into `buildElementNode` for
// both the per-entry card cells and the in-place custom-template edit
// surface. Both fields sit outside the canonical aliases.
export type BuildCollectionBodyContext = Pick<
  EditorContext,
  'editingCollectionTemplate' | 'buildElementNode'
>;

// ADR 0064 — tabs preview recurses into `ctx.buildElementNode` for the
// active tab's children, mutates `element.activeTabId` on click and then
// calls `ctx.rebuildElement` + `ctx.scheduleSave` to re-render and
// persist. Picks up RenderContext for the rebuild, PersistContext for
// the save, plus the local `buildElementNode` verb.
export type BuildTabsBodyContext = RenderContext &
  PersistContext &
  Pick<EditorContext, 'buildElementNode'>;

export type BuildFlowContainerBodyContext = Pick<EditorContext, 'buildHostedElementNode'>;

export type BuildRichMotionBodyContext = Pick<EditorContext, never>;

// ADR 0064 — buildElementBody is the per-type dispatcher; its parameter
// surface is the union of every per-builder narrow context plus the five
// primitive contexts re-exported from body-builders-basic.ts. The wiring
// in index.ts hands the wide `EditorContext` here, which satisfies the
// union; downstream code that calls `ctx.buildElementBody(...)` does so
// through the wide EditorContext field, so this alias narrows the
// declared surface without forcing any forward-cast.
export type BuildElementBodyContext = BuildTextBodyContext &
  BuildMediaBodyContext &
  BuildActionBodyContext &
  BuildShapeBodyContext &
  BuildContainerBodyContext &
  BuildChartBodyContext &
  BuildFormBodyContext &
  BuildEmbedBodyContext &
  BuildCodeBodyContext &
  BuildAccordionBodyContext &
  BuildCarouselBodyContext &
  BuildTableBodyContext &
  BuildNavBodyContext &
  BuildCollectionBodyContext &
  BuildTabsBodyContext &
  BuildFlowContainerBodyContext &
  BuildRichMotionBodyContext;

// -- Chart editor preview ----------------------------------------------
//
// The editor preview renders an inline approximation of the server SVG
// so the Owner sees colour bands + a kind hint while typing into the
// data grid. The visitor-facing render is the canonical server SVG
// (see src/canvas/elements/chart.ts) — this preview deliberately uses
// the SAME palette algorithm by reading the kit accent off the editor
// wrapper's --opencanvas-kit-accent token, so the editor swatch order
// matches what the server emits. No client-side chart library: ~80 lines
// of plain DOM + a fixed-format colour-rotation.

function currentChartPalette(ctx: BuildChartBodyContext): string[] {
  if (!ctx.mainEl) return ['#888', '#888', '#888', '#888', '#888'];
  const cs = window.getComputedStyle(ctx.mainEl);
  const accent = (cs.getPropertyValue('--opencanvas-kit-accent') || '').trim();
  return previewPaletteFromAccent(accent || '#888888');
}

export function buildChartBodyImpl(ctx: BuildChartBodyContext, element: ChartElement): HTMLElement {
  const node = document.createElement('div');
  node.className = 'opencanvas-chart-preview';
  node.style.width = '100%';
  node.style.height = '100%';
  node.style.position = 'relative';
  node.style.overflow = 'hidden';
  node.style.borderRadius = '4px';
  node.style.background = 'rgba(0, 0, 0, 0.04)';
  const palette = currentChartPalette(ctx);
  const series = Array.isArray(element.series) ? element.series : [];
  const categories = Array.isArray(element.categories) ? element.categories : [];
  if (series.length === 0 || categories.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'Chart (' + (element.kind || 'bar') + ') — add data';
    empty.style.position = 'absolute';
    empty.style.inset = '0';
    empty.style.display = 'flex';
    empty.style.alignItems = 'center';
    empty.style.justifyContent = 'center';
    empty.style.fontSize = '12px';
    empty.style.opacity = '0.7';
    node.appendChild(empty);
    return node;
  }
  if (element.kind === 'pie' || element.kind === 'donut') {
    const firstSeries = series[0];
    const values =
      firstSeries && Array.isArray(firstSeries.values)
        ? firstSeries.values.slice(0, categories.length)
        : [];
    let total = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (typeof v === 'number' && isFinite(v) && v > 0) total += v;
    }
    if (total <= 0) {
      node.textContent = 'Pie has no data';
      node.style.display = 'flex';
      node.style.alignItems = 'center';
      node.style.justifyContent = 'center';
      node.style.fontSize = '12px';
      return node;
    }
    // CSS conic-gradient gives us a tooltip-free pie preview with zero math.
    const stops: string[] = [];
    let cursor = 0;
    for (let i = 0; i < values.length; i++) {
      const raw = values[i];
      const v = typeof raw === 'number' && isFinite(raw) && raw > 0 ? raw : 0;
      const start = cursor;
      const end = cursor + (v / total) * 100;
      const color = palette[i % palette.length] ?? '#888';
      stops.push(color + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%');
      cursor = end;
    }
    const disc = document.createElement('div');
    disc.style.position = 'absolute';
    disc.style.inset = '8px';
    disc.style.borderRadius = '50%';
    disc.style.background = 'conic-gradient(' + stops.join(', ') + ')';
    if (element.kind === 'donut') {
      disc.style.maskImage = 'radial-gradient(circle, transparent 28%, black 29%)';
      (disc.style as unknown as { webkitMaskImage: string }).webkitMaskImage =
        'radial-gradient(circle, transparent 28%, black 29%)';
    }
    node.appendChild(disc);
    return node;
  }
  // bar / line / area share a stacked band preview. Compute per-series
  // max so legends line up; render N rows where each row is the per-
  // category values as proportional cells.
  const rowHost = document.createElement('div');
  rowHost.style.position = 'absolute';
  rowHost.style.inset = '8px';
  rowHost.style.display = 'flex';
  rowHost.style.flexDirection = 'column';
  rowHost.style.gap = '4px';
  for (let si = 0; si < series.length; si++) {
    const seriesEntry = series[si];
    if (!seriesEntry) continue;
    const row = document.createElement('div');
    row.style.flex = '1';
    row.style.display = 'flex';
    row.style.gap = '2px';
    const values = Array.isArray(seriesEntry.values) ? seriesEntry.values : [];
    let maxVal = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (typeof v === 'number' && isFinite(v) && v > maxVal) maxVal = v;
    }
    const color = palette[si % palette.length] ?? '#888';
    for (let ci = 0; ci < categories.length; ci++) {
      const cell = document.createElement('div');
      cell.style.flex = '1';
      cell.style.background = color;
      const v = values[ci];
      const ratio =
        typeof v === 'number' && isFinite(v) && maxVal > 0 ? Math.max(0.05, v / maxVal) : 0.05;
      cell.style.opacity = String(ratio);
      cell.title =
        (seriesEntry.label || 'Series ' + (si + 1)) +
        ' / ' +
        (categories[ci] || 'Cat ' + (ci + 1)) +
        ': ' +
        (typeof v === 'number' ? v : '—');
      row.appendChild(cell);
    }
    rowHost.appendChild(row);
  }
  node.appendChild(rowHost);
  return node;
}

export function buildFormBodyImpl(_ctx: BuildFormBodyContext, element: FormElement): HTMLElement {
  const node = document.createElement('form');
  node.className = 'opencanvas-form-preview';
  // ADR 0066 — reflect the chosen variant (+ pointer-fx primitive) on the
  // editor preview node so it mirrors the published DOM contract; the runtime
  // mirror (hydrate-interactives.ts) and any editor variant CSS key off it.
  {
    const variant = element.variant ?? 'classic';
    node.setAttribute('data-variant', variant);
    const pfx = formPointerFx(variant);
    if (pfx !== null) {
      node.setAttribute('data-opencanvas-pointer-fx', pfx);
      node.setAttribute('data-opencanvas-pointer-fx-reduced-motion', 'allow');
    }
  }
  node.style.display = 'flex';
  node.style.flexDirection = 'column';
  node.style.gap = '8px';
  node.style.width = '100%';
  node.style.height = '100%';
  node.addEventListener('submit', function (ev: Event) {
    ev.preventDefault();
  });
  const fields = Array.isArray(element.fields) ? element.fields : [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.flexDirection = 'column';
    label.style.gap = '4px';
    label.style.fontSize = '12px';
    label.textContent = field.label || field.id || 'Field';
    const input: HTMLInputElement | HTMLTextAreaElement =
      field.kind === 'textarea'
        ? document.createElement('textarea')
        : document.createElement('input');
    if (field.kind && field.kind !== 'textarea' && input instanceof HTMLInputElement) {
      input.setAttribute(
        'type',
        field.kind === 'email' ? 'email' : field.kind === 'checkbox' ? 'checkbox' : 'text',
      );
    }
    input.disabled = true;
    input.placeholder = field.placeholder || '';
    input.style.boxSizing = 'border-box';
    input.style.width = '100%';
    label.appendChild(input);
    node.appendChild(label);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = element.submitLabel || 'Submit';
  node.appendChild(button);
  return node;
}

export function buildEmbedBodyImpl(
  _ctx: BuildEmbedBodyContext,
  element: EmbedElement,
): HTMLElement {
  const node = document.createElement('div');
  node.className = 'opencanvas-embed-preview';
  node.style.display = 'flex';
  node.style.alignItems = 'center';
  node.style.justifyContent = 'center';
  node.style.width = '100%';
  node.style.height = '100%';
  node.style.padding = '12px';
  node.style.boxSizing = 'border-box';
  node.style.textAlign = 'center';
  node.textContent = element.title || element.url || 'Embed';
  return node;
}

export function buildCodeBodyImpl(_ctx: BuildCodeBodyContext, element: CodeElement): HTMLElement {
  const pre = document.createElement('pre');
  pre.className = 'opencanvas-code-preview';
  pre.style.margin = '0';
  pre.style.width = '100%';
  pre.style.height = '100%';
  pre.style.overflow = 'auto';
  pre.style.boxSizing = 'border-box';
  pre.style.padding = '12px';
  pre.textContent = element.source || '';
  return pre;
}

export function buildAccordionBodyImpl(
  _ctx: BuildAccordionBodyContext,
  element: AccordionElement,
): HTMLElement {
  const node = document.createElement('div');
  node.className = 'opencanvas-accordion-preview';
  node.setAttribute('data-variant', element.variant ?? 'list'); // ADR 0066
  const items = Array.isArray(element.items) ? element.items : [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const details = document.createElement('details');
    if (i === 0) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = item.title || 'Item';
    details.appendChild(summary);
    const body = document.createElement('div');
    const runs = Array.isArray(item.body) ? item.body : [];
    body.textContent = runs
      .map(function (run) {
        return run && typeof run.text === 'string' ? run.text : '';
      })
      .join('');
    details.appendChild(body);
    node.appendChild(details);
  }
  return node;
}

// Build the editor preview as the SAME DOM the visitor sees. Hydration
// (arrow + dot click listeners) is wired by `hydrateInteractives()` from
// `./hydrate-interactives.ts`, called once per renderAll. Keeping the
// hydration OUT of the builder lets a single source-of-truth runtime own
// the click contract for both the editor and the visitor, and removes the
// drift trap of two slightly-different local hydrators (the inline
// `hydrateCarouselPreview` that used to live here had stopPropagation but
// no `data-opencanvas-hydrated` flag, leaving the wrapper detectably
// different from a published page).
//
// `pointer-events: auto` is set inline on the arrows + dots so they
// receive clicks even when the carousel is NOT selected — the editor's
// click-shield CSS (`styles-build.ts:1843-1848`) sets `pointer-events:
// none` on every descendant of an unselected carousel so a click anywhere
// on the body selects the element. Inline styles outrank the `*` selector,
// so the arrows + dots stay clickable while the rest of the body still
// routes to selection.
export function buildCarouselBodyImpl(
  ctx: BuildCarouselBodyContext,
  element: CarouselElement,
): HTMLElement {
  const slides = Array.isArray(element.slides) ? element.slides : [];
  const count = slides.length;
  const direction = element.direction === 'vertical' ? 'vertical' : 'horizontal';
  const arrowPosition =
    element.arrowPosition === 'bunched-bottom-right' || element.arrowPosition === 'split-below'
      ? element.arrowPosition
      : 'split-vertical-center';
  const arrowStyle =
    element.arrowStyle === 'square' || element.arrowStyle === 'pill' ? element.arrowStyle : 'round';
  const mode = element.mode === 'scroll-snap' ? 'scroll-snap' : 'paginate';
  const isScrollSnap = mode === 'scroll-snap';

  const wrap = document.createElement('div');
  wrap.className = 'opencanvas-carousel';
  wrap.setAttribute('data-opencanvas-interactive', 'carousel');
  wrap.setAttribute('data-opencanvas-slide-index', '0');
  wrap.setAttribute('data-opencanvas-slide-count', String(count));
  wrap.setAttribute('data-opencanvas-direction', direction);
  wrap.setAttribute('data-opencanvas-arrow-position', arrowPosition);
  wrap.setAttribute('data-opencanvas-arrow-style', arrowStyle);
  // Mode mirrors the visitor renderer (`src/canvas/elements/carousel.ts`);
  // without it the visitor CSS (which selects on the attribute) would
  // disagree with the editor preview for scroll-snap carousels.
  wrap.setAttribute('data-opencanvas-carousel-mode', mode);
  wrap.setAttribute('data-variant', element.variant ?? 'classic'); // ADR 0066
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-roledescription', 'carousel');

  const track = document.createElement('div');
  track.className = 'opencanvas-carousel-track';
  wrap.appendChild(track);

  for (let i = 0; i < count; i++) {
    const slide = slides[i];
    if (!slide) continue;
    const fig = document.createElement('figure');
    fig.className = 'opencanvas-carousel-slide';
    fig.setAttribute('data-opencanvas-carousel-slide', slide.id || 'slide-' + String(i));
    fig.setAttribute('data-opencanvas-carousel-slide-index', String(i));
    fig.setAttribute('role', 'group');
    fig.setAttribute('aria-roledescription', 'slide');
    fig.setAttribute('aria-label', String(i + 1) + ' of ' + String(count));
    if (slide.assetId) {
      const img = document.createElement('img');
      img.className = 'opencanvas-carousel-image';
      img.src = ctx.siteBase + '/assets/' + encodeURIComponent(slide.assetId);
      img.alt = slide.caption || '';
      img.loading = 'lazy';
      fig.appendChild(img);
    }
    if (typeof slide.caption === 'string' && slide.caption.length > 0) {
      const cap = document.createElement('figcaption');
      cap.className = 'opencanvas-carousel-caption';
      cap.textContent = slide.caption;
      fig.appendChild(cap);
    }
    track.appendChild(fig);
  }

  // Arrows + dots are suppressed in scroll-snap mode to mirror the visitor
  // renderer (`src/canvas/elements/carousel.ts`).
  if (element.showArrows !== false && count > 1 && !isScrollSnap) {
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'opencanvas-carousel-arrow opencanvas-carousel-arrow-prev';
    prev.setAttribute('data-opencanvas-carousel-prev', '');
    prev.setAttribute('aria-label', 'Previous slide');
    prev.textContent = direction === 'vertical' ? '⌃' : '‹';
    // Inline pointer-events overrides the editor's unselected-carousel
    // click-shield CSS so the arrow stays clickable without first selecting.
    prev.style.pointerEvents = 'auto';
    wrap.appendChild(prev);
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'opencanvas-carousel-arrow opencanvas-carousel-arrow-next';
    next.setAttribute('data-opencanvas-carousel-next', '');
    next.setAttribute('aria-label', 'Next slide');
    next.textContent = direction === 'vertical' ? '⌄' : '›';
    next.style.pointerEvents = 'auto';
    wrap.appendChild(next);
  }

  if (element.showDots !== false && count > 1 && !isScrollSnap) {
    const dots = document.createElement('div');
    dots.className = 'opencanvas-carousel-dots';
    dots.setAttribute('role', 'tablist');
    dots.setAttribute('aria-label', 'Slide navigation');
    // Container also gets pointer-events:auto so clicks on the dot wrapper
    // (between dots) don't fall through to the wrapper's click-shield.
    dots.style.pointerEvents = 'auto';
    for (let i = 0; i < count; i++) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'opencanvas-carousel-dot';
      dot.setAttribute('data-opencanvas-carousel-dot', String(i));
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      dot.setAttribute('aria-label', 'Go to slide ' + String(i + 1));
      dot.style.pointerEvents = 'auto';
      dots.appendChild(dot);
    }
    wrap.appendChild(dots);
  }

  return wrap;
}

export function buildTableBodyImpl(
  _ctx: BuildTableBodyContext,
  element: TableElement,
): HTMLElement {
  const table = document.createElement('table');
  table.className = 'opencanvas-table-preview';
  table.style.width = '100%';
  table.style.height = '100%';
  table.style.borderCollapse = 'collapse';
  const columns = Array.isArray(element.columns) ? element.columns : [];
  const rows = Array.isArray(element.rows) ? element.rows : [];
  if (columns.length > 0) {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (!col) continue;
      const th = document.createElement('th');
      th.textContent = col.header || col.id || '';
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
  }
  const tbody = document.createElement('tbody');
  for (let r = 0; r < rows.length; r++) {
    const tr = document.createElement('tr');
    const row = rows[r];
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      if (!col) continue;
      const td = document.createElement('td');
      const key = col.id;
      const cells = row && row.cells ? row.cells : {};
      const cellValue = key ? cells[key] : undefined;
      td.textContent = key ? String(cellValue ?? '') : '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// Build one <a> for a NavLink-shaped link, with the editor's click handler
// (preventDefault + route through ctx.goToHrefOnCanvas for internal hops,
// window.open for external, no-op for anchor). Used for both nav-bar links
// and the primary-action CTA so the click semantics stay identical.
function buildNavLinkAnchor(
  ctx: BuildNavLinkAnchorContext,
  link: { label: string; href: string; kind: string },
  className: string,
): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = className;
  const kind = link.kind === 'external' || link.kind === 'anchor' ? link.kind : 'internal';
  a.setAttribute('data-opencanvas-nav-link-kind', kind);
  let resolvedHref = typeof link.href === 'string' ? link.href : '';
  if (kind === 'internal' && resolvedHref.length > 0 && resolvedHref.charAt(0) !== '/') {
    resolvedHref = '/' + resolvedHref;
  }
  a.setAttribute('href', resolvedHref.length > 0 ? resolvedHref : '#');
  if (kind === 'external') {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  }
  a.textContent = link.label || 'Link';
  const capturedHref = resolvedHref;
  const capturedKind = kind;
  a.addEventListener('click', function (ev: MouseEvent) {
    ev.preventDefault();
    if (ev.altKey) return;
    if (capturedKind === 'internal') {
      ctx.goToHrefOnCanvas(capturedHref);
      return;
    }
    if (capturedKind === 'external') {
      if (isAllowedHref(capturedHref)) {
        window.open(capturedHref, '_blank', 'noopener,noreferrer');
      }
      return;
    }
  });
  return a;
}

export function buildNavBodyImpl(ctx: BuildNavBodyContext, element: NavElement): HTMLElement {
  // Mirrors src/canvas/elements/nav.ts renderNav exactly so kit CSS selectors
  // matching .opencanvas-nav[data-opencanvas-nav-layout] and the slot rules
  // in editor styles fire on the editor preview the same way they fire on the
  // published page. The prior implementation emitted .opencanvas-nav-preview
  // with no slot structure, which is why layout / siteTitle / primaryAction /
  // logo changes never reflected live in the editor.
  const nav = document.createElement('nav');
  nav.className = 'opencanvas-nav';
  const layout = element.layout === 'left-right' ? 'left-right' : 'left-center-right';
  nav.setAttribute('data-opencanvas-nav-layout', layout);
  nav.setAttribute('data-opencanvas-nav-sticky', element.sticky ? 'true' : 'false');
  nav.style.position = 'relative';
  nav.style.width = '100%';
  nav.style.height = '100%';
  nav.style.display = 'flex';
  nav.style.alignItems = 'center';

  const leftSlot = document.createElement('div');
  leftSlot.className = 'opencanvas-nav-slot';
  leftSlot.setAttribute('data-slot', 'left');
  if (typeof element.logoAssetId === 'string' && element.logoAssetId.length > 0) {
    const logo = document.createElement('img');
    logo.className = 'opencanvas-nav-logo';
    logo.src = ctx.siteBase + '/assets/' + encodeURIComponent(element.logoAssetId);
    logo.alt = '';
    leftSlot.appendChild(logo);
  }
  if (typeof element.siteTitle === 'string' && element.siteTitle.length > 0) {
    const title = document.createElement('span');
    title.className = 'opencanvas-nav-site-title';
    title.textContent = element.siteTitle;
    leftSlot.appendChild(title);
  }
  nav.appendChild(leftSlot);

  const linksSlotName = layout === 'left-right' ? 'right' : 'center';
  const linksSlot = document.createElement('div');
  linksSlot.className = 'opencanvas-nav-slot';
  linksSlot.setAttribute('data-slot', linksSlotName);
  const links = Array.isArray(element.links) ? element.links : [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (!link) continue;
    linksSlot.appendChild(buildNavLinkAnchor(ctx, link, 'opencanvas-nav-link'));
  }
  nav.appendChild(linksSlot);

  if (element.primaryAction !== undefined && element.primaryAction !== null) {
    const primarySlot = document.createElement('div');
    primarySlot.className = 'opencanvas-nav-slot';
    primarySlot.setAttribute('data-slot', 'primary');
    primarySlot.appendChild(
      buildNavLinkAnchor(ctx, element.primaryAction, 'opencanvas-nav-primary-action'),
    );
    nav.appendChild(primarySlot);
  }

  return nav;
}

export function buildCollectionBodyImpl(
  ctx: BuildCollectionBodyContext,
  element: CollectionElement,
): HTMLElement {
  // ADR 0065 D5 — when this Collection's custom template is in edit mode,
  // render ONE editable instance of `element.customTemplate` instead of the
  // N-clone entries grid. The template elements carry their own absolute
  // boxes (per-card-frame coordinates), so the editor-only template-instance
  // wrapper anchors them with relative positioning, mirroring the per-entry
  // card cell shape buildCollectionBodyImpl already uses below. The wrapper
  // gets `data-collection-template-instance` so the chrome augmenter
  // (collection-template-edit-view.ts) can target it for the scrim cutout
  // and pan helper.
  //
  // Codex review pass 4 finding 1 — the edit-mode precondition fuses THREE
  // signals: the pin targets this Collection, AND the Collection is still
  // a Custom display, AND `customTemplate` is a present array (any length).
  // editingCollectionTemplate is UI-only (D6) so it is not in the undo stack;
  // a Ctrl+Z that reverts the atomic first-switch (display + customTemplate)
  // leaves the pin stale — `display` reverts to 'card' so the predicate
  // falls through to the normal grid renderer below.
  //
  // Codex review pass 7 finding 1 — empty array is a VALID authored state.
  // When the Owner deliberately deletes every template child to start
  // fresh, `display` stays 'custom' and `customTemplate` becomes `[]`.
  // The Owner must still be able to author into the empty surface; the
  // earlier `length > 0` guard over-corrected by falling through to the
  // entries grid in this state, locking the Owner out of edit mode with
  // no way back. `Array.isArray()` alone separates "valid edit-mode
  // state" (present array — empty or not) from "pre-seed" (undefined).
  // Undefined cannot happen at this point because the enter verb seeds
  // atomically before pinning, but defend anyway: undefined falls through
  // to the grid renderer so a half-applied state never mounts an
  // unanchored edit frame.
  const isEditingThis =
    ctx.editingCollectionTemplate !== null &&
    ctx.editingCollectionTemplate.collectionId === element.id &&
    element.display === 'custom' &&
    Array.isArray(element.customTemplate);
  if (isEditingThis) {
    const node = document.createElement('div');
    node.className = 'opencanvas-collection-template-edit';
    node.setAttribute('data-collection-template-instance', element.id);
    node.setAttribute('data-editor-only', 'true');
    node.style.position = 'relative';
    node.style.width = '100%';
    node.style.height = '100%';
    node.style.boxSizing = 'border-box';
    const tpl = Array.isArray(element.customTemplate) ? element.customTemplate : [];
    for (let i = 0; i < tpl.length; i++) {
      const child = tpl[i];
      if (child !== undefined) node.appendChild(ctx.buildElementNode(child));
    }
    // Codex review pass 7 finding 1 — empty template hint. When the
    // authored array is `[]`, the frame above renders zero children and
    // would otherwise look like a blank rectangle. An editor-only hint
    // surfaces the affordance ("drop elements here") so the Owner has a
    // visible target to author into. `data-editor-only="true"` keeps it
    // out of any publish-path source-guard sweep.
    if (tpl.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'opencanvas-collection-template-empty-hint';
      hint.setAttribute('data-editor-only', 'true');
      hint.style.position = 'absolute';
      hint.style.left = '0';
      hint.style.right = '0';
      hint.style.top = '0';
      hint.style.bottom = '0';
      hint.style.display = 'flex';
      hint.style.alignItems = 'center';
      hint.style.justifyContent = 'center';
      hint.style.padding = '16px';
      hint.style.textAlign = 'center';
      hint.style.color = 'var(--ink-3, #888)';
      hint.style.fontSize = '13px';
      hint.style.pointerEvents = 'none';
      hint.textContent = 'Drop elements here to build your card.';
      node.appendChild(hint);
    }
    return node;
  }
  const rawEntries = element.entries;
  const entriesKnown = Array.isArray(rawEntries);
  const entries = entriesKnown ? rawEntries : [];
  if (entries.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'opencanvas-collection-preview opencanvas-collection-empty';
    placeholder.style.width = '100%';
    placeholder.style.height = '100%';
    placeholder.style.boxSizing = 'border-box';
    placeholder.style.border = '1px dashed var(--line-2, #d4d4d4)';
    placeholder.style.background = 'var(--surface-2, #f5f5f5)';
    placeholder.style.display = 'flex';
    placeholder.style.flexDirection = 'column';
    placeholder.style.alignItems = 'center';
    placeholder.style.justifyContent = 'center';
    placeholder.style.gap = '6px';
    placeholder.style.padding = '16px';
    placeholder.style.textAlign = 'center';
    placeholder.style.color = 'var(--ink-3, #888)';
    placeholder.style.fontSize = '13px';
    const headline = document.createElement('div');
    headline.style.fontWeight = '600';
    headline.style.color = 'var(--ink-2, #555)';
    const sourceSlug =
      typeof element.collectionSlug === 'string' && element.collectionSlug.length > 0
        ? element.collectionSlug
        : null;
    if (sourceSlug === null) {
      headline.textContent = 'Collection preview';
    } else if (!entriesKnown) {
      headline.textContent = 'Collection preview - ' + sourceSlug;
    } else {
      headline.textContent = 'Collection grid - 0 entries';
    }
    placeholder.appendChild(headline);
    const hint = document.createElement('div');
    if (sourceSlug === null) {
      hint.textContent = 'Pick a source to bind this collection.';
    } else if (!entriesKnown) {
      hint.textContent =
        'Use the inspector for the live entry count; publish to populate this preview.';
    } else {
      hint.textContent =
        'No entries matched this source/folder. Add entries from the dashboard, then publish.';
    }
    placeholder.appendChild(hint);
    return placeholder;
  }
  const node = document.createElement('div');
  node.className = 'opencanvas-collection-preview';
  node.style.display = 'grid';
  node.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  node.style.gap = '8px';
  for (let i = 0; i < entries.length; i++) {
    const raw = entries[i];
    const entry: CanvasElement[] = Array.isArray(raw) ? raw : [];
    const card = document.createElement('div');
    card.style.position = 'relative';
    card.style.minHeight = '80px';
    for (let j = 0; j < entry.length; j++) {
      const child = entry[j];
      if (child !== undefined) card.appendChild(ctx.buildElementNode(child));
    }
    node.appendChild(card);
  }
  return node;
}

export function buildTabsBodyImpl(ctx: BuildTabsBodyContext, element: TabsElement): HTMLElement {
  const node = document.createElement('div');
  node.className = 'opencanvas-tabs';
  node.setAttribute('data-variant', element.variant ?? 'classic'); // ADR 0066
  node.style.position = 'relative';
  node.style.width = '100%';
  node.style.height = '100%';

  const tabs = Array.isArray(element.tabs) ? element.tabs : [];
  const barHeight = typeof element.tabBarHeight === 'number' ? element.tabBarHeight : 56;

  const bar = document.createElement('div');
  bar.className = 'opencanvas-tab-bar';
  bar.style.position = 'absolute';
  bar.style.left = '0';
  bar.style.top = '0';
  bar.style.width = '100%';
  bar.style.height = barHeight + 'px';
  bar.style.display = 'flex';
  bar.style.alignItems = 'center';
  bar.style.gap = '8px';

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (!tab) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'opencanvas-tab';
    // data-opencanvas-tab-id mirrors the server renderer and is the
    // selector the canvas mousedown handler keys off to skip
    // selection/drag for clicks that target a tab button.
    btn.setAttribute('data-opencanvas-tab-id', tab.id);
    let labelText = '';
    const runs = Array.isArray(tab.label) ? tab.label : [];
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      labelText += (run && run.text) || '';
    }
    btn.textContent = labelText || tab.id || 'Tab';
    if (tab.id === element.activeTabId) btn.setAttribute('data-tab-active', '');
    // stopPropagation on mousedown so the canvas root listener doesn't
    // resolve the parent tabs wrapper and start a selection/drag — that
    // pipeline jitters the wrapper position and steals focus before the
    // button's click handler ever runs.
    btn.addEventListener('mousedown', function (ev: Event) {
      ev.stopPropagation();
    });
    (function (tabId: string) {
      btn.addEventListener('click', function (ev: Event) {
        ev.stopPropagation();
        if (element.activeTabId === tabId) return;
        element.activeTabId = tabId;
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
    })(tab.id);
    bar.appendChild(btn);
  }
  node.appendChild(bar);

  const activeTab = tabs.find(function (t) {
    return t && t.id === element.activeTabId;
  });
  if (activeTab) {
    const panel = document.createElement('div');
    panel.className = 'opencanvas-tab-panel';
    panel.setAttribute('data-tab-active', '');
    panel.style.position = 'absolute';
    panel.style.left = '0';
    panel.style.top = barHeight + 'px';
    panel.style.right = '0';
    panel.style.bottom = '0';
    const children = Array.isArray(activeTab.elements) ? activeTab.elements : [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child !== undefined) panel.appendChild(ctx.buildElementNode(child));
    }
    node.appendChild(panel);
  }

  return node;
}

function flowAlignToCss(value: FlowAlign): string {
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
}

function flowJustifyToCss(value: FlowJustify): string {
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
}

function applyFlowLayoutStyle(node: HTMLElement, layout: FlowLayout): void {
  node.style.boxSizing = 'border-box';
  node.style.width = '100%';
  node.style.height = '100%';
  node.style.gap = String(layout.gap.row) + 'px ' + String(layout.gap.column) + 'px';
  node.style.padding =
    String(layout.padding.top) +
    'px ' +
    String(layout.padding.right) +
    'px ' +
    String(layout.padding.bottom) +
    'px ' +
    String(layout.padding.left) +
    'px';
  node.style.overflow = 'hidden';
  if (layout.mode === 'grid') {
    node.style.display = 'grid';
    node.style.gridTemplateColumns = 'repeat(' + String(layout.columns ?? 1) + ', minmax(0, 1fr))';
    node.style.alignItems = flowAlignToCss(layout.align);
    node.style.justifyContent = flowJustifyToCss(layout.justify);
    return;
  }
  node.style.display = 'flex';
  node.style.flexDirection = layout.mode === 'stack' ? 'column' : 'row';
  node.style.alignItems = flowAlignToCss(layout.align);
  node.style.justifyContent = flowJustifyToCss(layout.justify);
  if (layout.mode === 'row') {
    node.style.flexWrap = layout.wrap === true ? 'wrap' : 'nowrap';
  }
}

function buildFlowItemNode(
  ctx: BuildFlowContainerBodyContext,
  item: FlowItem,
  layout: FlowLayout,
): HTMLElement {
  const node = document.createElement('div');
  node.className = 'opencanvas-flow-item';
  node.setAttribute('data-opencanvas-flow-item', item.id);
  node.style.position = 'relative';
  node.style.minWidth = '0';
  node.style.minHeight = '0';
  if (layout.mode === 'grid' && item.span !== undefined) {
    node.style.gridColumn = 'span ' + String(item.span);
  }
  if (item.align !== undefined) {
    node.style.alignSelf = flowAlignToCss(item.align);
  }
  node.appendChild(ctx.buildHostedElementNode(item.element));
  return node;
}

export function buildFlowContainerBodyImpl(
  ctx: BuildFlowContainerBodyContext,
  element: FlowContainerElement,
): HTMLElement {
  const node = document.createElement('div');
  node.className = 'opencanvas-flow-container';
  node.setAttribute('data-opencanvas-flow-container', element.id);
  node.setAttribute('data-flow-layout-mode', element.layout.mode);
  applyFlowLayoutStyle(node, element.layout);
  const items = Array.isArray(element.items) ? element.items : [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item !== undefined) node.appendChild(buildFlowItemNode(ctx, item, element.layout));
  }
  return node;
}

export function buildRichMotionBodyImpl(
  _ctx: BuildRichMotionBodyContext,
  element: RichMotionElement,
): HTMLElement {
  const node = document.createElement('div');
  node.className = 'opencanvas-rich-motion';
  node.setAttribute('data-opencanvas-rich-motion-editor', element.id);
  node.setAttribute('data-rich-motion-asset-ref', element.assetRefId);
  node.setAttribute('data-rich-motion-fit', element.fit);
  node.setAttribute('aria-label', element.label);
  node.style.width = '100%';
  node.style.height = '100%';
  node.style.display = 'block';

  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-opencanvas-rich-motion-canvas', element.id);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  node.appendChild(canvas);

  return node;
}

export function buildElementBodyImpl(
  ctx: BuildElementBodyContext,
  element: CanvasElement,
): HTMLElement {
  switch (element.type) {
    case 'text':
      return buildTextBodyImpl(ctx, element);
    case 'media':
      return buildMediaBodyImpl(ctx, element);
    case 'rich-motion':
      return buildRichMotionBodyImpl(ctx, element);
    case 'action':
      return buildActionBodyImpl(ctx, element);
    case 'shape':
      return buildShapeBodyImpl(ctx, element);
    case 'container':
      return buildContainerBodyImpl(ctx, element);
    case 'chart':
      return buildChartBodyImpl(ctx, element);
    case 'form':
      return buildFormBodyImpl(ctx, element);
    case 'embed':
      return buildEmbedBodyImpl(ctx, element);
    case 'code':
      return buildCodeBodyImpl(ctx, element);
    case 'accordion':
      return buildAccordionBodyImpl(ctx, element);
    case 'carousel':
      return buildCarouselBodyImpl(ctx, element);
    case 'table':
      return buildTableBodyImpl(ctx, element);
    case 'nav':
      return buildNavBodyImpl(ctx, element);
    case 'collection':
      return buildCollectionBodyImpl(ctx, element);
    case 'tabs':
      return buildTabsBodyImpl(ctx, element);
    case 'flow-container':
      return buildFlowContainerBodyImpl(ctx, element);
  }
  // Exhaustive switch above — TypeScript proves this is unreachable.
  // Throw loudly anyway so a hand-rolled element type added without a
  // builder doesn't silently degrade to a blank wrapper.
  const exhaustive: never = element;
  throw new Error(
    'unsupported editor element type: ' + String((exhaustive as { type: string }).type),
  );
}
