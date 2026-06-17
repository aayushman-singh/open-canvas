import assert from 'node:assert/strict';
import { INTERACTIVE_RUNTIME_SRC } from './build.js';

assert.ok(INTERACTIVE_RUNTIME_SRC.includes('function runMotionSequenceLite'));
assert.ok(INTERACTIVE_RUNTIME_SRC.includes('data-opencanvas-motion-sequence-lite'));
assert.ok(INTERACTIVE_RUNTIME_SRC.includes('opencanvas-motion-effect'));

console.log('[motion-sequence-lite:smoke] OK');
