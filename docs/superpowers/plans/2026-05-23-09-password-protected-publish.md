# Password-protected publish

**Wishlist #:** 9 **Tier:** A **Wave:** 2 **Status:** queued
**Depends on:** Phase 0 ✓
**Blocks:** none

## User-visible outcome

An Owner toggles "Require password" for a site and sets a password. Visitors hitting the Published Address see a minimal password gate. After correct entry, the Visitor sees the site for the remainder of the session via a signed cookie. Wrong password = retry. The protected status applies to the whole Published Site (all pages).

## Scope in

- `site.passwordHash`, `site.passwordSetAt`, `site.passwordEnabled` fields (Phase 0 may have skipped; add here if not in Phase 0 scaffold — coordinate with main thread).
- Owner UI: toggle + set/change password + clear-and-disable. Password input never echoed; only hash stored (bcrypt-ish via `crypto.subtle` PBKDF2 with site-scoped salt).
- Public host middleware: when `site.passwordEnabled`, intercept all requests, serve gate HTML or check signed cookie.
- Cookie: `__rev01_unlock_<siteId>=<jwt>`, signed with `env.UNLOCK_SIGNING_SECRET`, scoped to host, `HttpOnly; Secure; SameSite=Lax`, 7-day expiry.
- Gate page: minimal HTML (no JS framework), form posts to `/__rev01/unlock` on the published host, sets cookie on success, redirects back.
- Failed-attempt rate limit per IP (5/min via DO counter, shared with form rate limiter if cheap).

## Scope out

- Per-page password (whole-site only for POC).
- Owner-managed visitor identity (named visitors). Just a shared password.
- Forgot-password flow (Owner just resets).

## Schema delta

Coordinate with Phase 0 — `site` table additions:

```ts
passwordEnabled: boolean('password_enabled').notNull().default(false),
passwordHash: text('password_hash'),
passwordSetAt: timestamp('password_set_at', { withTimezone: true }),
```

If Phase 0 didn't include this, add via a small migration in this feature's worktree (one of the few exceptions — flag to main thread before dispatch).

## Files owned (write)

- `src/password/hash.ts` — PBKDF2 hash + verify.
- `src/password/cookie.ts` — sign + verify cookie JWT.
- `src/password/gate.ts` — gate HTML renderer.
- `src/password/middleware.ts` — public-host middleware checking enabled flag.
- `src/password/unlock-route.ts` — `POST /__rev01/unlock` handler.
- `src/password/admin-route.ts` — `PUT /api/sites/:id/password` (Owner sets / clears).
- `src/password/smoke.ts`.
- `src/routes/public.ts` — single line: middleware mounted before snapshot serve. Phase 0 slot.
- `src/routes/dashboard/site-settings.tsx` (or extend existing) — toggle UI.
- `package.json` — `password:smoke` stub.

## Files read-only (must not modify)

- `src/canvas/schema.ts`, `src/canvas/render.ts`, `src/db/schema.ts` (except the small site-table additions above if Phase 0 missed them).

## Contract with neighbors

- Middleware exports `requireUnlock(c): Response | null`. Returns response (gate or 401) or null to continue.
- Unlock route emits cookie with JWT payload `{ siteId, iat, exp }` signed HS256.

## Smoke test

- `bun run password:smoke`:
  - Owner enables password; asserts hash stored, raw never persisted.
  - Visitor request without cookie returns gate HTML 200.
  - Correct password sets cookie, redirect to `/`, subsequent request returns snapshot.
  - Wrong password 5x triggers rate limit 429.
  - Owner disables password; previously-issued cookie still valid (acceptable for POC).

## Acceptance criteria

- Site with password enabled is fully gated end-to-end across all pages.
- Cookie persists across page reloads.
- Disable + re-enable restores access flow correctly.
- All smokes green.

## Open questions

- Cookie invalidation on password change. Recommend: include `passwordSetAt` in JWT payload; middleware rejects if older than current `passwordSetAt`. Documents in subsystem.
