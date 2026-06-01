# ADR 0026 — Defer Clerk networkless JWT verification; accept the JWKS fetch per isolate

**Status:** Accepted
**Date:** 2026-05-29 (proposed); 2026-06-01 (accepted)
**Author:** Aayushman Singh
**Drives:** lifts the deferred-JWT-verification decision from `src/auth/SUBSYSTEM.md` (Notes section) into canon. Per the 2026-05-29 SUBSYSTEM audit, this is an explicit architectural posture ("accept the cost at this stage") that belongs in an ADR rather than a prose note.
**Accepted-context:** verified 2026-06-01 — `CLERK_JWT_KEY` is absent from `src/`, `wrangler.toml`, and `.dev.vars.example`; the auth path uses the Clerk SDK default JWKS-fetch flow. `src/auth/SUBSYSTEM.md` was deleted in an earlier pass; the rationale now lives only here.

## Context

Clerk's `@clerk/backend` SDK supports two paths for verifying session JWTs:

- **Networkless verification.** The operator sets `CLERK_JWT_KEY` (a PEM-encoded public key derived from Clerk's signing key). The SDK verifies tokens locally with no network call. Fastest possible auth path: every request resolves identity from CPU only.
- **JWKS fetch (default).** The SDK fetches the Clerk app's JWKS once per isolate, caches it, and verifies subsequent tokens against the cached keys. The first request in a fresh isolate pays a one-time network round trip to Clerk's JWKS endpoint; every subsequent request in the same isolate is cache-hit.

Cloudflare Workers spin up many isolates (per region, per cold-start, per scale-up event). The JWKS fetch is therefore not a "once per deploy" cost but a "once per isolate" cost — somewhere between dozens and thousands of times per day depending on traffic shape and region distribution.

The codebase today uses the JWKS-fetch path. `CLERK_JWT_KEY` is not set. The networkless path is documented as a future optimisation but is not enabled. A prose comment in `src/auth/SUBSYSTEM.md` (Notes section) records the rationale: the env-var-to-PEM round trip has not been verified end-to-end, and the JWKS fetch is a cache-friendly cost the team accepts at this product stage.

That rationale is a real decision (accept ongoing fetch cost to avoid the verification setup overhead), not a runbook detail. Lifting it into canon prevents the prose note from rotting and prevents a future contributor from quietly enabling `CLERK_JWT_KEY` without verifying the round trip.

## Decisions

1. **The auth subsystem uses Clerk's default JWKS-fetch verification path. `CLERK_JWT_KEY` is intentionally not set.** Every fresh isolate pays one network round trip to Clerk's JWKS endpoint on first auth; subsequent auth in the same isolate is cache-hit.

   **Why:** at the current product stage, the operational complexity of the networkless path (deriving the PEM, distributing it via secrets, verifying that `@clerk/backend` accepts the format exactly, monitoring for Clerk key rotations that would invalidate a cached PEM) is not justified by the per-isolate latency savings. The JWKS fetch is a cache-friendly cost: most isolates handle many requests before being recycled; the amortised per-request cost is low. The networkless path is a real optimisation, but a premature one given current traffic and the unverified setup story.

   This would be wrong if rev01's traffic shape shifted such that cold-isolate auth latency became user-visible — for example, if a region with bursty traffic produced a sustained "every other request is a fresh isolate" pattern. At that point, the per-isolate JWKS fetch becomes a noticeable wall-clock cost, and a superseding ADR enables `CLERK_JWT_KEY` after verifying the round trip.

2. **`CLERK_JWT_KEY` is not added to `wrangler.toml`'s documented-secrets block, to `.dev.vars.example`, or to the operator secret-set instructions.** A future contributor enabling it must amend the documentation explicitly as part of the change.

   **Why:** documenting a secret the codebase does not use signals "set this to enable a feature" without naming the validation work required (verifying the SDK accepts the PEM, choosing a rotation story, deciding what happens when the cached PEM disagrees with Clerk's current signing key). Leaving the variable undocumented forces any enabling change to land alongside the validation work in one ADR-amendable unit.

## Out of scope

- Clerk's other config (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, the test-key pair) — required by every auth path and not part of this decision.
- The Clerk Account Portal hosted sign-in flow — owned by the auth subsystem broadly, not by this ADR.
- The `.dev.vars` Wrangler mirror requirement — a runbook detail; lives in the README's local-dev section, not in canon.
- Networkless JWT verification for any non-Clerk identity provider — the codebase has one identity provider; if a second appears, its verification story is its own ADR.
- Performance optimisations elsewhere in the auth path (caching the resolved user record per request, deduplicating concurrent JWKS fetches inside a single isolate) — orthogonal to the verify-mechanism choice.

## Consequences

**Positive:**
- The auth subsystem has one verification path, well-supported by Clerk's SDK defaults. No format-mismatch debugging when Clerk rotates keys or changes JWKS publication format.
- The decision to keep things simple is now canonical. A future contributor enabling the networkless path must verify the setup explicitly and write a superseding ADR; they cannot quietly flip a flag and hope.
- Operational footprint stays small: one less secret to manage, one less rotation event to handle, one less failure mode to monitor.

**Negative:**
- Every fresh Worker isolate pays a one-time JWKS round trip on first auth. At low traffic this is invisible; at high traffic with many isolates this adds aggregate request-time to the auth surface.
- A Clerk JWKS endpoint outage would prevent fresh isolates from completing first-auth (cache-hits in warm isolates continue working). The networkless path would dodge this. The decision accepts the dependency on Clerk's JWKS availability as the price of operational simplicity.
- The optimisation is named here but not enabled. A future contributor reading the ADR sees the trade-off; if they have data showing the trade-off no longer holds, the superseding-ADR path is the way to enable.

## Follow-ups

- Delete the relevant Notes section from `src/auth/SUBSYSTEM.md` (its content is now in this ADR) and delete the rest of the file as recommended by the 2026-05-29 SUBSYSTEM audit (the file's remaining content is a paraphrase of the auth route handler).
- If traffic patterns shift such that cold-isolate auth latency becomes a user-reported issue, run a one-week measurement (JWKS fetch p50/p95/p99 per isolate, distribution of isolate request count before recycle) and write a superseding ADR with the data attached.
- If Clerk announces deprecation of JWKS fetch or a change in the JWKS endpoint shape that affects the SDK, that is a forcing function — the superseding ADR enabling `CLERK_JWT_KEY` becomes the migration path.
