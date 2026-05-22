# ADR 0002 — Published address routing

**Status:** Accepted
**Date:** 2026-05-22
**Author:** Aayushman Singh
**Supersedes:** ADR 0001 decision 8

## Context

The POC is done when an owner publishes a site to a real public address under the owner's domain and visitors already viewing that address see the published change immediately. ADR 0001 chose path-routed customer sites under `/s/:siteId/*` to avoid custom-domain work, but that no longer matches the demo outcome: the site must feel like a real site, not an app preview route.

## Decisions

1. **Published address is the product concept.**

   **Why:** the owner cares that the site has a real public location; subdomains, paths, and custom domains are adapters for that concept, not the concept itself.

2. **The first published-address adapter is an owner-chosen subdomain under the owned domain.**

   **Why:** a subdomain such as `coffee.aayushman.dev` is the smallest public-address shape that feels like a standalone site while avoiding custom-domain ownership verification, DNS polling, and cross-origin auth handoff.

3. **Path-routed `/s/:siteId/*` public sites are not the POC target.**

   **Why:** path routing is useful as an internal debug route, but it weakens the user-facing demo and contradicts the stated outcome that publishing creates a real public address.

## Out of scope

This ADR does not decide custom-domain support, customer-owned apex domains, DNS verification, billing, or multi-tenant domain management.

## Consequences

**Positive:**

- The published site looks and feels real in demos.
- The public router can stay focused on one owned-domain adapter.
- The core model stays open to future address adapters.

**Negative:**

- Local development and tests need explicit host-based routing coverage.
- The Worker deployment must include wildcard host routing for the owned domain.
- Editor/dashboard auth remains separate from visitor routing even though both are served by one Worker.

## Follow-ups

- ADR 0003 — Publish contract and visitor live-update semantics.
