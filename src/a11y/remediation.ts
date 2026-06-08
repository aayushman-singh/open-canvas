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
// Every remediation is labelled by how it was derived:
//
//   - `computed`   — the fix is mechanically correct, not a guess. Today this
//                    is `heading-skip`: the target font size is the exact
//                    inverse of the level-derivation ladder, so the heading
//                    lands on the level that removes the skip.
//   - `suggested`  — a sensible, deterministic starting value the Owner should
//                    confirm (a page title title-cased from its slug; a generic
//                    button label). Non-empty, so it clears the blocker, but the
//                    Owner owns the final words.
//
// Issues a machine should NOT silently answer — alt text, colour contrast (the
// audit measures the Style Kit `text` token, not a per-element colour, so no
// element-level op can move it), empty form-field labels, and audit crashes —
// are returned as `manual`: surfaced with the audit's own `fixHint` and a
// deep-link to the editor, never auto-filled.
//
// ---------------------------------------------------------------------------
// Self-verification (the load-bearing guarantee)
// ---------------------------------------------------------------------------
// A candidate op is only promoted to a `Remediation` if, applied *alone* to the
// site, it (a) passes `validateEditableSite` and (b) re-running `runAudit`
// confirms the targeted issue is gone AND the total issue count did not grow.
// A fix that fails either check is downgraded to `manual` with the reason. This
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

export type RemediationConfidence = 'computed' | 'suggested';

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
 * carries volatile ratios/levels). */
function issueKey(issue: Pick<AuditIssue, 'kind' | 'pageSlug' | 'elementId'>): string {
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
  styleKit: StyleKitPreset,
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
      const predecessor = headingPredecessorLevel(page, styleKit, issue.elementId);
      const targetLevel = (predecessor + 1) as 1 | 2 | 3 | 4 | 5;
      if (targetLevel < 1 || targetLevel > 5) {
        return { manual: 'No valid heading level to demote to.' };
      }
      const oldLevel = deriveHeadingLevel(el.fontSize, styleKit.headingScale);
      const newFontSize = Math.round(targetFontSizeForLevel(targetLevel, styleKit.headingScale));
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

  let styleKit: StyleKitPreset;
  try {
    styleKit = resolveStyleKitWithCustom(state);
  } catch {
    // If the kit cannot resolve, every issue is manual — the audit itself will
    // have surfaced an `audit-crash`. Mirror that posture rather than guess.
    for (const issue of audit.issues) {
      manual.push({
        kind: issue.kind,
        severity: issue.severity,
        elementId: issue.elementId,
        pageSlug: issue.pageSlug,
        message: issue.message,
        reason: 'Style Kit could not be resolved; fix the theme first.',
        fixHint: issue.fixHint,
      });
    }
    return { remediations, manual };
  }

  for (const issue of audit.issues) {
    const candidate = buildCandidate(state, styleKit, issue);

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

/**
 * Apply `op` alone to a clone of `state` and confirm it (a) validates and
 * (b) removes the targeted issue without growing the total issue count. The
 * proof that a remediation is real, not a claim.
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
  const validation = validateEditableSite(next);
  if (!validation.valid) {
    return { ok: false, reason: `Fix produced an invalid site: ${validation.errors[0] ?? 'unknown'}` };
  }
  const after = runAudit(next);
  const targetKey = issueKey(issue);
  const stillPresent = after.issues.some((i) => issueKey(i) === targetKey);
  if (stillPresent) {
    return { ok: false, reason: 'Fix did not clear the issue on re-audit.' };
  }
  if (after.issues.length > baseline.issues.length) {
    return { ok: false, reason: 'Fix introduced new a11y issues.' };
  }
  return { ok: true };
}

/**
 * Fold a list of remediation ops onto a site in order and validate once at the
 * end. Used by the dashboard "apply" route. Pure — returns the new state and
 * the validation verdict; the caller persists only when `validation.valid`.
 */
export function applyRemediationOps(
  state: EditableSite,
  ops: ReadonlyArray<CanvasAgentOp>,
): { state: EditableSite; validation: ReturnType<typeof validateEditableSite> } {
  let working = state;
  for (const op of ops) {
    working = applyCanvasAgentOp(working, op);
  }
  return { state: working, validation: validateEditableSite(working) };
}
