// src/charts/colors.ts
//
// Derive a 5-colour palette from the active Style Kit accent.
//
// Algorithm (documented for the smoke + future palette tweaks):
//
//   1. Parse `kit.accent` (hex string `#rrggbb` or `#rgb`) into sRGB.
//   2. Convert to HSL (single-channel hue, saturation, lightness — cheap,
//      no dependency on the OKLCH module under `src/theme/`).
//   3. Emit 5 colours by rotating hue and nudging lightness:
//        slot 0: accent as-is.
//        slot 1: H + 36°, L unchanged.
//        slot 2: H - 36°, L + 0.10 (clamped to [0.25, 0.75]).
//        slot 3: H + 72°, L - 0.10.
//        slot 4: H - 72°, L + 0.05.
//      The 36°/72° spacing falls inside one quadrant of the wheel, so every
//      slot still reads as "the kit accent's family." Wider rotations
//      (90°+/120°) drift into rival families and stop feeling on-brand.
//   4. Saturation is held at the accent's saturation, clamped to [0.45, 0.85]
//      so we never collapse into greys and never glare.
//   5. Lightness is clamped to [0.25, 0.75] for the same readability
//      contract — bright greens and deep navies both produce a band that
//      sits comfortably on either light- or dark-bg kits.
//
// Pure math. No DOM, no I/O. Used by every chart kind.

import { getStyleKitPreset } from '../canvas/style-kits.js';

export interface HslColor {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

/**
 * Parse `#rgb` / `#rrggbb` into `{ r, g, b }` in 0..255. Throws on garbage so
 * a corrupt kit accent crashes loudly rather than silently producing greys.
 */
export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  if (typeof hex !== 'string' || hex.length === 0) {
    throw new Error(`parseHexColor: expected non-empty string, got ${String(hex)}`);
  }
  const cleaned = hex.trim().replace(/^#/, '');
  let r: number;
  let g: number;
  let b: number;
  if (cleaned.length === 3) {
    r = parseInt(cleaned[0]! + cleaned[0]!, 16);
    g = parseInt(cleaned[1]! + cleaned[1]!, 16);
    b = parseInt(cleaned[2]! + cleaned[2]!, 16);
  } else if (cleaned.length === 6) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  } else {
    throw new Error(`parseHexColor: expected 3 or 6 hex chars, got "${hex}"`);
  }
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    throw new Error(`parseHexColor: non-numeric components in "${hex}"`);
  }
  return { r, g, b };
}

/** Convert sRGB (0..255) to HSL (h: 0..360, s/l: 0..1). */
export function rgbToHsl(r: number, g: number, b: number): HslColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d) % 6;
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default: // bn
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hueToRgb(p: number, q: number, t: number): number {
  let tn = t;
  if (tn < 0) tn += 1;
  if (tn > 1) tn -= 1;
  if (tn < 1 / 6) return p + (q - p) * 6 * tn;
  if (tn < 1 / 2) return q;
  if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
  return p;
}

/** Convert HSL back to `#rrggbb`. */
export function hslToHex({ h, s, l }: HslColor): string {
  const hh = (((h % 360) + 360) % 360) / 360;
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, hh + 1 / 3);
    g = hueToRgb(p, q, hh);
    b = hueToRgb(p, q, hh - 1 / 3);
  }
  const toHex = (v: number): string => {
    const n = Math.round(v * 255);
    const clamped = Math.max(0, Math.min(255, n));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const CHART_PALETTE_SIZE = 5 as const;

interface PaletteOffset {
  hueDeg: number;
  lightnessDelta: number;
}

// Five offsets in slot order. Slot 0 is the accent itself.
const PALETTE_OFFSETS: ReadonlyArray<PaletteOffset> = [
  { hueDeg: 0, lightnessDelta: 0 },
  { hueDeg: 36, lightnessDelta: 0 },
  { hueDeg: -36, lightnessDelta: 0.1 },
  { hueDeg: 72, lightnessDelta: -0.1 },
  { hueDeg: -72, lightnessDelta: 0.05 },
];

const SATURATION_FLOOR = 0.45;
const SATURATION_CEIL = 0.85;
const LIGHTNESS_FLOOR = 0.25;
const LIGHTNESS_CEIL = 0.75;

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Build the 5-slot palette from a hex accent. Independent of the kit lookup
 * so the smoke can exercise the math without touching style-kits.ts.
 */
export function buildPaletteFromAccent(accentHex: string): string[] {
  const { r, g, b } = parseHexColor(accentHex);
  const base = rgbToHsl(r, g, b);
  const s = clamp(base.s, SATURATION_FLOOR, SATURATION_CEIL);
  const out: string[] = [];
  for (const offset of PALETTE_OFFSETS) {
    const h = base.h + offset.hueDeg;
    const l = clamp(base.l + offset.lightnessDelta, LIGHTNESS_FLOOR, LIGHTNESS_CEIL);
    out.push(hslToHex({ h, s, l }));
  }
  if (out.length !== CHART_PALETTE_SIZE) {
    // Belt-and-braces — if a future refactor changes PALETTE_OFFSETS by
    // accident, this surfaces the contract violation at the moment the chart
    // tries to render.
    throw new Error(
      `buildPaletteFromAccent: expected ${String(CHART_PALETTE_SIZE)} colours, produced ${String(out.length)}`,
    );
  }
  return out;
}

/**
 * Resolve the active accent for a chart by Style Kit name and produce the
 * palette. The 'custom' kit (Wave 2 #10) is intentionally not handled here:
 * the custom-theme owner wires `customStyleKit` into the renderer separately
 * and may pass an accent through different plumbing — chart palette resolves
 * only against built-in kits today.
 */
let _customAccent: string | null = null;

export function configureChartPalette(opts: { customAccent: string | null }): void {
  _customAccent = opts.customAccent;
}

export function buildChartPalette(styleKitName: string): string[] {
  if (styleKitName === 'custom') {
    if (!_customAccent) {
      throw new Error(
        'buildChartPalette: styleKit is "custom" but configureChartPalette was not called with the resolved accent.',
      );
    }
    return buildPaletteFromAccent(_customAccent);
  }
  const preset = getStyleKitPreset(styleKitName);
  return buildPaletteFromAccent(preset.accent);
}

export const CHART_PALETTE_LENGTH = CHART_PALETTE_SIZE;
