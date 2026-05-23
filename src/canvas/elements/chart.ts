// src/canvas/elements/chart.ts
//
// Phase 0 stub. `ChartElement` interface + render stub. Wave 2 owner: see
// docs/superpowers/plans/2026-05-23-11-charts.md.

import type { BaseElement } from '../schema.js';

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
}

export function renderChart(el: ChartElement, ctx: ChartRenderCtx): string {
  void el;
  void ctx;
  throw new Error('TODO: implement in Wave 2 — see docs/superpowers/plans/2026-05-23-11-charts.md');
}

export const CHART_RECIPE_ID = 'chart-card' as const;
