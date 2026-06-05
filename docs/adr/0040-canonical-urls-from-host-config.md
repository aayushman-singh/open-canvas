# ADR 0040 — Apogee Showcase fixture canonical URLs derive from request host at emit time, not from any fixture string

**Status:** Accepted
**Date:** 2026-05-30 (revised)
**Author:** Aayushman Singh
**Drives:** the canonical-URL leak surfaced in Pass 3 + Pass 4 of the demo drive and re-confirmed in [docs/demo/drive-2026-05-29-pass-5-findings.md](../demo/drive-2026-05-29-pass-5-findings.md). Five `apogee.rev01.aayushman.dev` literals lived in [src/canvas/fixtures/apogee-showcase.json](../../src/canvas/fixtures/apogee-showcase.json) at lines 615, 2357, 3453, 4950, 6367. Every site created from Apogee Showcase published those URLs into its meta tags until the Owner manually overrode them.

**As-built (2026-06-05):**
- Decision 1 — every built-in TemplateSeed page is free of `canonical` and `ogImageAssetId`; the runtime path in [`src/seo/meta-emit.ts`](../../src/seo/meta-emit.ts) composes canonicals from the request host. Verified across all nine templates.
- Decision 2 — landed as a CI-time check in [`src/seo/smoke.ts`](../../src/seo/smoke.ts) that iterates every `allTemplateSeeds` entry, materialises it via `instantiateTemplate`, and asserts no page carries a pre-baked canonical or `ogImageAssetId`. A runtime boot-time check was considered and rejected as duplicative coverage — CI already gates merges. The smoke catches the same regression class at the smallest reviewable moment.
- Decision 3 — SEO panel SERP preview reads `canonicalRaw.length > 0 ? canonicalRaw : publishedUrl` at [`src/routes/dashboard/page-settings.tsx:1113`](../../src/routes/dashboard/page-settings.tsx#L1113), surfacing the leaked value instead of the auto-derived URL.
- Decision 4 — host-mismatch warning lands as a `.canonical-warning` block at [`src/routes/dashboard/page-settings.tsx:1244`](../../src/routes/dashboard/page-settings.tsx#L1244) with CSS at [line 133](../../src/routes/dashboard/page-settings.tsx#L133) and the toggle behaviour at [line 762](../../src/routes/dashboard/page-settings.tsx#L762). Field is not auto-cleared.

## Context

The Apogee Showcase template fixture is the seed for every Owner who picks "Apogee Showcase" in the template gallery (S1.6 in [docs/demo/act-1-script.md](../demo/act-1-script.md)). It includes per-page SEO blocks with a `canonical` field. The fixture was authored when rev01 ran at `rev01.aayushman.dev` with per-site subdomain `apogee.rev01.aayushman.dev`. The apex migration to `opencanvas.aayushman.dev` (per [ADR 0013](0013-host-config-from-environment.md), the `project_opencanvas_apex_migration` memory, and the rebrand commits on `origin/main`) moved every site under the new apex, but the fixture's hard-coded canonicals stayed pointed at the dead host.

Symptom: every published site that came out of Apogee Showcase emitted `<link rel="canonical" href="https://apogee.rev01.aayushman.dev/...">` until the Owner manually edited each page's SEO panel. Search engines de-duplicate against canonicals; this is a real SEO failure that the Owner cannot easily diagnose (the dashboard SEO panel shows a per-page canonical field that the Owner thinks is correct because they never touched it).

A first-pass hot-fix (commit `899275a`) replaced the dead host literal with `opencanvas.aayushman.dev`. That swapped one bug for another: every Apogee-derived site now emits a canonical pointing at the *apex*, not at its own publishing host. A Briar site published at `briar.opencanvas.aayushman.dev` emits `<link rel="canonical" href="https://opencanvas.aayushman.dev/blog">` — wrong host, wrong page.

The deeper question: why did the fixture carry hard-coded canonicals at all? The runtime path in [src/seo/meta-emit.ts:138-149](../../src/seo/meta-emit.ts#L138-L149) already composes the correct canonical from the request host + page slug when `page.canonical` is unset. The fixture's only contribution was staleness. The same "fixture stores nothing the runtime can derive correctly" rule that [ADR 0041](0041-og-image-fresh-render-per-page.md) decision 1 applied to `ogImageAssetId` applies here: drop the field, let the runtime do its job.

## Decisions

1. **Built-in template fixtures do not set `canonical` on page SEO blocks.** The five occurrences in `apogee-showcase.json` (lines 615, 2357, 3453, 4950, 6367) are removed. `resolveCanonical` at [src/seo/meta-emit.ts:138-149](../../src/seo/meta-emit.ts#L138-L149) handles the rest — it composes `https://<host><path>` from the request's `Host` header and the page slug whenever `page.canonical` is empty.

   **Why:** the runtime path is already correct *and* host-aware — it produces `https://briar.opencanvas.aayushman.dev/blog` for a Briar publish and `https://mysite.io/blog` for an OSS fork's publish without touching any code. A `{{APEX}}` placeholder layer (an earlier proposal of this ADR) would have resolved to the apex, repeating the host-mismatch bug under a different name. Empty-by-default is the smaller and more correct primitive. Owner-authored overrides (e.g. a marketing umbrella canonical) remain a first-class feature: the Owner sets `page.canonical` through the SEO panel and that value survives downstream. The fixture just doesn't pre-seed one.

   This mirrors [ADR 0041](0041-og-image-fresh-render-per-page.md) decision 1 exactly. Same primitive, same rationale, both legs of the Apogee fixture leak close the same way.

2. **A boot-time check fails if any `src/canvas/fixtures/*.json` page SEO block carries a non-empty `canonical` or `ogImageAssetId`.** The check runs at server boot (and in unit tests) and lists the offending fixture + page index.

   **Why:** the runtime is correct, the fixture is the only regression surface, and the regression class ("fixture author wrote a literal URL or asset id in dev") is easy to forget at PR review. A boot-time check makes the rule observable at the cheapest possible moment. Combined with the same rule from [ADR 0041](0041-og-image-fresh-render-per-page.md), this collapses both fixture-leak follow-ups into one assertion.

3. **The SEO panel's SERP preview reflects the *actual* canonical that will be emitted, not the auto-derived URL.** [src/routes/dashboard/page-settings.tsx:1316](../../src/routes/dashboard/page-settings.tsx#L1316) is changed so the `[data-preview-canonical]` node renders `canonicalVal || publishedUrl` on initial paint. The Owner sees the leaked value, not a misleadingly correct preview.

   **Why:** the panel today reads `page.canonical` for the form input but renders `publishedUrl` in the preview. An Owner who opens the panel sees a SERP preview that *agrees* with the live page URL even when the renderer is about to emit a stale fixture canonical. That hides the bug — the panel actively misinforms. Showing the real canonical at every place the renderer would use it is the structural fix.

4. **The SEO panel warns when the canonical's hostname does not match the site's publishing host.** A small inline banner above the canonical field reads "This canonical points at a different host than this site publishes on. That tells search engines the page lives elsewhere — usually a mistake." The warning is purely advisory; the field is not auto-cleared.

   **Why:** the all-or-nothing rule from the user's global preferences forbids silent corrections. The Owner is the source of truth for "did I mean to do that?" — an Owner who points pricing-page canonicals at a marketing umbrella has a legitimate reason; the warning surfaces the situation without acting on it. For the fixture-leak case (the common one) the Owner now sees the leak at the dashboard, not on a search engine log six weeks later.

## Out of scope

- **Auto-overriding canonicals an Owner has already saved on existing sites.** That's the migration sweep, addressed separately in this ADR's Follow-ups but not by code in the application path.
- **OG image URLs in fixtures.** Closed by [ADR 0041](0041-og-image-fresh-render-per-page.md).
- **Per-fixture defaults beyond Apogee.** The boot-time check from decision 2 covers *every* built-in fixture under `src/canvas/fixtures/*.json` once landed; no per-fixture audit is needed beyond that.
- **Removing the `canonical` field from `CanvasPage` schema.** Owners still need a deliberate-override path. Empty-default + explicit-override is the right primitive, not "no field."

## Consequences

**Positive:**
- Every page of every site (template-derived or not) emits canonicals that match its actual publishing host, automatically. Briar publishes Briar canonicals; a fork on `mysite.io` publishes `mysite.io` canonicals. Zero source edits, zero per-site SEO-panel intervention.
- The "fixture stores nothing the runtime can derive correctly" rule from [ADR 0041](0041-og-image-fresh-render-per-page.md) generalises: built-in template fixtures hold zero pre-resolved URLs or asset references on page SEO blocks.
- The SEO panel actively flags the regression class. The Owner sees the leak at the dashboard the moment they open the SEO page, not after a search-engine indexing delay.

**Negative:**
- An Owner who *wanted* a deliberate cross-host canonical (the umbrella-marketing case) sees a yellow warning every time they open the SEO panel. The warning text is honest about this — "usually a mistake" — but is not a perfect signal. They can ignore it; the field still saves.
- The fixture-side fix only protects *new* sites. Already-published sites whose `editableState.pages[*].seo.canonical` carries a stale value still need the migration sweep (Follow-ups).
- The boot-time check from decision 2 fails the build if a future fixture author writes a literal URL in dev. That's the *intended* behaviour, but it's a fail-fast posture that adds one more thing to know about the fixture-author flow.

## Follow-ups

- **SEO smoke** asserting that a snapshot derived from `apogee-showcase.json` emits canonicals starting with `https://<request-host>/`, not with any hard-coded apex literal. Closes the regression loop at test-time.
- **Migration sweep** of already-published sites whose `editableState.pages[*].seo.canonical` contains `apogee.rev01.aayushman.dev` or hosts that don't match the site's publishing host. Same shape as the OG-side sweep called out in [ADR 0041](0041-og-image-fresh-render-per-page.md) follow-ups. Land both together if both leaks shipped to the same site cohort.
- **Other fixtures**: the boot-time check from decision 2 covers Starter, Launch, Enterprise, Studio, Local. No per-fixture follow-up needed beyond confirming the check fires cleanly on all of them.
