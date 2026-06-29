import {
  PARTICLE_FIELD_BREAKPOINT_SIZES,
  particleFieldGridFontSize,
  sampleAsciiPointsFromPixels,
  assertNonEmptyParticleFieldPointSets,
} from './particle-field-ascii.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[particle-field-ascii:smoke] ${message}`);
}

assert(particleFieldGridFontSize(220) === 5, 'phone grid font size must be 5');
assert(particleFieldGridFontSize(280) === 5, 'tablet grid font size must be 5');
assert(particleFieldGridFontSize(400) === 7, 'desktop grid font size must be 7');

assert(PARTICLE_FIELD_BREAKPOINT_SIZES.phone === 220, 'phone canvas size must be 220');
assert(PARTICLE_FIELD_BREAKPOINT_SIZES.tablet === 280, 'tablet canvas size must be 280');
assert(PARTICLE_FIELD_BREAKPOINT_SIZES.desktop === 400, 'desktop canvas size must be 400');

const width = 40;
const height = 40;
const pixels = new Uint8ClampedArray(width * height * 4);
for (let y = 10; y < 30; y++) {
  for (let x = 10; x < 30; x++) {
    const i = (y * width + x) * 4;
    pixels[i] = 200;
    pixels[i + 1] = 200;
    pixels[i + 2] = 200;
    pixels[i + 3] = 255;
  }
}

const charset = ' .:-=+*#%@';
const points = sampleAsciiPointsFromPixels(pixels, width, height, charset);
assert(points.length > 0, 'sampling a bright square must produce ASCII points');

for (const point of points) {
  assert(charset.includes(point.char), 'every sampled char must come from the charset');
  assert(point.alpha >= 0.4 && point.alpha <= 1, 'alpha must follow raydotsh brightness ramp');
  assert(point.x >= 0 && point.x <= width, 'x must stay inside the canvas');
  assert(point.y >= 0 && point.y <= height, 'y must stay inside the canvas');
}

const emptyCharset = sampleAsciiPointsFromPixels(pixels, width, height, '');
assert(emptyCharset.length === 0, 'empty charset must produce no points');

const transparentOnly = new Uint8ClampedArray(width * height * 4);
const transparentPoints = sampleAsciiPointsFromPixels(transparentOnly, width, height, charset);
assert(transparentPoints.length === 0, 'fully transparent pixels must produce no points');

let threwForEmpty = false;
try {
  assertNonEmptyParticleFieldPointSets([
    { breakpoint: 'desktop', canvasSize: 400, points: [] },
  ]);
} catch {
  threwForEmpty = true;
}
assert(threwForEmpty, 'empty point sets must be rejected before save');

console.log('[particle-field-ascii:smoke] OK');
