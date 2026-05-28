// src/charts/smoke.ts
//
// Wave 2 #11 smoke. Asserts:
//
//   1. Bar chart 3 categories x 2 series renders exactly 6 `<rect>` (3 x 2).
//   2. Pie chart with 4 slices spans 360 degrees (sweeps sum to 2*pi).
//   3. Active Style Kit accent appears (palette is derived from it).
//   4. Chart box dims w=800 h=400 produce viewBox="0 0 800 400".
//   5. Empty series renders a graceful empty-state SVG, no crash.
//
// Run with `bun.cmd run charts:smoke`. Exits non-zero on assertion failure
// so the wishlist:smoke runner short-circuits.

import { renderChart, type ChartElement } from '../canvas/elements/chart.js';
import { STYLE_KIT_PRESETS } from '../canvas/style-kits.js';
import {
  buildChartPalette,
  buildPaletteFromAccent,
  CHART_PALETTE_LENGTH,
  parseHexColor,
} from './colors.js';
import { computePieSlices } from './pie.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    process.stderr.write(`[charts:smoke] FAIL — ${message}\n`);
    process.exit(1);
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

function makeBaseElement(): Omit<ChartElement, 'kind' | 'series' | 'categories' | 'showLegend'> {
  return {
    id: 'chart-smoke',
    type: 'chart',
    box: { x: 0, y: 0, w: 800, h: 400, z: 1 },
  };
}

{
  let threw = false;
  try {
    parseHexColor('#0g0000');
  } catch (err) {
    threw = err instanceof Error && err.message.includes('hex');
  }
  assert(threw, 'parseHexColor must reject partial hex garbage');
}

// --- Assertion 1: 3 categories x 2 series -> 6 <rect> ----------------------
{
  const base = makeBaseElement();
  const el: ChartElement = {
    ...base,
    kind: 'bar',
    series: [
      { label: 'Apples', values: [3, 5, 2] },
      { label: 'Oranges', values: [4, 1, 6] },
    ],
    categories: ['Jan', 'Feb', 'Mar'],
    showLegend: true,
  };
  const svg = renderChart(el, { styleKit: 'charcoal' });
  const rectCount = countOccurrences(svg, '<rect ');
  // The legend swatches are also <rect>. Count those separately by stripping
  // the legend group: each legend item emits one rect. Series-count = 2 so
  // we expect 2 legend swatches plus the 6 data bars = 8 total.
  const expectedDataRects = 6;
  const expectedLegendRects = 2;
  const expectedTotalRects = expectedDataRects + expectedLegendRects;
  assert(
    rectCount === expectedTotalRects,
    `bar chart: expected ${String(expectedTotalRects)} <rect> total (${String(expectedDataRects)} bars + ${String(expectedLegendRects)} legend swatches), got ${String(rectCount)}`,
  );
  // Data-bar count specifically — count rects with the data-series-index attr.
  const dataRectCount = countOccurrences(svg, 'data-series-index="');
  // Each bar has 1 data-series-index attr; circles in line charts also use it
  // but here we only rendered bars, so this is the bar count.
  assert(
    dataRectCount === expectedDataRects,
    `bar chart: expected ${String(expectedDataRects)} data-series-indexed bars, got ${String(dataRectCount)}`,
  );
}

// --- Assertion 2: pie chart 4 slices sum to 360 degrees --------------------
{
  const base = makeBaseElement();
  const el: ChartElement = {
    ...base,
    kind: 'pie',
    series: [{ label: 'Share', values: [10, 20, 30, 40] }],
    categories: ['A', 'B', 'C', 'D'],
    showLegend: true,
  };
  const svg = renderChart(el, { styleKit: 'blue-saas' });
  const slices = computePieSlices([10, 20, 30, 40]);
  assert(slices.length === 4, `pie: expected 4 slices, got ${String(slices.length)}`);
  const totalSweep = slices.reduce((acc, s) => acc + s.sweep, 0);
  // Floating-point — allow 1e-9 drift.
  const TWO_PI = Math.PI * 2;
  assert(
    Math.abs(totalSweep - TWO_PI) < 1e-9,
    `pie: total sweep should equal 2*pi (got ${String(totalSweep)})`,
  );
  // SVG should contain 4 paths with data-slice-index.
  const sliceCount = countOccurrences(svg, 'data-slice-index="');
  assert(sliceCount === 4, `pie: expected 4 slices in SVG, got ${String(sliceCount)}`);
}

// --- Assertion 3: Style Kit accent appears in palette fills -----------------
{
  const charcoalAccent = STYLE_KIT_PRESETS['charcoal'].accent;
  // Build the palette directly; assert the first colour is the kit accent
  // (slot 0 is the accent as-is in the palette algorithm). Use a tolerant
  // comparison since the palette pipeline goes through HSL and back, which
  // may snap a single digit by ±1.
  const palette = buildChartPalette('charcoal');
  assert(
    palette.length === CHART_PALETTE_LENGTH,
    `palette: expected ${String(CHART_PALETTE_LENGTH)} colours, got ${String(palette.length)}`,
  );
  // Re-derive from accent directly — must match slot 0 exactly.
  const direct = buildPaletteFromAccent(charcoalAccent);
  assert(
    direct[0] === palette[0],
    `palette: slot 0 derived two ways should match (kit=${String(palette[0])}, direct=${String(direct[0])})`,
  );
  // Now render an actual chart and assert at least one palette fill ends up
  // in the SVG output. The kit's accent itself may round-trip to a near-but-
  // not-identical hex (HSL is not lossless), so check the first palette slot
  // appears in a fill attribute.
  const base = makeBaseElement();
  const el: ChartElement = {
    ...base,
    kind: 'bar',
    series: [{ label: 'Only', values: [1, 2, 3] }],
    categories: ['Jan', 'Feb', 'Mar'],
    showLegend: false,
  };
  const svg = renderChart(el, { styleKit: 'charcoal' });
  const slot0 = palette[0]!;
  assert(
    svg.includes(`fill="${slot0}"`),
    `palette: expected at least one fill="${slot0}" in rendered SVG`,
  );
  // Cross-kit sanity: the orange-editorial palette must be DIFFERENT from
  // the charcoal palette (proves the renderer is genuinely reading the kit).
  const orangePalette = buildChartPalette('orange-editorial');
  assert(
    orangePalette[0] !== palette[0],
    `palette: orange-editorial slot 0 (${String(orangePalette[0])}) must differ from charcoal slot 0 (${String(palette[0])})`,
  );
}

// --- Assertion 4: box dims 800x400 -> viewBox="0 0 800 400" -----------------
{
  const base = makeBaseElement();
  const el: ChartElement = {
    ...base,
    box: { x: 0, y: 0, w: 800, h: 400, z: 1 },
    kind: 'line',
    series: [{ label: 'Trend', values: [1, 2, 3] }],
    categories: ['Jan', 'Feb', 'Mar'],
    showLegend: false,
  };
  const svg = renderChart(el, { styleKit: 'green-organic' });
  assert(
    svg.includes('viewBox="0 0 800 400"'),
    `viewBox: expected "viewBox=\\"0 0 800 400\\"" in SVG`,
  );
  assert(
    svg.includes('preserveAspectRatio="xMidYMid meet"'),
    `viewBox: expected preserveAspectRatio="xMidYMid meet"`,
  );
}

// --- Assertion 5: empty series renders without crashing --------------------
{
  const base = makeBaseElement();
  const el: ChartElement = {
    ...base,
    kind: 'bar',
    series: [],
    categories: [],
    showLegend: true,
  };
  let svg = '';
  try {
    svg = renderChart(el, { styleKit: 'charcoal' });
  } catch (err) {
    assert(false, `empty: renderChart threw on empty series — ${String(err)}`);
  }
  assert(svg.length > 0, 'empty: renderChart returned an empty string');
  assert(svg.startsWith('<svg'), 'empty: rendered output should still be an SVG');
  // Empty state text should be present.
  assert(svg.includes('No data yet'), 'empty: expected empty-state placeholder text');
  // No <rect> for bars should be present (only legend rects could be, but
  // legend rendering also short-circuits on zero series).
  const dataRectCount = countOccurrences(svg, 'data-series-index="');
  assert(
    dataRectCount === 0,
    `empty: expected zero data-series-indexed elements, got ${String(dataRectCount)}`,
  );
}

// --- Extra sanity: every chart kind round-trips. ---------------------------
{
  const base = makeBaseElement();
  const kinds: ChartElement['kind'][] = ['bar', 'line', 'pie', 'donut', 'area'];
  for (const kind of kinds) {
    const el: ChartElement = {
      ...base,
      kind,
      series: [
        { label: 'A', values: [3, 5, 2, 4] },
        { label: 'B', values: [1, 4, 6, 2] },
      ],
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      showLegend: true,
    };
    const svg = renderChart(el, { styleKit: 'orange-editorial' });
    assert(svg.startsWith('<svg'), `${kind}: expected SVG output`);
    assert(svg.includes(`data-chart-kind="${kind}"`), `${kind}: expected data-chart-kind attr`);
  }
}

process.stdout.write(
  `[charts:smoke] OK — 5 assertions passed (bar bars, pie sum, palette, viewBox, empty)\n`,
);
