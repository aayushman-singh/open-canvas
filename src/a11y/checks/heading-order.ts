// src/a11y/checks/heading-order.ts
//
// Heading order check.
//
// Schema realities for the POC:
//   - TextElement.role is just `'heading' | 'body' | 'label'` — it carries NO
//     explicit H-level (H1 vs H2 vs H3). The renderer in src/canvas/elements/text.ts
//     emits a flat `<h1>` for every heading today, which itself is an a11y
//     concern but lives outside this audit's scope.
//   - To detect "H1 → H3 without H2" we MUST derive a numeric level for each
//     heading. We do so from `fontSize` via a per-Style-Kit ladder.
//
// ---------------------------------------------------------------------------
// fontSize → H-level derivation (the load-bearing heuristic)
// ---------------------------------------------------------------------------
//
// Each built-in kit has a `headingScale` multiplier. The published renderer
// emits the Owner-set absolute `fontSize` directly. We define a canonical
// six-rung ladder of base sizes that roughly matches gamma/template defaults:
//
//   H1 >= 48 px
//   H2 >= 36 px
//   H3 >= 28 px
//   H4 >= 22 px
//   H5 >= 18 px
//   H6 anything smaller
//
// We scale the ladder by `styleKit.headingScale` so kits whose displays are
// inherently larger (orange-editorial = 1.15) don't over-promote a 44px
// heading from H2 to H1 just because of the kit. Concretely, the rung
// thresholds are `baseRungPx * headingScale`.
//
// "Walk + skip detection" then becomes: traverse heading-role TextElements in
// document order across the entire page (section order, then element-in-
// section order). The first heading sets the current level (H1 if none seen
// yet, else its derived level). For each subsequent heading, the next level
// must satisfy `next <= current + 1`. A jump bigger than +1 (e.g. H1 → H3) is
// a `heading-skip` warning whose message names BOTH headings.
//
// Going UP a level (H3 → H1, for example) is NOT flagged — Owners commonly
// chunk content with a fresh H1-per-section style. Gamma's own UX leans into
// that. We surface only forward skips.
//
// Edge case: the FIRST heading on a page that isn't H1 is also a skip
// (implicit "H1 → Hk for k>1" jump). We flag that as the same kind.

import { DEFAULT_SEVERITY_BY_KIND } from '../severity.js';
import type { AuditIssue } from '../audit.js';
import type { CanvasPage, StyleKitPreset, TextElement } from '../../canvas/schema.js';

// Base rung thresholds in px before applying the kit's headingScale. The order
// is from highest H-level (i.e. largest font) to lowest.
const BASE_HEADING_RUNGS_PX: ReadonlyArray<{ level: 1 | 2 | 3 | 4 | 5 | 6; minPx: number }> = [
  { level: 1, minPx: 48 },
  { level: 2, minPx: 36 },
  { level: 3, minPx: 28 },
  { level: 4, minPx: 22 },
  { level: 5, minPx: 18 },
];

/** Map a TextElement.fontSize to an H-level (1..6) given the kit's scale. */
export function deriveHeadingLevel(
  fontSize: number,
  headingScale: number,
): 1 | 2 | 3 | 4 | 5 | 6 {
  if (headingScale <= 0) return 6;
  for (const rung of BASE_HEADING_RUNGS_PX) {
    if (fontSize >= rung.minPx * headingScale) return rung.level;
  }
  return 6;
}

/**
 * Inverse of {@link deriveHeadingLevel} for levels 1..5: the smallest `fontSize`
 * that derives to exactly `level` under `headingScale`. Used by a11y
 * remediation to compute the font size that demotes/promotes a heading to a
 * specific level so a `heading-skip` is removed. The rungs are strictly
 * decreasing in `minPx`, so `rung[level].minPx * scale` lands inside level
 * `level`'s band (≥ its own threshold, < the next-higher rung's). Level 6 has
 * no lower bound, so it is not a valid target.
 */
export function targetFontSizeForLevel(
  level: 1 | 2 | 3 | 4 | 5,
  headingScale: number,
): number {
  const rung = BASE_HEADING_RUNGS_PX.find((r) => r.level === level);
  if (!rung) {
    throw new Error(`targetFontSizeForLevel: no rung for level ${String(level)}`);
  }
  return rung.minPx * headingScale;
}

interface HeadingHit {
  element: TextElement;
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

export function checkHeadingOrder(
  page: CanvasPage,
  styleKit: StyleKitPreset,
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const headings: HeadingHit[] = [];

  for (const section of page.sections) {
    for (const element of section.elements) {
      if (element.type !== 'text') continue;
      if (element.role !== 'heading') continue;
      headings.push({
        element,
        level: deriveHeadingLevel(element.fontSize, styleKit.headingScale),
      });
    }
  }

  // No headings → no order to enforce. (Pages with zero headings get flagged
  // by other checks like missing page title, not here.)
  if (headings.length === 0) return issues;

  // First heading: implicit "previous level" is 0, so any first heading whose
  // level > 1 is a skip. The plan's smoke #4 (H1 → H3) tests the forward-skip
  // path with two headings; the first-heading-not-H1 case is the same kind.
  let current = 0;
  for (const hit of headings) {
    if (hit.level > current + 1) {
      const from = current === 0 ? 'page start' : `H${String(current)}`;
      // Snippet of the heading's actual text so the Owner can spot it
      // without having to know the element's internal id.
      const snippet = hit.element.content
        .map((r) => r.text)
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40);
      const subject = snippet.length > 0 ? `Heading "${snippet}"` : 'Heading';
      issues.push({
        kind: 'heading-skip',
        severity: DEFAULT_SEVERITY_BY_KIND['heading-skip'],
        elementId: hit.element.id,
        pageSlug: page.slug,
        message: `${subject} on page "${page.slug}" jumps from ${from} to H${String(hit.level)}.`,
        fixHint:
          'Add the missing intermediate heading level, or reduce the font size of the larger heading so the visual + semantic order line up.',
      });
    }
    current = hit.level;
  }
  return issues;
}
