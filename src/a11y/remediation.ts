// src/a11y/remediation.ts
//
// A11y remediation engine.
//
// `runAudit(state)` produces a structured `AuditReport`. Until now that report
// was advisory — surfaced in the dashboard, and (at publish time) computed and
// discarded (`src/routes/api/publish.ts`). This module turns each finding into
// an *actionable, self-verified* remediation: a `CanvasAgentOp` (the same op
// vocabulary the AI agent and the editor use) that, when applied through
// `applyCanvasAgentOp` + `validateEditableSite`, removes the issue.
//
// ---------------------------------------------------------------------------
// Honesty posture (per global CLAUDE.md — no silent fallbacks, no guessing)
// ---------------------------------------------------------------------------
// Every remediation is `computed` — mechanically correct, not a guess. Today
// the only computed auto-fix is `heading-skip`: the target font size is the
// inverse of the level-derivation ladder, so the heading lands on the level
// that removes the skip. (The `confidence` field is kept for future
// lower-certainty fix classes; nothing emits anything but `computed` yet.)
//
// Issues a machine should NOT answer are returned as `manual`, never auto-
// filled — either because the validator already prevents them (an empty page
// title is rejected outright; an empty action label is coerced to "Button") or
// because they need human judgement: alt text, colour contrast (the audit
// measures the Style Kit `text` token, not a per-element colour, so no
// element-level op can move it), form-field labels, page descriptions, and
// audit crashes. Manual items carry the audit's `fixHint` + a deep-link.
//
// ---------------------------------------------------------------------------
// Self-verification (the load-bearing guarantee)
// ---------------------------------------------------------------------------
// A candidate op is only promoted to a `Remediation` if, applied *alone* to the
// site, it (a) passes `validateEditableSite` and (b) re-running `runAudit`
// confirms the targeted issue is gone AND no NEW issue key appeared (a count
// check is insufficient — a fix can swap one skip for another). A fix that
// fails either check is downgraded to `manual` with the reason. This
// means a `Remediation` is never a claim — it is a proof against the same audit
// that raised the complaint.

import { runAudit, type AuditIssue, type AuditReport } from './audit.js';
import type { IssueKind, Severity } from './severity.js';
import {
  deriveHeadingLevel,
  targetFontSizeForLevel,
} from './checks/heading-order.js';
import { resolveStyleKitWithCustom } from '../themes/custom-resolve.js';
import { applyCanvasAgentOp, type CanvasAgentOp } from '../agent/canvas-ops.js';
import { validateEditableSite } from '../canvas/validate.js';
import type {
  CanvasPage,
  EditableSite,
  StyleKitPreset,
  TextElement,
} from '../canvas/schema.js';

// Only `computed` is emitted today; the union is a forward extension point for
// lower-certainty fix classes (none of which silently guess).
export type RemediationConfidence = 'computed';

export interface Remediation {
  kind: IssueKind;
  severity: Severity;
  elementId?: string | undefined;
  pageSlug?: string | undefined;
  /** The op that fixes it — the same shape the AI agent emits. */
  op: CanvasAgentOp;
  /** Human-readable current value (what the audit complained about). */
  before: string;
  /** Human-readable value after the op applies. */
  after: string;
  confidence: RemediationConfidence;
  /** Always true for items in `remediations` — kept explicit for the UI. */
  verified: true;
}

export interface ManualIssue {
  kind: IssueKind;
  severity: Severity;
  elementId?: string | undefined;
  pageSlug?: string | undefined;
  message: string;
  /** Why no automatic fix is offered. */
  reason: string;
  /** The audit's own remediation hint, passed through for the Owner. */
  fixHint?: string | undefined;
}

export interface RemediationPlan {
  /** Verified auto-fixes, owner-gated. */
  remediations: Remediation[];
  /** Issues left for human judgement (with the reason). */
  manual: ManualIssue[];
}

/** Stable identity of an issue across two audit runs (message is excluded — it
 * carries volatile ratios/levels). Accepts anything carrying the three keys —
 * an `AuditIssue` or a `Remediation` (which targets one issue). */
function issueKey(issue: {
  kind: IssueKind;
  pageSlug?: string | undefined;
  elementId?: string | undefined;
}): string {
  return `${issue.kind}|${issue.pageSlug ?? ''}|${issue.elementId ?? ''}`;
}

function findPageBySlug(state: EditableSite, slug: string | undefined): CanvasPage | undefined {
  if (slug === undefined) return undefined;
  return state.pages.find((p) => p.slug === slug);
}

function findTextElementById(
  page: CanvasPage,
  elementId: string,
): TextElement | undefined {
  for (const section of page.sections) {
    for (const el of section.elements) {
      if (el.id === elementId && el.type === 'text') return el;
    }
  }
  return undefined;
}

/**
 * Walk a page's heading-role text elements in document order and return the
 * derived level of the heading immediately *before* `targetElementId` (0 if it
 * is the first heading). Mirrors the walk in `checkHeadingOrder` so the
 * predecessor level matches what the audit saw.
 */
function headingPredecessorLevel(
  page: CanvasPage,
  styleKit: StyleKitPreset,
  targetElementId: string,
): number {
  let current = 0;
  for (const section of page.sections) {
    for (const el of section.elements) {
      if (el.type !== 'text' || el.role !== 'heading') continue;
      if (el.id === targetElementId) return current;
      current = deriveHeadingLevel(el.fontSize, styleKit.headingScale);
    }
  }
  return current;
}

/** A candidate op plus its display strings, before verification. */
interface Candidate {
  op: CanvasAgentOp;
  before: string;
  after: string;
  confidence: RemediationConfidence;
}

/**
 * Build a candidate fix for one issue, or `null` when the issue is not the kind
 * of thing a machine should answer (those become `manual`). Pure — no apply.
 */
function buildCandidate(
  state: EditableSite,
  issue: AuditIssue,
): Candidate | { manual: string } | null {
  switch (issue.kind) {
    case 'heading-skip': {
      const page = findPageBySlug(state, issue.pageSlug);
      if (!page || issue.elementId === undefined) {
        return { manual: 'Could not locate the heading on its page.' };
      }
      const el = findTextElementById(page, issue.elementId);
      if (!el) return { manual: 'Heading element not found.' };
      // Resolve the kit here, lazily — never as a global step. A `heading-skip`
      // issue can only exist if `runAudit` already resolved the kit to derive
      // levels, so this won't throw in practice; if it somehow does, THIS issue
      // becomes manual with the reason — no global swallow, no fallback.
      let styleKit: StyleKitPreset;
      try {
        styleKit = resolveStyleKitWithCustom(state);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { manual: `Style Kit failed to resolve: ${detail}` };
      }
      const predecessor = headingPredecessorLevel(page, styleKit, issue.elementId);
      const targetLevel = (predecessor + 1) as 1 | 2 | 3 | 4 | 5;
      if (targetLevel < 1 || targetLevel > 5) {
        return { manual: 'No valid heading level to demote to.' };
      }
      const oldLevel = deriveHeadingLevel(el.fontSize, styleKit.headingScale);
      // ceil, never round: the target is the *minimum* font size that derives to
      // `targetLevel`, so rounding down (fractional headingScale) would fall
      // below the rung and derive a different level.
      const newFontSize = Math.ceil(targetFontSizeForLevel(targetLevel, styleKit.headingScale));
      if (newFontSize === el.fontSize) {
        return { manual: 'Computed font size matches the current size.' };
      }
      return {
        op: {
          kind: 'updateElement',
          elementId: el.id,
          elementType: 'text',
          patch: { fontSize: newFontSize },
        },
        before: `${String(el.fontSize)}px (reads as H${String(oldLevel)})`,
        after: `${String(newFontSize)}px (reads as H${String(targetLevel)})`,
        confidence: 'computed',
      };
    }

    // NOT auto-fixed: `validateEditableSite` *rejects* an empty page title
    // outright ("title must be a non-empty string"), so a persisted site can
    // never carry this — it is only reachable for an unvalidated in-memory
    // state, and a page name is the Owner's to choose, not a slug echo.
    case 'missing-page-title':
      return { manual: 'Give the page a name — the validator rejects an empty title, so this can only appear pre-save.' };

    // NOT auto-fixed: `validateEditableSite` already coerces an empty action
    // label to `[{text:'Button'}]` in place (src/canvas/validate.ts), so a
    // persisted (validated) site never carries an empty label — this issue is
    // only reachable for an unvalidated in-memory state, and "Button" is itself
    // a poor label a machine shouldn't re-guess. Surface it for the Owner.
    case 'missing-action-label':
      return { manual: 'Give the button a label that says what it does — the validator otherwise fills a generic "Button".' };

    // Deliberately NOT auto-fixed — a machine would be guessing.
    case 'missing-alt':
      return { manual: 'Alt text describes a specific image; write it for the content, not from a template.' };
    case 'contrast':
      return {
        manual:
          'Contrast is set by the Style Kit `text`/`bg` tokens (or the container surface), not a per-element colour — adjust the kit rather than the element.',
      };
    case 'missing-form-field-label':
      return { manual: 'Each form field needs a label that names what it collects.' };
    case 'missing-page-description':
      return { manual: 'A page description should summarise the page in the Owner’s own words.' };
    case 'audit-crash':
      return { manual: 'This is a bug in the audit itself (or a malformed element), not a content fix.' };
    default:
      return null;
  }
}

/**
 * Compute a verified remediation plan for a site. Pure: never mutates `state`.
 *
 * @param state  the EditableSite to remediate.
 * @param report optional pre-computed audit (defaults to `runAudit(state)`).
 */
export function computeRemediations(
  state: EditableSite,
  report?: AuditReport,
): RemediationPlan {
  const audit = report ?? runAudit(state);
  const remediations: Remediation[] = [];
  const manual: ManualIssue[] = [];

  for (const issue of audit.issues) {
    const candidate = buildCandidate(state, issue);

    if (candidate === null || 'manual' in (candidate as { manual?: string })) {
      const reason =
        candidate !== null && 'manual' in (candidate as { manual?: string })
          ? (candidate as { manual: string }).manual
          : 'No automatic remediation available for this issue kind.';
      manual.push({
        kind: issue.kind,
        severity: issue.severity,
        elementId: issue.elementId,
        pageSlug: issue.pageSlug,
        message: issue.message,
        reason,
        fixHint: issue.fixHint,
      });
      continue;
    }

    const cand = candidate as Candidate;
    const verdict = verifyCandidate(state, audit, issue, cand.op);
    if (verdict.ok) {
      remediations.push({
        kind: issue.kind,
        severity: issue.severity,
        elementId: issue.elementId,
        pageSlug: issue.pageSlug,
        op: cand.op,
        before: cand.before,
        after: cand.after,
        confidence: cand.confidence,
        verified: true,
      });
    } else {
      manual.push({
        kind: issue.kind,
        severity: issue.severity,
        elementId: issue.elementId,
        pageSlug: issue.pageSlug,
        message: issue.message,
        reason: verdict.reason,
        fixHint: issue.fixHint,
      });
    }
  }

  return { remediations, manual };
}

/** Issues in `after` whose key did not exist in `before` — i.e. NEW problems. */
function newlyIntroduced(before: AuditReport, after: AuditReport): AuditIssue[] {
  const beforeKeys = new Set(before.issues.map((i) => issueKey(i)));
  return after.issues.filter((i) => !beforeKeys.has(issueKey(i)));
}

/**
 * Apply `op` alone and confirm it (a) keeps the site valid and (b) removes the
 * targeted issue WITHOUT introducing any new issue key. The "no new key" check
 * (not a mere count check) is load-bearing: a heading fix can clear one skip
 * while creating a different one (H1→H4→H5: demoting H4 to H2 makes H2→H5) —
 * the count stays flat but the page is still broken, so that fix must be
 * rejected, not blessed. The proof that a remediation is real, not a claim.
 */
function verifyCandidate(
  state: EditableSite,
  baseline: AuditReport,
  issue: AuditIssue,
  op: CanvasAgentOp,
): { ok: true } | { ok: false; reason: string } {
  let next: EditableSite;
  try {
    next = applyCanvasAgentOp(state, op);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Fix op threw: ${detail}` };
  }
  // Validate a CLONE: `validateEditableSite` mutates in place (it coerces empty
  // action labels to "Button"), and we must audit the exact state the op
  // produced — not a validator-mutated variant — so the verdict reflects the op
  // alone.
  const validation = validateEditableSite(structuredClone(next));
  if (!validation.valid) {
    return { ok: false, reason: `Fix produced an invalid site: ${validation.errors[0] ?? 'unknown'}` };
  }
  const after = runAudit(next);
  const targetKey = issueKey(issue);
  if (after.issues.some((i) => issueKey(i) === targetKey)) {
    return { ok: false, reason: 'Fix did not clear the issue on re-audit.' };
  }
  const introduced = newlyIntroduced(baseline, after);
  if (introduced.length > 0) {
    return { ok: false, reason: `Fix introduced a new issue: ${introduced[0]!.kind}.` };
  }
  return { ok: true };
}

/**
 * Apply a batch of remediations and VERIFY the whole batch by re-auditing.
 * Individual ops were each verified against the *original* state, but applying
 * several can interact (two heading fixes on one page), so the batch is only
 * sound when the final audit (a) introduces no new issue key AND (b) clears
 * every issue the batch claimed to fix. Checking only (a) is unsafe: a batch
 * could leave one of its own target issues unresolved while adding nothing new.
 * Pure — returns the folded state (not validator-mutated), the validation
 * verdict, and `verified`. The caller persists only when `validation.valid`
 * and `verified`.
 */
export function applyRemediationOps(
  state: EditableSite,
  remediations: ReadonlyArray<Remediation>,
): {
  state: EditableSite;
  validation: ReturnType<typeof validateEditableSite>;
  verified: boolean;
} {
  const before = runAudit(state);
  let working = state;
  for (const remediation of remediations) {
    working = applyCanvasAgentOp(working, remediation.op);
  }
  const validation = validateEditableSite(structuredClone(working));
  const after = runAudit(working);
  const afterKeys = new Set(after.issues.map((i) => issueKey(i)));
  const allTargetsCleared = remediations.every((r) => !afterKeys.has(issueKey(r)));
  const verified = allTargetsCleared && newlyIntroduced(before, after).length === 0;
  return { state: working, validation, verified };
}
