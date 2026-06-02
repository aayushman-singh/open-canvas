// src/canvas/elements/element-files.smoke.ts
//
// Per-element file existence smoke (ADR 0011 follow-up).
//
// Every `ElementType` literal in `src/canvas/schema.ts` must have a
// per-element module at `src/canvas/elements/<type>.ts`. The six dispatch
// records (RENDER, INSPECTOR, SIDEBAR, AGENT_TOOL, Y_ENCODE, Y_DECODE) each
// fail to compile if a literal lands in the union without a registry entry,
// but they cannot catch a literal being added with inline stub entries that
// never reach a per-element file — at which point the element has no home
// for its render/validate/spec/encode/decode code and the per-element module
// convention silently drifts.
//
// This smoke iterates ELEMENT_TYPES and asserts each one has a sibling .ts
// file in this directory. Catches "added the type to the union, forgot the
// file" in CI before it lands on `main`.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELEMENT_TYPES } from '../schema.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[element-files:smoke] ${message}`);
}

const ELEMENTS_DIR = dirname(fileURLToPath(import.meta.url));

const missing: string[] = [];
for (const type of ELEMENT_TYPES) {
  const path = join(ELEMENTS_DIR, `${type}.ts`);
  if (!existsSync(path)) missing.push(type);
}

assert(
  missing.length === 0,
  `missing per-element module files in src/canvas/elements/: ${missing
    .map((t) => `${t}.ts`)
    .join(', ')}. Add one .ts file per ElementType literal so per-element render/validate/spec/encode/decode code has a home — see existing siblings (e.g. text.ts, tabs.ts) for the shape.`,
);

console.log(
  `[element-files:smoke] OK — ${String(ELEMENT_TYPES.length)} ElementType literals each have a sibling file`,
);
