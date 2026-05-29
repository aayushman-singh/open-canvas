# ADR 0028 — Page background uses the buildColorRow swatch+hex pattern

**Status:** Proposed
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** beat S3.E.1 of [docs/demo/act-1-script.md](../demo/act-1-script.md) (Maya picks a warm-cream page background via a colour picker) plus the gap raised in [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.1, against the read-only finding that `buildColorRow` already exists at [src/editor/canvas-client.ts:4677](../../src/editor/canvas-client.ts) and may already be wired to the page-inspector's `backgroundColor` field at [canvas-client.ts:4284-4400](../../src/editor/canvas-client.ts).

## Context

The recording script's S3.E.1 beat narrates Maya picking a warm-cream colour for the `/blog` page background by clicking a swatch in a colour picker. The delta-resolution handoff §3.1 catalogued this as a product gap on the assumption that the page-background control was a bare hex text input — no swatch, no kit-default checkbox, no picker UX — and that the script would need to either rewrite the beat around a hex input or the product would need to grow a picker.

A subsequent read-only investigation found that `buildColorRow` at [canvas-client.ts:4677](../../src/editor/canvas-client.ts) already implements the hex + swatch + "use kit default" checkbox pattern used everywhere else colour picking happens in the editor. The page-inspector's `backgroundColor` field (canvas-client.ts:4284-4400, backed by `backgroundColor` in [src/schema.ts:209](../../src/schema.ts)) is *probably* already wired to `buildColorRow` — the investigator's note was "Gap 1 (page-background picker): Already exists via `buildColorRow` pattern at line 4677; backgroundColor field live in schema." That leaves two distinct branches: (a) the picker is already wired, the handoff's gap-1 entry is stale, the script is already correct, and the work is zero; (b) the helper exists but the page-bg field still renders as a plain hex input, in which case the work is small — swap one render call to use `buildColorRow` with the same shape the rest of the inspector uses.

The framing rule from [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) is: script wins by default *and* don't write code against an unverified gap. The two branches diverge sharply in effort — closing as no-op vs. shipping a small wiring patch — and committing to either before verifying wastes either reading time or implementation time.

## Decisions

1. **Verify whether the page-inspector's `backgroundColor` field already renders through `buildColorRow` before doing any product work.** The verification is one read pass over [canvas-client.ts:4284-4400](../../src/editor/canvas-client.ts) — look for a `buildColorRow` call on the `backgroundColor` field — plus one manual editor session that opens the page inspector and confirms the swatch + hex + checkbox UX appears.

   **Why:** the two branches (wired vs. unwired) cost dramatically different effort, and the investigator's note ("Already exists via buildColorRow pattern… backgroundColor field live in schema") is suggestive but not confirming. Writing the wiring patch against an already-wired field is wasted code review; writing the script around a swatch flow that doesn't render is wasted recording time. One verification pass collapses the branch cheaply.

2. **If already wired: close this ADR as no-op, update the handoff §3.1 entry to mark gap-1 stale, and confirm the script's S3.E.1 swatch-flow narration records as-written.** No code change, no script change beyond a producer-side note that the warm-cream swatch flow is the live UX.

   **Why:** the script is already correct under this branch. The gap was a documentation artefact, not a product gap. Closing it loudly (rather than silently leaving it open) keeps the handoff trustworthy for the next Pass-N drive.

3. **If not wired: wire the page-inspector `backgroundColor` field to `buildColorRow` with the same hex + swatch + "use kit default" checkbox shape every other colour field in the inspector uses.** No new helper, no new design, no new schema field — the schema already carries `backgroundColor`; the only change is the render call.

   **Why:** the helper exists and the pattern is established. Inventing a different control shape for one field would split the editor's colour-picking story into two non-parallel UXes for no Owner benefit. The minimal-complexity move is to reuse the existing helper.

## Out of scope

- Element-level background colour controls. Those already use `buildColorRow` per the investigator's pass; this ADR is page-scope only.
- The choice of warm-cream hex value (the script suggests `#f7ede3` as Apogee kit's seed; the kit's actual seed is the source of truth and the script's hex is not load-bearing).
- Any `buildColorRow` refactor — the helper's shape is fine as-is. This ADR consumes it, doesn't change it.
- Whether the picker offers a kit-aware swatch palette vs. a freeform colour wheel. The current helper's shape stands; that's a separate decision if it ever comes up.

## Consequences

**Positive:**
- One verification pass replaces one full design-and-build cycle in the wired-already branch.
- If the wiring is missing, the fix is a one-line render change against an existing helper — no new abstraction, no new test pattern.
- Closing the handoff §3.1 entry definitively (no-op or shipped) removes a Pass-N drive distraction.

**Negative:**
- One-step verification overhead before the fix (or no-op closure) lands. The cost is small — minutes — but it's not zero.

## Follow-ups

- Verify by reading [canvas-client.ts:4284-4400](../../src/editor/canvas-client.ts) for a `buildColorRow` call against `backgroundColor`, then open the editor's page inspector and confirm visually. Report the result as a comment on this ADR's PR.
- If wired: mark the ADR Accepted as a no-op closure, update [handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.1 to flag gap-1 as already-shipped, and note the warm-cream swatch flow records as-scripted.
- If not wired: land the minimal wiring patch (one render-call change in the page inspector), then mark this ADR Accepted with the patch link.
