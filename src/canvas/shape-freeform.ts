// src/canvas/shape-freeform.ts
//
// Freeform shape path helpers. Drawing uses perfect-freehand in the
// editor bundle only; published pages render the stored SVG path string.

export const FREEFORM_RENDER_MODES = ['fill', 'stroke'] as const;
export type FreeformRenderMode = (typeof FREEFORM_RENDER_MODES)[number];

/** Normalized viewBox edge — path coordinates live in 0..FREEFORM_VIEWBOX. */
export const FREEFORM_VIEWBOX = 100;

export const FREEFORM_MIN_POINTS = 3;
export const FREEFORM_MIN_BOX_PX = 8;

type Vec2 = [number, number];

/**
 * Turn perfect-freehand outline points into a closed SVG path (from the
 * library's documented helper).
 */
export function getSvgPathFromStroke(stroke: Vec2[]): string {
  if (stroke.length === 0) return '';
  const d: (string | number)[] = [];
  const first = stroke[0];
  if (!first) return '';
  d.push('M', first[0], first[1], 'Q');
  for (let i = 0; i < stroke.length; i++) {
    const [x0, y0] = stroke[i]!;
    const next = stroke[(i + 1) % stroke.length]!;
    const x1 = next[0];
    const y1 = next[1];
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  d.push('Z');
  return d.join(' ');
}

/** Smoothed open centerline for stroke-only freeform shapes. */
export function centerlineToSvgPath(points: Vec2[]): string {
  if (points.length === 0) return '';
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) {
    return `M ${String(first[0])} ${String(first[1])}`;
  }
  const parts = [`M ${String(first[0])} ${String(first[1])}`];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    const cpx = (prev[0] + curr[0]) / 2;
    const cpy = (prev[1] + curr[1]) / 2;
    parts.push(`Q ${String(prev[0])} ${String(prev[1])} ${String(cpx)} ${String(cpy)}`);
  }
  const last = points[points.length - 1];
  if (last) parts.push(`L ${String(last[0])} ${String(last[1])}`);
  return parts.join(' ');
}

export function isFreeformRenderMode(value: unknown): value is FreeformRenderMode {
  return value === 'fill' || value === 'stroke';
}

export interface FreeformPathResult {
  path: string;
  box: { x: number; y: number; w: number; h: number };
}

/**
 * Scale every numeric coordinate in a simple M/L/Q/Z path by `factor`.
 * Good enough for our generated paths (no arc commands).
 */
function scalePathNumbers(path: string, factor: number): string {
  if (factor === 1) return path;
  return path.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (match) => {
    const n = Number(match);
    if (!Number.isFinite(n)) return match;
    return String(Math.round(n * factor * 100) / 100);
  });
}

/**
 * Build a normalized path (0..FREEFORM_VIEWBOX) plus the section-local box
 * that should wrap it. `points` are section-local pixel coordinates.
 */
export function buildFreeformPathFromPoints(
  points: Vec2[],
  render: FreeformRenderMode,
  strokeFromOutline: (pts: Vec2[], options: { size: number; last: boolean }) => Vec2[],
): FreeformPathResult | null {
  if (points.length < FREEFORM_MIN_POINTS) return null;

  const padding = render === 'fill' ? 8 : 4;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const maxX = Math.max(...xs) + padding;
  const maxY = Math.max(...ys) + padding;

  const local = points.map(([x, y]) => [x - minX, y - minY] as Vec2);
  let localW = Math.max(FREEFORM_MIN_BOX_PX, maxX - minX);
  let localH = Math.max(FREEFORM_MIN_BOX_PX, maxY - minY);
  let pathLocal: string;
  let boxX = minX;
  let boxY = minY;

  if (render === 'fill') {
    const size = Math.max(4, Math.min(localW, localH) * 0.12);
    const outline = strokeFromOutline(local, { size, last: true });
    if (outline.length === 0) return null;
    const oxs = outline.map((p) => p[0]);
    const oys = outline.map((p) => p[1]);
    const localMinX = Math.min(...oxs);
    const localMinY = Math.min(...oys);
    const localMaxX = Math.max(...oxs);
    const localMaxY = Math.max(...oys);
    localW = Math.max(FREEFORM_MIN_BOX_PX, localMaxX - localMinX);
    localH = Math.max(FREEFORM_MIN_BOX_PX, localMaxY - localMinY);
    const shifted = outline.map(([x, y]) => [x - localMinX, y - localMinY] as Vec2);
    pathLocal = getSvgPathFromStroke(shifted);
    boxX = minX + localMinX;
    boxY = minY + localMinY;
  } else {
    pathLocal = centerlineToSvgPath(local);
  }

  const scale = FREEFORM_VIEWBOX / Math.max(localW, localH);
  const path = scalePathNumbers(pathLocal, scale);
  return {
    path,
    box: { x: boxX, y: boxY, w: localW, h: localH },
  };
}

export function renderFreeformShapeInnerSvg(
  path: string,
  render: FreeformRenderMode,
): string {
  const fill = render === 'fill' ? 'currentColor' : 'none';
  const stroke = render === 'stroke' ? 'currentColor' : 'none';
  const strokeWidth = render === 'stroke' ? '2' : '0';
  return `<svg class="opencanvas-shape-freeform" viewBox="0 0 ${String(FREEFORM_VIEWBOX)} ${String(FREEFORM_VIEWBOX)}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
