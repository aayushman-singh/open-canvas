// scripts/sync-brand-icons.smoke.ts
//
// No-network smoke for the Simple Icons response parser used by
// sync-brand-icons.ts.

import { stripSimpleIconInnerSvg } from './sync-brand-icons.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[sync-brand-icons:smoke] ${message}`);
}

const pathInner = stripSimpleIconInnerSvg(
  'github',
  '<svg role="img" viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg>',
);
assert(pathInner === '<path d="M1 1h22v22H1z"/>', `unexpected path inner: ${pathInner}`);

const groupInner = stripSimpleIconInnerSvg(
  'example',
  '<svg viewBox="0 0 24 24"><g><path d="M0 0h24v24H0z"/></g></svg>',
);
assert(groupInner.startsWith('<g>'), `expected group geometry; got ${groupInner}`);

let rejected = false;
try {
  stripSimpleIconInnerSvg('bad', '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>');
} catch (error) {
  rejected =
    error instanceof Error &&
    error.message.includes('expected SVG geometry') &&
    error.message.includes('bad');
}
assert(rejected, 'non-geometry SVG inner content must be rejected loudly');

console.log('[sync-brand-icons:smoke] OK');
