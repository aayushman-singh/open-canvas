// src/theme/derive.ts
//
// Pure-function derivation: paletteSeed hex -> twelve-token graph.
//
// Mirrors the Variant D (Post-Aero) token archetype in
// docs/specs/design-variants.md so a recruited site can shift palette without
// breaking the design language. Rules are documented in SUBSYSTEM.md.

import { parseHex, toCss, toHex, type OklchColor } from './oklch.js';

export interface ThemeTokens {
  bgDeep: OklchColor;
  bgPanel: OklchColor;
  bgPanelStrong: OklchColor;
  fg: OklchColor;
  fgMute: OklchColor;
  accent: OklchColor;
  accentGlow: OklchColor;
  warn: OklchColor;
  ok: OklchColor;
  err: OklchColor;
  grid: OklchColor;
  hairline: OklchColor;
}

export type ThemeTokenName = keyof ThemeTokens;

export const THEME_TOKEN_NAMES: readonly ThemeTokenName[] = [
  'bgDeep',
  'bgPanel',
  'bgPanelStrong',
  'fg',
  'fgMute',
  'accent',
  'accentGlow',
  'warn',
  'ok',
  'err',
  'grid',
  'hairline',
] as const;

// The colourfulness floor for "is this seed chromatic enough to use its hue
// directly?" — below ~0.04 chroma OKLCH the hue angle becomes unstable and a
// fixed rotation lands a more pleasant accent.
const CHROMATIC_FLOOR = 0.04;

export function deriveTokens(seedHex: string): ThemeTokens {
  const seed = parseHex(seedHex);

  const bgDeep: OklchColor = { l: 0.12, c: 0.03, h: seed.h };
  const bgPanel: OklchColor = { l: bgDeep.l + 0.08, c: 0.04, h: seed.h, a: 0.8 };
  const bgPanelStrong: OklchColor = { l: bgPanel.l + 0.02, c: 0.04, h: seed.h, a: 0.95 };

  const fg: OklchColor = { l: 0.96, c: 0.02, h: seed.h };
  const fgMute: OklchColor = { l: 0.7, c: 0.04, h: seed.h };

  const accentHue = seed.c >= CHROMATIC_FLOOR ? seed.h : (seed.h + 200) % 360;
  const accent: OklchColor = { l: 0.78, c: 0.15, h: accentHue };
  const accentGlow: OklchColor = { l: 0.78, c: 0.18, h: accentHue, a: 0.4 };

  const warn: OklchColor = { l: 0.82, c: 0.18, h: 70 };
  const ok: OklchColor = { l: 0.82, c: 0.18, h: 145 };
  const err: OklchColor = { l: 0.82, c: 0.18, h: 25 };

  const grid: OklchColor = { l: 0.4, c: 0.02, h: seed.h, a: 0.08 };
  const hairline: OklchColor = { l: 0.6, c: 0.02, h: seed.h, a: 0.28 };

  return {
    bgDeep,
    bgPanel,
    bgPanelStrong,
    fg,
    fgMute,
    accent,
    accentGlow,
    warn,
    ok,
    err,
    grid,
    hairline,
  };
}

// ---------------------------------------------------------------------------
// CSS emission. Both maps are exposed so callers can pick their integration
// path: inline-style declarations for the article element (render.ts) or a
// flat name->value map for swatch tables.
// ---------------------------------------------------------------------------

export const TOKEN_TO_CSS_VAR: Record<ThemeTokenName, string> = {
  bgDeep: '--rev01-bg-deep',
  bgPanel: '--rev01-bg-panel',
  bgPanelStrong: '--rev01-bg-panel-strong',
  fg: '--rev01-fg',
  fgMute: '--rev01-fg-mute',
  accent: '--rev01-accent',
  accentGlow: '--rev01-accent-glow',
  warn: '--rev01-warn',
  ok: '--rev01-ok',
  err: '--rev01-err',
  grid: '--rev01-grid',
  hairline: '--rev01-hairline',
};

export function tokensToCssDecls(tokens: ThemeTokens): string {
  return (Object.keys(TOKEN_TO_CSS_VAR) as ThemeTokenName[])
    .map((name) => `${TOKEN_TO_CSS_VAR[name]}: ${toCss(tokens[name])};`)
    .join(' ');
}

export function tokensToHexMap(tokens: ThemeTokens): Record<ThemeTokenName, string> {
  return {
    bgDeep: toHex(tokens.bgDeep),
    bgPanel: toHex(tokens.bgPanel),
    bgPanelStrong: toHex(tokens.bgPanelStrong),
    fg: toHex(tokens.fg),
    fgMute: toHex(tokens.fgMute),
    accent: toHex(tokens.accent),
    accentGlow: toHex(tokens.accentGlow),
    warn: toHex(tokens.warn),
    ok: toHex(tokens.ok),
    err: toHex(tokens.err),
    grid: toHex(tokens.grid),
    hairline: toHex(tokens.hairline),
  };
}
