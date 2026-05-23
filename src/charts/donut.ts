// src/charts/donut.ts
//
// Donut chart renderer. Visually identical to the pie kind except every
// slice is an annulus segment whose inner radius is 55% of the outer. The
// 0.55 ratio is taken from the plan; it's the conventional value where the
// donut hole reads as "intentional" rather than "thin pie that lost its
// centre."
//
// All the heavy lifting (slice math, palette indexing, empty-state, legend)
// lives in pie.ts via `renderRadialBody`. This file only fixes the inner
// ratio and forwards.

import type { ChartElement } from '../canvas/elements/chart.js';
import { renderRadialBody } from './pie.js';

const DONUT_INNER_RATIO = 0.55;

export function renderDonutChartBody(
  el: ChartElement,
  palette: string[],
  width: number,
  height: number,
): string {
  return renderRadialBody(el, palette, width, height, DONUT_INNER_RATIO);
}
