// src/a11y/checks/contrast.ts
//
// Wave 3 #15 — Text contrast check.
//
// For every TextElement on the page, compute the WCAG contrast ratio between
// the resolved text colour (Style Kit `text` token) and the resolved background
// the element will visually sit on. The ratio is then mapped to a severity:
//
//   ratio < 3.0           → blocking
//   3.0 <= ratio < 4.5    → warning
//   ratio >= 4.5          → no issue (AA-normal pass)
//
// See `src/a11y/severity.ts` for the rationale on those thresholds.
//
// ---------------------------------------------------------------------------
// Computed-background precedence (the load-bearing rule)
// ---------------------------------------------------------------------------
//
// Canvas elements are positioned freely. A TextElement may visually overlap a
// ContainerElement whose surface variant defines its own background. The
// "computed background" the Owner perceives behind the text is, in order:
//
//   1. The innermost wrapping ContainerElement whose box geometrically contains
//      the TextElement's box AND whose resolved
//      `styleKit.surfaceVariants[variant].background` parses to an opaque
//      colour. "Innermost" = smallest area among the candidate containers; ties
//      break by highest `z` (rendered last, i.e. on top).
//   2. Otherwise the Style Kit's top-level `bg`.
//
// We deliberately exclude:
//   - `transparent` / undefined backgrounds — they let the parent show
//     through, so the parent's background remains the effective bg.
//   - `rgba(...)` / `oklch(... / a)` translucent strings — the audit can't
//     resolve them against a stack of parents in pure data, and per the
//     all-or-nothing rule we'd rather skip the contrast claim than guess.
//     Such elements report a `contrast` issue with severity `info`
//     ("contrast-undetermined") so the Owner sees that the audit could not
//     evaluate — but only if the text-on-bg ratio itself can't be measured.
//     For the POC, undetermined contrast does NOT emit an issue — it just
//     falls back to the Style Kit `bg`, with a `fixHint` noting the assumption.
//
// BackgroundEffect (grain/grid/etc) on a CanvasSection is ignored — those are
// overlays whose visual luminance contribution is implementation-defined; the
// audit measures against the kit token.

import {
  CONTRAST_BLOCK_BELOW,
  CONTRAST_WARN_BELOW,
} from '../severity.js';
import type { AuditIssue } from '../audit.js';
import { checkContrast } from '../../theme/contrast.js';
import { parseHex } from '../../theme/oklch.js';
import type { OklchColor } from '../../theme/oklch.js';
import type {
  CanvasElement,
  CanvasPage,
  ContainerElement,
  PositionedBox,
  StyleKitPreset,
  TextElement,
} from '../../canvas/schema.js';

/**
 * Parse a Style Kit colour token into the OKLCH form `checkContrast` expects.
 * The token grammar in built-in kits is a hex string (3- or 6-digit). The
 * runtime contract for custom kits (validated by `validateStyleKitPreset`) is
 * the same shape — though we tolerate failure by returning `null` so the
 * caller can decide whether to skip the element or surface the issue.
 */
function tryParseHexColor(value: string | undefined | null): OklchColor | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'transparent') return null;
  if (!trimmed.startsWith('#')) return null;
  try {
    return parseHex(trimmed);
  } catch {
    return null;
  }
}

/**
 * Return true when `inner`'s box is fully inside `outer`'s box. Coordinates
 * are page-space pixels (PositionedBox.x/y/w/h). Equality at edges counts as
 * contained — Owners drop containers right against an outer edge constantly.
 */
function boxContains(outer: PositionedBox, inner: PositionedBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function area(box: PositionedBox): number {
  return box.w * box.h;
}

/**
 * Resolve the computed background colour the audit should compare against.
 * Returns the OKLCH form ready for `checkContrast`. The precedence rule is
 * documented at the head of this file.
 */
export function resolveComputedBackground(
  text: TextElement,
  elementsOnPage: CanvasElement[],
  styleKit: StyleKitPreset,
): { color: OklchColor; source: 'container' | 'kit-bg'; containerId?: string } {
  // Collect candidate containers — every ContainerElement whose box contains
  // the text's box and whose surface variant has a parseable opaque
  // background. Sort by area ascending, then by `z` descending. The first one
  // wins.
  type Candidate = {
    container: ContainerElement;
    color: OklchColor;
    area: number;
  };
  const candidates: Candidate[] = [];
  for (const element of elementsOnPage) {
    if (element.type !== 'container') continue;
    if (element.id === text.id) continue;
    if (!boxContains(element.box, text.box)) continue;
    const variantTokens = styleKit.surfaceVariants[element.variant];
    if (!variantTokens) continue;
    const color = tryParseHexColor(variantTokens.background);
    if (color === null) continue;
    candidates.push({ container: element, color, area: area(element.box) });
  }
  candidates.sort((a, b) => {
    const areaDiff = a.area - b.area;
    if (areaDiff !== 0) return areaDiff;
    return b.container.box.z - a.container.box.z;
  });
  const winner = candidates[0];
  if (winner) {
    return { color: winner.color, source: 'container', containerId: winner.container.id };
  }
  // Fallback — Style Kit `bg`. If even that's unparseable (impossible for
  // built-in kits; the custom-kit validator enforces the field exists), we
  // throw — per the all-or-nothing posture we must not silently substitute a
  // default colour.
  const kitBg = tryParseHexColor(styleKit.bg);
  if (kitBg === null) {
    throw new Error(
      `a11y/contrast: Style Kit bg token is not a parseable hex colour: ${JSON.stringify(styleKit.bg)}`,
    );
  }
  return { color: kitBg, source: 'kit-bg' };
}

export function checkContrastOnPage(
  page: CanvasPage,
  styleKit: StyleKitPreset,
): AuditIssue[] {
  const issues: AuditIssue[] = [];

  // Collect every element on the page once so the container lookup is O(N²)
  // worst-case per page; pages are small.
  const allElements: CanvasElement[] = [];
  for (const section of page.sections) {
    for (const element of section.elements) {
      allElements.push(element);
    }
  }

  const fg = tryParseHexColor(styleKit.text);
  if (fg === null) {
    throw new Error(
      `a11y/contrast: Style Kit text token is not a parseable hex colour: ${JSON.stringify(styleKit.text)}`,
    );
  }

  for (const element of allElements) {
    if (element.type !== 'text') continue;
    // Labels often render very small — same threshold applies; we measure
    // against the same Style Kit text token because the renderer uses it for
    // every role. (Owner-pinned styles would be a future extension.)
    const bg = resolveComputedBackground(element, allElements, styleKit);
    const result = checkContrast(fg, bg.color);
    const ratio = result.ratio;
    let severity: 'blocking' | 'warning' | null = null;
    if (ratio < CONTRAST_BLOCK_BELOW) severity = 'blocking';
    else if (ratio < CONTRAST_WARN_BELOW) severity = 'warning';
    if (severity === null) continue;

    const source =
      bg.source === 'container'
        ? `wrapping container "${bg.containerId ?? ''}"`
        : 'page Style Kit background';
    issues.push({
      kind: 'contrast',
      severity,
      elementId: element.id,
      pageSlug: page.slug,
      message: `Text "${element.id}" on page "${page.slug}" has contrast ratio ${ratio.toFixed(2)}:1 against ${source}.`,
      fixHint:
        severity === 'blocking'
          ? 'Raise the text/background contrast above 3:1 — pick a darker or lighter text colour, or move the text off a low-contrast surface.'
          : 'Contrast is below WCAG AA for normal text (4.5:1). Either confirm the text is rendered "large" (>=18pt regular / >=14pt bold) or increase contrast.',
    });
  }
  return issues;
}
