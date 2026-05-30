# ADR 0036 — Per-page password gate scope, single site secret

**Status:** Rejected
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** Demo recording Session 11.B + Interlude 5 — Owner publishes v1 of a launched site while keeping a single `/preview` page password-gated. Names G10 in [`docs/demo/handoff-delta-resolution-2026-05-30.md`](../demo/handoff-delta-resolution-2026-05-30.md) §3.9 ("Per-page password gate scope"). The current site-wide gate at [`src/password/middleware.ts`](../../src/password/middleware.ts) cannot express this; the script fell back to "site-wide" (script-fix #13) because the product cannot.

## Rejection rationale (2026-05-30)

Rejected on 2026-05-30 alongside the product-gap implementation sweep. Site-wide password gating stays as the only mechanism — per-page scope does not ship.

**Why rejected:** the per-page use case is genuinely narrow. The Owner's pre-launch flow is better served by the existing draft / unpublish primitive (visitors can't reach a page that isn't in `publishedSnapshot`); the one beat in the script that wanted per-page (S11.B narrating `/preview` as a gated page on an otherwise-public site) is recordable as site-wide with a one-sentence voiceover adjustment. Adding a schema migration, new middleware shape, sitemap/search filter, and a per-page Owner UX for a use case that the draft flow already covers is the wrong cost/benefit trade.

If a future Owner cohort surfaces a real per-page gating need that the draft flow cannot serve — e.g. "publish a public landing PLUS a paywalled members-only page on the same site" — the right vehicle is the addon model from [ADR 0009](0009-addon-entitlement-model.md), not a schema reshape of the core password column. A successor ADR would propose per-page gating as a paid addon with its own data shape (per-page entitlements, per-page secrets if needed) rather than widening the existing single-secret site-wide column.

**What stays in place:**
- Site-wide `passwordEnabled` / `passwordSetAt` / `passwordHash` on `site` ([src/db/schema.ts:97-103](../../src/db/schema.ts)).
- Gate middleware at [src/password/middleware.ts](../../src/password/middleware.ts) reading `site.passwordEnabled`.
- HS256 unlock cookie scoped to `siteId` (per [ADR 0017](0017-cookie-name-prefix-from-env.md) naming + the existing JWT payload).
- 5/60s DO-backed rate limiter on failed attempts.
- Script S11.B + I5 record against the site-wide gate (already the live behaviour).

**What does not happen:**
- No new `passwordGated` column on `CanvasPage`.
- No drop of `site.passwordEnabled`.
- No reserved-route allowlist additions to the middleware (the existing site-wide check needs no per-page exceptions).
- No sitemap/search filter for per-page gating.
- No Owner UX changes to expose per-page toggles.

The decisions and consequences below describe the path this ADR would have taken if Accepted. They are preserved unchanged as the historical record of what was considered — see the repo's status-flow rule ("Rejected — explored, declined. The ADR stays in the repo as the record of why").

## Context

Site password protection is site-wide today. Two columns on `site` carry the state — `passwordEnabled boolean` and `passwordSetAt timestamp` — alongside the PBKDF2 hash in `passwordHash`, all at [`src/db/schema.ts`](../../src/db/schema.ts) lines 97–103. The gate middleware reads `site.passwordEnabled` and short-circuits when false; when true, every request to the published origin (other than `/__rev01/unlock` itself) is intercepted with the gate HTML until the visitor presents a valid HS256 unlock cookie. The cookie name is `${COOKIE_NAME_PREFIX}unlock_<siteId>` (per [ADR 0017](0017-cookie-name-prefix-from-env.md)) and its JWT payload binds to `siteId` + a `hashEpoch` derived from `site.passwordSetAt.getTime()`.

The demo wants something the schema cannot say: "publish v1 publicly, but keep `/preview` gated." Session 11.B in [`docs/demo/act-1-script.md`](../demo/act-1-script.md) line 404 calls the per-page scope out as the natural beat. Interlude 5 (line 427) records the visitor hitting `/preview` and unlocking. The handoff (`G10`) names the gap explicitly.

Sitemap construction at [`src/seo/sitemap/build.ts`](../../src/seo/sitemap/build.ts) already filters pages through `resolveNoIndex(page, snapshot)` — the same predicate the renderer's `<meta name="robots">` emit uses. There is currently no "exclude because gated" branch because, today, a gated site has zero crawlable pages anyway (the gate intercepts everything). Per-page scope forces the question.

Failed unlock attempts are rate-limited 5/60s per IP via the shared Durable Object at [`src/password/rate-limit.ts`](../../src/password/rate-limit.ts), namespaced by `(kind, ipKey)`. The unlock cookie's `hashEpoch` is the rotation marker — when the Owner changes the password, `passwordSetAt` advances and every issued cookie becomes invalid on its next request.

The decisions below resolve five tensions: schema shape, secret cardinality, migration of existing sites, sitemap/search exclusion of gated pages, and the unlock cookie + rate-limiter scope.

## Decisions

1. **The password-enabled flag moves to the page; the password hash + rotation marker stay on the site. The site row keeps `passwordHash text` and `passwordSetAt timestamptz`. The site row drops `passwordEnabled`. `CanvasPage` gains an optional boolean `passwordGated`. A page is gated iff `passwordGated === true` AND its site's `passwordHash` is non-null.**

   **Why:** the question "which pages are gated?" belongs to the canvas model — it is per-page Owner intent, edited alongside the page's title/slug/locale. The question "what is the password?" belongs to the site — it is one secret, set once, and rotated as a single act. Splitting the flag from the secret is the conceptual minimum: each lives where it is read. The alternative — one extra `passwordScope` column on `site` enumerating gated page ids — buries page-level state inside a column the page editor has to round-trip through `editableState` JSON anyway. Moving the flag to the page where the page editor already lives keeps the boundary clean. A page cannot be gated when the site has no hash — the conjunction is enforced at the middleware, not by a DB constraint, because the canvas snapshot is JSONB and per-row checks would not catch all the editable-state mutations.

2. **One site password, shared across every gated page on the site. There is exactly one `passwordHash` and one `passwordSetAt` per site row; there is no per-page secret.**

   **Why:** the Owner UX of N passwords for N pages is bad — the demo records Maya setting one password and sharing it with a small group of invitees. The script Session 11.B reads "Maya turns it on before launch so only invitees with the password can preview Briar" — singular password. Per-page secrets would split the rotation story (each page tracks its own `passwordSetAt`, each issued cookie binds to a page's rotation marker, password rotation becomes N rotations) for zero observed gain. The conceptual minimum: one secret per site, per-page enable. If a future use case ever needs distinct secrets (mixed Owner + Invitee tiers per page) we open a new ADR; the schema here does not preclude it because the per-page flag is already there.

3. **The unlock cookie stays site-scoped. One cookie name `cookieName.unlock(env, siteId)`, one JWT payload bound to `(siteId, hashEpoch, exp)`. A visitor who unlocks any one gated page on the site unlocks every gated page on that site.**

   **Why:** the secret is per-site (decision 2) — there is exactly one thing the visitor proves they know, so the cookie should carry exactly one statement: "the holder presented the correct site secret at issue time T." Adding a per-page-list claim to the cookie would carry no additional security (the visitor proved knowledge of the only secret in play), would inflate the JWT, and would force re-mint on every page-level enable/disable. The existing payload shape at [`src/password/cookie.ts`](../../src/password/cookie.ts) lines 46–55 (`siteId / iat / exp / hashEpoch`) survives intact. Cookie scope (`Path=/`, site-id-suffixed name) survives intact. `buildUnlockCookieHeader` and `verifyUnlockCookie` do not change. This is the single largest reason to land single-secret + per-page-enable over per-page-secret.

4. **The middleware's resolution flips from site-flag to per-page-flag, computed against the requested page. `requireUnlock` accepts the resolved `CanvasPage` (or `null` for snapshot-level routes like `/sitemap.xml`, `/robots.txt`, `/__rev01/unlock`) and returns the gate response when `passwordGated === true` AND the site has a hash AND no valid cookie is present. Reserved routes (`/__rev01/unlock`, `/sitemap.xml`, `/robots.txt`, OG-image fetches) bypass the gate unconditionally.**

   **Why:** the gate decision is now page-scoped, but the middleware is mounted in `src/routes/public.ts` before the snapshot-serve branch picks a page. Push the page-resolution step earlier so the middleware sees the resolved page; pass `null` for routes that do not resolve to a page so the middleware can pass them through without inventing a fake page. The reserved-route list grows from one entry (`/__rev01/unlock` per [`src/password/middleware.ts`](../../src/password/middleware.ts) line 50) to a small explicit set — sitemap, robots, and OG-image endpoints serve crawler/preview infrastructure that must not require an unlock cookie, otherwise a gated `/preview` page would emit unreachable OG-image URLs and the sitemap.xml for the public pages would itself be gated. The bypass list is a closed allowlist; everything else routes through page-flag resolution.

5. **Migration of existing sites: `passwordEnabled = true` on a site becomes `passwordGated = true` on every page in the site's `editableState` AND on every page in the most recent `publishedSnapshot`. `passwordEnabled = false` becomes a no-op. The `site.passwordEnabled` column is then dropped. The migration touches `editable_state` JSONB and `published_snapshot` JSONB in one transaction per site.**

   **Why:** the existing behaviour ("the whole site is gated") must continue to hold for every currently-protected site without the Owner re-toggling anything. Mapping site-wide to "every page gated" preserves the visitor experience exactly. The migration touches both `editableState` (where the Owner's next edit cycle reads from) AND `publishedSnapshot` (where the live site serves from) because diverging the two on migration would create a published site that disagrees with what the Owner sees in the editor — the kind of silent state drift the no-fallback rule explicitly rejects. One transaction per site keeps the rollback story simple: if the transaction aborts, no half-migrated row. Sites with `passwordEnabled = false` carry no flag in the page model — there is nothing to migrate — and dropping the column for them is also a no-op. Mapping is loud: the migration logs a per-site summary `[migration 0036] site=<id> migrated <N> pages to passwordGated=true` so an operator running the migration can verify the count.

6. **Sitemap and search index exclude gated pages. `buildSitemapXml` at [`src/seo/sitemap/build.ts`](../../src/seo/sitemap/build.ts) gains a `passwordGated`-aware filter alongside the existing `resolveNoIndex` filter. The search indexer at [`src/search/indexer.ts`](../../src/search/indexer.ts) excludes gated pages on the same predicate.**

   **Why:** a gated page should not appear in the sitemap (a crawler reaching the URL is met by the 401 gate, fragmenting the site's crawl budget across uncrawlable URLs) and should not appear in on-site search results (the visitor would see a result snippet for content they cannot read without the password — a content-leak in the search excerpt). The exclusion lives next to `resolveNoIndex` rather than as a separate predicate because both answer the same question — "is this page publicly crawlable?" — and the two should never disagree. We do NOT extend `resolveNoIndex` itself to mean "noindex OR passwordGated"; the renderer's `<meta name="robots">` decision is about the indexability annotation on the rendered page, which is a different question from "should this URL appear in the sitemap." A gated page that an authenticated visitor unlocks should still render whatever robots meta the page declares. The two paths diverge cleanly: rendered meta = `resolveNoIndex`; sitemap entry = `resolveNoIndex || passwordGated`; search index = same.

7. **The rate limiter stays at site scope, namespaced `(kind: 'password-unlock', ipKey: <CF-IP>)`. The 5/60s budget is per IP per site (via the implicit site-id binding in the unlock route's URL handling), unchanged from today. A visitor failing on `/preview` and then trying again on a hypothetical second gated page consumes the same budget — there is one site secret, so attempts against it are one budget.**

   **Why:** the rate limit protects the secret. The secret is per-site (decision 2). The budget therefore is per-site-secret-per-IP. Adding a page dimension would let an attacker burn through 5 attempts on `/preview` and another 5 on `/draft-2` against the same secret, doubling the effective attack budget per IP. The conceptual minimum is "one limit per thing being guessed at"; the thing being guessed at is the site secret. No code change in `src/password/rate-limit.ts` is needed; the existing `(kind, ipKey)` namespacing already produces the correct partitioning because the unlock route lives at one path per site.

## Out of scope

- **Per-page secrets.** Decision 2 closes the door on N passwords per site. A future ADR could add a `pagePasswordHash` column to the page model alongside `passwordGated` if a mixed-tier use case appears; this ADR does not block that path but does not enable it either.
- **Per-collaborator gates.** "Maya invites Lin as an editor; Lin sees `/preview` without typing a password" is a different feature — Owner/collaborator auth, not visitor password gate. The unlock cookie remains the visitor mechanism.
- **Time-bounded preview links.** "Share a tokenized URL that grants 24h access without a password" is a separate share mechanism. The gate stays password-based.
- **The gate HTML's affordances.** Session 11.B records the existing gate page; this ADR does not change the gate's visual surface or its no-JS-required posture.
- **`noIndex` semantics on gated pages.** Renderer-emitted `<meta name="robots">` continues to be driven by `noIndex` (per-page) and `siteNoIndex` (site-wide). Whether the gated page also wants a `noindex` meta when rendered for an unlocked visitor is the Owner's call, separate from gating.

## Consequences

**Positive:**
- Session 11.B and Interlude 5 record as written: Maya gates `/preview`, publishes v1 publicly, shares the live URL, the password gate fires only on `/preview`.
- One site secret = one rotation event. The existing `hashEpoch` cookie-invalidation mechanism keeps working unchanged.
- The unlock cookie does not grow a page-list claim — JWT stays compact, cookie stays site-scoped, no new attack surface on the cookie payload.
- Sitemap and search agree on the "is this URL public?" predicate. Gated pages disappear from both.
- The migration is mechanical (a single map over each site's pages) and the existing all-or-nothing site-wide gate maps to "every page gated" exactly.
- The rate limiter does not change — the bug-prone shared DO contract stays out of this change set.

**Negative:**
- A migration touches every existing site's `editableState` AND `publishedSnapshot`. Sites with many pages take longer to migrate; sites with deeply nested JSON take more transaction time. The migration is one transaction per site to bound the lock window.
- The middleware contract changes: it now needs the resolved page (or `null` for snapshot routes). Every caller of `requireUnlock` has to either resolve the page first or pass `null` — `src/routes/public.ts` is the only caller today, but new visitor surfaces have to thread the page through too.
- "Site has a hash but every page has `passwordGated = false`" is a valid but pointless state. The Owner UI must either show "no pages currently gated" (informational) or refuse to keep the hash around. This ADR picks the former; deleting the hash on the Owner's behalf would be a silent destructive action.
- Owners who interpret "site password" as "the whole site is gated" face a small mental model shift. The site-settings UI surface (the Password card under `#password`) must show "Gated pages: <list>" to keep the model legible.

## Follow-ups

- DB migration: drop `site.password_enabled`; add `CanvasPage.passwordGated?: boolean` to the canvas schema; migrate existing-site `editable_state` + `published_snapshot` JSONB rows per decision 5.
- Update `requireUnlock` signature in [`src/password/middleware.ts`](../../src/password/middleware.ts) to accept the resolved `CanvasPage | null`. Push page resolution earlier in `src/routes/public.ts`. Add the reserved-route allowlist (sitemap, robots, OG-image, unlock).
- Update [`src/seo/sitemap/build.ts`](../../src/seo/sitemap/build.ts) to filter out `passwordGated` pages alongside the existing `resolveNoIndex` filter. Mirror in [`src/search/indexer.ts`](../../src/search/indexer.ts).
- Update the dashboard Password card (under `#password` per Session 11.A.1 / 11.B.1) to expose a per-page enable toggle in the page editor and surface "Gated pages: <list>" on the site settings card. The single password input on the settings card continues to set the site-level secret.
- Smoke: a published-site request to a gated page returns 401 with the gate; a request to a non-gated page on the same site returns 200; the sitemap.xml lists only the non-gated pages; the unlock cookie issued on the gated page also unlocks any other gated page on the same site.
- Add page-level `passwordGated` to the canvas validator so an invalid value (e.g. string `"true"`) is rejected at write time — keeps the [ADR 0012](0012-validation-write-gate.md) write-gate contract intact.
