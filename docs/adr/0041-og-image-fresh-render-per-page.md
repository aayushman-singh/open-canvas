# ADR 0041 — Apogee Showcase fixture og:image renders fresh per published page, not pre-baked to a seed asset

**Status:** Proposed
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** the og:image leak surfaced in Pass 4 + Pass 5 of the demo drive and named in [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.14. Three `ogImageAssetId: "seed-feature-canvas-1"` literals live in [src/canvas/fixtures/apogee-showcase.json](../../src/canvas/fixtures/apogee-showcase.json) at lines 617, 2359, 4952. Every site created from Apogee Showcase publishes those pages with an og:image pointing at the Apogee fixture's hero asset — not at a freshly-rendered OG PNG with the Owner's own page title / description / style kit.

## Context

The Apogee Showcase fixture is the seed for every Owner who picks "Apogee Showcase" in the template gallery (S1.6 in [docs/demo/act-1-script.md](../demo/act-1-script.md)). The fixture's per-page SEO blocks pre-set `ogImageAssetId` to `seed-feature-canvas-1` — the Apogee hero asset bundled with the fixture. `resolveOgUrl` in [src/seo/og-resolve.ts](../../src/seo/og-resolve.ts) treats any present `ogImageAssetId` as an Owner-authored override and routes the meta tag to `/assets/<contentHash>` (the Apogee seed) instead of `/og/<siteId>/<slug>.png` (the fresh render).

Symptom: a Briar-from-Apogee site (the demo recording's protagonist) publishes the Apogee fixture's stock hero on its LinkedIn / Twitter cards. The Owner sees their own page in the dashboard, doesn't touch the SEO panel, and only discovers the leak when a colleague pastes the URL into Slack and the wrong image appears in the unfurl.

The OG-render pipeline at [src/og-image/route.ts](../../src/og-image/route.ts) is already correct. It composes the page title, page description, site name, and style-kit preset into a Satori SVG, rasterises to a 1200×630 PNG with resvg, and caches in R2 keyed on `(siteId, pageSlug, snapshot.version)`. The fixture is the only reason it isn't reached: an `ogImageAssetId` set at fixture-author time pre-empts the render path for the lifetime of the site.

The narrow fix is a three-line deletion in `apogee-showcase.json`. The deeper question is the same one [ADR 0040](0040-canonical-urls-from-host-config.md) asks of canonical URLs: why did the fixture carry a per-site asset reference at all, when the runtime already renders the correct thing for free?

This ADR sits next to [ADR 0040](0040-canonical-urls-from-host-config.md) (canonical URLs) as the second leg of the Apogee-fixture cleanup. [ADR 0040](0040-canonical-urls-from-host-config.md) decision 2 ("empty canonical → derive at request time") is the precedent: the runtime already does the right thing; the fixture's job is to *not* override it.

## Decisions

1. **Built-in template fixtures do not set `ogImageAssetId` on page SEO blocks. The three occurrences in `apogee-showcase.json` (lines 617, 2359, 4952) are removed.** The runtime path in [src/seo/og-resolve.ts](../../src/seo/og-resolve.ts) — `page.ogImageAssetId` empty → `/og/<siteId>/<pageSlug>.png` — handles the rest. The OG-render route renders the page's actual title and description against the Owner's active style-kit preset on first request, caches the PNG in R2, and serves the cached bytes for the lifetime of the snapshot version.

   **Why:** fixture-side fix beats runtime-side for the same reason [ADR 0040](0040-canonical-urls-from-host-config.md) decision 2 picked it for canonicals — the runtime already produces the correct value; the fixture's only contribution is staleness. A placeholder substitution (the alternative — `{{OG_RENDER_URL}}` or similar) would add a loader step that has no behavioural payoff over an unset field. Owner-uploaded overrides remain a first-class feature: the Owner sets `ogImageAssetId` through the SEO panel and that value survives downstream. The fixture just doesn't pre-seed one.

2. **Render trigger stays lazy (first request to `/og/<siteId>/<slug>.png` after a snapshot-version bump), not pre-warmed at publish time.** The publish path does not `waitUntil` an OG-render call.

   **Why:** the recording's Session 7.H pastes the published URL into a social-card preview tool *seconds* after publish completes. The render path under Satori + resvg-wasm is sub-second on Workers (the rasterise step is the bottleneck and is already optimised). The first preview-tool fetch warms the cache; subsequent shares hit R2. Pre-warming buys a few hundred milliseconds on a single first-visitor request at the cost of complicating the publish path with a fire-and-forget render that can't surface its own failures (the publish response has already returned). The all-or-nothing rule from the user's global preferences says a hidden background failure is worse than a slightly slower first paint. If the recording proves the first-paint latency is visible, a `waitUntil` pre-warm is a single-line follow-up — but it's not the default.

3. **The Satori template inputs are: site name, page SEO title, page SEO description, and style-kit preset (typography + accent colours).** No hero image is composited into the OG card. The render is a typographic card — title + description over a kit-coloured background — not a screenshot of the page.

   **Why:** the existing renderer at [src/og-image/render.tsx](../../src/og-image/render.tsx) and the call site in [src/og-image/route.ts:83-88](../../src/og-image/route.ts) already accept exactly these inputs. Adding "page's first image element" as a hero source would couple the OG render to canvas-element traversal, force a fetch-and-decode of an arbitrary Owner-uploaded asset inside the Worker, and produce visually inconsistent cards across pages of the same site (some pages have a clear hero, some don't). The typographic card is consistent, kit-coherent, and renderable from data already in the published snapshot. An Owner who wants a custom image still uploads one and sets `ogImageAssetId` — decision 1 keeps that path open.

4. **Cache scope: the R2 key `(siteId, pageSlug, snapshot.version)` already in place ([src/og-image/cache.ts](../../src/og-image/cache.ts)) is the cache-invalidation primitive. No additional invalidation logic is added.**

   **Why:** every Owner edit that ships to visitors goes through publish, which bumps `snapshot.version`. The new version produces a new R2 key; the stale PNG under the old key is unreachable by URL (the `og:image` meta tag emitted into the new snapshot's HTML points at the versioned key, not at a stable alias). R2 sweeps abandoned keys via lifecycle rules out of scope of this ADR. The 1-hour `Cache-Control: public, max-age=3600` from the OG route caps downstream CDN/social-crawler caching between publishes, which is already correct — crawlers re-fetch on next share after the TTL.

5. **OG image dimensions stay at 1200×630.** The rasterise step at [src/og-image/rasterise.ts](../../src/og-image/rasterise.ts) and the meta-emit dimensions hints at [src/seo/meta-emit.ts:214-217](../../src/seo/meta-emit.ts) already agree on this; the ADR confirms it as the spec-compliant default (Open Graph + Twitter Cards both target 1200×630 for `summary_large_image`).

   **Why:** spec-default and existing-code-agree. No reason to deviate. A future ADR can revisit per-aspect-ratio renders (square for LinkedIn, vertical for Pinterest) if the demand surfaces — out of scope here.

## Out of scope

- **Migrating already-published Apogee-from-fixture sites whose snapshots carry `ogImageAssetId: "seed-feature-canvas-1"`.** That's a one-shot rewrite of `editableState.pages[*].seo.ogImageAssetId`, parallel to the canonical migration sweep called out in [ADR 0040](0040-canonical-urls-from-host-config.md)'s follow-ups. Tracked there, not here.
- **Other fixtures (Starter, Launch, Enterprise, Studio, Local).** If any of them also pre-seed `ogImageAssetId`, the fixture-author audit in [ADR 0040](0040-canonical-urls-from-host-config.md)'s follow-ups covers them. Decision 1's rule ("built-in fixtures do not set `ogImageAssetId`") applies to all of them; the ADR text references Apogee because that's the concrete leak.
- **Adding a hero image to the OG render template.** Decision 3 explicitly rules it out. A future ADR can revisit if Owners report that the typographic card is insufficient.
- **Pre-warming the OG render at publish time.** Decision 2 explicitly rules it out. A `waitUntil`-based pre-warm is a single follow-up if the demo recording surfaces a visible first-paint latency.
- **Renderer-level changes** (Satori template typography, accent-colour derivation rules, font-loading). Those belong to [src/og-image/render.tsx](../../src/og-image/render.tsx) and are governed by [ADR 0022](0022-twelve-token-oklch-theme-grammar.md) for the colour grammar.

## Consequences

**Positive:**
- Every page of every Apogee-Showcase-derived site emits an OG card that matches the page's own title, description, and style kit. The demo recording's Session 7.H shows a Briar card, not an Apogee card, with zero Owner intervention.
- The render path that already exists, is already tested ([src/seo/smoke.ts](../../src/seo/smoke.ts) assertion 4, [src/og-image/](../../src/og-image/) route), and is already cache-correct becomes the default rather than a fallback Owners discover by accident.
- Consistent with [ADR 0040](0040-canonical-urls-from-host-config.md)'s "fixture stores nothing the runtime can derive correctly" rule. The two ADRs together close both legs of the Apogee fixture leak.

**Negative:**
- An Owner who *wanted* the Apogee seed hero as their OG card (unlikely, but possible — they liked the stock image) loses that as the default. Remedy: upload it as their own ownerAsset and set `ogImageAssetId` to the new id. One-time action.
- First share of any page after a publish pays a sub-second render cost on the cache-miss path. The recording's Session 7.H is the relevant audience and the render is fast enough that this is invisible — but it is a real (small) cost.
- The fixture's `faviconAssetId: "seed-feature-canvas-1"` at line 607 is *not* changed by this ADR (favicons are a separate concern). If a future audit decides favicons should also be empty-default, that's a separate ADR.

## Follow-ups

- **Immediate hot-fix:** delete the three `ogImageAssetId` lines (617, 2359, 4952) from `apogee-showcase.json`. The deletion is structural — surrounding JSON commas must be cleaned up so the file stays valid. Verify via `bun run lint:fixtures` (or whichever fixture-validation smoke exists) before commit.
- **Boot-time check** mirroring [ADR 0040](0040-canonical-urls-from-host-config.md) decision 3: fail boot if any `src/canvas/fixtures/*.json` page-SEO block carries a non-empty `ogImageAssetId`. The check enforces decision 1 across new fixtures so a future author doesn't recreate the leak.
- **Verify the lazy-render path in the recording.** Session 7.H paste-into-preview-tool latency is the empirical test of decision 2. If the first-render delay is visible, file a follow-up ADR for `waitUntil` pre-warm — the implementation is small but the decision deserves its own record.
- **Migration sweep** of already-published snapshots whose `editableState.pages[*].seo.ogImageAssetId === "seed-feature-canvas-1"`. Parallel to the canonical sweep from [ADR 0040](0040-canonical-urls-from-host-config.md). Surface count in the result.
- **OG smoke** asserting that a published snapshot derived from `apogee-showcase.json` produces `og:image` URLs starting with `/og/`, not `/assets/`. Closes the regression loop at test-time.
