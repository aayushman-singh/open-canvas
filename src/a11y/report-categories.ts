// src/a11y/report-categories.ts
//
// The six dashboard a11y "category tiles" — pure summary logic, extracted from
// the route (`src/routes/dashboard/a11y-report.tsx`) so it can be tested
// without booting the dashboard (db client, Hono, JSX shell).
//
// History: the tile `kinds` used to reference stale issue-kind strings
// (`img-alt-missing`, `button-label-missing`, `contrast-low`, …) that never
// matched the real `IssueKind` union — so `summariseCategory` matched nothing
// and every tile rendered the green "ok" variant regardless of actual issues.
// The strings below are the live `IssueKind` values; `report-categories.smoke`
// pins them so the drift can't recur.

import type { AuditIssue } from './audit.js';
import type { IssueKind } from './severity.js';

export interface CheckCategory {
  label: string;
  /** Live `IssueKind` values that roll up into this tile. */
  kinds: ReadonlyArray<IssueKind>;
  okCopy: string;
}

export const CHECK_CATEGORIES: ReadonlyArray<CheckCategory> = [
  { label: 'Image descriptions', kinds: ['missing-alt'], okCopy: 'All images labelled' },
  { label: 'Button labels', kinds: ['missing-action-label'], okCopy: 'Every button is clear' },
  { label: 'Colour contrast', kinds: ['contrast'], okCopy: 'All contrast checks pass' },
  { label: 'Form labels', kinds: ['missing-form-field-label'], okCopy: 'All fields labelled' },
  { label: 'Heading order', kinds: ['heading-skip'], okCopy: 'No skipped levels' },
  {
    label: 'Page titles',
    kinds: ['missing-page-title', 'missing-page-description'],
    okCopy: 'Set on all pages',
  },
];

export function summariseCategory(
  category: CheckCategory,
  issues: AuditIssue[],
): { variant: 'ok' | 'warn' | 'red'; copy: string } {
  const matches = issues.filter((issue) => category.kinds.some((kind) => issue.kind === kind));
  if (matches.length === 0) {
    return { variant: 'ok', copy: category.okCopy };
  }
  const blocking = matches.filter((issue) => issue.severity === 'blocking').length;
  if (blocking > 0) {
    const word = blocking === 1 ? 'block' : 'blocks';
    return { variant: 'red', copy: `${blocking} ${word} publish` };
  }
  const word = matches.length === 1 ? 'area' : 'areas';
  return { variant: 'warn', copy: `${matches.length} ${word} to review` };
}
