// src/a11y/checks/alt-text.ts
//
// Alt-text presence check.
//
// Walks a CanvasPage and emits a blocking issue for every MediaElement whose
// `alt` field is missing or empty (after trim). The MediaElement schema in
// `src/canvas/schema.ts` already declares `alt: string` as required, so the
// rendered Owner editor cannot omit the field outright — this guard catches
// the empty-string case where the Owner left the input blank.
//
// Decorative images: gamma-parity POC does NOT distinguish decorative from
// content media. Every MediaElement must carry an alt. If the Owner wants a
// pure-decoration image they can place a Shape primitive instead, or set
// `alt=""` and accept the blocking issue (which is the right friction —
// rendering an alt-less <img> for a Visitor with reduced vision is the bug
// this check exists to prevent).

import { DEFAULT_SEVERITY_BY_KIND } from '../severity.js';
import type { AuditIssue } from '../audit.js';
import type { CanvasPage } from '../../canvas/schema.js';

export function checkAltText(page: CanvasPage): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const section of page.sections) {
    for (const element of section.elements) {
      if (element.type !== 'media') continue;
      // Trim to catch whitespace-only alts. The schema type forbids `undefined`
      // here so the only failure mode is the empty/whitespace string.
      if (typeof element.alt !== 'string' || element.alt.trim() === '') {
        issues.push({
          kind: 'missing-alt',
          severity: DEFAULT_SEVERITY_BY_KIND['missing-alt'],
          elementId: element.id,
          pageSlug: page.slug,
          message: `Image on page "${page.slug}" is missing alt text.`,
          fixHint:
            'Open the element in the editor and write a short alt description (one sentence is plenty).',
        });
      }
    }
  }
  return issues;
}
