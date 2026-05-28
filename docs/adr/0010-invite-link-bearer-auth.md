# ADR 0010 — Collaboration invite link is a bearer credential

**Status:** Accepted
**Date:** 2026-05-28
**Author:** Aayushman Singh

## Context

A Site Owner can invite a Collaborator by email address. The product flow the Owner expects is: type an email, hit invite, the Collaborator gets an email with a link, the Collaborator clicks it, and immediately lands on the site in edit mode. The Collaborator does not have a rev01 account before being invited, and most never will — they treat rev01 as an email-driven editor for somebody else's site.

The implementation today honours that experience by treating the invitation email's link as the credential. `verifyInviteToken` is the only gate at the accept endpoint; there is no Clerk sign-in step interposed between the email click and the edit cookie.

The signed `InviteTokenPayload` carries `siteId`, `collaboratorId`, and `invitedEmail`. The `invitedEmail` field is *not* checked against a logged-in Clerk identity at accept time (no such identity is required), and the database UPDATE matches it against the row that was written from the same payload at invite-issue time, so the field is a tautology in the current acceptance path. This ADR ratifies that as a deliberate design choice and lists the surface area it implies.

## Decisions

1. **The signed invite token is the only credential required to accept an invitation.**

   **Why:** the Collaborator's identity, as far as the product cares, is "someone who can read the invited email inbox." Requiring a separate Clerk sign-up before the seat can be claimed turns a one-click experience into a multi-step funnel and creates a parallel identity (the Clerk user) that adds nothing to the trust decision the Owner already made when they sent the invite. The token's TTL bounds the bearer window; signature + expiration are the trust contract. This would be wrong if Collaborators routinely transitioned into Owners with their own paid accounts (then linking the Clerk identity at accept time would be load-bearing), but that is not the current product shape.

2. **`invitedEmail` in the JWT payload is retained as audit metadata, not enforcement.**

   **Why:** the field is signed alongside the rest of the payload, so it captures the address the link was sent to in a tamper-evident way. That is useful for the Owner's audit view ("this seat was sent to alice@example.com") and for any future tightening of the model (decision 4). The DB-side WHERE-clause match against `siteCollaborator.invitedEmail` is therefore belt-and-suspenders — it does not change who can accept, but it does prevent a token from claiming a row that was rewritten under a different invitee (a state the codebase does not produce today but might if invite re-targeting is added). Removing the field would erase the audit signal; enforcing it without an authenticated identity to compare against would be theatre. Keeping it as signed audit data is the only honest position.

3. **The accept endpoint mints an edit-token cookie scoped to the invited Collaborator's customer record, regardless of any concurrent Clerk session in the browser.**

   **Why:** an Owner who is signed in as themselves can legitimately click their own copy of an invitation link to preview a seat; an unauthenticated browser can also claim the seat. The accept handler treats both the same — it does not consult `c.get('user')`. The cookie carries the *invited* customer's `clerkUserId` so downstream `editTokenAuth` resolves the same ownership context for the editor regardless of who clicked. Mixing the accepting party's Clerk identity into the edit-token payload would either lock seat-acceptance to that Clerk user (breaking decision 1) or create an ambiguous payload in which two identities disagree.

4. **A future "require sign-in before accept" mode is a separate ADR, not a flag.**

   **Why:** flag-gated security models tend to drift — every code path has to remember to check the flag. If the product moves toward Collaborator-as-real-account, the move should be a single discrete decision that flips the contract: accept requires Clerk identity, `invitedEmail` is enforced against `clerkUser.primaryEmail`, the edit cookie is bound to the accepting identity. That is a different system, not a configurable variant of this one.

## Out of scope

- Magic-link sign-in for Collaborators (a different shape of bearer auth, not an extension of this one).
- Invite revocation after acceptance (already supported via `siteCollaborator` row deletion; not part of this ADR's contract).
- Rate limiting on the accept endpoint.
- Detection of email forwarding (out-of-band; no signal in HTTP).
- Multi-seat / pooled invitation links.

## Consequences

**Positive:**

- One-click acceptance from any inbox, including ones that aren't signed in to rev01.
- No identity reconciliation step between "invited address" and "Clerk account" — Collaborators never have to know rev01's auth model.
- The accept handler stays Clerk-independent, which keeps custom-domain accept flows (where the Clerk session cookie isn't present) trivially working.

**Negative:**

- Email forwarding, mailbox compromise, or link-prefetcher races are sufficient to claim a seat within the 7-day TTL window. The trust boundary is the invited inbox, not the rev01 platform.
- The `invitedEmail` field is signed but does no enforcement work today; a future contributor reading the code may infer enforcement and depend on it. The accept handler should carry a one-line comment to the effect of "this field is audit, not auth — see ADR-0010" if it does not already.
- `verifyInviteToken` and the accept handler share a single point of failure: a leaked `UNLOCK_SIGNING_SECRET` lets an attacker mint accept tokens for any `(siteId, collaboratorId)` pair without an outbound email. Operational rotation of the secret is the only mitigation; this is the same exposure the edit-token model has and is acknowledged here for completeness.

## Follow-ups

- Add a comment on the `invitedEmail` field in `InviteTokenPayload` and on the WHERE-clause match in `handleAcceptInvite` citing ADR-0010, so future readers don't mistake the field for an enforcement gate.
- Add a smoke that pins the current contract: a fresh browser (no Clerk cookies, no session) can accept an invite and receive an `__rev01_edit` cookie scoped to the invited Collaborator's customer. If this smoke ever starts failing it should be a deliberate ADR-supersession event, not a quiet fix.
- Track whether a follow-up product decision needs Collaborator-as-real-account; if so, write the superseding ADR explicitly rather than letting the model drift route by route.
