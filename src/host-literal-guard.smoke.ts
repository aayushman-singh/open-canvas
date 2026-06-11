// src/host-literal-guard.smoke.ts
//
// ADR 0013 follow-up #5 + ADR 0017 follow-up + post-rebrand lockdown — assert
// no literal `rev01.*` brand string remains in production code outside the
// designated exceptions. Catches regressions where a contributor adds
// hardcoded brand strings to a new file without going through `host-config.ts`.
//
// Allowed exceptions:
//   - `src/host-literal-guard.smoke.ts` (this file — the literals live here
//     as the search target).
//   - `src/canvas/fixtures/**` (seed JSON data; ADR 0013 out-of-scope #6).
//   - `src/templates/seeds/**` (seed template content; ADR 0013 out-of-scope #6).
//
// Files matching `*.smoke.ts` are NOT exempt — smokes must pin against an
// injected test APP_DOMAIN / COOKIE_NAME_PREFIX per ADR 0013 decision 7
// and ADR 0017 decision 1.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[host-literal-guard:smoke] ${message}`);
}

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)));

// FORBIDDEN_LITERALS combines:
//   ADR 0013 / 0017: apex hostname + cookie prefix (env-derived).
//   Tier B (post-rebrand): CSS class / var / data-attr prefix.
//   Tier B (post-rebrand): every window global / route / cookie carrying
//     the legacy `__rev01` substring.
//   Tier B (post-rebrand): legacy HTTP signature header.
const FORBIDDEN_LITERALS = [
  'rev01.aayushman.dev',
  'rev01-',
  '__rev01',
  'X-Rev01-',
] as const;

const SELF_PATH = fileURLToPath(import.meta.url);

const EXEMPT_PREFIXES = [
  join('canvas', 'fixtures') + sep,
  join('templates', 'seeds') + sep,
];

function isExempt(absPath: string): boolean {
  if (absPath === SELF_PATH) return true;
  const rel = relative(SRC_ROOT, absPath);
  if (EXEMPT_PREFIXES.some((prefix) => rel.startsWith(prefix))) return true;
  return false;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!st.isFile()) continue;
    if (!/\.(ts|tsx|js|jsx|json)$/.test(entry)) continue;
    out.push(full);
  }
}

const files: string[] = [];
walk(SRC_ROOT, files);

const violations: string[] = [];
for (const file of files) {
  if (isExempt(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const literal of FORBIDDEN_LITERALS) {
    const idx = text.indexOf(literal);
    if (idx >= 0) {
      const lineStart = text.lastIndexOf('\n', idx) + 1;
      const lineEnd = text.indexOf('\n', idx);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const lineNumber = text.slice(0, idx).split('\n').length;
      violations.push(
        `${relative(SRC_ROOT, file)}:${lineNumber} contains forbidden literal "${literal}": ${line.trim()}`,
      );
    }
  }
}

assert(
  violations.length === 0,
  `forbidden brand literals in production code (ADR 0013 + Tier B rebrand):\n  ${violations.join('\n  ')}`,
);

console.log(`[host-literal-guard:smoke] OK — scanned ${files.length} files, 0 violations`);
