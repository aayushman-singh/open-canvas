// src/agent/rebrand/plan.ts
//
// Rebrand-mode plan model + the PURE, keyless core that turns a planned set of
// `CanvasAgentOp`s into a reviewable, accept-by-subset preview.
//
// Shape of the feature:
//   brief ── (LLM, gemini-3.5-flash, see planner.ts) ──▶ RebrandPlan
//   RebrandPlan ── applyRebrandSubset (THIS FILE, pure) ──▶ preview state + diff
//   Owner accepts a subset ── existing /apply route ──▶ live write (only on accept)
//
// This module is the deterministic half. It never calls the LLM, never touches
// the network or DB, and never mutates its input — so it is fully smoke-tested
// without any key. It carries the same posture as the V2 a11y engine: a
// proposal is only shown as applicable if applying it actually produces a valid
// site. The Owner sees a diff that is *derived from the ops*, not narrated by
// the model — `describeOp` reads the real before-value out of the state.

import { applyCanvasAgentOp, type CanvasAgentOp } from '../canvas-ops.js';
import { validateEditableSite } from '../../canvas/validate.js';
import type {
  CanvasElement,
  CanvasSection,
  EditableSite,
  InlineRun,
} from '../../canvas/schema.js';

/** Which concern a proposal addresses — drives grouping in the review UI. */
export type RebrandGroup = 'rename' | 'text' | 'style' | 'media' | 'other';

/**
 * One reviewable unit of a rebrand: a single `CanvasAgentOp` plus the context
 * the Owner needs to accept or reject it in isolation.
 */
export interface RebrandProposal {
  /** Stable id the review UI uses to accept/reject this proposal. */
  id: string;
  group: RebrandGroup;
  op: CanvasAgentOp;
  /** Why this op serves the brief (from the planner). */
  rationale: string;
}

/**
 * A full rebrand plan. `model` is recorded so the surface is honest about which
 * brain produced it (no hidden fallback — see planner.ts).
 */
export interface RebrandPlan {
  brief: string;
  model: string;
  summary: string;
  proposals: RebrandProposal[];
}

/** Deterministic, state-derived before/after for one op (the diff row). */
export interface OpDescription {
  /** Short human label for the kind of change. */
  label: string;
  /** Current value the op will change, read from `state`. */
  before: string;
  /** Value after the op applies. */
  after: string;
}

/** Per-proposal applicability verdict. */
export interface ProposalAssessment {
  id: string;
  /** True iff applying this op alone yields a schema-valid site. */
  applicable: boolean;
  /** Present when `applicable` is false. */
  error?: string;
  description: OpDescription;
}

/** Result of folding an accepted subset of proposals. */
export interface RebrandPreview {
  /** True iff every accepted op applied AND the final site validates. */
  ok: boolean;
  /** The previewed state — only when `ok`. Never persisted by this module. */
  previewState?: EditableSite;
  /** Validation / application errors when `ok` is false. */
  errors: string[];
  /** Per-accepted-proposal application status, in input order. */
  applied: Array<{ id: string; applied: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inlineText(runs: InlineRun[] | undefined): string {
  if (!Array.isArray(runs)) return '';
  return runs
    .map((r) => r.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function eachElement(state: EditableSite): CanvasElement[] {
  const out: CanvasElement[] = [];
  const sections: CanvasSection[] = [];
  if (state.header) sections.push(state.header);
  if (state.footer) sections.push(state.footer);
  for (const page of state.pages) for (const section of page.sections) sections.push(section);
  for (const section of sections) for (const el of section.elements) out.push(el);
  return out;
}

function findElement(state: EditableSite, elementId: string): CanvasElement | undefined {
  return eachElement(state).find((el) => el.id === elementId);
}

/** Count case-sensitive/insensitive substring occurrences across visible text. */
function countOccurrences(state: EditableSite, needle: string, caseSensitive: boolean): number {
  if (needle.length === 0) return 0;
  const hay = JSON.stringify(state);
  const h = caseSensitive ? hay : hay.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  let count = 0;
  let i = h.indexOf(n);
  while (i !== -1) {
    count += 1;
    i = h.indexOf(n, i + n.length);
  }
  return count;
}

/**
 * Derive a deterministic before/after for an op from the real `state`. The
 * review UI shows this — it is computed from the document, never trusted from
 * the model. Falls back to a generic description for op kinds a rebrand plan
 * does not normally emit.
 */
export function describeOp(state: EditableSite, op: CanvasAgentOp): OpDescription {
  switch (op.kind) {
    case 'renameToken': {
      const n = countOccurrences(state, op.from, op.caseSensitive ?? false);
      return {
        label: 'Rename across the whole site',
        before: `"${clip(op.from, 40)}" (${String(n)} place${n === 1 ? '' : 's'})`,
        after: `"${clip(op.to, 40)}"`,
      };
    }
    case 'rewriteText': {
      const el = findElement(state, op.elementId);
      const before = el && el.type === 'text' ? inlineText(el.content) : '(unknown text element)';
      return {
        label: 'Rewrite text',
        before: clip(before),
        after: clip(inlineText(op.content)),
      };
    }
    case 'setStyleKit':
      return {
        label: 'Switch style kit',
        before: state.styleKit,
        after: op.styleKit,
      };
    case 'replaceMedia': {
      const el = findElement(state, op.elementId);
      const before = el && el.type === 'media' ? `${el.assetId} — "${clip(el.alt, 30)}"` : '(unknown image)';
      return {
        label: 'Replace image',
        before: clip(before),
        after: `${op.assetId} — "${clip(op.alt, 30)}"`,
      };
    }
    case 'updatePage':
      return {
        label: 'Update page settings',
        before: `page ${op.pageId}`,
        after: Object.keys(op.patch).join(', ') || '(no fields)',
      };
    case 'updateElement':
      return {
        label: `Update ${op.elementType} element`,
        before: `element ${op.elementId}`,
        after: Object.keys(op.patch).join(', ') || '(no fields)',
      };
    default:
      return { label: op.kind, before: '—', after: '—' };
  }
}

/**
 * Assess each proposal in isolation: does applying ONLY this op to the current
 * state yield a schema-valid site? This is the "a proposal is a proof" gate —
 * the review UI marks non-applicable proposals so the Owner never accepts an op
 * that would be rejected at the write boundary. Pure: clones internally.
 */
export function assessProposals(
  state: EditableSite,
  proposals: ReadonlyArray<RebrandProposal>,
): ProposalAssessment[] {
  return proposals.map((proposal) => {
    const description = describeOp(state, proposal.op);
    try {
      const next = applyCanvasAgentOp(state, proposal.op);
      const validation = validateEditableSite(structuredClone(next));
      if (!validation.valid) {
        return { id: proposal.id, applicable: false, error: validation.errors[0] ?? 'invalid', description };
      }
      return { id: proposal.id, applicable: true, description };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { id: proposal.id, applicable: false, error: detail, description };
    }
  });
}

/**
 * Fold an accepted SUBSET of a plan's proposals onto the state and validate the
 * result once. `acceptedIds` selects which proposals to apply (default: all, in
 * plan order). Pure — returns a preview state, never persists. The caller (the
 * accept route) persists `previewState` only when `ok` is true.
 *
 * Application is sequential and order-preserving; if an op throws, that
 * proposal is recorded as not-applied and the fold continues with the rest, so
 * the Owner sees exactly which accepted ops landed. The final `ok` additionally
 * requires the whole accepted set to validate together.
 */
export function applyRebrandSubset(
  state: EditableSite,
  plan: RebrandPlan,
  acceptedIds?: ReadonlySet<string> | ReadonlyArray<string>,
): RebrandPreview {
  const accepted =
    acceptedIds === undefined
      ? null
      : acceptedIds instanceof Set
        ? acceptedIds
        : new Set(acceptedIds);
  const selected = plan.proposals.filter((p) => accepted === null || accepted.has(p.id));

  const applied: RebrandPreview['applied'] = [];
  const errors: string[] = [];
  let working = state;
  for (const proposal of selected) {
    try {
      working = applyCanvasAgentOp(working, proposal.op);
      applied.push({ id: proposal.id, applied: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      applied.push({ id: proposal.id, applied: false, error: detail });
      errors.push(`${proposal.id}: ${detail}`);
    }
  }

  const validation = validateEditableSite(structuredClone(working));
  if (!validation.valid) {
    for (const e of validation.errors) errors.push(e);
    return { ok: false, errors, applied };
  }
  if (errors.length > 0) {
    return { ok: false, errors, applied };
  }
  return { ok: true, previewState: working, errors, applied };
}

/** The ops for an accepted subset, in plan order — what the accept route sends
 * through the existing apply pipeline. */
export function acceptedOps(
  plan: RebrandPlan,
  acceptedIds?: ReadonlySet<string> | ReadonlyArray<string>,
): CanvasAgentOp[] {
  const accepted =
    acceptedIds === undefined
      ? null
      : acceptedIds instanceof Set
        ? acceptedIds
        : new Set(acceptedIds);
  return plan.proposals.filter((p) => accepted === null || accepted.has(p.id)).map((p) => p.op);
}
