// scripts/migrate-neon.smoke.ts
//
// Source contract for the one-shot Neon migration helper. This script is
// allowed to fail loudly; it must not silently skip rows and print success.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[migrate-neon:smoke] ${message}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, 'migrate-neon.ts'), 'utf8');

assert(
  !source.includes('ON CONFLICT DO NOTHING'),
  'data copy must not silently ignore conflicting target rows',
);
assert(
  source.includes('RETURNING 1'),
  'data copy must observe how many rows Postgres actually inserted',
);
assert(
  /insertedRows\.length\s*!==\s*chunk\.length/.test(source),
  'data copy must compare inserted row count with source chunk size',
);
assert(
  source.includes('target insert count mismatch'),
  'copy count mismatch must throw a clear failure with table/chunk context',
);

console.log('[migrate-neon:smoke] OK');
