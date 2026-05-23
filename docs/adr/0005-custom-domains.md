# ADR 0005 — Custom domains via Cloudflare for SaaS Custom Hostnames

**Status:** Accepted
**Date:** 2026-05-23
**Author:** Aayushman Singh

## Context

The user-perceived feature is: an Owner pastes their own hostname — `www.acme.com`, `coffee.example.org` — into the dashboard, follows a short DNS instruction, and within roughly a minute sees their Published Site live at that hostname with a valid TLS certificate, behaving identically to a Visitor opening any other Published Address.

ADR 0002 chose owner-subdomain (`*.rev01.aayushman.dev`) as the first Published Address adapter and explicitly punted custom-domain support. The wishlist for the gamma-parity POC re-opens that decision because "real-feeling" published sites in the SaaS product comparison all use Owner-owned hostnames. The product brief now requires the Published Address concept to admit a second adapter: an Owner-owned arbitrary hostname.

Three mechanisms exist on Cloudflare for delivering arbitrary hostnames to a Worker:

1. **Cloudflare for SaaS — Custom Hostnames API.** Designed for multi-tenant scenarios. Owner adds a CNAME to a SaaS hostname under our zone; we register the hostname through the Custom Hostnames API; Cloudflare verifies ownership, issues and renews a TLS certificate, and routes traffic for that Host header to our Worker. Per-cert nominal cost beyond a free tier.
2. **Workers Routes per zone.** Each Owner adds their domain to their own Cloudflare account and points a Workers Route at our deployed Worker. Functional but requires every Owner to have a CF account and configure a Route by hand. Does not scale.
3. **Off-Cloudflare termination with custom ACME automation.** Run our own TLS terminator, manage certificates via ACME, route to the Worker by Host. Requires moving traffic off Cloudflare's edge for the inbound TLS handshake. Defeats the runtime story.

The mechanism choice is hard to reverse: once Owners have registered custom hostnames against a chosen mechanism, the registry, certificate state, and DNS instructions become a contract with those Owners.

## Decisions

1. **Custom-hostname support is added as a second Published Address adapter alongside owner-subdomain.**

   **Why:** the lived outcome — an Owner sees their site at a domain they own — is unattainable with subdomain-only Published Addresses. Adding custom hostnames as an adapter, rather than replacing the subdomain adapter, preserves the simpler onboarding for Owners who do not own a domain and matches the Published Address concept articulated in ADR 0002 (the concept is the public location, with subdomain and custom hostname as two shapes of the same concept).

2. **The mechanism is the Cloudflare for SaaS Custom Hostnames API. Workers Routes per zone and own-ACME termination are explicitly rejected.**

   **Why:** the Custom Hostnames API is the only mechanism on Cloudflare designed for multi-tenant Owner-supplied hostnames. It removes the failure path where an Owner would otherwise have to own a Cloudflare account and configure routing per domain. The trade — small per-certificate fees beyond the free tier, and a dependency on the Cloudflare API surface for cert issuance and renewal — is paid for by the elimination of an entire class of operational concerns (cert renewal, ACME challenge plumbing, OCSP, KMS for private keys). Workers Routes per zone is rejected because it imposes a setup burden on the Owner that the lived outcome refuses; off-Cloudflare termination is rejected because it would move inbound traffic off the edge that runs every other piece of the system.

3. **Each custom hostname binds to exactly one Editable Site and serves exactly one Published Snapshot at a time.**

   **Why:** the Owner's mental model of "this domain is my site" admits no ambiguity. The public host router resolves `Host` header to a `customDomain` row, which resolves to a `site` row, which serves the current `publishedSnapshot`. Allowing one hostname to fan out across multiple sites would re-introduce the path-routing ambiguity that ADR 0002 explicitly rejected.

4. **Hostname registration is asynchronous and surfaces lifecycle state to the Owner.**

   **Why:** Cloudflare hostname verification and certificate issuance are not instantaneous. The Owner experience is degraded silently if the dashboard pretends the hostname is ready before Cloudflare confirms it. Explicit status — `pending → verifying → active`, or `failed` with a named reason — is what makes the wait felt as a real workflow rather than as a broken feature. A `failed` status that does not auto-retry is part of this decision: silent retry would mask Owner-DNS errors.

## Out of scope

This ADR does not decide:

- Apex-domain support requiring CNAME flattening at the Owner's DNS provider. CNAME-only support is sufficient for the POC.
- The dashboard UI shape for adding, listing, or removing custom hostnames.
- The polling cadence for verifying hostname status (cron vs. lazy-on-read) — both are compatible with the decision and chosen at implementation time.
- Pricing or quota policy: how many custom hostnames a single Owner may register.
- Owner-facing certificate transparency / disclosure beyond "the hostname is active and the cert was issued at X."
- Hostname transfer between sites once active (the POC treats hostname as bound permanently to the site that registered it).

## Consequences

**Positive:**

- The Published Address concept gains a second adapter without changing its conceptual definition.
- TLS certificate lifecycle, including renewal, is handled by Cloudflare. No own-ACME code.
- The public host router has exactly two arms: subdomain (existing) and custom hostname (new). Both terminate at the same `siteId → publishedSnapshot` resolution.
- The system can be demoed end-to-end on an Owner's real domain in ~60 seconds, which is the lived outcome the wishlist requires.

**Negative:**

- New dependency on the Cloudflare API surface. `CF_API_TOKEN` and `CF_ZONE_ID` become environment-level secrets the Worker must hold. Loss of API access blocks new hostname registrations until restored.
- Per-certificate fees beyond the free tier are a real-money cost that scales with Owner count.
- DNS misconfiguration on the Owner's side is now a visible failure mode the dashboard has to surface and explain. The system must own that explanation rather than handing back a raw Cloudflare error.
- A `customDomain` row that points at a deleted site is a data shape the public router has to refuse loudly.

## Follow-ups

- Plan: `docs/superpowers/plans/2026-05-23-05-custom-domains.md` — implementation specification, route shapes, smoke tests, and dashboard UI surface.
- Future ADR if and when apex-domain support is required (DNS provider integration to enable CNAME flattening or ALIAS records).
- Future ADR if quota or billing policies become real.
