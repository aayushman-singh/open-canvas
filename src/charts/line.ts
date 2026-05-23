// src/charts/line.ts
//
// Line chart renderer. One polyline per series, with circle markers at every
// category position. Same axis math as bar/area; the only difference is the
// per-category x-coordinate is the band CENTRE rather than the band's
// leading edge.

import type { ChartElement } from '../canvas/elements/chart.js';
import { escapeAttr } from '../canvas/elements/render-utils.js';
import {
  aggregateDomain,
  computePlotArea,
  legendBaselineY,
  niceTicks,
  renderEmptyStateOverlay,
  renderLegend,
  renderXAxis,
  renderYAxis,
  type AxisConfig,
  type LegendItem,
} from './axes.js';

const MARKER_RADIUS = 3.5;
const STROKE_WIDTH = 2;

export function renderLineChartBody(
  el: ChartElement,
  palette: string[],
  width: number,
  height: number,
): string {
  const cfg: AxisConfig = {
    width,
    height,
    hasXAxisTitle: typeof el.xAxisTitle === 'string' && el.xAxisTitle.length > 0,
    hasYAxisTitle: typeof el.yAxisTitle === 'string' && el.yAxisTitle.length > 0,
    hasLegend: el.showLegend && el.series.length > 0,
  };
  const plot = computePlotArea(cfg);
  const categoryCount = el.categories.length;
  const seriesCount = el.series.length;
  if (categoryCount === 0 || seriesCount === 0 || plot.w <= 0 || plot.h <= 0) {
    return renderEmptyStateOverlay(plot);
  }
  const seriesValues = el.series.map((s) => s.values);
  const domain = aggregateDomain(seriesValues);
  const ticks = niceTicks(domain.min, domain.max, 5);
  const denom = ticks.max - ticks.min;
  // Line chart: one anchor per category, evenly distributed across plot.w.
  // For a single category we centre the only point; otherwise span the
  // category centres edge-to-edge.
  const xForCategory = (i: number): number => {
    if (categoryCount === 1) return plot.x + plot.w / 2;
    const step = plot.w / (categoryCount - 1);
    return plot.x + step * i;
  };
  const bandCenters: number[] = [];
  for (let i = 0; i < categoryCount; i++) bandCenters.push(xForCategory(i));
  const yForValue = (v: number): number => {
    if (denom === 0) return plot.y + plot.h;
    const ratio = (v - ticks.min) / denom;
    return plot.y + plot.h - ratio * plot.h;
  };
  const out: string[] = [];
  out.push(renderYAxis(plot, ticks, el.yAxisTitle));
  // Polylines + markers, series by series.
  for (let si = 0; si < seriesCount; si++) {
    const series = el.series[si]!;
    const color = palette[si % palette.length] ?? '#888';
    // Compute points; skip NaN entries gracefully by treating them as 0.
    const points: string[] = [];
    const markers: string[] = [];
    for (let ci = 0; ci < categoryCount; ci++) {
      const raw = series.values[ci];
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      const x = bandCenters[ci]!;
      const y = yForValue(value);
      points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      markers.push(
        `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${String(MARKER_RADIUS)}" fill="${escapeAttr(color)}" data-series-index="${String(si)}" data-category-index="${String(ci)}"><title>${escapeAttr(series.label)}: ${String(value)}</title></circle>`,
      );
    }
    if (points.length >= 2) {
      out.push(
        `<polyline fill="none" stroke="${escapeAttr(color)}" stroke-width="${String(STROKE_WIDTH)}" stroke-linecap="round" stroke-linejoin="round" points="${points.join(' ')}" data-series-index="${String(si)}"/>`,
      );
    }
    out.push(markers.join(''));
  }
  out.push(renderXAxis(plot, el.categories, bandCenters, el.xAxisTitle));
  if (cfg.hasLegend) {
    const items: LegendItem[] = el.series.map((s, i) => ({
      label: s.label,
      color: palette[i % palette.length] ?? '#888',
    }));
    out.push(renderLegend(items, width, legendBaselineY(cfg)));
  }
  return out.join('');
}
