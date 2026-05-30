# ADR 0030 — Audit re-run button reads "Run audit"

**Status:** Accepted
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** beat S7.D.1 of [docs/demo/act-1-script.md](../demo/act-1-script.md). The script narrates "Re-run audit" and the on-screen action says `Sidebar → Accessibility → Run audit`. Current UI emits `Re-run check` at [src/routes/dashboard/a11y-report.tsx:441](../../src/routes/dashboard/a11y-report.tsx).

## Context

The accessibility audit page renders a dashboard tab where the Owner kicks a fresh audit pass. The audit produces blocker counts and per-finding rows that gate the Publish action (publish route returns 422 with `blockers[]` when `runAudit.blockerCount > 0`).

The action button for kicking a fresh pass currently reads **Re-run check**. The recording script's S7 beat reads **Run audit** in both voiceover and on-screen action. The mismatch is cosmetic but lands on camera — every Pass-N drive surfaces it because the script writer reads it the way they wrote it ("Run audit") and the operator sees the live button ("Re-run check") and pauses to reconcile.

The framing rule in [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) is: script wins by default. The button text changes.

## Decisions

1. **The audit re-run button label reads `Run audit`** at every render site — first-run (no audit yet) and re-run (one or more audits exist). One label, both states.

   **Why:** matches the script. "Run audit" is also the cleaner verb-noun form for a single button; "Re-run check" splits attention between two near-synonyms (check vs. audit) and forces the reader to reconcile them. A single canonical label collapses the question.

2. **No conditional label switching ("Run audit" vs "Re-run audit" depending on prior state).** The button always reads `Run audit`. Whether the click triggers the first pass or the Nth is irrelevant to the label.

   **Why:** the script doesn't carry the distinction either. The conditional adds branching for no Owner-visible benefit; the audit's result panel already shows the run history. The button is the trigger; its label names the action, not the state.

## Out of scope

- The audit page's overall layout, the per-finding row design, or any other a11y UX.
- The headline summary line ("Looking good!" / blocker count) — that's covered by [ADR 0031](0031-audit-numeric-score-handling.md).
- The empty-state CTA copy ("No audit yet — run one"). That's the empty-state lead text, not the button label.

## Consequences

**Positive:**
- Script S7.D.1 records without on-camera label mismatch.
- "Run audit" is unambiguous verb-noun, easier to scan in screenshots.
- One canonical string instead of one-or-two conditional labels.

**Negative:**
- One internal QA pass needed to confirm no test asserts on the old `Re-run check` string. Smoke tests under `src/routes/dashboard/__tests__/` and any Playwright fixture under `docs/demo/` should be grep-checked before landing.
- Owners who learned the page during the `Re-run check` era will see a renamed control. Cosmetic; no behaviour change.

## Follow-ups

- Grep the repo for `Re-run check` and `re-run check` (case-insensitive) and update every occurrence — UI string, tests, fixtures, docs. The literal at `a11y-report.tsx:441` is the production site; others are likely test fixtures.
- Add the rename to the smoke check that compares production strings against `feature-coverage.md` if such a check exists, otherwise no-op.
