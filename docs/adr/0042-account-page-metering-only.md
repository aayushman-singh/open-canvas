# ADR 0042 — Account page renders a mock-billing plan picker; no billing engine ships

**Status:** Accepted
**Date:** 2026-05-30 (amended 2026-06-04)
**Author:** Aayushman Singh
**Supersedes:** [ADR 0037](0037-account-page-billing-surface-pre-billing.md)
**Drives:** the original directive _"im not implementing billing at all just metering"_ (2026-05-30) which scoped the Account page to usage meters only, and the follow-on directive (2026-06-04) — _"upgrade to add sites button didnt lead to anything from dashboard, user cant upgrade, payments are deliberately defered but we do have mock db ops and all so setup ui for that"_ — which reverses the _no-plan-picker_ part of the 2026-05-30 framing while keeping the _no-billing-engine_ part. The site-count gate at [`src/routes/dashboard/index.tsx`](../../src/routes/dashboard/index.tsx) renders an _Upgrade to add sites_ CTA when the Owner is at their plan's site cap; under the 2026-05-30 framing that CTA dead-ended at a metering page with no upgrade affordance, which is itself a no-fallback violation (the button promised an action the surface couldn't deliver).

## Amendment (2026-06-04)

The 2026-05-30 version of this ADR forbade _plan tiles, invoices, upgrade prompts, and "Coming soon" alerts_ on the Account page on the grounds that rendering a billing-shaped surface without a billing engine would be a degraded mode. The 2026-06-04 directive refines that rule:

- **Mock-checkout theatre (fake invoices, fake cards, fake Stripe redirects, "Coming soon" alerts) remains forbidden.** Those promise an external billing engine that doesn't exist.
- **A plan picker that flips `customer.plan` via [`PATCH /api/profile`](../../src/routes/api/profile.ts) is _not_ a degraded billing surface.** The DB column is real, the per-plan limits the picker selects between (`siteLimitForPlan` / `storageLimitForPlan` in [`src/billing/plan-limits.ts`](../../src/billing/plan-limits.ts)) are enforced at write time, and the consequence of switching plans (more sites unlock, more storage cap, etc.) is observable on the next request. Nothing about the surface implies that money changed hands.

The amendment therefore re-introduces plan tiles and a "Switch to X" button per tile on the Account page, plus an inline plan modal on the dashboard so the "Upgrade to add sites" CTA lands somewhere actionable. It does not re-introduce invoice history, payment-method UX, or anything else that would imply a billing engine exists.

## Context

[ADR 0037](0037-account-page-billing-surface-pre-billing.md) framed the Account page as a "pre-billing surface" that should ship mocks while the engine choice (Stripe / LemonSqueezy / Paddle) was deferred. The 2026-05-30 directive replaced that framing with a metering-only surface, on the basis that anything shaped like billing without a billing engine was degraded-mode UI.

The 2026-06-04 directive surfaced the gap that framing left behind: the dashboard's site-limit gate at [`src/routes/dashboard/index.tsx`](../../src/routes/dashboard/index.tsx) renders an _Upgrade to add sites_ button when `siteCount >= siteLimitForPlan(customerPlan)`, and a small `Upgrade` link in the _Plan_ stat card. Both targets are `/dashboard/settings`. Under the metering-only Account page those links arrive at a surface that doesn't expose a plan choice — the gate tells the Owner to upgrade, the destination has no upgrade affordance. That mismatch is a worse Owner experience than either _no gate_ or _real upgrade UX_.

The reconciliation is the amendment above: the `customer.plan` column was already real — it's been driving limit enforcement since [ADR 0009](0009-addon-entitlement-model.md) / migration 0007 — and the [`PATCH /api/profile`](../../src/routes/api/profile.ts) endpoint already accepts a `plan` field (validated against `BILLING_PLANS`). The mock surface is therefore a UI over real DB state, not a fake of an engine that doesn't exist. What stays mocked is the _payment_ — switching plans costs nothing, and the UI says so out loud.

The script's S11.M beat — Maya seeing "Account meters" — still records honestly, with the Plan tab open alongside Usage so the surface area matches the new shape.

## Decisions

1. **The Account page renders three tabs in this order: Plan, Usage, Notifications, Account.** The Plan tab is the new canonical plan-picker surface. The Usage tab keeps the Sites + Storage meters from the 2026-05-30 version. Notifications and Account are unchanged.

   **Why:** the Plan tab is what the dashboard's _Upgrade_ links arrive at. Putting it first makes the page's primary purpose answer the question the link asked. Usage stays because the meters are honest telemetry the page already computes.

2. **The Plan tab renders one tile per `BillingPlan` (Free / Pro / Team).** Each tile shows the plan name, the headline price label (`$0` / `$19/mo` / `$49/mo`), the site cap, the storage cap, and either a "Current plan" badge or a "Switch to X" button. Clicking "Switch to X" issues `PATCH /api/profile { plan: 'x' }` and reloads the page on success. Both upgrade and downgrade directions are exposed.

   **Why:** the picker is honest about being instantaneous because that is what the mock-DB operation actually does. Hiding downgrade behind a smaller affordance would mimic the shape of a real billing UI (where downgrades are friction-loaded for retention) and would be the kind of theatre the original ADR was right to forbid. A label below the tiles names the mock explicitly: _"Switching plans is instant and free in this build — no card needed, no charges made."_

3. **The dashboard "Upgrade to add sites" button opens an inline plan modal, not a navigation.** The modal renders the same plan tiles as the Plan tab (Free / Pro / Team) and writes through the same `PATCH /api/profile` endpoint. On success the modal closes and the page reloads so the site-count gate releases. The small _Upgrade_ link in the _Plan_ stat card opens the same modal.

   **Why:** the dashboard's _at-limit_ state is the moment the upgrade question is asked. Forcing a navigation away from that context — to a settings page the Owner has to scan for the right tab — is friction that the modal removes. The modal and the Plan tab share their tile renderer so the surface stays singular.

4. **No fake invoices, no fake payment-method UX, no fake Stripe redirects, no "Coming soon" alerts.** Every visible affordance on the Account page corresponds to a real DB write or a real DB read. The only mock is the _cost_ of switching plans, which is named in copy.

   **Why:** these were the elements the 2026-05-30 framing was correct to remove. Re-introducing them would re-introduce the degraded-mode shape the amendment is careful to keep out of scope.

5. **The `customer.plan` column stays, and `billing/plan-limits` stays.** Both were preserved by the 2026-05-30 version of this ADR for the same reasons; both are now actively exercised by the Plan tab UI.

   **Why:** the limit lookups (`siteLimitForPlan`, `storageLimitForPlan`) are already the canonical source-of-truth at the site-create write-gate and the ownerAsset storage-cap check. The Plan tab reads the same helpers when it renders each tile's caps, so there is no second list of plan capabilities to drift out of sync.

6. **No `billing_waitlist` table, no email-capture form, no future-billing affordance of any kind.** [ADR 0037](0037-account-page-billing-surface-pre-billing.md) proposed promoting "Coming soon" alerts to a real waitlist table; the 2026-05-30 ADR rejected it; the 2026-06-04 amendment rejects it again for the same reason. Capturing waitlist signal for a feature that isn't planned is a different kind of degraded mode.

   **Why:** the directive is explicit that billing isn't on the roadmap. A waitlist would re-introduce a future-billing affordance under a different name. If billing returns to the roadmap, a successor ADR can add the waitlist alongside the engine work.

## Out of scope

- Removing `customer.plan` from the schema. The plan-cohort model is intact at the DB layer; it now has a primary UI surface.
- Per-plan feature gates beyond site count and storage. The plan picker exposes the two caps the limit helpers compute; other gates (e.g. _Pro-only addons_) are out of scope until a separate ADR introduces them.
- Real payment processing. The "mock" in _mock-billing_ is the cost — there is no payment UI of any kind. A successor ADR adds the engine, the payment-method capture, and the invoice surface in the same commit, not staggered the way [ADR 0037](0037-account-page-billing-surface-pre-billing.md) originally proposed.
- The Notifications tab content. Unchanged from the 2026-05-30 version.
- The Profile page at `/dashboard/profile`. Unchanged.

## Consequences

**Positive:**

- The dashboard "Upgrade to add sites" CTA now lands on an actionable surface. The site-limit gate's promise (upgrade unlocks more sites) is fulfilled by a single click that flips the column the limit helpers read against.
- The Account page answers the question Owners arrive with: _what plan am I on, and how do I change it?_ It used to answer only the first half.
- The mock-cost framing is honest — copy on both surfaces names the mock out loud, so an Owner reading the picker doesn't form a false expectation that payment will be requested.
- The plan-cohort model that ADR 0009 introduced now has a primary UI surface; future plan-tier work (e.g. extra plans, per-plan addon gates) has an obvious place to land.

**Negative:**

- The S11.M demo voiceover still needs the rewrite the 2026-05-30 version of this ADR scheduled (see Follow-ups); the rewrite now describes a Plan tab alongside the Usage meters rather than a metering-only surface.
- An Owner who saw the 2026-05-30 metering-only surface and learned "this product doesn't expose plan choice" will see plan choice re-appear. The change is additive on top of the meters, so the metering content they were taught remains visible — but the _page's primary tab_ is now Plan, not Usage.
- The plan tiles re-introduce price labels (`$19/mo` / `$49/mo`) on a surface that doesn't process payment. The copy mitigation ("Switching plans is instant and free in this build") is load-bearing — if it's removed, the surface decays back toward the 2026-05-30 critique.

## Follow-ups

- **Script update**: revise S11.M in [`docs/demo/act-1-script.md`](../demo/act-1-script.md) to narrate against the four-tab Account page (Plan → Usage → Notifications → Account) and the dashboard upgrade modal. The 2026-05-30 follow-up scheduled a rewrite to "Sites and Storage meters" only — that rewrite is now itself stale.
- **Handoff update**: [`docs/demo/handoff-delta-resolution-2026-05-30.md`](../demo/handoff-delta-resolution-2026-05-30.md) §3 item #15 was framed under ADR 0037, then re-framed under the 2026-05-30 ADR; if the handoff is still being read as authoritative, re-frame again under the 2026-06-04 amendment. Per the _only-ADRs-canonical_ rule, the handoff is a snapshot and this ADR overrides.
- **Successor ADR (if billing returns)**: if a real billing engine becomes scope, write a successor ADR that adds the engine, payment-method UX, invoice surface, and webhooks in the same commit, and turns this ADR's mock-cost framing off. The plan-picker surface and the `BillingPlan` column survive the transition unchanged; only the _cost is a mock_ claim flips.
