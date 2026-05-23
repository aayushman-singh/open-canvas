// src/themes/visitor-mode/built-in-darks.ts
//
// Wave 3 #20 — Sidecar table of dark-mode partials for the built-in Style
// Kits. Lives HERE — not in `src/canvas/style-kits.ts` — because the canvas
// style-kits module belongs to Wave 2 #10 (custom theme editor) and Wave 3
// agents must not modify it. Keeping the dark partials in a sibling file
// gives this Wave 3 feature full ownership of the dark-variant authoring
// surface for built-ins without crossing wave boundaries.
//
// Coverage:
//   - `charcoal` — already dark by design; the dark variant deepens the bg
//     a notch and pushes the muted text a hair lighter so dark-mode visitors
//     still get a perceptible difference from light mode (which already
//     renders as a near-black backdrop).
//   - `blue-saas` — dark navy already; the variant lowers the panel
//     luminance and re-tunes the accent against the deeper field.
//
// The other two built-ins (`orange-editorial`, `green-organic`) deliberately
// have NO dark variant in this table. Per the plan, kits without a `dark`
// partial fall back to the light kit at visitor render time — the dark block
// emitted by the CSS layer ends up structurally equal to the light block, so
// toggling is a visual no-op for those kits. Owners who want dark on those
// kits author a custom theme.
//
// Why this table is keyed by string and not `BuiltInStyleKit`: the resolver
// accepts a string kit id (so it does not have to import the schema's
// BuiltInStyleKit union from the canvas tree). The table accepts only valid
// built-in keys; unknown keys return undefined, which is the documented "no
// built-in dark partial for this kit" signal.

import type { StyleKitPreset } from '../../canvas/schema.js';

const CHARCOAL_DARK: Partial<StyleKitPreset> = {
  bg: '#050507',
  panel: '#0d0e11',
  muted: '#a8a8b2',
  surfaceVariants: {
    flat: { background: '#0d0e11', shadow: 'none' },
    raised: {
      background: '#13141a',
      shadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
      radius: '10px',
    },
    glass: {
      background: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      shadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
    },
    outlined: { background: 'transparent', border: '1px solid #1f2026' },
    sticker: {
      background: '#16171c',
      border: '1px solid #1f2026',
      shadow: '0 2px 0 #000, 0 8px 20px rgba(0, 0, 0, 0.5)',
      radius: '14px',
    },
    'editorial-frame': {
      background: 'transparent',
      border: '2px solid #d9dde4',
      radius: '0px',
    },
    'soft-panel': { background: '#101115', shadow: '0 1px 0 rgba(255,255,255,0.03) inset' },
  },
};

const BLUE_SAAS_DARK: Partial<StyleKitPreset> = {
  bg: '#04081a',
  panel: '#0a1430',
  muted: '#7791b8',
  accent: '#7aa5ff',
  accentText: '#04081a',
  surfaceVariants: {
    flat: { background: '#0a1430', shadow: 'none', radius: '12px' },
    raised: {
      background: '#0e1c4a',
      shadow: '0 16px 40px rgba(2, 6, 22, 0.7)',
      radius: '16px',
    },
    glass: {
      background: 'rgba(122, 165, 255, 0.08)',
      border: '1px solid rgba(122, 165, 255, 0.18)',
      shadow: '0 6px 18px rgba(2, 6, 22, 0.5)',
      radius: '12px',
    },
    outlined: { background: 'transparent', border: '1px solid #1a2e66' },
    sticker: {
      background: '#102254',
      border: '1px solid #1a2e66',
      shadow: '0 4px 0 #02061a, 0 10px 22px rgba(2, 6, 22, 0.55)',
      radius: '14px',
    },
    'editorial-frame': {
      background: 'transparent',
      border: '2px solid #7aa5ff',
      radius: '4px',
    },
    'soft-panel': { background: '#0c1944', shadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' },
  },
  actionVariants: {
    solid: { background: '#7aa5ff', color: '#04081a', weight: 600 },
    outline: { background: 'transparent', color: '#e8efff', border: '1px solid #7aa5ff' },
    ghost: { background: 'transparent', color: '#7791b8' },
    pill: { background: '#7aa5ff', color: '#04081a', weight: 600 },
    glass: {
      background: 'rgba(122, 165, 255, 0.12)',
      color: '#e8efff',
      border: '1px solid rgba(122, 165, 255, 0.28)',
    },
    brutalist: {
      background: '#04081a',
      color: '#e8efff',
      border: '2px solid #7aa5ff',
      weight: 700,
    },
    underline: { background: 'transparent', color: '#7aa5ff' },
  },
};

const BUILT_IN_DARK_TABLE: Record<string, Partial<StyleKitPreset>> = {
  charcoal: CHARCOAL_DARK,
  'blue-saas': BLUE_SAAS_DARK,
};

/**
 * Look up the built-in dark partial for a given kit id. Returns `undefined`
 * for unknown ids OR for known ids that intentionally have no dark variant
 * (e.g. `orange-editorial`, `green-organic`). The caller treats `undefined`
 * as "no dark variant authored for this kit — visitor dark mode is the
 * light kit unchanged."
 */
export function resolveBuiltInDark(kitId: string): Partial<StyleKitPreset> | undefined {
  if (!Object.prototype.hasOwnProperty.call(BUILT_IN_DARK_TABLE, kitId)) return undefined;
  return BUILT_IN_DARK_TABLE[kitId];
}

/**
 * Whole table — exported for the smoke and for any future surface that needs
 * to enumerate which built-ins have dark variants. Treat as read-only.
 */
export const BUILT_IN_DARK_VARIANTS: Readonly<Record<string, Partial<StyleKitPreset>>> =
  BUILT_IN_DARK_TABLE;
