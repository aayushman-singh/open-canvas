# ADR 0031 — Accessibility audit hides the numeric score

**Status:** Accepted
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** beat S7.A.1 of [docs/demo/act-1-script.md](../demo/act-1-script.md). The audit page at [src/routes/dashboard/a11y-report.tsx:428-438](../../src/routes/dashboard/a11y-report.tsx) renders `<b>{score}</b><small>/ 100</small>` inside the score ring. For the Briar demo state that reads `50 / 100`. The script delta in [docs/demo/handoff-delta-resolution-2026-05-30.md §Pass-6 #20](../demo/handoff-delta-resolution-2026-05-30.md) named two acceptable resolutions — (a) hide the number, (b) script-add a voiceover line — and the parallel script branch took (b). This ADR re-opens the choice and answers the door of the more honest fence.

## Context

The audit page renders three concentric signals for the Owner:

1. A **conic-gradient ring** that fills in the band colour (`ok` / `warn` / `red`) keyed off blocker/warning counts.
2. A **headline + body** computed from those same counts: `Needs attention` / `Looking good!` / `All clear` plus a sentence that names how many blockers exist and what to do next.
3. A **numeric score** rendered inside the ring: `100 − blockerCount×20 − warningCount×5`, floored at 0.

The number is therefore a thin lossy projection of two counts the Owner can already see on the same page — once in the per-finding rows below the ring, once narrated in the body copy. It carries no information the qualitative signals do not. What it adds, on the other hand, is the question the script writer flinched at: "what does 50/100 mean? what gets me to 70?"

The headline + body copy is already where the actionable read lives. "1 issue is blocking publish. Resolve it, then re-run this check." answers *what to do next*. The number answers nothing the Owner can act on — there is no "70/100 unblocks publish" rule; only the blocker count gates publish, and that's already in the body.

The rubric (`20 per blocker, 5 per warning`) is also an internal heuristic with no Owner-facing justification. A site with one blocker and eight warnings scores `40`; a site with two blockers and zero warnings scores `60`. The second site is closer to publishable (fewer blockers) but scores lower. The number is misleading on its own terms.

The script's option (b) — voiceover acknowledging "Numeric score 50 / 100" — papers over the gap by narrating the number on camera. It does not answer what the number means; it admits the number is there.

## Decisions

1. **The numeric score line (`{score} / 100`) is removed from the audit page render.** The conic-gradient ring stays, the band colour stays, and the headline + body copy stay. The ring fills in proportion to `score%` as today; the percentage drives geometry, not text.

   **Why:** the number is a derived projection of counts the Owner sees twice already, and the rubric does not survive scrutiny (two blockers score worse than one blocker plus eight warnings). The ring's *fill ratio* communicates "how much headroom" with no false precision; the body copy communicates "what's wrong and what to do." The number is the node doing the least work and inviting the most questions — exactly the case for removal per the design-stance reduction tests in CLAUDE.md.

2. **The score variable itself stays in the route handler** (it still drives the conic-gradient `ringStyle`). Only the `<b>{score}</b><small>/ 100</small>` render fragment is removed. The ring's inner well is then either empty or shows the band icon (tick / warning), matching the per-category check tiles' visual grammar.

   **Why:** the geometry is doing useful work — a 100% fill ring reads as "complete" at a glance, a 40% fill reads as "lots missing." That's the trend signal the script wanted. The *number* is what fails the test; the *ratio* doesn't. Keep the ratio, drop the digits.

3. **The script's voiceover line acknowledging "Numeric score 50 / 100" is removed in a follow-up commit on the script branch.** Beat S7.A.1 returns to silence on the number because the number is no longer on screen.

   **Why:** the voiceover existed only to acknowledge a UI element the Owner would see on camera. Remove the element, remove the line. Keeping the voiceover without the number would be narrating a thing the viewer can't see; keeping the number to justify the voiceover is the tail wagging the dog.

4. **No replacement metric is introduced** — no "X of 6 checks passing", no letter grade, no "Y blockers, Z warnings" badge inside the ring.

   **Why:** the per-category check tiles below the ring already render "X of 6" implicitly (six tiles, each green or warned). The headline body already names the blocker count. Adding a fourth representation of the same two numbers reintroduces the problem this ADR exists to remove.

## Out of scope

- The conic-gradient ring's visual design, colours, or animation. The ring stays; only the inner text changes.
- The per-category check tiles below the ring. Untouched.
- The audit's scoring *algorithm* for non-display purposes (sorting, history trend lines, telemetry). If the score is consumed elsewhere, those consumers can keep using it; this ADR is about the page render only.
- Whether the audit page should show a *historical trend* of any kind. The "trending up across edits" framing in the delta-resolution handoff is a separate question and would need its own ADR if pursued.
- The button label — that's [ADR 0030](0030-audit-button-label-run-audit.md).

## Consequences

**Positive:**
- The audit page stops inviting "what does 50/100 mean?" — a question the product cannot honestly answer.
- One fewer on-camera element to narrate; S7.A.1 records cleanly without the voiceover patch.
- The Owner's read path is unambiguous: ring colour → headline → per-finding row. Three signals, each doing distinct work, none of them lossy projections of the others.
- Removes a misleading rubric (one-blocker-plus-eight-warnings scoring worse than two-blockers-plus-zero-warnings) from the visible surface.

**Negative:**
- Owners who had learned to read the number as a quick "am I trending up" cue lose that signal. Mitigation: the ring fill ratio is the same cue without the digits, and the per-finding row count is the honest version.
- One follow-up commit on the script branch to back out the S7.A.1 voiceover line. Coordinated via the script-deltas log.

## Follow-ups

- Remove the `<b>{String(score)}</b><small>/ 100</small>` fragment at [src/routes/dashboard/a11y-report.tsx:431-432](../../src/routes/dashboard/a11y-report.tsx) and decide whether the ring's inner well shows the band icon, the headline first word, or stays empty. Default: empty — the headline beside the ring already names the state.
- Back out the "Numeric score `50 / 100`" voiceover line in beat S7.A.1 of [docs/demo/act-1-script.md](../demo/act-1-script.md) on the `script-deltas-2026-05-30` branch. Note the back-out in [docs/demo/script-deltas-2026-05-29.md](../demo/script-deltas-2026-05-29.md).
- Grep for other consumers of the `score` variable to confirm decision 2's claim (ring `ringStyle` is the only consumer). If others exist, they get their own review.
- Smoke test that no Playwright fixture under `docs/demo/` asserts on the literal `/ 100` string.
