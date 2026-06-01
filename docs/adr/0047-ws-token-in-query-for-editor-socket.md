# ADR 0047 — Editor WebSocket bearer travels in the URL query string

**Status:** Accepted
**Date:** 2026-06-01 (proposed); 2026-06-01 (accepted)
**Author:** Aayushman Singh
**Drives:** the 2026-06-01 second-opinion audit pass named the 4-hour edit-token-in-URL as "long-lived bearer in URL" without naming the constraint that makes it the only practical mechanism in browsers. This ADR pins the constraint, the exposure surface, and the supersession trigger.
**Accepted-context:** verified 2026-06-01 — `src/live/socket-route.ts:36-37` reads `?wsToken=` from the upgrade URL and `verifyEditToken` gates the socket role assignment. `canvas-client.ts` opens the WS with the token in the query string. No alternative path (subprotocol, custom header) is wired. The as-built contract matches the ADR.

## Context

The on-site editor opens its co-edit WebSocket like this:

```js
new WebSocket(`wss://${location.host}/__live?siteId=${siteId}&wsToken=${editToken}`);
```

`wsToken` is the same value as the editor session's HTTP edit-token cookie ([`src/auth/edit-token.ts:22`](../../src/auth/edit-token.ts) — 4-hour TTL). The Worker's `/__live` handler reads it from the URL and verifies it via `verifyEditToken` before upgrading the socket. A valid token upgrades to `role=editor`; absent or invalid token degrades to `role=visitor` (presence-only, no Y.Doc write authority).

The browser WebSocket API exposes no mechanism to set custom request headers on the upgrade request. The two known workarounds are:

- **`Sec-WebSocket-Protocol` smuggling.** Pass the bearer as a subprotocol token. Treated as routing metadata by intermediaries; sometimes stripped or rewritten. Known anti-pattern.
- **Cookies on the upgrade.** Same-origin cookies do arrive on the upgrade request. But the editor at `<owner>.opencanvas.aayushman.dev/?edit` and the WS at the same origin's `/__live` is one topology; the editor on the apex (`opencanvas.aayushman.dev/dashboard/sites/.../edit`) hitting a custom-hostname WS is another. Across that mix, cookies are not reliably present.

Query-string bearer auth is the only mechanism that works uniformly across every Published Address shape. This ADR ratifies the choice and names the residual risk.

## Decisions

1. **The editor authenticates its WebSocket by passing the edit-token as a `?wsToken=` query parameter on the `wss://…/__live` upgrade URL. Custom request headers are not used; subprotocol smuggling is not used.**

   **Why:** the browser WebSocket API does not allow custom request headers, and the two workarounds (subprotocol, cookies) are unreliable across the apex / published-subdomain / custom-domain topology this product spans. Query-string bearer auth is the only mechanism that works uniformly. The Worker's `/__live` handler validates the token via `verifyEditToken` before upgrading; an invalid token degrades the connection to `role=visitor` rather than rejecting outright, so a stale token causes no Owner-perceived error during the editor's natural refresh path — the editor re-mounts and obtains a fresh token without the visible "your session expired" interruption.

   This would be wrong if browser WebSocket APIs gained a way to set Authorization headers. They have not in roughly fifteen years and no live proposal in the WHATWG / W3C / WHATWG threads exists; this ADR will be superseded at the moment such an API ships.

2. **The `wsToken` value is the same token as the editor session's HTTP cookie. There is no separate "short-lived WS token" minting path.**

   **Why:** minting a separate WS-only token would mean a second auth path with its own TTL, refresh story, revocation logic, and verify code. The editor session's edit-token already represents "this customer has been authenticated as an editor of this site"; the WebSocket is an extension of the same session. Reusing the token keeps the auth surface to one class and one verifier. The cost — the same 4-hour TTL appears in the WebSocket URL — is bounded by the URL only being persisted in three places, all of which are operator-only or already-authorised: the editor tab's address bar (the Owner is already authorised), the Worker access logs (operator-only), and the Cloudflare edge logs (Cloudflare-internal).

   This would be wrong if a third party could observe the WS URL. The plausible paths are (a) Referer headers on outbound image hot-links from a `/__live` error response, and (b) `window.opener.location` leaks from a window the editor opens to a visitor-controlled URL. Decision 4's smoke pins both as out of scope.

3. **The token's 4-hour TTL is the editor session length, inherited from the HTTP edit-token. Shortening the WS TTL specifically would require minting a separate WS token (decision 2's rejected path) and is not done.**

   **Why:** four hours is the calibrated "the Owner can keep an editor tab open through lunch" window. The WS inherits that window because it is the same token. Shortening it would force editor sessions to re-authenticate via a WS-only token refresh, which is a feature this product does not need until WS-URL exposure becomes a measured attack vector rather than a theoretical one.

   This would be wrong if a real exposure path were observed — if Cloudflare edge log retention or third-party CDN logging changed such that historical WS URLs became recoverable by a non-operator party, the TTL shortening (and the separate-token mint path) becomes load-bearing.

4. **Token-in-URL is acceptable only because the URL is `wss://` (TLS-protected). The Worker rejects `ws://` upgrades; there is no plaintext code path.**

   **Why:** the bearer-in-URL anti-pattern is severe when the URL travels in cleartext. Under TLS, the URL is encrypted in transit; only the endpoints (browser, Cloudflare edge, Worker origin) observe the path and query string. The published deployment is HTTPS-only via Cloudflare-managed certs ([ADR 0005](0005-custom-domains.md)); `wss://` is the only possible connection shape. Local development under Wrangler runs HTTPS for the editor route, so even dev does not weaken the contract.

   This would be wrong if any deployment served the editor over plain HTTP. None does.

## Out of scope

- The 4-hour edit-token TTL itself — owned by `src/auth/edit-token.ts`; not relitigated here.
- WebSocket reconnection behaviour after token expiration — covered by `src/editor/canvas-client.ts`'s reconnect-with-backoff logic and `loadInitialState` re-fetch.
- The visitor-side WS path (`role=visitor`) — has no auth and serves presence-only updates; no token to expose.
- An alternative `Sec-WebSocket-Protocol` smuggling channel — explicitly rejected as a known anti-pattern.
- Server-side log retention policy for the access-log surface that captures the WS URL — operator concern, not auth design.

## Consequences

**Positive:**
- One auth path for the editor session, covering both HTTP and WebSocket. The editor uses standard `new WebSocket(url)` with no browser-API workarounds.
- TLS protects the token in transit; the exposure surface is limited to operator-accessible logs and the editor's own address bar.
- The contract degrades gracefully on a stale token (drops to visitor role) rather than producing a hard reject the Owner has to recover from.

**Negative:**
- The 4-hour-TTL token appears in the editor tab's address bar (visible to over-shoulder observation) and in Worker / Cloudflare edge logs.
- A senior-review answer relying on "URLs never leave the TLS tunnel" is honest but not airtight — Referer headers and `window.opener` are the typical leak paths. Decision 2 names them; decision 4's follow-up audit pins them as smoke regressions.
- If WS-URL exposure becomes a real concern, the separate-WS-token path (decision 2's rejection) becomes the migration target — a non-trivial refactor of token-minting and editor reconnect logic.

## Follow-ups

- **Done (2026-06-01)** — audited the editor's outbound navigation paths. Every `window.open` in `src/editor/canvas-client.ts` uses `noopener,noreferrer` except the post-publish "view live site" button (line 11013, opens the Owner's own published site). That button's Referer would carry the editor page URL (`/?edit`), which does NOT contain `wsToken` — the token only ever exists in the WebSocket URL passed to `new WebSocket(...)` and never in `window.location`. No leak path; no smoke pinned.
- Document the WS-URL-in-logs exposure in the operator runbook so log-rotation cadence and access controls reflect the threat model. Reference this ADR from the runbook.
- If editor-session telemetry or a real incident shows `wsToken` values being read from logs by non-operators, mint a separate short-lived WS token via an HTTP endpoint (e.g. `POST /__api/wsToken` returning a 5-minute token bound to the editor session) and supersede this ADR. The current 4-hour TTL is fine until that signal arrives.
- Watch for a browser API proposal that allows custom WebSocket headers — at that moment, this ADR's decision 1 supersedes.
