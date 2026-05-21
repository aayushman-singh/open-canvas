// src/theme/contrast.ts
//
// WCAG 2.x AA/AAA pass/fail evaluator for any fg/bg pairing.
//
// Thresholds (WCAG 2.2 SC 1.4.3 + 1.4.6):
//   AA normal text:  >= 4.5
//   AA large text:   >= 3.0
//   AAA normal text: >= 7.0
//   AAA large text:  >= 4.5
// "Large" = >=18pt regular or >=14pt bold. The studio reports both columns
// so the operator can pick.

import { contrastRatio, oklchToSrgb, type OklchColor } from './oklch.js';

export type WcagVerdict = 'pass' | 'fail';

export interface ContrastResult {
  ratio: number;
  aaNormal: WcagVerdict;
  aaLarge: WcagVerdict;
  aaaNormal: WcagVerdict;
  aaaLarge: WcagVerdict;
}

export function checkContrast(fg: OklchColor, bg: OklchColor): ContrastResult {
  // Alpha is intentionally ignored — WCAG is defined for opaque pairings.
  // Translucent tokens get their ratio measured against their nominal colour.
  const ratio = contrastRatio(oklchToSrgb(fg), oklchToSrgb(bg));
  return {
    ratio,
    aaNormal: ratio >= 4.5 ? 'pass' : 'fail',
    aaLarge: ratio >= 3 ? 'pass' : 'fail',
    aaaNormal: ratio >= 7 ? 'pass' : 'fail',
    aaaLarge: ratio >= 4.5 ? 'pass' : 'fail',
  };
}
