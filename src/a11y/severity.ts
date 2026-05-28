// src/a11y/severity.ts
//
// A11y audit subsystem severity ladder and the default blocker configuration
// consumed by `runAudit`.
//
// The ladder is purely ordinal — `info` < `warning` < `blocking`. We do NOT
// derive thresholds from the ladder; checks decide their own thresholds and
// then map onto a ladder rung. Anything `blocking` refuses publish at the
// caller (publish.ts).
//
// All-or-nothing: a check that crashes (unexpected element shape) MUST report
// a `blocking` issue with the kind `'audit-crash'` rather than swallow the
// error. The runner enforces that — see `src/a11y/audit.ts`.

/** Ordinal severity rung. Strictly: info < warning < blocking. */
export type Severity = 'info' | 'warning' | 'blocking';

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  info: 0,
  warning: 1,
  blocking: 2,
});

/** Domain set of issue `kind` values the audit emits. */
export const ISSUE_KINDS = [
  'missing-alt',
  'contrast',
  'heading-skip',
  'missing-action-label',
  'missing-form-field-label',
  'missing-page-title',
  'missing-page-description',
  'audit-crash',
] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

/**
 * Default mapping of `kind` to severity. Checks reach for this map when they
 * don't otherwise need a per-instance dynamic mapping (e.g. contrast varies by
 * measured ratio — its check sets severity inline, not via this map).
 *
 * Defaults match the plan brief §"Severity ladder":
 *   - missing alt              → blocking
 *   - missing action label     → blocking
 *   - missing form field label → blocking
 *   - missing page title       → blocking
 *   - heading skip             → warning
 *   - missing page description → info  (forward-compat for #21 SEO meta)
 *   - audit-crash              → blocking (all-or-nothing)
 *
 * Contrast is dynamic and bypasses this map.
 */
export const DEFAULT_SEVERITY_BY_KIND: Readonly<Record<IssueKind, Severity>> = Object.freeze({
  'missing-alt': 'blocking',
  contrast: 'blocking',
  'heading-skip': 'warning',
  'missing-action-label': 'blocking',
  'missing-form-field-label': 'blocking',
  'missing-page-title': 'blocking',
  'missing-page-description': 'info',
  'audit-crash': 'blocking',
});

/**
 * Contrast thresholds (WCAG-derived but POC-curated):
 *
 *   ratio < 3.0          → blocking
 *   3.0 <= ratio < 4.5   → warning
 *   ratio >= 4.5         → no issue (passes AA normal text)
 *
 * Picked deliberately. WCAG 2.x SC 1.4.3 requires >= 4.5 for normal text; we
 * mark anything below 3.0 (which would also fail AA Large Text and AAA Large
 * Text) as a hard publish blocker because such text is effectively unreadable.
 * The 3.0–4.5 band passes AA Large but fails AA Normal — surfacing as a warning
 * lets the Owner choose to ship if every TextElement in that band is genuinely
 * Large (>=18pt regular or >=14pt bold) — the audit cannot know font-size in
 * rendered context vs canvas px so it errs on the safe side and warns.
 */
export const CONTRAST_BLOCK_BELOW = 3.0;
export const CONTRAST_WARN_BELOW = 4.5;

/** Compare two severities; >0 if a is strictly higher than b. */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}
