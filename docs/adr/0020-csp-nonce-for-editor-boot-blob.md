# ADR 0020 — Per-request CSP nonce gates the editor's inline boot blob

**Status:** Proposed
**Date:** 2026-05-29
**Author:** Aayushman Singh
**Drives:** Content-Security-Policy tightening on the editor route. Surfaced as a follow-up in [ADR 0015](0015-editor-client-asset-pipeline.md)'s out-of-scope. Depends on ADR 0015 landing first.
**Verified-state:** verified 2026-06-03 — **none of the three decisions are as-built, and none can be while [ADR 0015](0015-editor-client-asset-pipeline.md) remains unimplemented.**
- The "minimal HTML shell with exactly one inline `<script>` boot blob" that this ADR would nonce does not exist yet — the editor route still ships the entire `canvas-client.ts` body inline (14,352 lines, see [ADR 0015's Verified-state](0015-editor-client-asset-pipeline.md)). Generating a per-request nonce against a multi-thousand-line inline body would either nonce the whole thing (defeating the CSP point) or require pre-extracting the shell-vs-bundle split that ADR 0015 owns.
- No `Content-Security-Policy` response header is emitted by the editor route today.
- This ADR's Follow-ups already name the dependency explicitly: *"Land after [ADR 0015]. Generating a nonce makes sense only once there is exactly one inline `<script>` to nonce."*

Status stays **Proposed, blocked on [ADR 0015](0015-editor-client-asset-pipeline.md)**. The dependency is hard, not soft — there is no incremental version of this ADR that ships standalone.

## Context

Today the editor route ships its entire client script inline inside a `<script>` tag, which forces the Worker's response either to omit a CSP header entirely or to include `script-src 'unsafe-inline'`. Both options let any reflected-XSS payload execute as a script — the protection an external-`<script src=…>`-only CSP would provide is unavailable while the editor depends on inline scripts.

[ADR 0015](0015-editor-client-asset-pipeline.md) moves the editor's main script body to a separately-fetched, content-hashed static asset served via Wrangler's `[assets]` binding. After that lands, the HTML shell carries exactly one inline `<script>` block — the request-specific boot blob (`window.__rev01EditorBoot = {…}`) that injects `siteId`, `apiBase`, the WS token, and similar per-request values the bundle reads on init. The boot blob cannot move to the cached bundle (it is request-specific) and cannot move to a data-attribute on the canvas root without a parse step the bundle would have to carry anyway.

Three approaches remove the need for `'unsafe-inline'` while keeping the boot blob inline:
- **Per-request nonce.** Server generates a random nonce per request; `<script nonce="…">` and `script-src 'nonce-…'` both carry it; browsers allow inline scripts whose nonce matches.
- **Hash-based CSP.** Compute SHA-256 of the boot blob, list it in `script-src 'sha256-…'`. Works only when the boot blob is deterministic (it is not — `siteId` and tokens vary per request).
- **Move boot data to a data attribute.** No inline script; bundle parses `<div id="canvas-root" data-boot='…'>`. Cleaner CSP but the parse step now lives in the bundle.

The nonce approach is the standard pattern for "we have legitimate request-specific inline scripts and want a CSP." It costs a per-request `crypto.randomBytes` call (negligible on Workers) and requires the same nonce to flow from the route handler into both the response header and the `<script>` attribute — a single template parameter.

## Decisions

1. **The editor route generates a CSP nonce per request and includes it in both the `Content-Security-Policy` response header (`script-src 'nonce-<value>' 'self'`) and the inline `<script>` tag carrying the boot blob (`<script nonce="<value>">`).** The nonce is at least 128 bits of entropy from `crypto.getRandomValues`, base64-encoded.

   **Why:** the nonce-based pattern is the only one of the three alternatives that handles request-specific inline content without dropping the CSP protection or moving the content elsewhere. Hash-based CSP cannot handle non-deterministic content; the data-attribute alternative pushes a parse step into the bundle for no remaining CSP benefit. Per-request nonce is the well-understood pattern for "we ship some inline script per request and we want a real CSP." 128 bits of entropy is the standard floor — collision probability across the lifetime of any conceivable deployment is operationally zero.

2. **`Content-Security-Policy` on the editor route lists `script-src 'nonce-<value>' 'self'` (no `'unsafe-inline'`), `style-src 'self' 'unsafe-inline'`, `connect-src 'self'` plus the WebSocket origin, `img-src 'self' data:` plus the assets domain, `font-src 'self'` plus any external font origins the deployed Style Kit references, and `default-src 'none'`.** Each directive is the tightest value the current code supports.

   **Why:** `default-src 'none'` is the only safe baseline — every directive that needs broader permission lists it explicitly. The current code uses inline `<style>` blocks in many places (per the inline-CSS theme from the original synthesis), so `style-src 'unsafe-inline'` stays until a separate ADR addresses inline styles. `img-src 'self' data:` covers the assets domain and the inline data: URIs the editor uses for placeholders. The WebSocket and font origins are externalised per [ADR 0013](0013-host-config-from-environment.md)'s helper.

3. **The CSP header is emitted by the editor route only.** Dashboard routes, public-site routes, API routes, and the live socket all get their own CSP decisions in follow-up ADRs. This ADR's scope is the editor's inline-boot-blob problem; widening the scope to "what is rev01's site-wide CSP?" would conflate unrelated decisions.

   **Why:** the route-by-route variation is real — the public site has different inline-style needs than the editor, the dashboard has different script needs, the API serves no HTML. A single site-wide CSP would have to be the loosest of the four, defeating the point.

## Out of scope

- Site-wide CSP for dashboard, public-site, API, and live-socket routes. Each is its own follow-up ADR.
- `style-src` tightening — inline styles are present throughout the editor; addressing them is its own ADR.
- Subresource Integrity (SRI) for the editor bundle. Worth doing once the bundle filename is content-hashed (per [ADR 0015](0015-editor-client-asset-pipeline.md) decision 3 it already is); SRI adds an extra `integrity="sha384-…"` on the script tag. Separate follow-up.
- `report-uri` / `report-to` directives for CSP violation reporting. Operationally valuable but the receiving endpoint is an additional moving part this ADR does not commit to.
- Browsers that do not support nonces (essentially none in scope today — every modern browser does).

## Consequences

**Positive:**
- Reflected-XSS via injected inline scripts becomes impossible on the editor route: the injection cannot guess the per-request nonce.
- The editor route ships a real CSP, not the `'unsafe-inline'` opt-out it carries today.
- The decision is route-local; landing it does not require coordinating with the dashboard, public, or API routes.

**Negative:**
- The CSP header is dynamic per request — the editor response cannot be cached at any layer that strips or normalises headers. Today the editor response is uncacheable anyway (per-site, per-auth-state), so this is no new constraint.
- A bug that generates a different nonce in the header vs the inline tag silently breaks the editor — the browser drops the inline script, the editor never initialises. The mitigation is a single template parameter shared between header and body; a smoke that loads the editor and asserts `window.__rev01EditorBoot` is defined catches this regression.
- The remaining inline styles still need `style-src 'unsafe-inline'`. The CSP is meaningfully tighter for scripts but not for styles; a follow-up ADR is needed to close that.

## Follow-ups

- Land after [ADR 0015](0015-editor-client-asset-pipeline.md). Generating a nonce makes sense only once there is exactly one inline `<script>` to nonce.
- Add a smoke that loads the editor with a known-good request, parses the response, verifies the nonce on the `<script>` tag matches the `Content-Security-Policy` header, and asserts the inline script executed (e.g. by checking the boot blob's effect on a downstream API call).
- Audit the actual inline `<style>` usage in the editor and decide whether `style-src` can drop `'unsafe-inline'` via a separate ADR (likely depends on the same kind of refactor [ADR 0015](0015-editor-client-asset-pipeline.md) did for scripts).
- Open follow-up ADRs for dashboard, public-site, and live-socket route CSPs as each surface settles.
- Consider SRI on the editor bundle's `<script src>` tag once the bundle hash is stable across deploys (it is, per [ADR 0015](0015-editor-client-asset-pipeline.md) decision 3).
