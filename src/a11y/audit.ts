// src/a11y/audit.ts
//
// Top-level a11y audit runner.
//
// Contract:
//   - Pure function: `runAudit(state: EditableSite): AuditReport`.
//   - Walks every page; runs each registered check; aggregates the issue list.
//   - NO publishing side-effect — that's the caller's job. The publish path
//     in `src/routes/api/publish.ts` runs the audit but no longer aborts on
//     `blockerCount > 0`; the dashboard report (`/dashboard/sites/:id/a11y`)
//     is where Owners triage findings post-ship. The "audit only" route in
//     `src/a11y/route.ts` simply returns the report.
//
// All-or-nothing posture (per global CLAUDE.md):
//   - A check that throws (e.g. an element type the audit didn't anticipate,
//     a Style Kit field that fails to parse) MUST be reported as a
//     `blocking` issue with kind `'audit-crash'`. The error message is
//     surfaced verbatim so the Owner / developer sees the real failure rather
//     than a sanitized fallback. The runner does NOT swallow the error; the
//     caller still sees a structured report instead of a 500.
//
// Severity counters are derived once at the end — every issue's severity is
// already typed (the constructors hard-fail on a typo).

import { compareSeverity, type IssueKind, type Severity } from './severity.js';
import { checkAltText } from './checks/alt-text.js';
import { checkContrastOnPage } from './checks/contrast.js';
import { checkHeadingOrder } from './checks/heading-order.js';
import { checkActionLabels } from './checks/action-labels.js';
import { checkFormFields } from './checks/form-fields.js';
import { checkPageMeta } from './checks/page-meta.js';
import { resolveStyleKitWithCustom } from '../themes/custom-resolve.js';
import type { CanvasPage, EditableSite, StyleKitPreset } from '../canvas/schema.js';

export interface AuditIssue {
  kind: IssueKind;
  severity: Severity;
  /** Set when the issue can be traced to a specific element. */
  elementId?: string;
  /** Set when the issue is page-scoped (always set in practice today). */
  pageSlug?: string;
  message: string;
  /** Plain-language remediation hint shown to the Owner in the dashboard. */
  fixHint?: string;
}

export interface AuditReport {
  issues: AuditIssue[];
  blockerCount: number;
  warningCount: number;
  infoCount: number;
}

type PageCheck = (page: CanvasPage, styleKit: StyleKitPreset) => AuditIssue[];

interface CheckEntry {
  name: string;
  run: PageCheck;
}

// Order matters only for stable test output — the report sorts by severity
// then by page+kind at the end. The list is closed (no plugins) by design.
const PAGE_CHECKS: ReadonlyArray<CheckEntry> = [
  { name: 'alt-text', run: (page) => checkAltText(page) },
  { name: 'contrast', run: (page, kit) => checkContrastOnPage(page, kit) },
  { name: 'heading-order', run: (page, kit) => checkHeadingOrder(page, kit) },
  { name: 'action-labels', run: (page) => checkActionLabels(page) },
  { name: 'form-fields', run: (page) => checkFormFields(page) },
  { name: 'page-meta', run: (page) => checkPageMeta(page) },
];

function runChecksOnPage(
  page: CanvasPage,
  styleKit: StyleKitPreset,
): AuditIssue[] {
  const collected: AuditIssue[] = [];
  for (const entry of PAGE_CHECKS) {
    try {
      const issues = entry.run(page, styleKit);
      for (const issue of issues) collected.push(issue);
    } catch (err) {
      // Per "all-or-nothing": loud failure, never silent. The error message
      // carries enough context to debug from logs alone.
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        `[a11y] check "${entry.name}" crashed on page "${page.slug}"`,
        err,
      );
      collected.push({
        kind: 'audit-crash',
        severity: 'blocking',
        pageSlug: page.slug,
        message: `A11y check "${entry.name}" crashed on page "${page.slug}": ${detail}`,
        fixHint:
          'This indicates a bug in the audit subsystem itself (or a malformed element). Open an issue with the page + element ids.',
      });
    }
  }
  return collected;
}

/**
 * Run the audit over an editable Canvas Site State and return the report. The
 * caller (publish endpoint, dashboard route, smoke harness) reads the
 * structured `AuditReport` shape.
 */
export function runAudit(state: EditableSite): AuditReport {
  const issues: AuditIssue[] = [];

  // Resolving the Style Kit can itself throw (custom-kit validator hard-fails
  // on a malformed preset). Surface that as a `blocking` `audit-crash` issue
  // covering the whole site rather than letting the throw escape — the
  // dashboard UI needs a structured report even in this degenerate case.
  let styleKit: StyleKitPreset;
  try {
    styleKit = resolveStyleKitWithCustom(state);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[a11y] style kit resolution failed', err);
    return {
      issues: [
        {
          kind: 'audit-crash',
          severity: 'blocking',
          message: `Could not resolve Style Kit for this site: ${detail}`,
          fixHint:
            'Re-pick a built-in Style Kit (or fix the Custom theme preset) and try again.',
        },
      ],
      blockerCount: 1,
      warningCount: 0,
      infoCount: 0,
    };
  }

  for (const page of state.pages) {
    for (const issue of runChecksOnPage(page, styleKit)) issues.push(issue);
  }

  // Stable ordering: blocking first, then warning, then info. Within a
  // severity rung, keep the discovery order (which already reflects page +
  // check order). The sort is stable in modern JS engines.
  issues.sort((a, b) => -compareSeverity(a.severity, b.severity));

  let blockerCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const issue of issues) {
    if (issue.severity === 'blocking') blockerCount += 1;
    else if (issue.severity === 'warning') warningCount += 1;
    else infoCount += 1;
  }

  return { issues, blockerCount, warningCount, infoCount };
}
