# ADR 0021 — Dashboard ships as one shared, browser-cached asset bundle

**Status:** Proposed
**Date:** 2026-05-29
**Author:** Aayushman Singh
**Drives:** the dashboard side of the inline-template-literal problem ([handoff-rev01-batch-27](../../) §"Theme E"). Follows the same delivery model as [ADR 0015](0015-editor-client-asset-pipeline.md). Flagged as a follow-up in 0015's out-of-scope.

## Context

The dashboard surfaces today — `src/routes/dashboard/index.tsx`, `page-settings.tsx`, `site-settings.tsx`, `templates.tsx`, `domains.tsx`, and the rest — render server-side TSX with embedded `<script>` blocks per page. Each page ships its own inline script for the dashboard-side interactivity (form handling, drag-drop in the templates picker, modal open/close, etc.). The shape is different from the editor's monolithic single-script: each dashboard page is a smaller, self-contained TSX render with a smaller embedded script, but the *combined* surface across all dashboard pages adds up.

The Owner-perceived failure mode is the same as the editor's: navigating between dashboard pages re-downloads each page's inline script every time, because there is no separate URL to cache. The developer-perceived failure mode is similar to the editor's pre-[ADR 0015](0015-editor-client-asset-pipeline.md) state: each TSX page either inlines its script as a template literal (carrying the same backtick / interpolation hazards [ADR 0014](0014-template-literal-data-substitution.md) names) or imports a string constant from a sibling `.script.ts` file. There is no shared module system across dashboard pages today.

[ADR 0015](0015-editor-client-asset-pipeline.md) defined the delivery mechanism (Bun.build → hashed-filename assets under `[assets]` binding → cached static asset) for the editor. The same mechanism applies to the dashboard, with one decision the editor did not have to make: **how to chunk the dashboard's JS across pages.**

Three chunking options exist:
- **One shared bundle**: every dashboard page loads the same `dashboard.<hash>.js`. Cached once after the first dashboard visit; warm-load to any other dashboard page is free.
- **One bundle per page**: each page loads its own `dashboard-<page>.<hash>.js`. Smaller per page; warm-load to a different page still incurs a download.
- **Hybrid (shared core + per-page chunks)**: a shared module with common code plus tiny per-page chunks. Most cache-efficient; most build complexity.

The shared-bundle option wins given the dashboard's traffic shape: an Owner typically visits multiple dashboard pages in one session (sites list → site detail → page settings → publish), so the per-session re-download of "the same code, paid for once" pattern is the cheapest. The cold-load penalty (downloading code for pages the Owner may not visit this session) is real but small compared to the per-navigation savings.

## Decisions

1. **The dashboard TSX surfaces migrate to one shared TS module tree (`src/dashboard-client/`) that builds via Bun.build into a single hashed-filename JS asset, served from the same `[assets]` binding as [ADR 0015](0015-editor-client-asset-pipeline.md).** Every dashboard route's HTML shell loads `<script src="/_assets/dashboard.<hash>.js" defer></script>`. The shared bundle is cached once per browser; subsequent dashboard navigations download only the small per-page HTML shell.

   **Why:** the Owner's traffic pattern in the dashboard is multi-page-per-session (Owner navigates between sites list, site detail, page editor, publish dialog, etc. in one workflow). A shared bundle caches once and serves every subsequent navigation for free; per-page bundles re-download on every navigation. The cold-load cost of "shared bundle is bigger than any single page's code" is a one-time cost amortised across the session. Hybrid chunking would buy a smaller cold load at the cost of build-config complexity ([ADR 0015](0015-editor-client-asset-pipeline.md) decision 2 chose Bun.build's straightforward output for the editor; per-page chunks would push beyond the simple-entry-point shape). The shared-bundle pick keeps the dashboard's delivery model parallel to the editor's.

2. **The dashboard build script is a sibling of `scripts/build-editor-client.ts` (per [ADR 0015](0015-editor-client-asset-pipeline.md) follow-up): `scripts/build-dashboard-client.ts`.** Same shape — entry point at `src/dashboard-client/index.ts`, Bun.build call, hashed-filename output, manifest module updated alongside the editor manifest. CSS bundling is handled the same way.

   **Why:** keeping the two build scripts parallel makes "we have two cached client bundles, one for the editor and one for the dashboard" the natural reading. A single combined build script for both would couple their schedules — a change to the dashboard would force a rebuild of the editor (and a cache bust of the editor bundle's hash) — which is exactly the no-incidental-coupling property the per-asset hashing buys.

3. **Per-page request-specific boot data (current site, current user, feature flags, etc.) flows through the same `window.__rev01DashboardBoot` named-globals pattern [ADR 0015](0015-editor-client-asset-pipeline.md) decision 6 defined for the editor, with the same per-request-nonce CSP gating from [ADR 0020](0020-csp-nonce-for-editor-boot-blob.md) extended to the dashboard route.** Each dashboard route emits its own inline boot blob; the bundle reads from `__rev01DashboardBoot` on init and dispatches to the page-specific handler.

   **Why:** the dashboard's per-page differences (which page is being viewed, what entity is current) are exactly the kind of request-specific data the bundle cannot bake in. The named-globals pattern works for the dashboard for the same reasons it works for the editor; sharing the convention across the two surfaces means one mental model for "how does request-specific data reach the cached bundle." The CSP nonce decision applies identically — every dashboard route has the same one-inline-script profile after migration.

4. **The dashboard bundle is built with the same source-map policy as the editor: source maps in dev, none in production.** [ADR 0015](0015-editor-client-asset-pipeline.md) decision 4 applies unchanged.

   **Why:** consistent developer-debug story across the two surfaces. No reason to diverge.

## Out of scope

- Visitor-side dashboard analytics / telemetry bundles — none exist today; if any are added later, separate ADR.
- The `src/routes/api/*` routes — they serve JSON, not HTML, and have no inline-script story to migrate.
- The dashboard's auth and routing logic — both stay server-side in the Worker; this ADR is about *client-side dashboard JS delivery*, not about restructuring server-side dashboard code.
- Hybrid chunking (shared core + per-page chunks). Reconsider in a follow-up ADR if the shared bundle grows large enough that the cold-load cost becomes the bottleneck.
- The dashboard *CSS* surface — assumed to be mechanically similar to the editor's `canvas-styles.ts` migration but the dashboard's CSS is currently a different shape (per-component styling vs the editor's monolithic stylesheet). Worth a separate ADR if it materially diverges.

## Consequences

**Positive:**
- Dashboard per-navigation payload drops from "re-download each page's inline JS every time" to "download the dashboard bundle once per session, then small HTML shells thereafter."
- Dashboard developers write code in normal TS modules with normal imports; the [ADR 0014](0014-template-literal-data-substitution.md) substitution mechanism is unnecessary for the dashboard side (just as [ADR 0015](0015-editor-client-asset-pipeline.md) makes it unnecessary for the editor).
- Build pattern and operational story are identical between the editor and dashboard surfaces; one mental model.

**Negative:**
- Cold-load to any dashboard page downloads code for *every* dashboard page. For an Owner who only ever opens "domains" (and only once), the cold-load is larger than the per-page-bundle alternative would have been. The shared-bundle pick assumes multi-page sessions; single-page-per-session usage is a worst case.
- The dashboard's per-page handler code is in one file (or one tree) rather than scattered across page-specific files. The split between "what runs on every page" and "what's specific to this page" needs to be expressed in the bundle's own routing logic (`if (page === 'site-settings') initSiteSettings(); …`).
- Tighter coupling between dashboard pages: a build break in one page's code breaks the whole dashboard bundle. Mitigated by the existing typecheck pre-commit hook + per-feature smokes.

## Follow-ups

- Land after [ADR 0015](0015-editor-client-asset-pipeline.md) ships; the build infrastructure (`build-editor-client.ts`, the `[assets]` binding, the manifest pattern) is the foundation this ADR builds on.
- Write `scripts/build-dashboard-client.ts` modelled on the editor's build script.
- Extract dashboard TSX inline scripts into `src/dashboard-client/<page>.ts` modules with a single entry point `src/dashboard-client/index.ts` that dispatches on the page identifier.
- Update each dashboard route's TSX to emit the minimal HTML shell + `__rev01DashboardBoot` globals + `<script src="/_assets/dashboard.<hash>.js" defer>` pattern.
- Extend [ADR 0020](0020-csp-nonce-for-editor-boot-blob.md)'s nonce-generating helper to the dashboard routes; same nonce shape, same header values.
- If the dashboard CSS surface grows beyond what fits in a single bundled file, open a follow-up ADR for dashboard styles specifically.
- If the shared bundle grows large enough that cold-load latency becomes a complaint, open a follow-up ADR for hybrid chunking.
