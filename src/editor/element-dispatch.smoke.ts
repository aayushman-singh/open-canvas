// Guards against the regression that surfaced when the portfolio PR added the
// `tabs` element type server-side without updating the editor's client-side
// `buildElementBody` switch — opening any site that used tabs threw
// "unsupported editor element type: tabs" and the editor refused to load.
//
// ADR 0015 Phase 3 — the dispatch now lives in
// src/editor-client/body-builders-data.ts as buildElementBodyImpl. The
// switch is type-narrowed against CanvasElement at the TypeScript level
// (`exhaustive: never` at the end), but TS exhaustiveness is invisible to
// readers and easy to bypass with a string cast. This smoke parses the
// source and asserts every member of the canonical `ELEMENT_TYPES` has a
// matching `case '<type>':` line inside `buildElementBodyImpl`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ELEMENT_TYPES } from '../canvas/schema.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[element-dispatch:smoke] ${message}`);
}

const source = readFileSync(
  join(process.cwd(), 'src', 'editor-client', 'body-builders-data.ts'),
  'utf8',
);

const dispatchStart = source.indexOf('export function buildElementBodyImpl(');
assert(dispatchStart >= 0, 'buildElementBodyImpl not found in body-builders-data.ts');
const dispatchSlice = source.slice(dispatchStart);
const throwMatch = /throw\s+new\s+Error\(\s*['"]unsupported editor element type: /.exec(
  dispatchSlice,
);
const dispatchEnd = throwMatch ? dispatchStart + throwMatch.index : -1;
// Lower-bound the dispatch body so a quote-style flip on the throw sentence
// (e.g. Prettier config drift switching single → double quotes) cannot
// shrink dispatchBody to an empty slice and silently pass the missing-case
// check below. 500 chars is a conservative floor — the live switch is
// ~1.5 KB and shrinking past 500 means at least half the cases vanished.
assert(
  dispatchEnd > dispatchStart + 500,
  'buildElementBodyImpl throw-on-unknown sentinel missing or dispatch body shrank below 500 chars — quote style flipped, switch was gutted, or the source shape changed; update this smoke',
);
const dispatchBody = source.slice(dispatchStart, dispatchEnd);

const missing = ELEMENT_TYPES.filter((type) => !dispatchBody.includes(`case '${type}':`));
assert(
  missing.length === 0,
  `buildElementBodyImpl is missing case branches for: ${missing.join(', ')}. ` +
    `Every member of ELEMENT_TYPES (src/canvas/schema.ts) must have a matching ` +
    `case '<type>': line in the switch, otherwise loading a site that uses the ` +
    `new element type throws "unsupported editor element type: <type>".`,
);

console.log(
  `[element-dispatch:smoke] OK — buildElementBodyImpl handles all ${String(ELEMENT_TYPES.length)} element types`,
);
