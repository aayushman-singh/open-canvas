import assert from 'node:assert/strict';
import { INTERACTIVE_RUNTIME_SRC } from './build.js';

assert.ok(
  INTERACTIVE_RUNTIME_SRC.includes('window.__opencanvasHydrate'),
  'runtime must expose window.__opencanvasHydrate',
);
assert.ok(
  INTERACTIVE_RUNTIME_SRC.includes('hydratePremiumInteractions'),
  'runtime must call hydratePremiumInteractions from the shared hydrator',
);
assert.ok(
  INTERACTIVE_RUNTIME_SRC.includes('data-opencanvas-route-container'),
  'runtime must know the route container contract',
);

console.log('[premium-hydrator:smoke] OK');
