# auth

## Definition

Identity gate for the product. Decides, per request, whether the caller is a known human and — when so — pins their identity to the request context so downstream subsystems can speak about "who". Routes that demand a signed-in caller delegate the redirect-to-hosted-sign-in decision here; routes that tolerate anonymous callers see a null identity and choose for themselves. No sign-in UI is rendered in-process; the hosted Account Portal owns the credential-collection surface.

## Inputs

- **incoming request** -> session token via cookie or bearer header
- **environment** -> publishable + secret keys identifying the Clerk instance to verify against; the instance's hosted Account Portal origin is derived from the publishable key
- **authorized origins** -> the canonical hosts allowed to mint sessions for this product

## Outputs

- **route handlers** -> resolved identity bound to the request context: a user id, a session id, a token-minting closure, and the fully-resolved user record (or all-null for anonymous callers)
- **unauthenticated callers of protected routes** -> redirect to the hosted sign-in URL with a return path back to the requested resource

## Notes

- Networkless JWT verification via `CLERK_JWT_KEY` is deferred. The current implementation lets `@clerk/backend` perform its default JWKS network fetch — a per-isolate, cache-friendly cost we accept at this stage. Re-enable once the env-var-to-PEM round-trip is verified.
- `.dev.vars` is required for `bun run dev` (Wrangler does not auto-load `.env`). Mirror `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `DATABASE_URL` from `.env` into a local-only `.dev.vars` (already gitignored) before booting the dev worker.
- For production, the same keys are installed via `wrangler secret put <KEY>` — a follow-up step the operator runs by hand.
