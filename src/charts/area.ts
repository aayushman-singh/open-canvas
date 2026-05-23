// src/charts/area.ts
//
// Area chart renderer — same anchor points as the line chart, but each
// series is drawn as a filled polygon closing down to the baseline.
//
// Multi-series areas overlap with reduced fill opacity so visitors can still
// read the silhouettes. This is intentionally not a stacked area (a stack
// is a different visual contract — out of scope for the POC).

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

const STROKE_WIDTH = 2;
const FILL_OPACITY = 0.35;

export function renderAreaChartBody(
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
  const baselineY = plot.y + plot.h;
  const out: string[] = [];
  out.push(renderYAxis(plot, ticks, el.yAxisTitle));
  for (let si = 0; si < seriesCount; si++) {
    const series = el.series[si]!;
    const color = palette[si % palette.length] ?? '#888';
    const topPoints: string[] = [];
    for (let ci = 0; ci < categoryCount; ci++) {
      const raw = series.values[ci];
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      const x = bandCenters[ci]!;
      const y = yForValue(value);
      topPoints.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    if (topPoints.length === 0) continue;
    // Close the polygon down to the baseline.
    const first = bandCenters[0]!;
    const last = bandCenters[bandCenters.length - 1]!;
    const polyPoints = [
      `${first.toFixed(2)},${baselineY.toFixed(2)}`,
      ...topPoints,
      `${last.toFixed(2)},${baselineY.toFixed(2)}`,
    ].join(' ');
    out.push(
      `<polygon fill="${escapeAttr(color)}" fill-opacity="${String(FILL_OPACITY)}" stroke="${escapeAttr(color)}" stroke-width="${String(STROKE_WIDTH)}" stroke-linejoin="round" points="${polyPoints}" data-series-index="${String(si)}"><title>${escapeAttr(series.label)}</title></polygon>`,
    );
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
