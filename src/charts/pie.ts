// src/charts/pie.ts
//
// Pie chart renderer. Sums the FIRST series across categories and renders
// one slice per category. Pie does not consume a multi-series stack — the
// editor signals "pie wants category totals," not "stack of series."
//
// SVG arc trick: each slice is `<path d="M cx,cy L p0 A r,r 0 large 1 p1 Z"/>`
// where p0 and p1 are computed from angles. Single-slice / full-circle case
// uses two half-arcs to avoid the SVG arc-flag ambiguity at exactly 360°.

import type { ChartElement } from '../canvas/elements/chart.js';
import { escapeAttr } from '../canvas/elements/render-utils.js';
import { legendBaselineY, renderEmptyStateOverlay, renderLegend, type LegendItem } from './axes.js';

const SLICE_GAP_RAD = 0.005; // hair gap between slices for readability
const RADIUS_PADDING = 12;

interface SliceLayout {
  startAngle: number;
  endAngle: number;
  sweep: number; // for the smoke + the <title> tooltip
}

/**
 * Compute slice angles from a list of non-negative values. Negative values
 * are clamped to 0 — pies are nonsense for signed data. Zero-total returns
 * an empty array (caller renders empty-state).
 */
export function computePieSlices(values: number[]): SliceLayout[] {
  const clamped = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clamped.reduce((acc, v) => acc + v, 0);
  if (total <= 0) return [];
  const out: SliceLayout[] = [];
  let cursor = -Math.PI / 2; // start at 12 o'clock
  for (const v of clamped) {
    const sweep = (v / total) * Math.PI * 2;
    out.push({ startAngle: cursor, endAngle: cursor + sweep, sweep });
    cursor += sweep;
  }
  return out;
}

function pointOnCircle(cx: number, cy: number, r: number, theta: number): [number, number] {
  return [cx + r * Math.cos(theta), cy + r * Math.sin(theta)];
}

/**
 * Build a single pie slice path. `innerRadius` of 0 produces a wedge; any
 * positive value produces an annulus segment (used by the donut renderer).
 */
export function buildSlicePath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const gap = SLICE_GAP_RAD / 2;
  const a0 = startAngle + gap;
  const a1 = endAngle - gap;
  // Slice too narrow for the gap budget — drop the gap entirely.
  const effectiveA0 = a1 <= a0 ? startAngle : a0;
  const effectiveA1 = a1 <= a0 ? endAngle : a1;
  const sweep = effectiveA1 - effectiveA0;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const [p0x, p0y] = pointOnCircle(cx, cy, outerRadius, effectiveA0);
  const [p1x, p1y] = pointOnCircle(cx, cy, outerRadius, effectiveA1);
  if (innerRadius <= 0) {
    return `M ${cx.toFixed(2)} ${cy.toFixed(2)} L ${p0x.toFixed(2)} ${p0y.toFixed(2)} A ${outerRadius.toFixed(2)} ${outerRadius.toFixed(2)} 0 ${String(largeArc)} 1 ${p1x.toFixed(2)} ${p1y.toFixed(2)} Z`;
  }
  const [q1x, q1y] = pointOnCircle(cx, cy, innerRadius, effectiveA1);
  const [q0x, q0y] = pointOnCircle(cx, cy, innerRadius, effectiveA0);
  return `M ${p0x.toFixed(2)} ${p0y.toFixed(2)} A ${outerRadius.toFixed(2)} ${outerRadius.toFixed(2)} 0 ${String(largeArc)} 1 ${p1x.toFixed(2)} ${p1y.toFixed(2)} L ${q1x.toFixed(2)} ${q1y.toFixed(2)} A ${innerRadius.toFixed(2)} ${innerRadius.toFixed(2)} 0 ${String(largeArc)} 0 ${q0x.toFixed(2)} ${q0y.toFixed(2)} Z`;
}

/**
 * Render the pie chart body — variant-shared with donut via `innerRatio`.
 * Pie passes 0; donut passes 0.55 per the plan.
 */
export function renderRadialBody(
  el: ChartElement,
  palette: string[],
  width: number,
  height: number,
  innerRatio: number,
): string {
  const hasLegend = el.showLegend && el.categories.length > 0;
  // Reserve legend strip space when shown.
  const legendBand = hasLegend ? 28 : 0;
  const drawingHeight = Math.max(0, height - legendBand);
  const cx = width / 2;
  const cy = drawingHeight / 2;
  const outerRadius = Math.max(0, Math.min(width, drawingHeight) / 2 - RADIUS_PADDING);
  if (outerRadius <= 0) {
    return renderEmptyStateOverlay({ x: 0, y: 0, w: width, h: height });
  }
  const first = el.series[0];
  if (!first || el.categories.length === 0) {
    return renderEmptyStateOverlay({ x: 0, y: 0, w: width, h: height });
  }
  const slices = computePieSlices(first.values.slice(0, el.categories.length));
  if (slices.length === 0) {
    return renderEmptyStateOverlay({ x: 0, y: 0, w: width, h: height });
  }
  const innerRadius = innerRatio > 0 ? outerRadius * innerRatio : 0;
  const out: string[] = [];
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i]!;
    const color = palette[i % palette.length] ?? '#888';
    const label = el.categories[i] ?? '';
    const path = buildSlicePath(
      cx,
      cy,
      outerRadius,
      innerRadius,
      slice.startAngle,
      slice.endAngle,
    );
    const value = first.values[i] ?? 0;
    out.push(
      `<path d="${path}" fill="${escapeAttr(color)}" data-slice-index="${String(i)}"><title>${escapeAttr(label)}: ${String(value)}</title></path>`,
    );
  }
  if (hasLegend) {
    const items: LegendItem[] = el.categories.map((label, i) => ({
      label,
      color: palette[i % palette.length] ?? '#888',
    }));
    out.push(
      renderLegend(items, width, legendBaselineY({
        width,
        height,
        hasXAxisTitle: false,
        hasYAxisTitle: false,
        hasLegend: true,
      })),
    );
  }
  return out.join('');
}

export function renderPieChartBody(
  el: ChartElement,
  palette: string[],
  width: number,
  height: number,
): string {
  return renderRadialBody(el, palette, width, height, 0);
}
