// src/charts/axes.ts
//
// Shared axis / tick / label math for bar, line, and area charts. Pie and
// donut don't use axes — they render against the polar centre instead.
//
// All math is in SVG user-space units. The chart renderers compose a single
// `<svg viewBox="0 0 W H">` tag where W and H are the element box dimensions
// in CSS pixels; `preserveAspectRatio="xMidYMid meet"` lets the visitor's
// browser scale the chart to fit the wrapper. That means tick counts and
// label sizes are computed against the design canvas (W × H), not the screen.
//
// The numeric Y-axis uses a "nice" tick algorithm — find a tick spacing of
// the form 1×10^k, 2×10^k, or 5×10^k that yields ~5 ticks across the data
// range. The algorithm is the same one Vega-Lite + D3 use under the hood,
// reduced to ~20 lines and zero dependencies.
//
// Pure functions — no I/O, no DOM.

import { escapeHtml } from '../canvas/elements/render-utils.js';

/** Pixel-space rectangle reserved for the plot itself (inside axis labels). */
export interface PlotArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AxisConfig {
  /** Total SVG box dimensions. */
  width: number;
  height: number;
  /** True when the chart has an x-axis title — adds a row at the bottom. */
  hasXAxisTitle: boolean;
  /** True when the chart has a y-axis title — adds a column on the left. */
  hasYAxisTitle: boolean;
  /** True when the chart renders a legend strip below the plot. */
  hasLegend: boolean;
}

// Margin constants. Picked once so every chart kind reserves the same gutters.
const MARGIN_TOP = 16;
const MARGIN_RIGHT = 16;
const MARGIN_BOTTOM_BASE = 36; // room for category labels
const MARGIN_LEFT_BASE = 44; // room for numeric Y-axis labels
const AXIS_TITLE_BAND = 22; // extra row/column when an axis title is set
const LEGEND_BAND = 28;

/**
 * Compute the inner plot rectangle for an axis-bearing chart. Caller draws
 * gridlines / ticks / bars / lines inside the returned box; outside is
 * reserved for axis labels, axis titles, and the optional legend.
 */
export function computePlotArea(cfg: AxisConfig): PlotArea {
  const left = MARGIN_LEFT_BASE + (cfg.hasYAxisTitle ? AXIS_TITLE_BAND : 0);
  const right = MARGIN_RIGHT;
  const top = MARGIN_TOP;
  const bottom =
    MARGIN_BOTTOM_BASE +
    (cfg.hasXAxisTitle ? AXIS_TITLE_BAND : 0) +
    (cfg.hasLegend ? LEGEND_BAND : 0);
  const w = Math.max(0, cfg.width - left - right);
  const h = Math.max(0, cfg.height - top - bottom);
  return { x: left, y: top, w, h };
}

export interface NiceTicks {
  ticks: number[];
  min: number;
  max: number;
  step: number;
}

/**
 * Build a "nice" tick set across [domainMin, domainMax]. Returns at most
 * `maxTicks + 1` evenly-spaced values. The min/max may extend slightly past
 * the input domain so the ticks land on round numbers.
 *
 * Handles the empty / degenerate cases without throwing:
 *   - both bounds equal -> single tick at the value (axis still draws).
 *   - both bounds zero  -> [0, 1] domain so the axis isn't a single line.
 */
export function niceTicks(domainMin: number, domainMax: number, maxTicks = 5): NiceTicks {
  if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
    return { ticks: [0, 1], min: 0, max: 1, step: 1 };
  }
  let lo = Math.min(domainMin, domainMax);
  let hi = Math.max(domainMin, domainMax);
  if (lo === hi) {
    if (lo === 0) return { ticks: [0, 1], min: 0, max: 1, step: 1 };
    // Pad ±10% so a flat series still draws a strip.
    const pad = Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  const range = hi - lo;
  const roughStep = range / Math.max(1, maxTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalised = roughStep / mag;
  let step: number;
  if (normalised < 1.5) step = 1 * mag;
  else if (normalised < 3) step = 2 * mag;
  else if (normalised < 7) step = 5 * mag;
  else step = 10 * mag;
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  // Guard against floating-point drift inflating the loop iteration count.
  const expected = Math.round((niceMax - niceMin) / step) + 1;
  for (let i = 0; i < expected; i++) {
    ticks.push(niceMin + i * step);
  }
  return { ticks, min: niceMin, max: niceMax, step };
}

/** Format a tick label — strip trailing zeros after a decimal point. */
export function formatTick(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Build the Y-axis SVG fragment (gridlines + tick labels + axis line).
 * Returns the SVG `<g>...</g>` group, ready to embed inside a chart.
 *
 * Coordinate system: plot.y is the TOP of the plot, plot.y + plot.h is the
 * X-axis baseline. Tick values map linearly between min and max.
 */
export function renderYAxis(plot: PlotArea, ticks: NiceTicks, axisTitle?: string): string {
  if (ticks.ticks.length === 0 || plot.h <= 0) return '';
  const denom = ticks.max - ticks.min;
  const lines: string[] = [];
  // Gridlines + labels.
  for (const v of ticks.ticks) {
    const ratio = denom === 0 ? 0 : (v - ticks.min) / denom;
    const y = plot.y + plot.h - ratio * plot.h;
    // Gridline across the plot. Stroke-opacity stays low so bars / lines pop.
    lines.push(
      `<line x1="${String(plot.x)}" y1="${y.toFixed(2)}" x2="${String(plot.x + plot.w)}" y2="${y.toFixed(2)}" stroke="currentColor" stroke-opacity="0.08" stroke-width="1"/>`,
    );
    // Label sits 6 px to the left of the plot, right-aligned.
    lines.push(
      `<text x="${String(plot.x - 6)}" y="${(y + 3).toFixed(2)}" font-size="10" text-anchor="end" fill="currentColor" fill-opacity="0.7">${escapeHtml(formatTick(v))}</text>`,
    );
  }
  // Axis line.
  lines.push(
    `<line x1="${String(plot.x)}" y1="${String(plot.y)}" x2="${String(plot.x)}" y2="${String(plot.y + plot.h)}" stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>`,
  );
  if (axisTitle !== undefined && axisTitle.length > 0) {
    // Rotated label sitting in the dedicated AXIS_TITLE_BAND column.
    const titleX = plot.x - MARGIN_LEFT_BASE + 8;
    const titleY = plot.y + plot.h / 2;
    lines.push(
      `<text x="${titleX.toFixed(2)}" y="${titleY.toFixed(2)}" font-size="11" text-anchor="middle" fill="currentColor" fill-opacity="0.85" transform="rotate(-90 ${titleX.toFixed(2)} ${titleY.toFixed(2)})">${escapeHtml(axisTitle)}</text>`,
    );
  }
  return `<g class="rev01-chart-yaxis">${lines.join('')}</g>`;
}

/**
 * Build the X-axis SVG fragment — baseline + category labels positioned at
 * the band centres. `bandCenters` is supplied by the caller because the
 * grouped bar / line / area renderers each space their categories slightly
 * differently.
 */
export function renderXAxis(
  plot: PlotArea,
  categories: string[],
  bandCenters: number[],
  axisTitle?: string,
): string {
  if (plot.w <= 0) return '';
  const baseline = plot.y + plot.h;
  const lines: string[] = [];
  lines.push(
    `<line x1="${String(plot.x)}" y1="${baseline.toFixed(2)}" x2="${String(plot.x + plot.w)}" y2="${baseline.toFixed(2)}" stroke="currentColor" stroke-opacity="0.3" stroke-width="1"/>`,
  );
  for (let i = 0; i < categories.length; i++) {
    const cx = bandCenters[i];
    if (cx === undefined) continue;
    lines.push(
      `<text x="${cx.toFixed(2)}" y="${(baseline + 14).toFixed(2)}" font-size="10" text-anchor="middle" fill="currentColor" fill-opacity="0.85">${escapeHtml(categories[i] ?? '')}</text>`,
    );
  }
  if (axisTitle !== undefined && axisTitle.length > 0) {
    const cx = plot.x + plot.w / 2;
    const cy = baseline + 32;
    lines.push(
      `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-size="11" text-anchor="middle" fill="currentColor" fill-opacity="0.85">${escapeHtml(axisTitle)}</text>`,
    );
  }
  return `<g class="rev01-chart-xaxis">${lines.join('')}</g>`;
}

export interface LegendItem {
  label: string;
  color: string;
}

/**
 * Build a horizontal legend strip beneath the chart. Items wrap inside the
 * SVG via simple inline `<text>` advancement — we estimate each label width
 * as `8 * char count + 18 (swatch+gap)`, accepting a little overshoot rather
 * than measuring text in pure SVG. Pie / donut also use this.
 */
export function renderLegend(items: LegendItem[], width: number, y: number): string {
  if (items.length === 0) return '';
  const swatchSize = 10;
  const gap = 6;
  const itemGap = 14;
  const estimatedItemWidth = (label: string): number => 8 * label.length + swatchSize + gap;
  const totalWidth =
    items.reduce((acc, item) => acc + estimatedItemWidth(item.label) + itemGap, 0) - itemGap;
  let cursor = Math.max(8, (width - totalWidth) / 2);
  const out: string[] = [];
  for (const item of items) {
    out.push(
      // REVIEW: `fill="${escapeHtml(item.color)}"` — `escapeHtml` does not escape quotes. In an attribute context, a color value containing `"` breaks out of the fill attribute. Use `escapeAttr` (which escapes quotes) for attribute values.
      `<rect x="${cursor.toFixed(2)}" y="${(y - swatchSize + 2).toFixed(2)}" width="${String(swatchSize)}" height="${String(swatchSize)}" fill="${escapeHtml(item.color)}" rx="2"/>`,
    );
    out.push(
      `<text x="${(cursor + swatchSize + gap).toFixed(2)}" y="${y.toFixed(2)}" font-size="11" fill="currentColor" fill-opacity="0.9">${escapeHtml(item.label)}</text>`,
    );
    cursor += estimatedItemWidth(item.label) + itemGap;
  }
  return `<g class="rev01-chart-legend">${out.join('')}</g>`;
}

/**
 * Compute the y-coord of the legend baseline, given plot area + chart bottom
 * margins. The legend sits just above the bottom edge of the SVG.
 */
export function legendBaselineY(cfg: AxisConfig): number {
  if (!cfg.hasLegend) return cfg.height;
  return cfg.height - LEGEND_BAND / 2;
}

/** Compute the overall numeric domain across every series in a chart. */
export function aggregateDomain(seriesValues: ReadonlyArray<ReadonlyArray<number>>): {
  min: number;
  max: number;
} {
  let min = Infinity;
  let max = -Infinity;
  for (const series of seriesValues) {
    for (const v of series) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }
  // Always include 0 in the domain for bar/area charts — visitors expect bars
  // to start from the axis baseline, not "wherever the smallest value lands."
  // Caller can ignore the 0-inclusion when it doesn't make sense (e.g. line
  // chart over a narrow range), but for the POC we keep it on across all
  // axis-bearing kinds.
  if (min > 0) min = 0;
  if (max < 0) max = 0;
  return { min, max };
}

/**
 * Empty-state SVG fragment — drawn inside the plot area when a chart has no
 * usable data points. Keeps the chart from looking broken when the editor
 * data grid is open with no rows yet.
 */
export function renderEmptyStateOverlay(plot: PlotArea): string {
  if (plot.w <= 0 || plot.h <= 0) return '';
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  return `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-size="12" text-anchor="middle" fill="currentColor" fill-opacity="0.55">No data yet</text>`;
}
