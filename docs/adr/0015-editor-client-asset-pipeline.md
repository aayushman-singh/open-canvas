# ADR 0015 — Editor client ships as a built, cached, separately-fetched asset

**Status:** Proposed
**Date:** 2026-05-29
**Author:** Aayushman Singh
**Drives:** Theme E of the rev01 OSS code review (handoff-rev01-batch-27 §"Theme E — Inline-string CSS + inline-string JS in TS templates") for the editor surface. Supersedes [ADR 0014](0014-template-literal-data-substitution.md) on completion.

## Context

An Owner opening the desktop editor today downloads everything the editor needs to function on every request. The HTML response from the editor route inlines the client script body as a `<script>` block — currently `src/editor/canvas-client.ts` (9333 lines) and `src/editor/canvas-styles.ts` (2089 lines) — every time. There is no browser cache for this payload because there is no separate URL to cache. Navigating away from the editor and back redownloads the entire 11kLOC bundle. Reloading the editor redownloads it. Adding a new editor feature grows the per-request payload directly.

The developer side is shaped by the same delivery model. Because the script body is a template literal returned from a TS function, the editor's TS source cannot use normal `import` statements for runtime values — every schema enum, every numeric bound, every regex must be redeclared inline as a JS literal. [ADR 0014](0014-template-literal-data-substitution.md) proposes a compile-time substitution mechanism to make those redeclarations derived rather than duplicated, but explicitly names itself as transitional: the substitution exists because the template-literal constraint exists, and goes away when the constraint goes away.

The codebase already has two patterns for shipping browser-side code from a Worker:

- `scripts/bundle-co-edit.ts` (the **bundle-to-string** pattern): an offline build script bundles `src/live/co-edit/client.ts` (with its Yjs / y-protocols deps) into an IIFE, JSON-stringifies the result, and writes it to `src/live/co-edit/bundled.ts` as `export const CO_EDIT_BUNDLE = "..."`. The editor route imports `CO_EDIT_BUNDLE` and inlines it. Bundled output is committed to the repo so the Worker has nothing to compile at request time. The script today calls `esbuild` directly — but esbuild is *not* a declared dependency in `package.json`; the import resolves only because Wrangler ships esbuild as a hoisted transitive. That reach is a load-bearing accident: a Wrangler version that stops hoisting esbuild, or a package-manager change, silently breaks the script.
- `src/interactive/build.ts` (the **concatenated-IIFE** pattern): hand-written JS source fragments (`ACCORDION_RUNTIME_SRC`, `CAROUSEL_RUNTIME_SRC`, etc.) are concatenated into a single IIFE string at request time. Intentionally unminified — the brief is ~3KB of hand-authored vanilla JS, not bundler output. Visitor-side hydration runtime.

Neither pattern caches in the browser. Both inline-on-each-request. That is correct for `interactive/`'s budget (3KB of always-needed visitor JS) and acceptable for `co-edit/`'s scope (loaded only when the editor opens a Yjs session). It is wrong for the editor's own scripts, which are an order of magnitude bigger and are loaded on every editor session.

The Owner-perceived failure mode is "the editor is slow to load every time, even when nothing changed." The developer-perceived failure mode is "I can't write the editor as normal TS — I have to redeclare every constant and avoid backticks." The two are caused by the same delivery model.

Wrangler's `[assets]` binding (added in 2024) serves static files from a configured directory at URL paths the operator chooses, alongside the Worker's own routing. The same single-worker deployment can ship a hashed, cacheable static asset *and* run the Worker's code, without introducing Workers Pages or a CDN.

## Decisions

1. **The editor's client script and stylesheet are built as separate JS / CSS bundles at build time, written to a hashed-filename location, and served as static assets via Wrangler's `[assets]` binding.** Source moves from `src/editor/canvas-client.ts` (one TS function returning a string) to `src/editor-client/` (a real TS module tree with normal `import` statements). An esbuild build step compiles the tree into `dist/_assets/canvas-client.<hash>.js` and `dist/_assets/canvas-styles.<hash>.css`. The editor route serves an HTML shell with `<script src="/_assets/canvas-client.<hash>.js" defer></script>` and `<link rel="stylesheet" href="/_assets/canvas-styles.<hash>.css">`.

   **Why:** the Owner's failure mode (re-downloading 11kLOC every editor session) is caused by inline-on-request delivery; a separately-fetched asset with a content-hash filename gets browser-cached as immutable, so the second-and-later session downloads only the small HTML shell. The developer's failure mode (can't import TS modules into the template literal) is caused by the template-literal constraint; a real TS module tree removes the constraint entirely, normal imports work, and the [ADR 0014](0014-template-literal-data-substitution.md) substitution mechanism becomes unnecessary. One mechanism resolves both failure modes.

   This would be wrong if the editor's per-session payload were small enough that re-downloading it on every navigation were free (it is not — 11kLOC pre-minification, somewhere in the hundreds of KB minified+gzipped) or if the developer ergonomics issue were itself negligible (it is not — the existing twelve mirrored constants, the no-backtick rule, the special review-smoke for catching template-literal breakage all attest to its size).

2. **The build step uses `Bun.build`, the bundler built into the Bun runtime, with the same overall shape as the existing `scripts/bundle-co-edit.ts` precedent generalised to emit hashed-filename outputs and a manifest module.** A new `scripts/build-editor-client.ts` runs at build time, takes `src/editor-client/index.ts` as entry, emits `dist/_assets/canvas-client.<hash>.js` (and corresponding `.css`), and writes `src/_assets/manifest.generated.ts` exporting `{ canvasClientUrl: string; canvasStylesUrl: string }`. The editor route imports the manifest and embeds the URLs in the HTML shell.

   **Why:** Bun is already a hard runtime requirement for this repo — every smoke is invoked via `bun run *`, the `dev:all` script is `bun run scripts/dev-all.mjs`, and contributors cannot work in the repo without Bun installed. Its bundler is built into the runtime, requires zero new dependencies, and covers every capability this ADR needs (IIFE/ESM output, browser target, source maps, content-hash filenames via `naming`, minification, in-memory artifact reads via `BuildArtifact.text()`, plain CSS bundling). The alternatives — adding esbuild as a direct dev dep, or continuing to reach into Wrangler's hoisted transitive — either grow the dependency surface or extend a known-fragile import path. Bun.build is the honest "no new tooling" answer that the original "esbuild is already a dep" framing falsely claimed.

   This would be wrong if rev01 ever picked up a build need outside Bun.build's scope (SCSS/Tailwind preprocessing, deep PostCSS integration, a community bundler plugin) — none of which apply today. If one materialises, that need drives the bundler choice for that surface; this ADR's choice does not need to anticipate it.

   `scripts/bundle-co-edit.ts` should migrate to the same mechanism in a small follow-up PR so the codebase has exactly one bundler answer; that work is named in the follow-ups below.

3. **Hashed-filename outputs are content-addressed and served with `Cache-Control: public, max-age=31536000, immutable`.** The hash is derived from the bundle's content (`Bun.build`'s `naming: '[name]-[hash].[ext]'` option). Different content produces a different URL; same content reuses the same URL across deploys.

   **Why:** the cache contract is "given URL X, the bytes are byte-identical forever." Content-addressed naming makes that contract mechanically true; immutable cache headers tell browsers to skip the conditional GET. The alternative — query-string cache-busting (`canvas-client.js?v=123`) — works for browsers but is inconsistent with CDN/proxy caching and leaks the version into HTML. Hashed filenames are the standard, well-understood mechanism and they cost nothing extra given esbuild produces them natively.

4. **Source maps ship in dev builds, not in production.** The dev build emits inline source maps so browser dev tools resolve canvas-client errors to the original TS files; the production build emits no source maps (the `.map` files are not built, not deployed, not referenced).

   **Why:** source maps unlock real-TS debuggability for developers — without them, "client TS as real modules" buys nothing the template-literal didn't already have, since errors still surface at unhelpful generated locations. In production they would expose the full editor source tree to anyone who opens dev tools on a deployed editor, which is a leak of internal helpers, validation paths, and integration shapes that the inline-template-literal model also avoided (sort of, accidentally). Skipping them in prod restores the property without skipping them in dev.

5. **The migration target is `src/editor/canvas-client.ts` + `src/editor/canvas-styles.ts` only. `src/canvas/public-styles.ts` (175 LOC), `src/interactive/build.ts` (visitor hydration), dashboard TSXs, and inline route scripts (modals, error pages, etc.) stay inline.** Each of those has a different shape — `public-styles.ts` is small and visitor-facing; `interactive/` is intentionally hand-authored and budget-bounded; dashboard TSXs are per-page-generated HTML with small embedded scripts; inline route scripts are one-offs. None of them carry the editor's "11kLOC re-shipped every request" cost.

   **Why:** the cost the ADR addresses is concentrated on the editor surface. Migrating the small inline scripts would add bundler complexity for no payload-size or developer-ergonomics win. Drawing the line at the editor's two big files keeps the change focused and reviewable. The visitor-side and dashboard-side concerns are real but different — they belong in their own follow-up ADRs if and when their own pain materialises.

6. **The HTML shell served by the editor route is hand-written and minimal: head with the style link, body with `<div id="canvas-root">` and the script tag, nothing more.** The shell's job is to load the bundle; the bundle's job is everything else. The shell does not embed configuration, content, or runtime-injected data — those flow to the client either through `window.__rev01EditorBoot = ...` (a single inline JSON blob the bundle reads on init) or through API calls the bundle makes itself.

   **Why:** the only legitimate reason to inline anything into the HTML shell is "this value comes from the request and can't be known at build time" — `siteId`, the API base URL, an auth token. Those go in one named globals object the bundle consumes as data. Anything that could be in the bundle should be in the bundle (so it caches); anything that's request-specific stays in the shell (so it doesn't accidentally bake into the cached asset).

7. **The Wrangler `[assets]` binding's `not_found_handling` defaults to handing 404s back to the Worker, not to a default-asset fallback.** The Worker's router takes precedence; only paths starting with `/_assets/` reach the static-asset layer. No "single-page-app fallback" routing, no implicit default document.

   **Why:** rev01's URL space is not an SPA — `/dashboard`, `/editor/<id>`, `/__live`, `/api/...`, and the public-site routes all run server-side logic in the Worker. A static-asset binding that "helpfully" serves `index.html` for unknown paths would silently intercept those routes. Scoping the static binding to `/_assets/` and routing everything else through the Worker preserves the existing routing contract.

8. **[ADR 0014](0014-template-literal-data-substitution.md) is superseded on completion of this ADR's migration. The substitution plugin, its token registry, and the post-substitution smoke are deleted; mirrored constants in the new `src/editor-client/` tree become normal `import` statements.**

   **Why:** [ADR 0014](0014-template-literal-data-substitution.md) explicitly named itself transitional and named this ADR as its replacement. Keeping both alive after the migration is pure cost — two ways to share enums across the editor boundary, both maintained, with no remaining justification for the substitution mechanism once the template-literal constraint is gone. The supersession is concrete: a single PR deletes the plugin alongside the last token-using file's migration.

## Out of scope

- **`src/canvas/public-styles.ts` migration** — visitor CSS is small and stays inline. If it grows or develops a caching pain, a follow-up ADR addresses it then.
- **Visitor-side bundles for `src/interactive/` and the popup runtime** — intentionally hand-authored, intentionally inline. A separate ADR if visitor JS payload becomes a concern.
- **Dashboard TSX migration** — different shape (per-page generated HTML with small embedded scripts). Worth its own ADR; not folded into this one.
- **CDN delivery / multi-region asset hosting** — single-Worker `[assets]` binding is sufficient for current scale and consistent with OSS-deployability. CDN is a follow-up if origin response times become the constraint.
- **Cache-control headers for the HTML shell itself** — the shell is dynamic (per-site, per-auth-state) and stays uncacheable; this ADR does not change that.
- **Build-step caching** (incremental rebuilds, watch mode) — orthogonal to the delivery model. `Bun.build`'s watch option in dev is a developer convenience addressed at the script level, not here.
- **CSP (Content Security Policy) tightening** — moving from inline scripts to external scripts opens the door to a stricter CSP (no `'unsafe-inline'` needed for the editor bundle), but the policy itself is a separate decision with stakeholders this ADR does not engage.
- **Server-side rendering of the canvas preview** — the editor still runs entirely client-side after boot; this ADR is about *how* the client ships, not *what* the client does.

## Consequences

**Positive:**

- The editor's per-session payload drops from "redownload 11kLOC every time" to "redownload a small HTML shell every time, fetch the cached bundle once." Cold-cache load stays at parity (one extra round trip in exchange for a cacheable response); warm-cache load is dramatically faster.
- The developer writes editor code as normal TS modules with normal imports. The twelve mirrored constants, the no-backtick rule, the review-smoke special case all disappear. [ADR 0014](0014-template-literal-data-substitution.md)'s entire mechanism becomes deletable.
- [ADR 0011](0011-canvas-element-registry.md) step 5 (client renderer dispatch) unblocks. The dispatch can ship as normal TS, imported by the client like any other module, without ADR 0014's substitution plugin or any new tooling.
- Source maps work in dev. Browser dev tools resolve errors to original TS files. Developer ergonomics improve concretely; debugging stops being a hex-cursor exercise in a 9000-line inline string.
- The build pipeline gains one `Bun.build` script. Bun is already a hard runtime requirement (every smoke runs via `bun run *`), so no new top-level dependencies are added — and the existing `scripts/bundle-co-edit.ts` esbuild-via-Wrangler-transitive accident loses its sole user, removable in the follow-up PR. The wrangler.toml gains an `[assets]` block with a directory and a URL prefix.

**Negative:**

- The first deploy of this ADR's change requires the operator to run the build script before `wrangler deploy`, in CI or locally. Today `wrangler deploy` is the only build step. The new step is `bun run build:editor-client && wrangler deploy` (or wrapped in a single npm script). This is a new failure mode — "deploy without running the build first ships stale bundles." A pre-deploy CI check (or a build script that runs as a `prepublish`-style hook) is the mitigation; the ADR does not specify which.
- The committed `src/_assets/manifest.generated.ts` (and the committed bundles, if that path is chosen) introduces generated files into git history. The `bundle-co-edit.ts` precedent already does this; the editor's bundle is larger and will produce noisy diffs on every editor-code change. The alternative — generating on every CI run and committing nothing — requires the build to be deterministic and the CI to gate every deploy. Either approach is a real choice; this ADR picks the committed-output path for consistency with the existing precedent and explicitly accepts the noisier git history.
- The migration is invasive. `src/editor/canvas-client.ts` is referenced by the editor route, by `src/review-smoke.ts`, by the existing build, and by every constant-mirror comment. The cutover is a single coordinated PR, not a per-file series — partial states (some routes serving from the bundle, some still inlining) would race.
- Source maps in dev mean local dev needs the asset server running (Wrangler's dev mode handles this; one more thing that has to work). Production has no source maps; if an Owner reports an editor crash with a stack trace in the bundled output, the developer has to reproduce locally to get readable frames. This is a real ergonomics loss for production debugging; the trade-off is the source-leak avoidance per decision 4.
- The `<script defer>` shell-then-bundle model has a small first-paint window where the canvas root is empty. The inline-script model had zero such window. The mitigation is a tiny inline skeleton in the shell (a "Loading editor..." state) that the bundle replaces on boot — small added complexity in the shell.

## Follow-ups

- Write `scripts/build-editor-client.ts` modelled on `scripts/bundle-co-edit.ts`: entry point, `Bun.build` call, hashed-filename output, manifest emit. Cover both JS and CSS in the same script (Bun.build handles CSS imports natively).
- Migrate `scripts/bundle-co-edit.ts` from `import { build } from 'esbuild'` to `Bun.build`. The script is ~40 lines today; the rewrite is the same shape. This step removes the codebase's only dependency on Wrangler's hoisted esbuild transitive and leaves one bundler answer for the whole repo. Best done either before or alongside the editor-client migration so the two new scripts share a pattern.
- Extract `src/editor/canvas-client.ts` into a real module tree under `src/editor-client/`. Use the existing structure (mark handling, inspector, drag/drop, etc.) as the natural split; the file's existing internal sections are already module-shaped.
- Extract `src/editor/canvas-styles.ts` likewise into `src/editor-client/styles/`.
- Add the `[assets]` binding to `wrangler.toml` with `directory = "./dist/_assets"` and `binding = "ASSETS"` (or similar). Configure `not_found_handling` per decision 7.
- Update the editor route handler to import the manifest and emit the HTML shell described in decision 6. Define the `window.__rev01EditorBoot` shape and remove all other inline configuration.
- Delete `src/editor/canvas-client.ts` once the bundle is the source of truth. Update `src/review-smoke.ts` to import from the new location (or to read the built bundle, whichever fits its assertions).
- Delete the ADR 0014 substitution plugin and registry. Per ADR 0014 decision 1, this is the deletion-on-supersession step.
- Add a `predeploy` hook (npm script chain) so `bun run deploy` runs `bun run build:editor-client` first. Document the chain in the README.
- Open a follow-up ADR for dashboard TSX migration once this lands and the pattern is exercised. The dashboards are bigger collective surface than the editor; the same delivery model fits but the per-page-script shape may want adaptations.
- Open a follow-up ADR for CSP tightening — moving to external scripts removes the technical blocker for dropping `'unsafe-inline'` from script-src; the policy decision is downstream.
