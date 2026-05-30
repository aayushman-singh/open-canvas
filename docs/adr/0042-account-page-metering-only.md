# ADR 0042 — Account page is usage metering only; no billing surface ships

**Status:** Accepted
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Supersedes:** [ADR 0037](0037-account-page-billing-surface-pre-billing.md)
**Drives:** the directive *"im not implementing billing at all just metering"* delivered alongside the product-gap implementation sweep, replacing the framing in [ADR 0037](0037-account-page-billing-surface-pre-billing.md) (which assumed a pre-billing surface should ship as the bridge to a future billing engine). The mocked surface previously rendered at [`src/routes/dashboard/settings.tsx`](../../src/routes/dashboard/settings.tsx) — plan tiles for Free/Pro/Team, three usage meters (one of which was fake), three placeholder invoice rows with a "Coming soon" alert on the PDF link — went out the door alongside this ADR.

## Context

[ADR 0037](0037-account-page-billing-surface-pre-billing.md) was written under the assumption that some form of billing was on the roadmap, and that the Account page should ship a "pre-billing surface" — mocks promoted to a real `billing_waitlist` table, fake meters and invoices removed, Stripe/LemonSqueezy/Paddle choice deferred — so the demo recording could show the surface area without committing to a billing implementation yet.

The directive that produced this ADR replaced that assumption: the Account page is *metering only*, the billing engine is not on the roadmap, and rendering a billing-shaped surface without a billing engine is a no-fallback violation (per the user's global preference against silent degraded modes). A page that shows plan tiles you can't choose, invoices that don't exist, and a "Coming soon" alert on every CTA is a worse Owner experience than a page that simply doesn't promise billing in the first place.

The script's S11.M beat — Maya seeing "Account meters" — survives because *metering* (sites used / storage used) is real telemetry the product already computes at every settings load. The plan-tier *labels* on those meters also survive, because the underlying `customer.plan` column still drives the per-plan limits the meters render against (`siteLimitForPlan` / `storageLimitForPlan` from [`src/billing/plan-limits`](../../src/billing/plan-limits.ts)) — but no plan-change UX is exposed.

## Decisions

1. **The Account page renders usage metering and account-profile controls only. No plan tiles, no invoices, no upgrade prompts, no "Coming soon" alerts.** The previous "Plan & billing" tab label changes to "Usage". The Notifications and Account profile tabs ship unchanged.

   **Why:** the surface the previous design rendered was a billing surface with the billing engine removed. The shape promised more than it delivered. The metering surface keeps every component honest — every meter shows real numbers from real DB state, and the limits the meters render against are the same limits the product enforces at write time. Nothing is mocked, nothing is "Coming soon," nothing requires explanation when an Owner asks "can I upgrade?" (answer: no, that's not a thing this product ships).

2. **Exactly two meters ship: Sites and Storage.** The previous third meter ("Build minutes") was placeholder copy with a `0%` fill — no data source existed for it. It's removed entirely; the responsive grid drops from `repeat(3, 1fr)` to `repeat(2, 1fr)`.

   **Why:** the no-fallback rule from the user's CLAUDE.md applies to UI as much as to error handling. A meter that shows `—` over an arbitrary cap, with a 0% fill bar, is a degraded-mode rendering of a measurement the product can't make. Removing it is the correct move; adding the measurement (build-minutes accounting) is a separate decision that needs its own ADR and a real data source.

3. **The `customer.plan` column stays.** The Account UI no longer surfaces it as a tier label or upgrade target, but the column continues to drive the limit lookups (`siteLimitForPlan`, `storageLimitForPlan`) the meters render against and the site-create write-gate enforces.

   **Why:** the plan-aware limit lookups already shipped (per [ADR 0009](0009-addon-entitlement-model.md) and migration 0007); removing them would be a different decision with implications for the site-create flow. This ADR is about the *Account-page UI*, not the underlying plan-cohort model. A future ADR can remove `customer.plan` entirely if the plan-cohort concept becomes dead scope; until then it stays a backend-only signal.

4. **The `billing/plan-limits` module stays in place.** Only the Account-page consumers of `billingPlanInvoiceAmount` and `billingPlanLabel` are removed; the limit helpers (`siteLimitForPlan`, `storageLimitForPlan`) keep their existing call sites.

   **Why:** Same as decision 3 — the underlying helpers serve other paths (site-create site-limit enforcement, ownerAsset storage-cap checks). Decoupling this ADR from those paths keeps the change atomic.

5. **No `billing_waitlist` table, no email-capture form, no future-billing affordance of any kind.** [ADR 0037](0037-account-page-billing-surface-pre-billing.md) proposed promoting the fake "Coming soon" alerts to a real waitlist table that captured Owner interest. That isn't built here because billing is no longer on the roadmap; capturing waitlist signal for a feature that isn't planned is a different kind of degraded mode (promising a future that may never materialise).

   **Why:** the directive is explicit about scope ("just metering"). Adding a waitlist would be expanding scope back toward billing under a different name. If billing returns to the roadmap, a successor ADR can add the waitlist alongside the engine work.

## Out of scope

- Removing `customer.plan` from the schema. The plan-cohort model is intact at the DB layer; this ADR only stops the Account UI from exposing it. A future ADR can collapse the cohorts if the limits become single-tier.
- Other billing-adjacent UI elsewhere in the dashboard (e.g. site-create flow showing "you're on the Free plan, limit X"). Not in this ADR's scope; the meters here are the canonical display.
- Build-minutes accounting. Removed from the UI; no implementation work, no ADR. If usage-time metering becomes a real product concept, a successor ADR adds the data source AND the meter together.
- The Notifications tab content. The "Per-event email preferences aren't wired up in this build" placeholder text stays; it's not billing-related and isn't this ADR's concern.
- The Profile page at `/dashboard/profile`. Separate route, separate concerns; this ADR is about `/dashboard/settings`.

## Consequences

**Positive:**
- The Account page no longer renders unfulfillable promises (upgrade buttons, plan tiles, invoice rows). Every visible element corresponds to a real product capability.
- One less roadmap dependency on the demo recording: S11.M records against the metering UI as it ships, no waiting on a billing engine.
- The no-fallback rule from CLAUDE.md is honoured at the UI layer — degraded-mode renderings (`—` over an arbitrary cap) are removed alongside the broken billing rubric. Mirrors [ADR 0031](0031-audit-numeric-score-handling.md)'s removal of the misleading numeric audit score.
- Cohort plan model stays intact (decisions 3 + 4), so adding billing back later doesn't require re-introducing the limit infrastructure.

**Negative:**
- An Owner reading the previous Account page who learned "Free / Pro / Team" as terms will see those labels disappear from the UI. The terms still exist in the DB (and in error messages from the site-create limit gate); the Account UI just no longer treats them as user-facing tier choices.
- Build-minutes meter removal means there is no UI surface for any "execution time" measurement at all today. If that becomes Owner-facing (e.g. for AI-generation rate limiting), the absence is a fresh design choice rather than an extension of the existing meter set.
- The demo recording's S11.M voiceover (per the previous script) name-checked plan tiles + invoices. Beat needs a rewrite (see Follow-ups).

## Follow-ups

- **Script update**: revise S11.M in [`docs/demo/act-1-script.md`](../demo/act-1-script.md) to narrate against the metering-only surface (Sites + Storage meters + Account profile + Notifications). The original "Free/Pro/Team plan tiles + meters + invoices" script line is dead scope; replace with "Sites and Storage meters showing real usage against the current plan's limits."
- **Handoff update**: [`docs/demo/handoff-delta-resolution-2026-05-30.md`](../demo/handoff-delta-resolution-2026-05-30.md) §3 item #15 ("Account meters") was framed under the previous ADR's assumption. Update the framing to point at this ADR + close as shipped.
- **Successor ADR (if billing returns)**: if a Stripe/LemonSqueezy/Paddle integration becomes scope, write a successor ADR that adds the engine, the waitlist (if still wanted), and the surface — in the same commit, not as the staggered shape ADR 0037 originally proposed.
