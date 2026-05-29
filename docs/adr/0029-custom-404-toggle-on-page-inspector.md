# ADR 0029 — Custom-404 toggle on the page inspector

**Status:** Proposed
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** beat S4.E.1 of [docs/demo/act-1-script.md](../demo/act-1-script.md). The script wants Maya to click the `_404` row, see a "Set as custom 404 page" toggle in the page inspector, and read it as already-on. Today the page inspector renders title, slug, entrance, trigger, motion, and background fields only — no 404 toggle — and the custom-404 mechanism is implicit in the slug literal `_404`.

## Context

The router treats a page as the catch-all when its slug equals `CUSTOM_404_PAGE_SLUG` (the literal `_404`). The constant lives at [src/canvas/page-routing.ts:10](../../src/canvas/page-routing.ts), `isCustom404Page` resolves the role from the slug, `resolvePrimaryPage` excludes it, the validator caps the site at one `_404` page, and the rename flow rejects a derived slug of `_404` or `404` so the owner cannot accidentally land on the reserved slug from the title field. The mechanism is therefore consistent — one fact (`slug === '_404'`) drives every router, validator, and emitter decision — but invisible. The owner only learns the convention by reading source or by being told.

The recording script's S4.E.1 beat shows the toggle as already-on when Maya selects the seeded `_404` page, and the voiceover frames the toggle as the user-facing handle on the catch-all behaviour. The framing rule in [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) is: script wins by default unless the script asks for something incoherent. A visible toggle is not incoherent — it is the missing surface for a behaviour that already exists.

The tension to resolve is **what the toggle changes**. Two shapes are possible:

- **Slug-rewrite.** The toggle is a view onto the existing `slug === '_404'` fact. Turning it on rewrites the page's slug to `_404` (and demotes any prior `_404` page back to a normal slug derived from its title). Turning it off rewrites the slug to a title-derived value. No schema change.
- **Parallel boolean.** The toggle reads/writes a new `is404` field on `CanvasPage`. The router and validator are taught to honour `is404 === true` instead of (or in addition to) `slug === '_404'`. Slug and 404-ness decouple — an owner could keep slug `lost-in-the-wilds` while flagging the page as the catch-all.

The parallel-boolean path is more flexible on paper but creates two facts that can disagree (a page with `is404: true` and slug `home`, or `is404: false` and slug `_404`). Every consumer downstream — the router, the renderer, the SEO emitter that forces `noIndex` on the 404, the publish validator, the smoke at [src/routes/public-404.smoke.ts](../../src/routes/public-404.smoke.ts) — would need a reconciliation rule, and the schema would carry a redundant field in every snapshot. The slug-rewrite path keeps one fact and adds one view.

## Decisions

1. **The page inspector renders a "Set as custom 404 page" toggle when a page is selected.** It is bound to the existing fact `page.slug === CUSTOM_404_PAGE_SLUG` (read) and rewrites `page.slug` on change (write). No new field is added to `CanvasPage`.

   **Why:** the catch-all role is already a derived fact off the slug, honoured uniformly by the router, the validator, the snapshot resolver, and the SEO emitter. A parallel `is404` boolean would create a second source of truth that can disagree with the slug; every consumer would need a reconciliation rule, and the existing smoke at `src/routes/public-404.smoke.ts` would be testing the wrong invariant. The toggle is a surface for an existing fact, not a new fact.

2. **Turning the toggle on rewrites `page.slug` to `_404`.** If another page on the site already holds slug `_404`, that page is demoted first: its slug is rewritten to a fresh title-derived slug using the same normalisation the rename flow uses (`title.toLowerCase().replace(/[^a-z0-9]+/g, '-')`, collision-suffixed `-2`, `-3`, …). The demotion happens in the same write as the promotion so the model never transiently violates the validator's "at most one `_404` page" rule.

   **Why:** the validator at [src/canvas/validate.ts:1110](../../src/canvas/validate.ts) caps the site at one `_404` page. A naive "set slug to `_404`" would either fail validation on save or create a brief two-`_404` window the autosave might persist. The toggle has to own the demotion side too — promoting page B implies demoting page A, and the inspector is the only place where the owner sees both facts at once. The reverse — leaving the prior `_404` page intact and failing the toggle with an error — would force the owner to navigate to the prior page, toggle it off, navigate back, and toggle the new one on, for no behavioural benefit.

3. **Turning the toggle off rewrites `page.slug` to a fresh title-derived slug** (same normalisation as decision 2). The site is then left with zero custom-404 pages — the router falls back to the Open Canvas default 404 render, the behaviour [src/routes/public.ts:941](../../src/routes/public.ts) already handles.

   **Why:** the off-state is "no custom 404 for this site." There is no other meaning the toggle could have. The fallback path is already exercised by the smoke and is the documented default for a freshly-created site that hasn't opted in.

4. **The slug field on the same inspector is disabled (read-only, with the value `_404` shown) while the toggle is on.** A small caption explains that the slug is reserved while the page is the custom 404.

   **Why:** the toggle owns the slug while it is on. Allowing the owner to edit the slug field in that state would either silently fight the toggle (slug edit demotes the page) or silently win (slug edit ignored). Both surface a hidden coupling. Disabling the slug field makes the coupling visible and removes the only path by which the two controls could disagree.

5. **The toggle ships with a confirm modal when promoting a page would demote an existing `_404` page.** Copy names the page being demoted and the slug it will receive. The confirm modal reuses `window.__rev01Modal.confirm` per the pattern at [src/editor/canvas-client.ts:871](../../src/editor/canvas-client.ts).

   **Why:** the demotion side-effect is destructive from the owner's point of view — their hand-designed catch-all page suddenly has a different URL. A silent demotion would surface as "where did my 404 go?" in the next session. The confirm modal converts the side-effect from invisible to acknowledged. No confirm is required when the site has zero existing `_404` pages — the promotion has no side-effect to acknowledge.

## Out of scope

- **A `is404` boolean on `CanvasPage`.** Decided against in decision 1; the slug remains the single fact.
- **Allowing multiple `_404` pages** (per-locale, per-path-prefix, etc.). The validator caps the site at one; multi-404 is its own ADR if/when it becomes a real requirement.
- **The custom 404 page's SEO metadata** — `noIndex` is already forced by the SEO emitter at [src/seo/meta-emit.ts:126](../../src/seo/meta-emit.ts) and the description/og fields work the same as any other page. The toggle does not change SEO behaviour.
- **The rename-flow guard** that rejects a title-derived slug of `_404` or `404` at [src/editor/canvas-client.ts:1200](../../src/editor/canvas-client.ts). It stays — title rename remains a no-go path to the reserved slug; the toggle is the only path in.
- **The page-list "Add 404 page" affordance** if one exists elsewhere in the sidebar. The toggle lets any existing page become the 404; an explicit "create a new 404 page" entry point is a separate UX question.

## Consequences

**Positive:**
- S4.E.1 records without an on-camera "wait, where's the toggle?" pause.
- The owner has a visible, reversible handle on the catch-all role without having to know the slug convention.
- The data model stays single-source — one fact (`slug === '_404'`) drives every router, validator, and emitter decision exactly as it does today.
- Promoting one page automatically demotes the prior one, so the validator's cardinality rule never sees a transiently-invalid state.

**Negative:**
- The toggle has a destructive interaction with the slug field — turning it on or off changes the URL. Mitigated by decision 4 (disabling the slug field while on) and decision 5 (confirm modal on demotion), but the owner still has to internalise that the toggle is a slug-rewrite.
- Owners who learned the seeded fixture's slug literal `_404` may be confused by a fresh title-derived slug after toggling off. Mitigated by the toggle being reversible — toggling on again restores `_404`.
- The toggle's "off" semantics require a freshly-computed slug, which means the page must still have a title to derive from. Empty-title pages cannot exist today (`title` is required on `CanvasPage`), so this is consistent with current invariants, but worth naming.

## Follow-ups

- Land the inspector renderer change inside `renderPageInspector` at [src/editor/canvas-client.ts:4045](../../src/editor/canvas-client.ts), threaded above the existing entrance/trigger/motion groups so it reads as a page-identity control, not a styling control.
- Add a smoke at `src/editor/page-404-toggle.smoke.ts` covering: promotion of a fresh page, promotion that demotes a prior `_404` page (asserting the demoted page's slug is title-derived and unique), demotion that leaves the site with zero `_404` pages, and the disabled-slug-field invariant.
- Update the seeded fixture at [src/canvas/fixtures/apogee-showcase.json](../../src/canvas/fixtures/apogee-showcase.json) to confirm the existing `_404` page still satisfies the new inspector's "already-on" assertion (no fixture change expected — the slug is already `_404`).
- Reconcile [docs/demo/script-deltas-2026-05-29.md](../demo/script-deltas-2026-05-29.md) and [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md): the prior delta resolved S4.E.1 as "there is no toggle"; that resolution is superseded by this ADR. Mark the delta as closed.
