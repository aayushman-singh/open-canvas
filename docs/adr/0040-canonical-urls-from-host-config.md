# ADR 0040 — Apogee Showcase fixture canonical URLs derive from host config, not hard-coded

**Status:** Proposed
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** the canonical-URL leak surfaced in Pass 3 + Pass 4 of the demo drive and re-confirmed in [docs/demo/drive-2026-05-29-pass-5-findings.md](../demo/drive-2026-05-29-pass-5-findings.md). Five `apogee.rev01.aayushman.dev` literals live in [src/canvas/fixtures/apogee-showcase.json](../../src/canvas/fixtures/apogee-showcase.json) at lines 615, 2357, 3453, 4950, 6367. Every site created from Apogee Showcase publishes those URLs into its meta tags until the Owner manually overrides them.

## Context

The Apogee Showcase template fixture is the seed for every Owner who picks "Apogee Showcase" in the template gallery (S1.6 in [docs/demo/act-1-script.md](../demo/act-1-script.md)). It includes per-page SEO blocks with a `canonical` field. The fixture was authored when rev01 ran at `rev01.aayushman.dev` with per-site subdomain `apogee.rev01.aayushman.dev`. The apex migration to `opencanvas.aayushman.dev` (per [ADR 0013](0013-host-config-from-environment.md), the `project_opencanvas_apex_migration` memory, and the rebrand commits on `origin/main`) moved every site under the new apex, but the fixture's hard-coded canonicals stayed pointed at the dead host.

Symptom: every published site that came out of Apogee Showcase emits `<link rel="canonical" href="https://apogee.rev01.aayushman.dev/...">` until the Owner manually edits each page's SEO panel. Search engines de-duplicate against canonicals; this is a real SEO failure that the Owner cannot easily diagnose (the dashboard SEO panel shows a per-page canonical field that the Owner thinks is correct because they never touched it).

The narrow fix is a five-URL search/replace. The deeper question is why the fixture carried hard-coded canonicals at all — [ADR 0013](0013-host-config-from-environment.md) decision 5 already says the apex domain derives from `APP_DOMAIN` at boot, so a canonical URL in a fixture is by definition stale-prone.

## Decisions

1. **Canonical URLs in built-in template fixtures use a `{{APEX}}` placeholder, resolved by the fixture loader at site-create time using the runtime `APP_DOMAIN`.** The five literal occurrences in `apogee-showcase.json` are rewritten to `https://{{APEX}}/...` (or simpler, `{{APEX}}/...` if the loader normalises). The loader's existing fixture transformation pipeline gains a placeholder-substitution step that runs once per fixture-clone.

   **Why:** the OSS-fork promise ([ADR 0013](0013-host-config-from-environment.md)) already says the apex is one env var. Hard-coded canonicals in fixtures break that promise — a fork operator who sets `APP_DOMAIN=mysite.io` still inherits `apogee.rev01.aayushman.dev` canonicals through this template. The placeholder is the smallest extension of the env-driven-host rule that closes the hole. It also doesn't change the per-page canonical-override UX: the Owner can still edit the field, and an explicit override survives kit changes, template swaps, etc.

2. **Pages with an empty / null `canonical` field continue to use the runtime-derived canonical (current behaviour) at publish-meta-emission time** ([src/seo/meta-emit.ts](../../src/seo/meta-emit.ts)). Decision 1 only addresses fixtures with *non-empty* canonical fields.

   **Why:** there's already a working code path for "no canonical override → derive from the live URL at request time." That code is correct under the apex migration because it reads from request context, not from a fixture. Decision 1 is only about the case where a fixture wants to *override* the auto-derived canonical with a deliberate URL.

3. **A boot-time check fails if any fixture's `canonical` field contains a literal hostname that isn't `{{APEX}}`-prefixed.** The check runs against `src/canvas/fixtures/*.json` at server boot (or test setup) and lists the offending fixture + line.

   **Why:** the broader rev01 codebase already follows the "fail loud" pattern (per the user's global preferences and [ADR 0013](0013-host-config-from-environment.md) decision 2). The fixtures are the most-likely source of regression here because new fixtures will be authored against a real URL in dev, and the placeholder substitution is easy to forget. A boot-time check makes the regression visible at the cheapest moment — before any site is created.

## Out of scope

- **Auto-overriding canonicals an Owner has already saved on existing sites.** That's a one-shot migration concern (rewrite every published `editableState.pages[*].seo.canonical` whose value contains `apogee.rev01.aayushman.dev`), separate from the fixture fix. This ADR does not address it.
- **OG image URLs in fixtures.** Those have their own leak ([docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.14) and are addressed by [ADR 0041](0041-og-image-fresh-render-per-page.md).
- **The placeholder syntax itself.** `{{APEX}}` is the proposal here; a future placeholder ADR can rationalise this with other template-placeholder needs ([ADR 0014](0014-template-literal-data-substitution.md) already governs data placeholders).
- **Removing the `canonical` field from `apogee-showcase.json` entirely.** Some pages do want a non-default canonical (e.g. the pricing page canonical-pointing to a marketing umbrella). Empty-default + explicit-override is the right primitive, not "no field."

## Consequences

**Positive:**
- Every site created from Apogee Showcase emits canonicals that match the publishing apex, automatically.
- A fork on `mysite.io` inherits correct canonicals from the template without any source edits.
- The boot check makes the regression class ("fixture author wrote a literal URL") observable in the dev loop, not in production search-engine logs.

**Negative:**
- One more layer in the fixture-loader pipeline (the placeholder substitution). It's small (one regex) but it's another step in the create-site path.
- Fixture authors must know to use `{{APEX}}` rather than literal URLs. That's documented behaviour, but the boot check makes the rule observable on regression rather than at PR review.
- The five-URL hot-fix (search/replace in `apogee-showcase.json`) lands separately and immediately; this ADR's full implementation lands after. Until then, the hot-fix is the only thing protecting new sites from the leak.

## Follow-ups

- **Immediate hot-fix:** search/replace the five `apogee.rev01.aayushman.dev` occurrences in `apogee-showcase.json` with `opencanvas.aayushman.dev`. This is a 5-minute change that doesn't wait on this ADR's full implementation. The ADR makes the *structural* fix (placeholder + loader + boot check) so the regression doesn't recur.
- **Then:** rewrite the same fixture's canonicals with `{{APEX}}`, add the loader substitution, add the boot check.
- **Migration sweep:** if any sites already published with the leaked canonical, rewrite their `editableState.pages[*].seo.canonical` field in a one-shot script. Surface count in the result (likely small — apex migration is recent).
- **Next fixture audit:** apply the same `{{APEX}}` placeholder to any other built-in template fixture (Starter, Launch, Enterprise, Studio, Local — five more under `src/canvas/fixtures/`).
