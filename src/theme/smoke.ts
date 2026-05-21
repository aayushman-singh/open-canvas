// src/theme/smoke.ts
//
// Headless sanity check for the OKLCH + WCAG math + token derivation.
//
// Run: bun run theme:smoke
//
// Exits with code 0 on success, 1 on any assertion failure. Prints a one-line
// summary per assertion so CI logs stay readable.

import { deriveTokens, THEME_TOKEN_NAMES, tokensToHexMap } from './derive.js';
import { checkContrast } from './contrast.js';
import { parseHex, toCss, contrastRatio, oklchToSrgb } from './oklch.js';

declare const process: { exit: (code: number) => never };

let failures = 0;

function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

function approx(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol;
}

// ---------------------------------------------------------------------------
// deriveTokens shape + ranges.
// ---------------------------------------------------------------------------

const SEED = '#0a0e1a';
const tokens = deriveTokens(SEED);
const tokenList = THEME_TOKEN_NAMES.map((n) => tokens[n]);

assert('twelve tokens emitted', tokenList.length === 12, String(tokenList.length));

for (const name of THEME_TOKEN_NAMES) {
  const t = tokens[name];
  const ok =
    Number.isFinite(t.l) &&
    Number.isFinite(t.c) &&
    Number.isFinite(t.h) &&
    t.l >= 0 &&
    t.l <= 1 &&
    t.c >= 0 &&
    t.h >= 0 &&
    t.h <= 360;
  assert(`token ${name} has valid OKLCH range`, ok, JSON.stringify(t));
}

// CSS emission well-formed for all tokens.
for (const name of THEME_TOKEN_NAMES) {
  const css = toCss(tokens[name]);
  assert(`token ${name} -> CSS literal`, css.startsWith('oklch('), css);
}

// Hex map is twelve entries.
const hex = tokensToHexMap(tokens);
assert('hex map has 12 keys', Object.keys(hex).length === 12);

// ---------------------------------------------------------------------------
// WCAG sanity — known values.
// ---------------------------------------------------------------------------

const black = parseHex('#000000');
const white = parseHex('#ffffff');
const ratioBW = contrastRatio(oklchToSrgb(black), oklchToSrgb(white));
assert(`black vs white ratio ~21`, approx(ratioBW, 21, 0.1), ratioBW.toFixed(3));

const verdictBW = checkContrast(black, white);
assert('black/white passes AAA normal', verdictBW.aaaNormal === 'pass');
assert('black/white passes AA normal', verdictBW.aaNormal === 'pass');

// Mid-grey #777 vs white is ~4.48 — fails AA normal (4.5), passes AA large (3).
const grey = parseHex('#777777');
const verdictG = checkContrast(grey, white);
assert(
  'grey #777 vs white passes AA large',
  verdictG.aaLarge === 'pass',
  verdictG.ratio.toFixed(3),
);

// Same colour against itself = ratio 1 = fail everything.
const verdictSame = checkContrast(white, white);
assert('white vs white ratio == 1', approx(verdictSame.ratio, 1, 1e-9));
assert('white vs white fails AA normal', verdictSame.aaNormal === 'fail');

// Variant D dark navy bg vs the Variant D fg should pass AAA normal — this
// validates that the derivation lines up with the design language spec.
const fgVsBg = checkContrast(tokens.fg, tokens.bgDeep);
assert(
  `fg vs bgDeep passes AAA normal (ratio=${fgVsBg.ratio.toFixed(2)})`,
  fgVsBg.aaaNormal === 'pass',
);

// ---------------------------------------------------------------------------
// Done.
// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${String(failures)} assertion(s) failed`);
  process.exit(1);
}
console.log(`\nall green — ${String(THEME_TOKEN_NAMES.length)} tokens, WCAG math sane`);
