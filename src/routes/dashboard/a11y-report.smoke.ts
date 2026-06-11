// src/routes/dashboard/a11y-report.smoke.ts
//
// Pins the dashboard accessibility surface:
//   - copy stays advisory (findings don't block publish after cd16102);
//   - the category tiles roll up the REAL `IssueKind` values (regression guard
//     for the stale-kind bug where every tile rendered "ok");
//   - the route surfaces the self-verified remediation plan.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECK_CATEGORIES, summariseCategory } from '../../a11y/report-categories.js';
import { ISSUE_KINDS } from '../../a11y/severity.js';
import type { AuditIssue } from '../../a11y/audit.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[a11y-report:smoke] ${message}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, 'a11y-report.tsx'), 'utf8');

// --- copy contract (advisory, no publish-gate language) --------------------
assert(
  !source.includes('blocking publish'),
  'a11y report must not claim findings block publish after the publish gate was removed',
);
assert(
  !source.includes('Publish is unblocked'),
  'a11y report must not describe publish as blocked/unblocked after the gate was removed',
);
assert(
  source.includes('Ready to review') &&
    source.includes('No accessibility issues detected on this site.'),
  'a11y report must keep a clear clean-state message without publish-gate language',
);

// --- category tiles use REAL issue kinds (the stale-kind regression) --------
const validKinds = new Set<string>(ISSUE_KINDS);
for (const category of CHECK_CATEGORIES) {
  for (const kind of category.kinds) {
    assert(
      validKinds.has(kind),
      `category "${category.label}" references unknown issue kind "${kind}" (must be a live IssueKind)`,
    );
  }
}

// Behavioural: a blocking missing-alt must turn the Image-descriptions tile red,
// a heading-skip warning must turn the Heading-order tile to review, and an
// empty issue list must leave every tile "ok".
const cat = (label: string) => {
  const found = CHECK_CATEGORIES.find((c) => c.label === label);
  assert(found !== undefined, `category "${label}" missing`);
  return found;
};

const altIssue: AuditIssue = {
  kind: 'missing-alt',
  severity: 'blocking',
  elementId: 'img-1',
  pageSlug: 'home',
  message: 'x',
};
const headingIssue: AuditIssue = {
  kind: 'heading-skip',
  severity: 'warning',
  elementId: 'h-2',
  pageSlug: 'home',
  message: 'x',
};

assert(
  summariseCategory(cat('Image descriptions'), [altIssue]).variant === 'red',
  'a blocking missing-alt must turn the Image-descriptions tile red (was always "ok" before the fix)',
);
assert(
  summariseCategory(cat('Heading order'), [headingIssue]).variant === 'warn',
  'a heading-skip warning must turn the Heading-order tile to review',
);
assert(
  summariseCategory(cat('Image descriptions'), []).variant === 'ok',
  'no issues must leave the tile "ok"',
);
assert(
  summariseCategory(cat('Colour contrast'), [altIssue]).variant === 'ok',
  'an unrelated issue must not flag the Colour-contrast tile',
);

// Tile copy must stay advisory — no "publish" gate language (cd16102).
assert(
  !summariseCategory(cat('Image descriptions'), [altIssue]).copy.includes('publish'),
  'category tile copy must not reference publish gating (findings are advisory)',
);

// --- remediation surfacing is wired ----------------------------------------
assert(
  source.includes('computeRemediations') && source.includes('RemediationCard'),
  'a11y report must surface the remediation plan (computeRemediations + RemediationCard)',
);

console.log('[a11y-report:smoke] OK');
