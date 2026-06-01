// src/themes/smoke.ts
//
// `bun run themes:smoke` — exercises the custom theme editor.
//
// Coverage:
//   1. Author a valid custom kit; `resolveStyleKitWithCustom` returns it
//      verbatim.
//   2. Render a snapshot with `styleKit='custom'` and a valid `customStyleKit`
//      — renderer does not throw; output carries the `data-style-kit="custom"`
//      attribute and the published custom tokens are recoverable from the
//      resolver.
//   3. Missing `customStyleKit` when `styleKit='custom'` throws loudly via
//      `resolveStyleKitWithCustom`.
//   4. Out-of-shape `customStyleKit` (missing field) trips the runtime
//      validator with a path that names the missing field.
//   5. Contrast guard returns a warning for bg=#ffffff text=#bbbbbb (the
//      ratio is ~4.0:1 and fails the 4.5 AA threshold).
//   6. Reset-to-built-in: switching `styleKit` from `'custom'` back to
//      `'charcoal'` produces the charcoal preset, ignoring the leftover
//      `customStyleKit` field on the state.
//   7. Contract sanity: the canvas style-kits module re-exports
//      `resolveStyleKitWithCustom` so the render boundary can route through
//      it without depending on `src/themes/`.

import { renderCanvasSnapshot } from '../canvas/render.js';
import type { EditableSite, PublishedSnapshot, StyleKitPreset } from '../canvas/schema.js';
import { buildStyleKitCss, getStyleKitPreset, STYLE_KIT_PRESETS } from '../canvas/style-kits.js';

import { checkKitContrast, BG_TEXT_AA_THRESHOLD } from './contrast-guard.js';
import { resolveStyleKitWithCustom, validateStyleKitPreset } from './custom-resolve.js';
import {
  findActiveSurfaceTreatmentId,
  findActiveTypePairId,
  SURFACE_TREATMENTS,
  TYPE_PAIRS,
} from './panel.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[themes:smoke] ${message}`);
}

// --------------------------------------------------------------------------
// Fixture builders — keep the smoke hermetic. No DB, no Hono, no live route.
// --------------------------------------------------------------------------

function buildCustomKit(): StyleKitPreset {
  // Mirrors the shape every kit must fill; the values are intentionally
  // distinct from any built-in so test 2 can recover them. We also exercise
  // the optional `dark` partial so the forward-compat path is type-checked.
  return {
    bg: '#102030',
    panel: '#1a2b3f',
    text: '#f5f5fa',
    muted: '#9aa4b8',
    accent: '#ff7a59',
    accentText: '#102030',
    fontFamilyDisplay: "'Inter', system-ui, sans-serif",
    fontFamilyBody: "'Inter', system-ui, sans-serif",
    fontFamilyMono: "'JetBrains Mono', ui-monospace, monospace",
    headingScale: 1.05,
    bodyScale: 1.0,
    labelScale: 0.85,
    lineHeight: 1.5,
    radius: '10px',
    borderWidth: '1px',
    shadow: '0 6px 18px rgba(0, 0, 0, 0.4)',
    surfaceVariants: {
      flat: { background: '#1a2b3f' },
      raised: { background: '#22344d', shadow: '0 12px 28px rgba(0,0,0,0.45)' },
      glass: {
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.12)',
      },
      outlined: { background: 'transparent', border: '1px solid #324867' },
      sticker: { background: '#22344d', border: '1px solid #324867', radius: '14px' },
      'editorial-frame': { background: 'transparent', border: '2px solid #ff7a59' },
      'soft-panel': { background: '#192a3d' },
    },
    shapeFill: '#ff7a59',
    shapeStroke: '#9aa4b8',
    shapeStrokeWidth: '1px',
    actionRadius: '8px',
    actionPadding: '10px 18px',
    actionVariants: {
      solid: { background: '#ff7a59', color: '#102030', weight: 600 },
      outline: { background: 'transparent', color: '#f5f5fa', border: '1px solid #ff7a59' },
      ghost: { background: 'transparent', color: '#9aa4b8' },
      pill: { background: '#ff7a59', color: '#102030', weight: 600 },
      glass: {
        background: 'rgba(255,122,89,0.16)',
        color: '#f5f5fa',
        border: '1px solid rgba(255,122,89,0.3)',
      },
      brutalist: {
        background: '#102030',
        color: '#f5f5fa',
        border: '2px solid #ff7a59',
        weight: 700,
      },
      underline: { background: 'transparent', color: '#ff7a59' },
    },
    motionDurationMs: 360,
    motionEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    motionPresets: {
      none: {},
      'fade-up': { transform: 'translateY(12px)', opacity: 0 },
      'fade-down': { transform: 'translateY(-12px)', opacity: 0 },
      'fade-in': { opacity: 0 },
      'fade-right': { transform: 'translateX(-12px)', opacity: 0 },
      'slide-left': { transform: 'translateX(20px)', opacity: 0 },
      'slide-up': { transform: 'translateY(20px)' },
      'slide-right': { transform: 'translateX(-20px)' },
      'scale-in': { transform: 'scale(0.96)', opacity: 0 },
      'zoom-out': { transform: 'scale(1.08)', opacity: 0 },
      'blur-in': { opacity: 0 },
      'rotate-in': { transform: 'rotate(-6deg) scale(0.95)', opacity: 0 },
      'flip-in': { transform: 'perspective(600px) rotateY(90deg)', opacity: 0 },
      'bounce-in': { transform: 'scale(0.6)', opacity: 0 },
      'stagger-children': { transform: 'translateY(8px)', opacity: 0, delayMs: 60 },
      'slow-drift': { transform: 'translateY(0px)' },
      'parallax-soft': { transform: 'translateY(6px)' },
    },
    // Light/dark forward-compat — the visitor-mode subsystem consumes this
    // partial; here it must round-trip untouched.
    dark: {
      bg: '#050811',
      text: '#f8fafc',
    },
  };
}

function makeSnapshot(state: EditableSite): PublishedSnapshot {
  // Mirror the same fields the publish path mirrors over. The custom kit (if
  // any) is carried separately so the renderer can resolve it.
  return {
    version: 1,
    publishedAt: '2026-05-23T00:00:00.000Z',
    styleKit: state.styleKit,
    pages: state.pages,
    ...(state.customStyleKit !== undefined ? { customStyleKit: state.customStyleKit } : {}),
  };
}

function makeMinimalState(styleKit: EditableSite['styleKit']): EditableSite {
  return {
    styleKit,
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Home',
        width: 1440,
        sections: [
          {
            id: 'section-hero',
            recipeId: 'hero-split',
            name: 'Hero',
            height: 400,
            elements: [
              {
                id: 'hero-heading',
                type: 'text',
                box: { x: 80, y: 120, w: 600, h: 80, z: 1 },
                content: [{ text: 'Hello' }],
                role: 'heading',
                fontSize: 48,
                fontWeight: 700,
                align: 'left',
              },
            ],
          },
        ],
      },
    ],
  };
}

// --------------------------------------------------------------------------
// Test 1 — valid custom kit resolves identity.
// --------------------------------------------------------------------------

const customKit = buildCustomKit();
const customState: EditableSite = {
  ...makeMinimalState('custom'),
  customStyleKit: customKit,
};
const resolved = resolveStyleKitWithCustom(customState);
assert(
  resolved === customKit,
  'expected resolveStyleKitWithCustom to return the exact customStyleKit reference passed in',
);
assert(resolved.accent === '#ff7a59', 'expected resolved kit to expose the custom accent');

// --------------------------------------------------------------------------
// Test 2 — render snapshot with custom kit; renderer does not throw.
// --------------------------------------------------------------------------

const customSnapshot = makeSnapshot(customState);
const html = renderCanvasSnapshot(customSnapshot, '/assets', 'site-themes-smoke', {
  turnstileSiteKey: 'turnstile-test-key',
});
assert(
  html.includes('data-style-kit="custom"'),
  'expected rendered HTML to carry data-style-kit="custom"',
);
assert(
  html.includes('data-opencanvas-page="page-home"'),
  'expected rendered HTML to include the page marker',
);
// The custom kit's tokens are not emitted as a per-kit CSS block by the
// shared builder (it iterates BUILT_IN_STYLE_KITS only — intentional, since
// custom kits are per-site). Recovering the custom tokens at render time
// happens via `resolveStyleKitWithCustom`. Verify the recovered preset
// matches what we authored.
const recovered = resolveStyleKitWithCustom({
  styleKit: customSnapshot.styleKit,
  // The published snapshot mirrors the editable state's customStyleKit, but
  // its TS type is `StyleKitPreset | undefined`. Branch around the undefined
  // case so the resolver call accepts `Pick<EditableSite, ...>` under
  // exactOptionalPropertyTypes.
  ...(customSnapshot.customStyleKit !== undefined
    ? { customStyleKit: customSnapshot.customStyleKit }
    : {}),
});
assert(
  recovered.accent === customKit.accent &&
    recovered.bg === customKit.bg &&
    recovered.text === customKit.text,
  'expected resolved preset from snapshot to mirror authored custom kit tokens',
);
const customCss = buildStyleKitCss('custom', customKit);
assert(
  customCss.includes('[data-style-kit="custom"]') &&
    customCss.includes('--opencanvas-kit-bg: #102030;') &&
    customCss.includes('--opencanvas-kit-accent: #ff7a59;'),
  'expected buildStyleKitCss to emit real custom kit tokens for the public visitor stylesheet',
);

// --------------------------------------------------------------------------
// Test 3 — missing customStyleKit when styleKit='custom' throws loudly.
// --------------------------------------------------------------------------

let missingThrew = false;
try {
  resolveStyleKitWithCustom({ styleKit: 'custom' });
} catch (err) {
  missingThrew = true;
  assert(
    err instanceof Error && err.message.includes('customStyleKit is missing'),
    `expected error to name customStyleKit as missing, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(missingThrew, 'expected resolveStyleKitWithCustom to throw when customStyleKit is absent');

let renderMissingThrew = false;
try {
  renderCanvasSnapshot(
    {
      version: 1,
      publishedAt: '2026-05-23T00:00:00.000Z',
      styleKit: 'custom',
      pages: customSnapshot.pages,
    },
    '/assets',
    'site-themes-smoke',
    { turnstileSiteKey: 'turnstile-test-key' },
  );
} catch (err) {
  renderMissingThrew = true;
  assert(
    err instanceof Error && err.message.includes('customStyleKit is missing'),
    `expected renderer error to name customStyleKit as missing, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(renderMissingThrew, 'expected renderer to throw when styleKit=custom has no customStyleKit');

// --------------------------------------------------------------------------
// Test 4 — runtime validator catches out-of-shape custom kit.
// --------------------------------------------------------------------------

// (4a) Missing required field on the colour tier.
const noBg: unknown = { ...customKit };
delete (noBg as Record<string, unknown>).bg;
let noBgThrew = false;
try {
  validateStyleKitPreset(noBg, 'customStyleKit');
} catch (err) {
  noBgThrew = true;
  assert(
    err instanceof Error && err.message.includes('customStyleKit.bg'),
    `expected validator error to name customStyleKit.bg, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(noBgThrew, 'expected validator to reject a kit missing the bg field');

// (4b) Missing a SurfaceVariant slot (every variant must be present).
const missingSurface: unknown = JSON.parse(JSON.stringify(customKit));
delete (missingSurface as { surfaceVariants: Record<string, unknown> }).surfaceVariants.glass;
let missingSurfaceThrew = false;
try {
  validateStyleKitPreset(missingSurface, 'customStyleKit');
} catch (err) {
  missingSurfaceThrew = true;
  assert(
    err instanceof Error && err.message.includes('customStyleKit.surfaceVariants.glass'),
    `expected validator error to name customStyleKit.surfaceVariants.glass, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(
  missingSurfaceThrew,
  'expected validator to reject a kit whose surfaceVariants is missing the "glass" slot',
);

// (4c) Wrong primitive type — number where string expected.
const wrongType: unknown = JSON.parse(JSON.stringify(customKit));
(wrongType as { accent: unknown }).accent = 12345;
let wrongTypeThrew = false;
try {
  validateStyleKitPreset(wrongType, 'customStyleKit');
} catch (err) {
  wrongTypeThrew = true;
  assert(
    err instanceof Error && err.message.includes('customStyleKit.accent'),
    `expected validator error to name customStyleKit.accent, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(wrongTypeThrew, 'expected validator to reject accent=number (wrong primitive)');

// (4d) Unknown ActionVariant — typo in Owner data must surface, not be hidden.
const typoVariant: unknown = JSON.parse(JSON.stringify(customKit));
(typoVariant as { actionVariants: Record<string, unknown> }).actionVariants['solidd'] = {};
let typoThrew = false;
try {
  validateStyleKitPreset(typoVariant, 'customStyleKit');
} catch (err) {
  typoThrew = true;
  assert(
    err instanceof Error && err.message.includes('solidd'),
    `expected validator error to name the typo'd variant, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(typoThrew, 'expected validator to reject an unknown ActionVariant key');

// (4e) Unknown dark partial key — forward-compat must still catch typos.
const darkTypo: unknown = JSON.parse(JSON.stringify(customKit));
(darkTypo as { dark: Record<string, unknown> }).dark = { backgroundd: '#000' };
let darkTypoThrew = false;
try {
  validateStyleKitPreset(darkTypo, 'customStyleKit');
} catch (err) {
  darkTypoThrew = true;
  assert(
    err instanceof Error && err.message.includes('customStyleKit.dark.backgroundd'),
    `expected validator error to name the unknown dark key, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(darkTypoThrew, 'expected validator to reject an unknown key on the dark partial');

// (4f) Dark partial with a recognised key passes — the partial is forward-
// compat with #20, so a valid subset of StyleKitPreset keys must NOT throw.
const validDark: unknown = JSON.parse(JSON.stringify(customKit));
(validDark as { dark: Record<string, unknown> }).dark = { bg: '#000', text: '#fff' };
validateStyleKitPreset(validDark, 'customStyleKit');

// (4g) Resolver path runs validation — a malformed customStyleKit reaching
// the resolver must throw with the field path, not silently render.
let resolverValidationThrew = false;
try {
  resolveStyleKitWithCustom({
    styleKit: 'custom',
    customStyleKit: noBg as StyleKitPreset,
  });
} catch (err) {
  resolverValidationThrew = true;
  assert(
    err instanceof Error && err.message.includes('customStyleKit.bg'),
    `expected resolver to surface validator error with field path, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(
  resolverValidationThrew,
  'expected resolveStyleKitWithCustom to invoke the validator on customStyleKit',
);

// --------------------------------------------------------------------------
// Test 5 — contrast guard warns on bg=#ffffff text=#bbbbbb (~4.0:1).
// --------------------------------------------------------------------------

const lowContrastKit: StyleKitPreset = {
  ...customKit,
  bg: '#ffffff',
  text: '#bbbbbb',
  accent: '#000000',
  accentText: '#ffffff',
};
const warnings = checkKitContrast(lowContrastKit);
assert(
  warnings.some((w) => w.kind === 'bg-text'),
  `expected a bg-text warning for #fff/#bbb, got ${JSON.stringify(warnings)}`,
);
const bgTextWarning = warnings.find((w) => w.kind === 'bg-text');
// The WCAG-correct ratio for #ffffff vs #bbbbbb is ~1.92:1 (the brief's
// "~4.0:1" hint was an approximation; the math is what matters and it is
// well under the 4.5 AA threshold, which is the point of the test).
assert(
  bgTextWarning !== undefined && bgTextWarning.ratio < BG_TEXT_AA_THRESHOLD,
  'expected bg-text warning to report a sub-threshold ratio',
);
assert(
  bgTextWarning !== undefined && bgTextWarning.ratio >= 1.0 && bgTextWarning.ratio < 4.5,
  `expected bg-text ratio to land below the AA threshold, got ${String(bgTextWarning?.ratio)}`,
);
assert(
  bgTextWarning !== undefined && bgTextWarning.pair.background === '#ffffff',
  'expected pair.background to surface the offending background colour',
);
// And: a kit that meets both thresholds emits zero warnings.
const cleanKit: StyleKitPreset = {
  ...customKit,
  bg: '#ffffff',
  text: '#000000',
  accent: '#000000',
  accentText: '#ffffff',
};
const cleanWarnings = checkKitContrast(cleanKit);
assert(
  cleanWarnings.length === 0,
  `expected no warnings for high-contrast kit, got ${JSON.stringify(cleanWarnings)}`,
);

// --------------------------------------------------------------------------
// Test 6 — reset-to-built-in.
// --------------------------------------------------------------------------

const resetState: EditableSite = {
  ...customState,
  styleKit: 'charcoal',
  // customStyleKit lingers on the in-memory state — the resolver MUST ignore
  // it because the selector says built-in. The DELETE route strips this on
  // the persistence side; the resolver's contract here is "selector wins".
};
const charcoalResolved = resolveStyleKitWithCustom(resetState);
assert(
  charcoalResolved === STYLE_KIT_PRESETS.charcoal,
  'expected reset-to-charcoal to return the charcoal preset by identity',
);
assert(
  charcoalResolved.accent === getStyleKitPreset('charcoal').accent,
  'expected reset-to-charcoal accent to match the built-in charcoal preset',
);

// --------------------------------------------------------------------------
// Test 7 — `resolveStyleKitWithCustom` re-export on `src/canvas/style-kits.ts`.
// The render boundary imports from `src/canvas/style-kits.ts`; the `'custom'`
// dispatch slot must be reachable from there.
// --------------------------------------------------------------------------

// Dynamic import so the smoke does not require the symbol at module-init
// time (it is verified at runtime).
const styleKitsModule = await import('../canvas/style-kits.js');
assert(
  typeof (styleKitsModule as { resolveStyleKitWithCustom?: unknown }).resolveStyleKitWithCustom ===
    'function',
  'expected src/canvas/style-kits.ts to re-export resolveStyleKitWithCustom',
);

// --------------------------------------------------------------------------
// Test 8 — panel helpers project the kit to the right control values.
// --------------------------------------------------------------------------

// findActiveTypePairId picks the entry whose families match.
const interPairId = findActiveTypePairId({
  ...customKit,
  fontFamilyDisplay: "'Inter', system-ui, -apple-system, sans-serif",
  fontFamilyBody: "'Inter', system-ui, -apple-system, sans-serif",
});
assert(
  interPairId === 'inter',
  `expected findActiveTypePairId to recognise the Inter pair, got ${interPairId}`,
);
const noMatchPairId = findActiveTypePairId({
  ...customKit,
  fontFamilyDisplay: 'totally-unknown',
  fontFamilyBody: 'still-unknown',
});
assert(
  TYPE_PAIRS.some((p) => p.id === noMatchPairId),
  'expected findActiveTypePairId to fall back to a known choice when no exact match',
);

// findActiveSurfaceTreatmentId picks by radius + shadow.
const sharpId = findActiveSurfaceTreatmentId({
  ...customKit,
  radius: '0px',
  shadow: '6px 6px 0 rgba(0, 0, 0, 0.85)',
});
assert(
  sharpId === 'sharp',
  `expected findActiveSurfaceTreatmentId to recognise the sharp treatment, got ${sharpId}`,
);
assert(
  SURFACE_TREATMENTS.some((s) => s.id === sharpId),
  'expected surface treatment id to be in the curated list',
);

console.log('[themes:smoke] OK');
