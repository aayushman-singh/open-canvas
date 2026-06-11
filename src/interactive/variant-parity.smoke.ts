// src/interactive/variant-parity.smoke.ts
//
// ADR 0066 (Smokes consequence) — guard the visitor-runtime / editor-mirror
// duplication. The pointer-fx fragment and the carousel `--opencanvas-slide-
// offset` publishing exist twice: the visitor source-strings in
// `src/interactive/*` and the TS mirror in
// `src/editor-client/hydrate-interactives.ts`, kept in sync by hand because of
// the worker-typed vs DOM-typed tsconfig split. If one side gains a custom
// property / attribute / primitive the other lacks, the editor preview silently
// diverges from the published site — unacceptable for a design tool. This smoke
// asserts both sides reference the same contract tokens.
//
// `bun run variant-parity:smoke`.

import { readFileSync } from 'node:fs';
import { CAROUSEL_RUNTIME_SRC } from './carousel.js';
import { POINTER_FX_RUNTIME_SRC } from './pointer-fx.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[variant-parity:smoke] ${message}`);
}

const editorMirror = readFileSync('src/editor-client/hydrate-interactives.ts', 'utf8');

// The visitor side of the pointer-fx + carousel-offset contracts.
const visitorPointerFx = POINTER_FX_RUNTIME_SRC;
const visitorCarousel = CAROUSEL_RUNTIME_SRC;

// Every token that BOTH the visitor runtime and the editor mirror must carry
// for the two implementations to paint identically.
const POINTER_FX_TOKENS = [
  '--opencanvas-ptr-x',
  '--opencanvas-ptr-y',
  '--opencanvas-tilt-x',
  '--opencanvas-tilt-y',
  'data-opencanvas-pointer-fx',
  'data-opencanvas-pfx-hydrated',
  'spotlight',
  'tilt',
];

for (const token of POINTER_FX_TOKENS) {
  assert(
    visitorPointerFx.includes(token),
    `visitor pointer-fx fragment is missing token "${token}"`,
  );
  assert(
    editorMirror.includes(token),
    `editor mirror (hydrate-interactives.ts) is missing pointer-fx token "${token}"`,
  );
}

// Carousel coverflow offset contract.
assert(
  visitorCarousel.includes('--opencanvas-slide-offset'),
  'visitor carousel fragment must publish --opencanvas-slide-offset',
);
assert(
  editorMirror.includes('--opencanvas-slide-offset'),
  'editor mirror must publish --opencanvas-slide-offset (coverflow parity)',
);

// The tilt rotation factor must match across both sides (a divergent constant
// would tilt the editor preview by a different amount than the live site).
assert(
  visitorPointerFx.includes('* 12') && editorMirror.includes('* 12'),
  'tilt rotation factor (12) must match between visitor fragment and editor mirror',
);

console.log('[variant-parity:smoke] OK');
