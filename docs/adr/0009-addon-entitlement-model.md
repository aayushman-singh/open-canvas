# ADR 0009 — Addon entitlement model: account-scoped purchase, site-scoped configuration

**Status:** Accepted
**Date:** 2026-05-25
**Author:** Aayushman Singh

## Context

The product is adding purchasable capabilities ("addons") that enhance a Published Site — the first being Google Analytics script injection. An Owner buys an addon once and can then enable it on any of their sites with per-site configuration (e.g. a GA Measurement ID).

Today every feature in rev01 is unconditionally available to every Owner. There is no concept of paid capabilities, entitlements, or per-site feature configuration. The addon system introduces conditional feature access for the first time.

The user-perceived outcome is: an Owner opens a Shop tab, picks an addon, acquires it, then goes to any of their sites' settings and enables it with whatever configuration that addon needs. Visitors see the effect on the Published Site after the next publish.

## Decisions

1. **Addon Entitlements are account-scoped; Site Addons are site-scoped. They live in separate tables.**

   **Why:** an Owner buys Google Analytics once and might enable it on 3 of 5 sites with different Measurement IDs. The purchase fact and the per-site wiring change for different reasons and at different rates. A single table conflates "has the Owner paid?" with "is this site configured?" — querying one always drags in the other. Two tables let the dashboard answer "what has this Owner bought?" with a single indexed scan on `addon_entitlement(customer_id)`, and the rendering pipeline answer "what scripts does this site need?" with a single scan on `site_addon(site_id)`. The cost is one extra table and a cross-check at enable time. This would be wrong if addons were always 1:1 with sites (buy per-site, configure per-site), but the product intent is account-wide purchase.

2. **The addon catalog is a hardcoded TypeScript registry, not a database table.**

   **Why:** each addon has bespoke integration logic (GA injects a script tag; a future chat widget would inject entirely different markup). The catalog entry and its integration are the same concern — they change together on the same deploy cadence. A database table would decouple catalog metadata from integration code, requiring a sync step that adds complexity without flexibility the POC needs. The template seeds registry already proves this pattern in the codebase. This would be wrong if the catalog were large, frequently updated by non-developers, or decoupled from integration logic.

3. **Addon effects are injected by a dedicated emitter function, not inline in the public host router.**

   **Why:** the public host router (`src/routes/public.ts`) already has conditional injection for fonts, dual-mode CSS, embed CSP, interactive runtime, and SEO meta. Adding per-addon conditionals directly would make the file harder to follow and couple the router to each addon's integration details. A single `emitAddonHeadScripts(siteId)` call keeps the contract simple: the addon subsystem owns what to inject, the router owns where to inject it. New addons never touch `public.ts`. This would be wrong if addon injection required deep coupling with other parts of the document assembly (e.g. modifying the CSP computation), but the current addon (GA) is a self-contained script tag.

4. **Removing an Addon Entitlement disables the effect at render time but does not cascade-delete Site Addons.**

   **Why:** if an Owner's entitlement lapses and is later restored, their per-site configuration should still be there. Cascade-deleting Site Addon rows would force the Owner to re-enter every Measurement ID across every site. The render-time check is: "does the Owner hold this entitlement AND is the Site Addon enabled?" — a missing entitlement silently skips injection. The configuration is inert, not deleted.

## Out of scope

This ADR does not decide:

- Payment processing, pricing, or subscription management (the POC uses mock purchase UI)
- Consent banners, cookie consent, or GDPR compliance for analytics scripts
- Server-side analytics or rev01-owned analytics dashboards
- Per-addon usage quotas or rate limits
- Addon dependencies (one addon requiring another)
- Addon versioning or migration between addon versions

## Consequences

**Positive:**

- The Shop tab is a pure read of the registry + a join with entitlements. No catalog table to seed or migrate.
- Site settings can show "enable GA" with a simple entitlement check. Configuration is a typed JSON blob per addon.
- The public host router gains one function call, not N conditional blocks per addon type.
- Owner configuration survives entitlement lapses.

**Negative:**

- Two new tables and a cross-check at enable time add schema surface area.
- Adding a new addon requires a code deploy (registry change), not a database insert.
- The render-time entitlement check adds one query to the visitor request path (mitigated by joining with the site_addon query).

## Follow-ups

- Database migration to create `addon_entitlement` and `site_addon` tables.
- Addon registry module with Google Analytics as the first entry.
- `emitAddonHeadScripts` emitter wired into `src/routes/public.ts`.
- Dashboard Shop tab UI (mock purchase flow).
- Site settings panel for per-site addon configuration.
