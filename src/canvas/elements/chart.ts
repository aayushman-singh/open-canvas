// src/canvas/elements/chart.ts
//
// Chart Element. Server-rendered SVG charts (bar / line / area / pie / donut)
// with palette derived from the active Style Kit's accent. No client-side JS;
// visitors see a static SVG that scales to the element box via `viewBox` +
// `preserveAspectRatio="xMidYMid meet"`.
//
// The five chart-kind renderers live under `src/charts/`. All math is pure
// (no DOM, no I/O).

import type { InspectorSpec } from './inspector-spec.js';
import type { BaseElement } from '../schema.js';
import { renderAreaChartBody } from '../../charts/area.js';
import { renderBarChartBody } from '../../charts/bar.js';
import { buildChartPalette } from '../../charts/colors.js';
import { renderDonutChartBody } from '../../charts/donut.js';
import { renderLineChartBody } from '../../charts/line.js';
import { renderPieChartBody } from '../../charts/pie.js';
import { escapeAttr } from './render-utils.js';

export const CHART_KINDS = ['bar', 'line', 'pie', 'donut', 'area'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export interface ChartSeries {
  label: string;
  values: number[];
}

export interface ChartElement extends BaseElement {
  type: 'chart';
  kind: ChartKind;
  series: ChartSeries[];
  /** X-axis labels (bar/line/area) or slice labels (pie/donut). */
  categories: string[];
  xAxisTitle?: string;
  yAxisTitle?: string;
  showLegend: boolean;
}

export interface ChartRenderCtx {
  styleKit: string;
  customAccent?: string | null;
}

/**
 * Render a chart element as a single `<svg>` block. The SVG viewBox matches
 * the element's positioned box; `preserveAspectRatio="xMidYMid meet"` lets
 * the wrapping `<div>` (set up by the public renderer with `width: box.w`
 * and `height: box.h`) scale the chart cleanly. The chart body is purely
 * declarative — there is no embedded `<script>` and no client-side runtime.
 */
export function renderChart(el: ChartElement, ctx: ChartRenderCtx): string {
  // Width / height come straight from the canonical positioned box; the
  // public-renderer wrapper already pins the outer <div> to those dims via
  // inline style. The SVG keeps its own viewBox so it scales when the wrapper
  // is resized at any breakpoint.
  const width = Math.max(0, el.box.w);
  const height = Math.max(0, el.box.h);
  const palette = buildChartPalette(ctx.styleKit, { customAccent: ctx.customAccent ?? null });
  let body: string;
  switch (el.kind) {
    case 'bar':
      body = renderBarChartBody(el, palette, width, height);
      break;
    case 'line':
      body = renderLineChartBody(el, palette, width, height);
      break;
    case 'pie':
      body = renderPieChartBody(el, palette, width, height);
      break;
    case 'donut':
      body = renderDonutChartBody(el, palette, width, height);
      break;
    case 'area':
      body = renderAreaChartBody(el, palette, width, height);
      break;
    default: {
      const exhaustive: never = el.kind;
      throw new Error(`renderChart: unhandled ChartKind ${JSON.stringify(exhaustive)}`);
    }
  }
  // `role="img"` + a synthesised aria-label so assistive tech reads "bar
  // chart, 3 series across 4 categories" rather than diving into the inner
  // <rect>s. The legend toggle / per-slice <title> elements still provide
  // detail to anyone that wants it.
  const seriesSummary = el.series.length === 0 ? 'no data' : `${String(el.series.length)} series`;
  const categorySummary = el.categories.length === 0 ? '' : `, ${String(el.categories.length)} categories`;
  const ariaLabel = `${el.kind} chart, ${seriesSummary}${categorySummary}`;
  return `<svg class="rev01-chart" data-chart-kind="${escapeAttr(el.kind)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" role="img" aria-label="${escapeAttr(ariaLabel)}">${body}</svg>`;
}

export const CHART_RECIPE_ID = 'chart-card' as const;

export const chartInspectorSpec: InspectorSpec = {
  fields: [
    { kind: 'select', label: 'Chart kind', path: 'kind', options: CHART_KINDS },
    {
      kind: 'text',
      label: 'X-axis title',
      path: 'xAxisTitle',
      placeholder: 'X-axis title (optional)',
      emptyOmits: true,
    },
    {
      kind: 'text',
      label: 'Y-axis title',
      path: 'yAxisTitle',
      placeholder: 'Y-axis title (optional)',
      emptyOmits: true,
    },
    { kind: 'checkbox', label: 'Show legend', path: 'showLegend' },
    // 2D series × categories grid editor with cascading values cleanup when
    // a category is removed. Imperative because the data-grid shape is
    // table-like (same reason as table-grid lives in mount form).
    { kind: 'custom-mount', name: 'chart-data' },
  ],
};
