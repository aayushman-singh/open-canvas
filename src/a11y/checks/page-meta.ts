// src/a11y/checks/page-meta.ts
//
// Wave 3 #15 — Page metadata presence checks.
//
// Two concerns, both feed the eventual SEO + browser-tab UX:
//
//   1. `CanvasPage.title` — REQUIRED by schema, but the schema type alone
//      doesn't catch the "title === ''" case. The renderer falls back to the
//      site name when the title is empty at runtime; that is acceptable for
//      rendering but is still a publish-time defect — assistive tech and
//      browser tab UIs treat the page title as the canonical landmark. Block.
//
//   2. `CanvasPage.description` — OPTIONAL today, will be promoted to a
//      meaningful SEO field by Wave 3 #21. The audit emits an `info` issue
//      when a published page has no description so Owners get a visible
//      reminder once #21 lands. Forward-compat — does NOT block publish.

import { DEFAULT_SEVERITY_BY_KIND } from '../severity.js';
import type { AuditIssue } from '../audit.js';
import type { CanvasPage } from '../../canvas/schema.js';

export function checkPageMeta(page: CanvasPage): AuditIssue[] {
  const issues: AuditIssue[] = [];

  if (typeof page.title !== 'string' || page.title.trim() === '') {
    issues.push({
      kind: 'missing-page-title',
      severity: DEFAULT_SEVERITY_BY_KIND['missing-page-title'],
      pageSlug: page.slug,
      message: `Page "${page.slug}" has no title — set a name for the page (e.g. "About", "Pricing").`,
      fixHint:
        'Open Page Settings in the editor and fill in the title field. It drives both the browser tab and the screen-reader landmark for this page.',
    });
  }

  // description: present-as-undefined or whitespace-only both count as
  // "missing" for the forward-compat #21 warning. Empty string is what the
  // schema-validator produces today when the Owner leaves the input blank.
  const description = page.description;
  if (typeof description !== 'string' || description.trim() === '') {
    issues.push({
      kind: 'missing-page-description',
      severity: DEFAULT_SEVERITY_BY_KIND['missing-page-description'],
      pageSlug: page.slug,
      message: `Page "${page.slug}" has no description — search-engine previews will fall back to a generic snippet.`,
      fixHint:
        'Open Page Settings and write a one-line summary of the page (~140 chars). Used as the meta description once SEO landing wave merges (#21).',
    });
  }

  return issues;
}
