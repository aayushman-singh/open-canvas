// src/theme/oklch.ts
//
// Pure colour math: hex <-> sRGB <-> linear-RGB <-> XYZ <-> OKLab <-> OKLCH,
// plus WCAG 2.x relative luminance + contrast ratio. Zero deps.
//
// Math sources: Bjorn Ottosson "A perceptual color space for image
// processing" (oklab.com, 2020) and the W3C "Relative luminance" formula.
// Documented in SUBSYSTEM.md.

export interface RgbColor {
  r: number; // 0..1
  g: number; // 0..1
  b: number; // 0..1
}

export interface OklchColor {
  l: number; // 0..1
  c: number; // 0..~0.4
  h: number; // 0..360 degrees
  a?: number; // 0..1 opacity
}

// ---------------------------------------------------------------------------
// Hex parsing.
// ---------------------------------------------------------------------------

export function parseHex(hex: string): OklchColor {
  const cleaned = hex.trim().replace(/^#/, '');
  let r: number;
  let g: number;
  let b: number;
  if (cleaned.length === 3) {
    r = parseInt(cleaned[0]! + cleaned[0]!, 16) / 255;
    g = parseInt(cleaned[1]! + cleaned[1]!, 16) / 255;
    b = parseInt(cleaned[2]! + cleaned[2]!, 16) / 255;
  } else if (cleaned.length === 6) {
    r = parseInt(cleaned.slice(0, 2), 16) / 255;
    g = parseInt(cleaned.slice(2, 4), 16) / 255;
    b = parseInt(cleaned.slice(4, 6), 16) / 255;
  } else {
    throw new Error(`parseHex: expected 3 or 6 hex chars, got "${hex}"`);
  }
  if (!isFinite(r) || !isFinite(g) || !isFinite(b)) {
    throw new Error(`parseHex: non-numeric components in "${hex}"`);
  }
  return srgbToOklch({ r, g, b });
}

// ---------------------------------------------------------------------------
// sRGB <-> linear.
// ---------------------------------------------------------------------------

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ---------------------------------------------------------------------------
// OKLab transform matrices (Ottosson 2020).
// ---------------------------------------------------------------------------

function linearRgbToOklab(rgb: RgbColor): { L: number; a: number; b: number } {
  const l = 0.4122214708 * rgb.r + 0.5363325363 * rgb.g + 0.0514459929 * rgb.b;
  const m = 0.2119034982 * rgb.r + 0.6806995451 * rgb.g + 0.1073969566 * rgb.b;
  const s = 0.0883024619 * rgb.r + 0.2817188376 * rgb.g + 0.6299787005 * rgb.b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinearRgb(lab: { L: number; a: number; b: number }): RgbColor {
  const l_ = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

// ---------------------------------------------------------------------------
// sRGB <-> OKLCH (the user-facing pair).
// ---------------------------------------------------------------------------

export function srgbToOklch(rgb: RgbColor): OklchColor {
  const linear: RgbColor = {
    r: srgbChannelToLinear(rgb.r),
    g: srgbChannelToLinear(rgb.g),
    b: srgbChannelToLinear(rgb.b),
  };
  const { L, a, b } = linearRgbToOklab(linear);
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

export function oklchToSrgb(c: OklchColor): RgbColor {
  const hr = (c.h * Math.PI) / 180;
  const lab = { L: c.l, a: c.c * Math.cos(hr), b: c.c * Math.sin(hr) };
  const linear = oklabToLinearRgb(lab);
  return {
    r: clamp01(linearChannelToSrgb(linear.r)),
    g: clamp01(linearChannelToSrgb(linear.g)),
    b: clamp01(linearChannelToSrgb(linear.b)),
  };
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ---------------------------------------------------------------------------
// Serialisation.
// ---------------------------------------------------------------------------

export function toCss(c: OklchColor): string {
  const l = round(c.l, 4);
  const ch = round(c.c, 4);
  const h = round(c.h, 2);
  if (c.a !== undefined && c.a < 1) {
    return `oklch(${String(l)} ${String(ch)} ${String(h)} / ${String(round(c.a, 3))})`;
  }
  return `oklch(${String(l)} ${String(ch)} ${String(h)})`;
}

export function toHex(c: OklchColor): string {
  const { r, g, b } = oklchToSrgb(c);
  const toByte = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

function round(v: number, places: number): number {
  const mul = Math.pow(10, places);
  return Math.round(v * mul) / mul;
}

// ---------------------------------------------------------------------------
// WCAG relative luminance + contrast ratio.
// Reference: WCAG 2.2 §"Relative luminance" + §"Contrast ratio".
// ---------------------------------------------------------------------------

export function relativeLuminance(rgb: RgbColor): number {
  const r = srgbChannelToLinear(rgb.r);
  const g = srgbChannelToLinear(rgb.g);
  const b = srgbChannelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const L1 = Math.max(la, lb);
  const L2 = Math.min(la, lb);
  return (L1 + 0.05) / (L2 + 0.05);
}
