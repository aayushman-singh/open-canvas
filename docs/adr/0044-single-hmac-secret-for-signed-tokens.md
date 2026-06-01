# ADR 0044 — Single HMAC secret signs invite, edit, and unlock tokens

**Status:** Accepted
**Date:** 2026-06-01
**Author:** Aayushman Singh
**Drives:** the 2026-06-01 second-opinion audit pass named `UNLOCK_SIGNING_SECRET`'s reuse across three trust domains as a senior-grade architectural concern. This ADR ratifies the reuse as a deliberate trade rather than letting it stay as undocumented operational drift.

## Context

The Worker holds one HMAC-SHA256 signing secret, `UNLOCK_SIGNING_SECRET`, and uses it to sign three distinct classes of signed token:

- **Visitor unlock cookies.** Issued by `/__rev01/unlock` POST when a visitor presents the correct site password. Signed and verified in `src/password/cookie.ts:73,116`. Bearer authority: "the holder unlocked site X at time T."
- **Editor session tokens.** Issued at the end of the Clerk sign-in flow on `/?edit` and on invite acceptance. Signed and verified in `src/auth/edit-token.ts:36,48`. Bearer authority: "the holder is an editor of site X as customer Y until time T."
- **Collaborator invite tokens.** Issued when an Owner adds a collaborator email. Signed in `src/routes/api/collaborators.ts:76`. Bearer authority: "the holder may claim seat (siteId, collaboratorId, invitedEmail) within 7 days."

The same Worker secret signs and verifies all three. A leak of `UNLOCK_SIGNING_SECRET` allows an attacker to mint:

- valid unlock cookies for every password-gated site,
- valid edit-token cookies impersonating any owner or collaborator on any site,
- valid accept-invite tokens for any `(siteId, collaboratorId)` pair without sending an email.

The alternative — three separate Worker secrets — gives blast-radius isolation: a leak of one does not enable the others.

This ADR lifts the trade-off into canon rather than leaving it implicit in `wrangler.toml`.

## Decisions

1. **One HMAC signing secret (`UNLOCK_SIGNING_SECRET`) signs every signed-token class. Distinct per-class secrets are not used.**

   **Why:** the operational footprint of three distinct signing secrets is real — each needs a name, a rotation cadence, a runbook, and a developer mental model of which token uses which key. The blast-radius benefit of separation only materialises in the narrow case where exactly one secret leaks; in practice the three secrets share the same threat surface (Worker environment, the Wrangler dashboard, the deploy CLI, the operator's local shell) and a single compromise of that surface compromises all three regardless of how the secrets are split. The trade in the current product's threat model favours one rotation event over three.

   This would be wrong if one token class became a higher-value target than the others — for example, if visitor unlock links were widely shared on social media and routinely scraped, increasing the per-class leak probability — to the point where rotating only that class would be a real operational win over rotating all three.

2. **Rotation rotates everything together. There is no partial rotation; there is no per-class key versioning.**

   **Why:** with one secret, a rotation event invalidates every issued token in every class. Invite links sent yesterday become invalid; edit-token cookies in flight become invalid; visitor unlock cookies require re-entry of the site password. That is the contract. Splitting into three secrets to enable per-class rotation would buy "we can rotate the leaked class without disrupting the other two" — a feature this product does not need because rotation is rare and the disruption is short. The conceptual minimum: one secret, one rotation event.

   This would be wrong if rotation became frequent enough that kicking every editor and every gated visitor out at once became a real Owner-perceived disruption. At today's rate (zero rotations in the product's lifetime), the disruption cost is hypothetical.

3. **There is no documented rotation runbook today. Writing one is a follow-up, not a precondition for this ADR's acceptance.**

   **Why:** rotation runbooks decay if the rotation event is hypothetical. A real cause for rotation (suspected leak, compliance audit, secret-management policy change) is what should drive the runbook's first revision — at that point the runbook is exercised against the live system and any drift between document and reality is caught. Documenting the steps in advance, before any rotation has been performed, creates a document that goes stale before its first use.

   This would be wrong if a compliance regime (SOC 2, ISO 27001) audited for a documented rotation runbook regardless of actual usage. The product is pre-compliance at the moment this ADR is written.

4. **Per-class secret derivation via HKDF over the single root secret is rejected.**

   **Why:** HKDF-derived per-class subkeys would give partial blast-radius isolation (a leaked subkey only compromises its class) while keeping one root secret to rotate. The cost is real: a new key-derivation step at every sign and verify, an HKDF context string per class that must be agreed across all sign/verify pairs, and a test surface to confirm the derivations are stable. The benefit — protection against leaks of derived keys — does not materialise because the only leak path that matters is the root secret (since every subkey is recomputed from it on every Worker startup). HKDF here would be cryptographic theatre.

   This would be wrong if a class's verify path could be exposed without exposing the root — for example, if verification moved to an edge worker holding only the subkey while signing stayed on the origin. The current deployment topology has one Worker holding everything.

## Out of scope

- The cookie-name prefix decisions ([ADR 0017](0017-cookie-name-prefix-from-env.md)) — orthogonal naming concern.
- Clerk's signing secrets ([ADR 0026](0026-defer-clerk-networkless-jwt.md)) — Clerk owns those keys; we do not sign with them.
- The 4-hour edit-token TTL itself — owned by `src/auth/edit-token.ts`; not part of this ADR.
- The 7-day invite-token TTL — owned by [ADR 0010](0010-invite-link-bearer-auth.md) decision 1.
- Multi-region Worker deployments where the secret might exist in more than one CF account — the product runs in one account.

## Consequences

**Positive:**
- One secret to set, one to rotate, one to monitor. The Wrangler secrets surface stays small.
- No cross-class confusion bugs: every signed token verifies against the same key, so a "verify with the wrong secret" failure mode does not exist.
- Operators reading `wrangler secret list` see one name and one purpose statement.

**Negative:**
- A leak of `UNLOCK_SIGNING_SECRET` compromises every signed-token class. Visitor unlock cookies, editor sessions, and pending invites are all spendable until rotation.
- Rotation is a heavy event: invalidates every active edit-token cookie (forces every editor to re-authenticate) and every pending invite link (forces every uncollected invitation to be re-sent).
- The senior-review answer — "we have one secret because three would be operationally more complex" — is honest but uncomfortable. The right complement is the rotation runbook follow-up below.

## Follow-ups

- Write a rotation runbook the next time a real rotation is triggered. Capture the steps in the operator runbook; reference back from this ADR.
- If the product moves toward partial-class rotation as a real need (audit signal, compliance scope, observed leak), supersede with an HKDF-derived per-class secret scheme. Re-evaluate the cryptographic-theatre concern at that point.
- Add an inline reference to this ADR in `wrangler.toml`'s comment above `UNLOCK_SIGNING_SECRET` so a future operator reading the secrets list sees the contract without grepping.
