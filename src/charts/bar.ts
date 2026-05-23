// src/charts/bar.ts
//
// Bar chart renderer. Vertical bars grouped by category; one bar per series
// per category, sitting side-by-side. Pure SVG fragment — no <svg> wrapper
// (the chart-element renderer composes the outer <svg viewBox>).
//
// Layout:
//   - Each category gets a "band" along the x-axis.
//   - Inside a band, series occupy equal-width sub-slots.
//   - 12% of the band width is reserved as inter-band padding.
//   - 8% of the sub-slot width is reserved as inter-bar padding.

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
} from './axes.js';
import type { LegendItem } from './axes.js';

const BAND_PADDING_RATIO = 0.12; // gap between category groups
const BAR_PADDING_RATIO = 0.08; // gap between bars within a group

export function renderBarChartBody(el: ChartElement, palette: string[], width: number, height: number): string {
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
  // Empty-state — no series OR no categories.
  if (categoryCount === 0 || seriesCount === 0 || plot.w <= 0 || plot.h <= 0) {
    return renderEmptyStateOverlay(plot);
  }
  const seriesValues = el.series.map((s) => s.values);
  const domain = aggregateDomain(seriesValues);
  const ticks = niceTicks(domain.min, domain.max, 5);
  const denom = ticks.max - ticks.min;
  // X-axis band geometry. bandStep is the centre-to-centre distance between
  // categories; bandWidth is the usable interior of each band (minus inter-
  // band padding).
  const bandStep = plot.w / categoryCount;
  const bandWidth = bandStep * (1 - BAND_PADDING_RATIO);
  const bandLeftOffset = (bandStep - bandWidth) / 2;
  const subSlot = bandWidth / seriesCount;
  const barWidth = subSlot * (1 - BAR_PADDING_RATIO);
  const barLeftOffset = (subSlot - barWidth) / 2;
  const baseline = plot.y + plot.h;
  const out: string[] = [];
  const bandCenters: number[] = [];
  // Emit Y-axis first so gridlines sit behind bars.
  out.push(renderYAxis(plot, ticks, el.yAxisTitle));
  // Rects: 1 per (category, series).
  for (let ci = 0; ci < categoryCount; ci++) {
    const bandLeft = plot.x + ci * bandStep + bandLeftOffset;
    bandCenters.push(plot.x + ci * bandStep + bandStep / 2);
    for (let si = 0; si < seriesCount; si++) {
      const series = el.series[si]!;
      const raw = series.values[ci];
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
      const ratio = denom === 0 ? 0 : (value - Math.min(0, ticks.min)) / denom;
      // Positive bars grow up from the baseline; bars only support the >=0
      // case in this POC (data with negatives still renders but always starts
      // from the bottom of the plot, not from the zero line — flagged as a
      // follow-up if visitors ever ship negative data).
      const barHeight = Math.max(0, ratio * plot.h);
      const x = bandLeft + si * subSlot + barLeftOffset;
      const y = baseline - barHeight;
      const color = palette[si % palette.length] ?? '#888';
      out.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" fill="${escapeAttr(color)}" data-series-index="${String(si)}" data-category-index="${String(ci)}"><title>${escapeAttr(series.label)}: ${String(value)}</title></rect>`,
      );
    }
  }
  // X-axis after bars so labels sit cleanly below.
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
