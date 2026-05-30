# ADR 0039 — A11y link in the canvas editor header

**Status:** Accepted
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** Session 7 entry beat of [docs/demo/act-1-script.md](../demo/act-1-script.md) (S7.A.1 / S7.D.1), and the gap named in [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3 "A11y link from editor header". Sits adjacent to [ADR 0030](0030-audit-button-label-run-audit.md) (audit button label) and [ADR 0031](0031-audit-numeric-score-handling.md) (audit score line) — same recording, same audit page.

## Context

The accessibility audit page lives only at the dashboard route `/dashboard/sites/{id}/a11y`, reached via the dashboard sidebar entry **Accessibility**. From inside the canvas editor — where the Owner spends Sessions 3–6 — there is no direct entry. To run the audit she leaves the editor, navigates to the dashboard, clicks **Accessibility**, runs the audit, and (when a finding is flagged) clicks `Fix in editor` to come back.

The editor header (`#canvas-editor-header`) already renders the publish-tier action cluster: `AI Chat`, `Settings`, `Save`, `Publish`, version badge, `Save as template` (see [src/editor/route.tsx:206–244](../../src/editor/route.tsx)). The audit is in the same urgency tier as Save / Publish — it *gates* Publish (the publish route returns 422 with `blockers[]` when `runAudit.blockerCount > 0`, per [ADR 0031](0031-audit-numeric-score-handling.md) context). The Owner's mental model when she hits the publish stretch is "save, check, publish", and the check has no home in the header.

Session 7 of the recording script (S7.A.1) currently narrates "Sidebar → Accessibility", which forces a camera-cut to the dashboard mid-publish flow. The handoff names two ways out: rewrite the script to accept the cut, or add the editor-header link. This ADR takes the second.

## Decisions

1. **The editor header (`#canvas-editor-header`) gets a top-level `A11y` link, rendered as a sibling of `Settings` — placed immediately between `Settings` and `Save`.** It is an `<a>` whose `href` is the same dashboard route the sidebar entry targets: `/dashboard/sites/{id}/a11y`. The render order in the header becomes: `AI Chat · Settings · A11y · Save · Publish · version badge · Save as template`.

   **Why:** the audit gates Publish — it belongs in the same visual cluster as Save and Publish, not buried inside Settings. Putting it between `Settings` (configuration tier) and `Save` (publish tier) reads as "configure, check, save, publish" left-to-right, which mirrors the Owner's actual sequence. Making it a sibling top-level link — not a tab inside the Settings dropdown — keeps it one click away and visible at rest, which matters because the recording lands on this control during S7.A.1 with no prior beat introducing it.

2. **The label is the literal string `A11y`.** Not `Accessibility`, not `Audit`, not an icon-only button.

   **Why:** the recording script S7 already says `A11y` in the on-screen-action column. Matching the script collapses the same writer-vs-product mismatch class that [ADR 0030](0030-audit-button-label-run-audit.md) decision 1 collapses for `Run audit`. `Accessibility` is verbose for a dense header row that already carries five other controls; `Audit` is ambiguous (the Owner could plausibly read it as a billing/usage audit). `A11y` is the developer-community shorthand the script writer chose deliberately; keep it.

3. **Text-only, no icon.** The header's other controls (`AI Chat`, `Settings`, `Save`, `Publish`, `Save as template`) are all text-only at [src/editor/route.tsx:210–232](../../src/editor/route.tsx); the version badge is text (`v0` / `v{n}`). The new link follows the same shape.

   **Why:** consistency with the rest of the cluster. Introducing the first icon-bearing control in this row would force a visual-weight decision on every other button (do they get icons too?) for no Owner-visible benefit. Text-only also keeps the recording readable at the export resolution without an icon-recognition pause.

4. **Click target is the existing dashboard route `/dashboard/sites/{id}/a11y` — opened in the same tab.** Not a new tab, not an editor-embedded panel, not an overlay.

   **Why:** an editor-embedded audit panel is the cleaner long-term UX but is a meaningful refactor (the audit page is a dashboard-route component, not extractable as a panel without lifting state and re-wiring `Fix in editor` to act on the editor's current selection model rather than via a navigation). That refactor is out of scope for this ADR and for the demo. Same-tab navigation matches the existing `Settings` link's behaviour at [src/editor/route.tsx:213](../../src/editor/route.tsx) — both leave the editor surface to a dashboard-tier route — so the link's behaviour is predictable from the neighbour control. The Owner's return path is already paved by `Fix in editor` at each finding row, which jumps back to the editor with the offending element selected (S7.C.1).

5. **The dashboard sidebar Accessibility entry is not removed.** The editor-header `A11y` link is an *additional* entry point, not a replacement. The sidebar `Accessibility` row at [src/routes/dashboard/shell.tsx](../../src/routes/dashboard/shell.tsx) stays.

   **Why:** the dashboard sidebar is the Owner's entry point when she's already in dashboard context (S11.K.1 references it). Removing it would force the editor-header round-trip even for Owners who never opened the editor in this session. Two entry points to the same route is fine — the route is one page, the entries are two affordances; nothing duplicates.

## Out of scope

- Embedding the audit page as an in-editor panel or overlay. Tracked as a future refactor; this ADR explicitly chooses the same-tab dashboard navigation.
- Changing the audit page itself (layout, score line, per-finding row, button label). Those are covered by [ADR 0030](0030-audit-button-label-run-audit.md) and [ADR 0031](0031-audit-numeric-score-handling.md).
- Adding a blocker-count badge to the editor-header `A11y` link (e.g. red dot when `runAudit.blockerCount > 0`). That's a useful follow-up but requires the editor to know the audit's last result; out of scope for this ADR.
- Keyboard shortcut for the link. Header controls don't carry shortcuts today; not introducing one here.

## Consequences

**Positive:**
- Session 7 records without a dashboard-detour camera-cut. Owner stays in the editor surface until `A11y` click; one navigation, not two.
- The audit's tier (publish-gating) is reflected visually — it now sits in the same row as Save and Publish.
- The editor's "publish stretch" cluster (Save · Publish · A11y) becomes self-contained; the Owner doesn't need to know the dashboard sidebar exists to run the audit.

**Negative:**
- One more control in an already dense header row. The current cluster is six controls; this makes it seven. Mitigation: text-only, short label (`A11y` is four characters), placed adjacent to a related sibling (`Settings`) rather than at the end of the row.
- Two entry points to the same route means one more place to update if the route ever moves. Cheap to maintain — the route is one string in two files.
- Same-tab navigation leaves the editor surface on click. Acceptable: the Owner returns via `Fix in editor` or the browser back button, same as the existing `Settings` link.

## Follow-ups

- Implement the `<a id="canvas-a11y-link">` element in [src/editor/route.tsx](../../src/editor/route.tsx) between the Settings link (line 213) and the Save button (line 216). `href` matches the dashboard route the sidebar already points at; copy the `title` attribute pattern from the Settings link.
- Smoke test: from the editor for a site with a known blocker, click `A11y`, confirm landing on `/dashboard/sites/{id}/a11y` with the audit results rendered.
- Update [docs/demo/act-1-script.md](../demo/act-1-script.md) S7.A.1 on-screen action from `Dashboard sidebar → Accessibility` to `Editor header → A11y`. The voiceover ("Before she publishes — a11y check") still works.
- Defer (do not open issue yet): editor-embedded audit panel. Revisit if recording or Owner-feedback Pass-N surfaces the same-tab navigation as friction.
- Defer: blocker-count indicator on the link. Requires audit-result wiring into the editor's boot data.
