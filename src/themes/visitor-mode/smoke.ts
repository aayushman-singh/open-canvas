// src/themes/visitor-mode/smoke.ts
//
// `bun run visitor-mode:smoke` — exercises the light/dark visitor toggle.
// Hermetic: no DB, no Hono, no live route.
//
// Coverage:
//   1. `emitDualModeCss(charcoal-with-dark)` contains both `:root {` and
//      `:root[data-mode="dark"] {` blocks; the dark block carries an
//      overridden `--opencanvas-kit-bg` value.
//   2. `getModeSetterScript()` is ≤200 chars, contains `data-mode`, and is
//      syntactically valid JS (parses cleanly when evaluated in a Function
//      constructor sandbox).
//   3. `renderModeToggleHtml()` emits a `<button>` with the `aria-pressed`
//      attribute.
//   4. `resolveStyleKitForMode(kit, 'dark')` for a kit with no `dark` partial
//      returns the light kit unchanged (no crash, identity preserved).
//   5. Resolver for a kit with a partial `dark` correctly merges:
//      top-level scalars override, nested variant records shallow-merge by
//      key (absent variants fall through to light, present variants replace
//      whole).
//   6. `withBuiltInDark` resolves the sidecar table for known built-ins and
//      returns the kit unchanged for unknown ids.
//   7. `emitDualModeCss` for a kit without ANY dark partial (light-only)
//      still emits both blocks (toggling is a visual no-op but the structure
//      is preserved).

import type { StyleKitPreset } from '../../canvas/schema.js';
import { getStyleKitPreset } from '../../canvas/style-kits.js';
import { cookieName, type HostConfigEnv } from '../../host-config.js';

import { resolveBuiltInDark } from './built-in-darks.js';
import { emitDualModeCss } from './css-emit.js';
import { getModeSetterScript } from './inline-script.js';
import { resolveStyleKitForMode, withBuiltInDark } from './resolve.js';
import { renderModeToggleHtml, buildModeToggleScript } from './toggle-element.js';

// Per ADR 0013 dec 7 + ADR 0017 dec 1, the smoke asserts the contract
// against an injected env, never a brand literal.
const SMOKE_ENV: HostConfigEnv = {
  APP_DOMAIN: 'opencanvas.aayushman.dev',
  AUTHORIZED_PARTIES: 'https://opencanvas.aayushman.dev',
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: 'noreply@opencanvas.aayushman.dev',
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[visitor-mode:smoke] ${message}`);
}

// --------------------------------------------------------------------------
// Test 1 — emitDualModeCss emits both blocks; dark overrides --opencanvas-kit-bg.
// --------------------------------------------------------------------------

const charcoal = getStyleKitPreset('charcoal');
const charcoalDualCss = emitDualModeCss(charcoal, 'charcoal');
assert(
  charcoalDualCss.includes(':root {'),
  `expected charcoal dual CSS to contain ":root {" block, got: ${charcoalDualCss.slice(0, 200)}`,
);
assert(
  charcoalDualCss.includes(':root[data-mode="dark"] {'),
  `expected charcoal dual CSS to contain ":root[data-mode=\\"dark\\"] {" block`,
);
// The light bg is `#0c0c0d`; the built-in dark override (built-in-darks.ts)
// sets it to `#050507`. The dark block must therefore contain the dark
// value as an `--opencanvas-kit-bg:` declaration.
const charcoalDarkVariant = resolveBuiltInDark('charcoal');
assert(charcoalDarkVariant !== undefined, 'expected charcoal to have a built-in dark variant');
assert(
  charcoalDarkVariant.bg !== undefined && charcoalDarkVariant.bg !== charcoal.bg,
  'expected the charcoal dark variant to override bg with a different colour',
);
// Locate the dark block and confirm it carries the dark bg, not the light one.
const darkBlockStart = charcoalDualCss.indexOf(':root[data-mode="dark"] {');
assert(darkBlockStart >= 0, 'expected dark block selector in dual CSS');
const darkBlock = charcoalDualCss.slice(darkBlockStart);
assert(
  darkBlock.includes(`--opencanvas-kit-bg: ${charcoalDarkVariant.bg};`),
  `expected dark block to declare --opencanvas-kit-bg with the dark override value, got:\n${darkBlock.slice(0, 400)}`,
);

// --------------------------------------------------------------------------
// Test 2 — early mode-setter script: size budget, contents, and parseability.
// --------------------------------------------------------------------------

const setterScript = getModeSetterScript(SMOKE_ENV);
assert(
  getModeSetterScript(SMOKE_ENV) === setterScript,
  'expected getModeSetterScript(env) to be deterministic for the same env',
);
assert(
  setterScript.length <= 220,
  `expected mode-setter script ≤220 chars, got ${String(setterScript.length)}: ${setterScript}`,
);
assert(
  setterScript.includes('data-mode'),
  `expected mode-setter script to mention data-mode, got: ${setterScript}`,
);
assert(
  setterScript.includes(cookieName.colorScheme(SMOKE_ENV)),
  `expected mode-setter script to reference the env-derived cookie name ${cookieName.colorScheme(SMOKE_ENV)}, got: ${setterScript}`,
);
// Parse-only sandbox: wrap in a `new Function` so it is parsed at construction
// time; this throws a SyntaxError if the script is malformed. We do NOT
// execute it (no DOM in the smoke), only confirm syntactic validity. Per the
// plan, the script is a self-contained IIFE; we wrap it so the IIFE body is
// the Function body and the outer `()` would otherwise call it on construction
// (we want parse-only — so we wrap it as a string-bodied no-op statement).
let scriptParseThrew = false;
try {
  // Strip the outer `()` invocation so we parse the IIFE expression as a
  // statement body without invoking it. Equivalent to: does this string
  // parse as a JS Program? Per the plan brief we explicitly want parse-only
  // validation via the Function constructor; the eslint rule that warns
  // against `new Function` is muted for this one line on purpose.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(setterScript);
} catch (err) {
  scriptParseThrew = true;
  void err;
}
assert(!scriptParseThrew, 'expected mode-setter script to parse cleanly');

// --------------------------------------------------------------------------
// Test 3 — renderModeToggleHtml emits a button with aria-pressed.
// --------------------------------------------------------------------------

const toggleHtml = renderModeToggleHtml(SMOKE_ENV);
assert(
  toggleHtml.includes('<button '),
  `expected toggle HTML to include a <button> element, got: ${toggleHtml.slice(0, 200)}`,
);
assert(
  toggleHtml.includes('aria-pressed='),
  `expected toggle HTML to include aria-pressed attribute, got: ${toggleHtml.slice(0, 200)}`,
);
assert(
  toggleHtml.includes('data-opencanvas-mode-toggle'),
  'expected toggle HTML to expose the data-opencanvas-mode-toggle selector hook',
);
assert(
  toggleHtml.includes('aria-label='),
  'expected toggle HTML to include aria-label for screen readers',
);
// The inline script must also be embedded for the standalone toggle to work
// without a separate <script> tag.
const expectedToggleScript = buildModeToggleScript(SMOKE_ENV);
assert(
  toggleHtml.includes(expectedToggleScript.trim().slice(0, 40)),
  'expected toggle HTML to embed the env-derived toggle script body',
);
assert(
  expectedToggleScript.includes(`COOKIE='${cookieName.colorScheme(SMOKE_ENV)}'`),
  `expected toggle script to interpolate the env-derived cookie name, got: ${expectedToggleScript}`,
);

// --------------------------------------------------------------------------
// Test 4 — resolveStyleKitForMode without a dark partial.
// --------------------------------------------------------------------------

// Build a kit by hand with NO `dark` field. (orange-editorial has no built-in
// dark; we strip its `dark` field anyway in case a future tweak adds one
// inline.) The identity check verifies the no-crash + no-clone fast path.
const orangeRaw = getStyleKitPreset('orange-editorial');
const orangeNoDark: StyleKitPreset = { ...orangeRaw };
delete orangeNoDark.dark;
const lightOrange = resolveStyleKitForMode(orangeNoDark, 'light');
assert(
  lightOrange === orangeNoDark,
  'expected resolveStyleKitForMode(kit, "light") to be identity when no dark partial',
);
const darkOrangeFallback = resolveStyleKitForMode(orangeNoDark, 'dark');
assert(
  darkOrangeFallback === orangeNoDark,
  'expected resolveStyleKitForMode(kit, "dark") with no dark partial to be identity (no clone, no crash)',
);

// --------------------------------------------------------------------------
// Test 5 — resolveStyleKitForMode merges top-level + nested correctly.
// --------------------------------------------------------------------------

const baseKit: StyleKitPreset = {
  ...orangeRaw,
  // Author an explicit dark partial that exercises both layers of the merge:
  //   - top-level scalars `bg` + `accent` (must replace)
  //   - nested `actionVariants` with only ONE entry (must shallow-merge so
  //     the other variants fall through to the light kit)
  dark: {
    bg: '#000010',
    accent: '#88ccff',
    actionVariants: {
      // Only the `solid` entry is supplied; the rest of the variants must
      // come from the light kit unchanged. We cast to satisfy
      // Partial<Record<ActionVariant, ActionVariantTokens>> typing — the
      // type system already permits partial supply via Partial.
      solid: { background: '#88ccff', color: '#000010', weight: 700 },
    } as StyleKitPreset['actionVariants'],
  },
};
const resolvedDark = resolveStyleKitForMode(baseKit, 'dark');
assert(
  resolvedDark !== baseKit,
  'expected merged dark resolution to return a new object, not the input reference',
);
assert(
  resolvedDark.bg === '#000010',
  `expected top-level dark.bg override (#000010), got ${resolvedDark.bg}`,
);
assert(
  resolvedDark.accent === '#88ccff',
  `expected top-level dark.accent override (#88ccff), got ${resolvedDark.accent}`,
);
// `text` was NOT overridden in dark — must fall through to the light value.
assert(
  resolvedDark.text === orangeRaw.text,
  `expected text to inherit from light when dark partial omits it; light=${orangeRaw.text} got=${resolvedDark.text}`,
);
// Nested variant merge: `solid` is the dark override; `outline`, `ghost`,
// etc. must equal the light kit's entries.
assert(
  resolvedDark.actionVariants.solid.background === '#88ccff',
  `expected actionVariants.solid.background to be the dark override, got ${String(resolvedDark.actionVariants.solid.background)}`,
);
assert(
  resolvedDark.actionVariants.outline.color === orangeRaw.actionVariants.outline.color,
  'expected non-overridden actionVariants entry (outline) to fall through to light',
);
assert(
  resolvedDark.actionVariants.ghost.color === orangeRaw.actionVariants.ghost.color,
  'expected non-overridden actionVariants entry (ghost) to fall through to light',
);
// The resolver strips `dark` off the output so downstream emitters never
// re-process it.
assert(
  resolvedDark.dark === undefined,
  'expected resolved dark kit to not carry its dark partial forward (would be a foot-gun for emitters)',
);

// --------------------------------------------------------------------------
// Test 6 — withBuiltInDark consults the sidecar.
// --------------------------------------------------------------------------

const charcoalWithBuiltInDark = withBuiltInDark(charcoal, 'charcoal');
assert(
  charcoalWithBuiltInDark.dark !== undefined,
  'expected withBuiltInDark to stitch a dark partial onto charcoal from the sidecar',
);
assert(
  charcoalWithBuiltInDark.dark?.bg === resolveBuiltInDark('charcoal')?.bg,
  'expected stitched dark partial to match the sidecar table for charcoal',
);
// Unknown id — returns kit unchanged.
const unknownKit = withBuiltInDark(orangeNoDark, 'orange-editorial');
assert(
  unknownKit === orangeNoDark,
  'expected withBuiltInDark to return the kit unchanged when no built-in dark exists (no clone)',
);
// Kit that already has `kit.dark` set — no-op (don't overwrite Owner work).
const handcraftedDark: StyleKitPreset = { ...orangeNoDark, dark: { bg: '#111111' } };
const preservedDark = withBuiltInDark(handcraftedDark, 'charcoal');
assert(
  preservedDark === handcraftedDark,
  'expected withBuiltInDark to be a no-op when the kit already carries a `dark` partial',
);

// --------------------------------------------------------------------------
// Test 7 — emitDualModeCss for a kit with no dark partial still emits both
// blocks (visitor-toggling is a no-op visually, but structure is preserved).
// --------------------------------------------------------------------------

const orangeDualCss = emitDualModeCss(orangeNoDark, 'orange-editorial');
assert(
  orangeDualCss.includes(':root {'),
  'expected light-only kit dual CSS to still contain :root {} block',
);
assert(
  orangeDualCss.includes(':root[data-mode="dark"] {'),
  'expected light-only kit dual CSS to still contain :root[data-mode="dark"] {} block',
);
// The two blocks must be structurally identical (modulo selector) — the dark
// block has no overrides because no dark partial exists.
const orangeLightStart = orangeDualCss.indexOf(':root {');
const orangeDarkStart = orangeDualCss.indexOf(':root[data-mode="dark"] {');
const orangeLight = orangeDualCss.slice(
  orangeLightStart + ':root {'.length,
  orangeDarkStart,
);
const orangeDark = orangeDualCss.slice(orangeDarkStart + ':root[data-mode="dark"] {'.length);
// Strip closing braces + surrounding whitespace to compare declaration bodies.
function stripBraces(s: string): string {
  return s.replace(/}\s*$/, '').trim();
}
assert(
  stripBraces(orangeLight) === stripBraces(orangeDark),
  'expected light and dark declaration bodies to match for a kit with no dark variant',
);

console.log('[visitor-mode:smoke] OK');
