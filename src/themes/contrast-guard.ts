// src/themes/contrast-guard.ts
//
// UI-friendly wrapper around `src/theme/contrast.ts`. The theme panel renders
// inline warnings when an Owner picks a colour combination that breaks
// accessibility minimums. The panel does not need WCAG verdicts on
// AA/AAA-normal/large columns; it only needs:
//
//   1. Is the bg/text pair under the AA-normal threshold (4.5:1)?
//   2. Is the accent/accentText pair under the AA-large threshold (3.0:1)?
//
// Returns one warning entry per failing pair. Empty array = no warnings.
//
// The thresholds match WCAG 2.2 SC 1.4.3 (AA normal text) and SC 1.4.11
// (UI components, non-text large). They are reused from `src/theme/contrast.ts`
// rather than re-derived so contrast logic stays in one place.

import { parseHex } from '../theme/oklch.js';
import { checkContrast } from '../theme/contrast.js';
import type { StyleKitPreset } from '../canvas/schema.js';

export type ContrastWarningKind = 'bg-text' | 'accent-accent-text';

export interface ContrastWarning {
  kind: ContrastWarningKind;
  /** Actual measured contrast ratio (range >= 1, typically 1..21). */
  ratio: number;
  /** Threshold the pair failed. */
  threshold: number;
  /** The colours that produced the failing ratio. Hex strings as Owner authored them. */
  pair: {
    foreground: string;
    background: string;
  };
}

/** Minimum bg/text ratio per WCAG AA normal text (1.4.3). */
export const BG_TEXT_AA_THRESHOLD = 4.5;

/** Minimum accent/accentText ratio per WCAG AA large/non-text (1.4.11). */
export const ACCENT_AA_THRESHOLD = 3.0;

/**
 * Inspect a kit's colour tokens and return one warning per failing pair.
 *
 * Empty array = the kit passes both contrast checks. The panel displays the
 * array under the colour controls and refuses to silently hide a warning;
 * the Owner can still save the kit (the contract is advisory, not blocking)
 * but the warning is visible before they do.
 *
 * If `parseHex` rejects a token (malformed hex), the function throws. This is
 * the "fail loud" path — a malformed colour means the Owner-side colour input
 * accepted something it shouldn't have, and quietly hiding the warning would
 * mislead the Owner into thinking their kit passes.
 */
export function checkKitContrast(
  kit: Pick<StyleKitPreset, 'bg' | 'text' | 'accent' | 'accentText'>,
): ContrastWarning[] {
  const warnings: ContrastWarning[] = [];
  // bg ↔ text (AA normal text — body copy reads against the page background).
  const bgTextRatio = measureContrast(kit.text, kit.bg);
  if (bgTextRatio < BG_TEXT_AA_THRESHOLD) {
    warnings.push({
      kind: 'bg-text',
      ratio: bgTextRatio,
      threshold: BG_TEXT_AA_THRESHOLD,
      pair: { foreground: kit.text, background: kit.bg },
    });
  }
  // accent ↔ accentText (AA non-text large — used on buttons / accents where
  // the bar is 3.0 not 4.5 because the typography is presumed larger).
  const accentRatio = measureContrast(kit.accentText, kit.accent);
  if (accentRatio < ACCENT_AA_THRESHOLD) {
    warnings.push({
      kind: 'accent-accent-text',
      ratio: accentRatio,
      threshold: ACCENT_AA_THRESHOLD,
      pair: { foreground: kit.accentText, background: kit.accent },
    });
  }
  return warnings;
}

function measureContrast(fgHex: string, bgHex: string): number {
  // Both inputs are hex strings stored verbatim in the kit. `parseHex` does
  // the sRGB → OKLCH conversion; `checkContrast` does the WCAG ratio. Round
  // to two decimal places so the UI displays a stable value across renders.
  const fg = parseHex(fgHex);
  const bg = parseHex(bgHex);
  const result = checkContrast(fg, bg);
  return Math.round(result.ratio * 100) / 100;
}
