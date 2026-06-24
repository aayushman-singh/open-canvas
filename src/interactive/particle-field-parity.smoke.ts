// src/interactive/particle-field-parity.smoke.ts
//
// `bun run particle-field-parity:smoke` — asserts the ascii-portrait particle
// field runtime matches raydotsh.github.io AsciiPortrait.jsx semantics.

import { BEHAVIOUR_RUNTIME_SRC } from './behaviour.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[particle-field-parity:smoke] ${message}`);
}

const src = BEHAVIOUR_RUNTIME_SRC;

assert(
  src.includes('devicePixelRatio'),
  'particle field runtime must scale the canvas backing store with devicePixelRatio',
);
assert(
  src.includes('setTransform(dpr, 0, 0, dpr, 0, 0)'),
  'particle field runtime must scale the 2d context for HiDPI drawing',
);
assert(
  src.includes('return 400') || src.includes('behaviourParticleScatterSpread'),
  'particle field runtime must scatter particles with the source 400px spread',
);
assert(
  src.includes('logicalSize <= 280 ? 5'),
  'particle field runtime must use 5px glyphs when the logical portrait size is at most 280',
);
assert(
  src.includes('px monospace'),
  'particle field runtime must draw ascii glyphs with monospace',
);
assert(
  src.includes('radiusRatio: typeof pointer.radiusRatio === \'number\' ? pointer.radiusRatio : 0.2'),
  'particle field runtime must default pointer repel radius to 20% of canvas size',
);
assert(
  src.includes('force: typeof pointer.force === \'number\' ? pointer.force : 4'),
  'particle field runtime must default pointer repel force to 4',
);
assert(
  src.includes('passive: false'),
  'particle field touchmove listener must be non-passive so preventDefault can run',
);
assert(
  src.includes('event.cancelable) event.preventDefault()'),
  'particle field touchmove must call preventDefault when cancelable',
);
assert(
  src.includes('width <= 480 ? \'phone\' : width <= 768 ? \'tablet\' : \'desktop\''),
  'particle field point-set selection must follow source viewport breakpoints',
);
assert(
  src.includes('visualWidth') && src.includes('/ visualWidth) * canvas.clientWidth'),
  'particle field pointer tracking must map visual pointer coords into canvas layout space',
);

console.log('[particle-field-parity:smoke] OK');
