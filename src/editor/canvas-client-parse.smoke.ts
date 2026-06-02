// Guards against the template-literal cook trap: the canvas-client IIFE body
// is wrapped in an untagged template literal upstream, so any backslash
// escape (\n, \t, \r, \(, \[, etc.) authored inside it either silently
// changes a regex/string at runtime OR gets cooked into a real character
// that breaks the surrounding syntax. The latter blocks the entire editor
// script from parsing - the whole canvas refuses to load with "Invalid or
// unexpected token", which is exactly the symptom that bit prod on
// 547cdc8 + 5fbc679.
//
// This smoke calls canvasClientScript() with a fixture payload, writes the
// cooked output to disk, and hands the file to `node --check` so node's
// parser reports a precise line + column when something inside the cook
// breaks. Any backslash escape in a comment or string that survives the
// cook step and breaks JS syntax surfaces here as a build error instead of
// in prod.

import { execSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canvasClientScript } from './canvas-client.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[canvas-client-parse:smoke] ${message}`);
}

const FIXTURE = {
  siteId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  apiBase: '/api',
  wsToken: 'TEST_WS_TOKEN',
  displayName: 'Smoke Tester',
  userId: 'user_smoke',
};

const source = canvasClientScript(FIXTURE);
assert(source.length > 1000, 'canvasClientScript returned a suspiciously short body');

const target = join(tmpdir(), `canvas-client-parse-smoke-${String(process.pid)}.js`);
writeFileSync(target, source);
try {
  execSync(`node --check "${target}"`, { stdio: 'pipe' });
} catch (err) {
  const out =
    err instanceof Error && 'stderr' in err && err.stderr
      ? String((err as { stderr: Buffer }).stderr)
      : String(err);
  throw new Error(
    `[canvas-client-parse:smoke] cooked IIFE fails to parse:\n${out.split('\n').slice(0, 12).join('\n')}`,
  );
} finally {
  try {
    unlinkSync(target);
  } catch {
    /* best-effort cleanup */
  }
}

console.log(
  `[canvas-client-parse:smoke] OK - canvasClientScript output (${String(source.length)} chars) parses cleanly`,
);
