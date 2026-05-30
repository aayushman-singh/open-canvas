# ADR 0028 — Page background uses the buildColorRow swatch+hex pattern

**Status:** Accepted
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** beat S3.E.1 of [docs/demo/act-1-script.md](../demo/act-1-script.md) (Maya picks a warm-cream page background via a colour picker) plus the gap raised in [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.1, against the read-only finding that `buildColorRow` already exists at [src/editor/canvas-client.ts:4677](../../src/editor/canvas-client.ts) and may already be wired to the page-inspector's `pageBackground` field at [canvas-client.ts:4284-4400](../../src/editor/canvas-client.ts).

**Resolution:** verification confirmed the field was *not* wired — `pageBackground` rendered as a bare `<input type="text">` accepting any CSS value validated through `isSafeCssValue` (which permitted `transparent`, named colors, and gradients alongside hex). Decision-3's wiring path applied. The wiring landed alongside this acceptance and added decision 4 to record the hex-only restriction the swatch picker imposes.

## Context

The recording script's S3.E.1 beat narrates Maya picking a warm-cream colour for the `/blog` page background by clicking a swatch in a colour picker. The delta-resolution handoff §3.1 catalogued this as a product gap on the assumption that the page-background control was a bare hex text input — no swatch, no kit-default checkbox, no picker UX — and that the script would need to either rewrite the beat around a hex input or the product would need to grow a picker.

A subsequent read-only investigation found that `buildColorRow` at [canvas-client.ts:4677](../../src/editor/canvas-client.ts) already implements the hex + swatch + "use kit default" checkbox pattern used everywhere else colour picking happens in the editor. The page-inspector's `backgroundColor` field (canvas-client.ts:4284-4400, backed by `backgroundColor` in [src/schema.ts:209](../../src/schema.ts)) is *probably* already wired to `buildColorRow` — the investigator's note was "Gap 1 (page-background picker): Already exists via `buildColorRow` pattern at line 4677; backgroundColor field live in schema." That leaves two distinct branches: (a) the picker is already wired, the handoff's gap-1 entry is stale, the script is already correct, and the work is zero; (b) the helper exists but the page-bg field still renders as a plain hex input, in which case the work is small — swap one render call to use `buildColorRow` with the same shape the rest of the inspector uses.

The framing rule from [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) is: script wins by default *and* don't write code against an unverified gap. The two branches diverge sharply in effort — closing as no-op vs. shipping a small wiring patch — and committing to either before verifying wastes either reading time or implementation time.

## Decisions

1. **Verify whether the page-inspector's `backgroundColor` field already renders through `buildColorRow` before doing any product work.** The verification is one read pass over [canvas-client.ts:4284-4400](../../src/editor/canvas-client.ts) — look for a `buildColorRow` call on the `backgroundColor` field — plus one manual editor session that opens the page inspector and confirms the swatch + hex + checkbox UX appears.

   **Why:** the two branches (wired vs. unwired) cost dramatically different effort, and the investigator's note ("Already exists via buildColorRow pattern… backgroundColor field live in schema") is suggestive but not confirming. Writing the wiring patch against an already-wired field is wasted code review; writing the script around a swatch flow that doesn't render is wasted recording time. One verification pass collapses the branch cheaply.

2. **If already wired: close this ADR as no-op, update the handoff §3.1 entry to mark gap-1 stale, and confirm the script's S3.E.1 swatch-flow narration records as-written.** No code change, no script change beyond a producer-side note that the warm-cream swatch flow is the live UX.

   **Why:** the script is already correct under this branch. The gap was a documentation artefact, not a product gap. Closing it loudly (rather than silently leaving it open) keeps the handoff trustworthy for the next Pass-N drive.

3. **If not wired: wire the page-inspector `pageBackground` field to `buildColorRow` with the same hex + swatch + "use kit default" checkbox shape every other colour field in the inspector uses.** No new design, no new schema field — the schema already carries `pageBackground`; the existing `<input type="text">` block in `renderPageInspector` is replaced with one `buildColorRow` call against the same data. The helper is hoisted from its previous nested location (inside `buildStyleSection`) to module scope, and gains an explicit `onChange` callback so each consumer can drive its own repaint / persist path (`onStyleChange` for element bg, `applyPageStyles(page); scheduleSave();` for page bg).

   **Why:** the helper exists and the pattern is established. Inventing a different control shape for one field would split the editor's colour-picking story into two non-parallel UXes for no Owner benefit. Hoisting the helper rather than copying it inline avoids the second-consumer drift problem (the existing element-bg call site and the new page-bg call site stay in lock-step). The minimal-complexity move is to reuse the existing helper at a higher scope, not to copy it.

4. **Page background is hex-only as of this ADR.** Values that aren't `#rgb` or `#rrggbb` — `transparent`, named colors like `rebeccapurple`, gradients, `currentColor`, etc. — are no longer representable through the page-inspector UI. The schema field stays a free-form CSS string (no validator tightening), so existing sites with non-hex values keep rendering; only the *input UX* narrows to hex.

   **Why:** the swatch picker's `<input type="color">` produces `#rrggbb` and nothing else; offering a swatch alongside a free-form text input was the alternative considered, and was rejected because two controls writing the same field create a "which one wins?" question for every Owner interaction. The recording script's S3.E.1 beat is hex-driven ("warm cream" `#f7ede3`) — that's the Owner-perceived primary case, and the loss of `transparent` / gradients on page backgrounds is a real but narrow regression. A future ADR can extend the picker to accept non-hex inputs through the hex text field if Owner demand surfaces; this ADR doesn't pre-commit to it.

   This would be wrong if `transparent` page backgrounds were load-bearing for any built-in template or for accessibility (e.g. a "see-through to the parent" pattern that breaks without it). Verified during this ADR's verification pass that no built-in fixture sets `pageBackground` to `transparent` or to a named colour; the loss is theoretical for current Owner state, not concrete.

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

- Verification confirmed not-wired; wiring landed alongside this Acceptance. `buildColorRow` is now defined at module scope after `applyPageStyles` and is called from two sites: the element-style background (with `onChange: onStyleChange`) and the page inspector (with `onChange: function() { applyPageStyles(page); scheduleSave(); }`).
- Update [handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.1 in a follow-up handoff revision to flag the gap closed.
- If non-hex page backgrounds (`transparent`, gradients, named colors) become Owner-requested, draft a successor ADR that extends `buildColorRow`'s hex text field to accept a CSS-value passthrough, OR adds a sibling control. Do not silently widen the hex regex — the swatch + hex contract is what every other colour field in the inspector also commits to.
