// src/a11y/checks/action-labels.ts
//
// Wave 3 #15 — Action element label presence check.
//
// An ActionElement renders as an <a class="rev01-action"> — Visitors and
// screen readers identify it solely by its label text. Empty labels yield
// "Link" announcements with no destination context. Block at publish time.

import { DEFAULT_SEVERITY_BY_KIND } from '../severity.js';
import type { AuditIssue } from '../audit.js';
import type { CanvasPage } from '../../canvas/schema.js';

export function checkActionLabels(page: CanvasPage): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const section of page.sections) {
    for (const element of section.elements) {
      if (element.type !== 'action') continue;
      if (typeof element.label !== 'string' || element.label.trim() === '') {
        issues.push({
          kind: 'missing-action-label',
          severity: DEFAULT_SEVERITY_BY_KIND['missing-action-label'],
          elementId: element.id,
          pageSlug: page.slug,
          message: `Action "${element.id}" on page "${page.slug}" has no label — it would render as an empty link.`,
          fixHint:
            'Open the action in the editor and add a visible label (e.g. "Get started", "Read more").',
        });
      }
    }
  }
  return issues;
}
