import {
  buildFreeformPathFromPoints,
  centerlineToSvgPath,
  getSvgPathFromStroke,
  FREEFORM_VIEWBOX,
} from './shape-freeform.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[shape-freeform:smoke] ${message}`);
}

const strokeStub = (pts: [number, number][], options: { size: number; last: boolean }) => {
  void options;
  return pts.length > 0 ? ([...pts, pts[0]!] as [number, number][]) : [];
};

const fill = buildFreeformPathFromPoints(
  [
    [10, 10],
    [50, 80],
    [90, 20],
  ],
  'fill',
  strokeStub,
);
assert(fill !== null, 'fill path should build');
assert(fill.path.includes('M'), 'fill path should be SVG');
assert(fill.box.w >= 8 && fill.box.h >= 8, 'fill box should respect min size');

const stroke = buildFreeformPathFromPoints(
  [
    [0, 0],
    [40, 10],
    [80, 0],
  ],
  'stroke',
  strokeStub,
);
assert(stroke !== null, 'stroke path should build');
assert(stroke.path.startsWith('M'), 'stroke path should start with M');

const closed = getSvgPathFromStroke([
  [0, 0],
  [10, 0],
  [10, 10],
]);
assert(closed.endsWith('Z'), 'stroke outline path should close');

const line = centerlineToSvgPath([
  [0, 0],
  [20, 20],
]);
assert(line.includes('Q') || line.includes('L'), 'centerline should curve or line');

assert(FREEFORM_VIEWBOX === 100, 'viewbox constant');

console.log('[shape-freeform:smoke] OK');
