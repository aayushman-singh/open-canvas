# ADR 0037 — Account page ships the billing surface before the billing engine

**Status:** Superseded by [ADR 0042](0042-account-page-metering-only.md)
**Date:** 2026-05-30
**Superseded:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** Demo recording Session 11.M ([`docs/demo/act-1-script.md`](../demo/act-1-script.md) line 415) and item #15 in [`docs/demo/handoff-delta-resolution-2026-05-30.md`](../demo/handoff-delta-resolution-2026-05-30.md) ("Account meters — rewrite Free/Pro/Team tiles + meters + invoices out"). The handoff's first-cut resolution was to delete the script beat; the new framing rule treats that as a stale capitulation to the product gap and forces the question the other way — what does the Account page have to be for the script to record as written, and how much of a real billing system does that pull in?

## Superseded (2026-05-30)

Superseded by [ADR 0042](0042-account-page-metering-only.md) the same day. The Owner directive — *"im not implementing billing at all just metering"* — eliminated the question this ADR was framed around. There is no pre-billing surface because there is no billing engine on the roadmap. The new ADR scopes the Account page to usage metering (Sites + Storage) plus the existing profile and notifications panes; plan tiles, invoice rows, and Coming-soon alerts were stripped.

The decisions and consequences below remain as the record of what was considered before the directive landed.

## Context

The Account page lives at [`src/routes/dashboard/settings.tsx`](../../src/routes/dashboard/settings.tsx). It already renders three things the demo script asks for — a `plan-now` summary card, three `.mtr` usage meters (Sites, Storage, Build minutes), three `.plan` tier cards (Free / Pro / Team), and an invoices block — but every action is mocked. The plan tier cards' upgrade buttons are `disabled`. The invoice rows' `PDF` link calls `window.__rev01Modal.alert('Invoice PDFs ship with billing v1.', 'Coming soon')`. The Build minutes meter renders `— / 60` with a 0% fill because no metering exists. The Sites and Storage meters read real numbers from `customer` → `site` and `customer` → `ownerAsset` joins, so they are the only meters with real content today.

`customer.plan` already exists as a `text` column with the `BillingPlan = 'free' | 'pro' | 'team'` union ([`src/db/schema.ts`](../../src/db/schema.ts) lines 59–77), and `siteLimitForPlan` / `storageLimitForPlan` already gate the new-site creation flow per plan. The Pro and Team site/storage limits are encoded in [`src/billing/plan-limits.ts`](../../src/billing/plan-limits.ts) but nothing today writes `customer.plan = 'pro'` or `'team'` — every row stays `free` because no upgrade path exists. The schema is plan-aware; the runtime is single-tier.

Building a real billing engine — a billing provider integration, webhook handlers for `subscription.created` / `subscription.updated` / `invoice.payment_failed` etc., a subscription-state column on `customer`, plan-gated feature checks throughout the code, usage metering for AI calls + build minutes, invoice PDF generation, a plan-change flow with proration, owner UX for failed payments and dunning — is a multi-week feature project. Memory does not capture a billing-provider decision; Stripe is the obvious pick but is not the only one (LemonSqueezy and Paddle handle the merchant-of-record question differently, which matters for the Cloudflare Workers + global-VAT story).

The demo records before any of that is real. The script asks the viewer to believe the Account page **looks like** a billing page so that the rest of the product story (free tier is enough for the Open Canvas pitch; Pro unlocks custom domains; Team adds seats) lands as part of what Open Canvas is, rather than what Open Canvas plans to add. Dropping the script beat would leave the recording with a profile-only page and no answer to "how does this make money", which is the exact framing the new rule rejects.

The decisions below resolve six tensions: the surface vs. engine split, what the disabled actions actually do, what the meters report when there is no metering, the runtime contract for plan-gating that already exists, the billing-provider choice, and what the migration path from this ADR's surface to a real engine looks like so the surface code is not thrown away when the engine lands.

## Decisions

1. **The Account page ships its full Free/Pro/Team billing surface — plan-now card, three usage meters, three plan tier cards, invoices list — as the demo recording target. The actions behind the surface (upgrade buttons, plan-change flow, invoice PDF) stay mocked behind a single sentinel until the billing engine lands. The mocks are loud, not silent: each disabled action surfaces a "Plans ship with billing v1 — join the waitlist" modal that captures an email, not a generic "Coming soon" alert.**

   **Why:** the script's purpose for Session 11.M is showing that Open Canvas knows what it wants to charge for. The plan tier cards, the meters, the invoices block — these are how the viewer learns "here is the shape of the deal". An empty profile-only page tells the viewer "the deal is not designed yet", which is a worse story for the recording than mocked surface with a real-feeling waitlist. The waitlist capture turns the mocks from inert placeholders into a real product surface: the Owner who clicks Upgrade today is heard, the conversion intent is logged, and the day billing v1 ships there is a list of users to ping. The conceptual minimum is "the page communicates the offer + captures interest"; everything past that is engine.

   This would be wrong if the recording were a feature demo of billing specifically. It is not — Session 11.M is a 30-second dashboard tour beat that establishes the product's monetisation shape on the way through. The mocked surface carries that weight; the engine does not need to.

2. **The Build minutes meter is removed from the page until a real metering exists. The Sites and Storage meters stay because they read real counts. The plan-now card and plan tier cards stay regardless because they describe the offer, not consumption.**

   **Why:** the no-fallback rule explicitly rejects "render a 0% bar with a `—` numerator because the data does not exist". A meter that reads `— / 60` with a 0% fill is the rendered equivalent of `try: ... except: pass` — the viewer sees a working-looking widget that is in fact reporting nothing. The Sites and Storage meters survive scrutiny because their numerators are real DB joins; the Build minutes meter does not. The page is honest about what it knows: two real meters, three plan cards, an invoice block with the historical (= zero) charge history. Adding an AI-generation meter would face the same test — if the AI call counter does not exist as a real per-customer column, the meter does not render. The test is "is the number a real number?" and that test fails the Build minutes meter today.

   The counterfactual: leaving the Build minutes meter in as a "filled in later" placeholder reads to the demo viewer as "this is a feature today" and to the next contributor as "the metering exists somewhere I have not found yet". Both readings are wrong. The meter goes.

3. **The mocked Upgrade flow writes a row to a new `billing_waitlist` table — `{ id, customer_id, plan_requested ('pro'|'team'), source ('account-page'|'plan-card'|'plan-now'), created_at }`. The Account page reads back the most recent waitlist entry per customer and replaces the disabled Upgrade button with "Waitlisted for Pro — we'll email you when billing ships" (with a Cancel link that deletes the row). One row per `(customer_id, plan_requested)` enforced by a unique index.**

   **Why:** turning the mock into a real recorded action is the difference between this ADR being a "build the fake page" exercise and a "build the pre-billing surface" exercise. The waitlist is the real product behaviour the surface enables — pre-billing customers express conversion intent, the operator gets a list, and when billing v1 ships the first email goes to the people on the list. The schema is intentionally minimal — no payment method captured, no plan-change choreography, no provider-side state — because everything past "I want to be on Pro" is engine work this ADR explicitly defers. The unique index per `(customer_id, plan_requested)` prevents a click-spammer from generating a thousand waitlist rows; the Cancel link makes opt-out one click.

   This would be wrong if the engine were two weeks away. It is not — billing v1 has no committed date and the recording wants to happen now. The waitlist is the bridge that makes the recording honest: the surface looks like billing, the action behind it does something real, and nothing in the database pretends to be a subscription.

4. **The mocked Invoice PDF link is removed. The invoices block re-purposes to show "Billing history will appear here once your first paid plan starts" with a chip linking to the same waitlist flow. No fake invoice rows render.**

   **Why:** the invoices block is the most consequential mock to leave honest. A fake invoice row with a `PDF` link that opens a "Coming soon" alert is the surface that most explicitly lies — it suggests the customer has a billing history, which they do not. The decision rules out the lie. The block stays for surface-area reasons (so the recording can pan over a recognisable invoices area) but its rendered content is the truth: no invoices yet, here is the waitlist. The invoice rows currently rendered from the `INVOICES = [{ date: 'May 2026' }, ...]` literal in `settings.tsx` are deleted.

   The counterfactual — leave the fake rows in for the recording — fails the same test as decision 2. The viewer sees `May 2026 · $0.00 · Free · PDF` and reads it as a real billing record. The recording is then dishonest about the product state. Better to show the empty-state copy that doubles as a conversion surface.

5. **No new runtime plan-gating beyond what already exists. `siteLimitForPlan` / `storageLimitForPlan` continue to gate site creation and asset upload; nothing else gates. The "Pro features" listed on the plan tier cards (custom domains, remove branding, unlimited sites) describe the offer's future shape, not gates that exist today. The plan tier cards' feature lists are content, not contract.**

   **Why:** plan-gating is the part of a billing system that is hardest to undo. A `requirePlan('pro')` check sprinkled through the route layer becomes load-bearing fast — every test fixture has to pick a plan, every developer has to remember which plan unlocks which feature, every demo Owner is auto-upgraded by hand to make the recording work. Until billing v1 ships an actual upgrade path, the runtime stays single-tier: every Owner is on Free, every feature works for every Owner, and the tier cards describe what the deal will look like rather than what the code enforces. The site-limit and storage-limit gates that already exist stay because they were written against the plan column from day one and removing them would regress a working invariant; they are the only two gates that survive the rule.

   The counterfactual is the version of this where the demo Owner gets manually flipped to `customer.plan = 'pro'` so the recording shows custom domains working. That flip is a one-off that opens a door the engine has to close — the moment a second feature checks `customer.plan` we have a plan-gating subsystem that has no upgrade path. Hold the line: one plan in the runtime, three plans on the surface.

6. **The billing-provider choice is deferred to a follow-up ADR explicitly out of scope here. The pre-billing surface is provider-agnostic — `billing_waitlist` rows have no provider-side coupling, and the upgrade buttons do not link to a Stripe Checkout / LemonSqueezy / Paddle URL. When the follow-up ADR picks a provider, the waitlist table becomes the seed for the first batch of upgrade emails and the surface code stays put.**

   **Why:** picking Stripe today binds the surface to Stripe's webhook contract, customer object model, and merchant-of-record posture. Cloudflare Workers is friendlier to providers that handle VAT/sales-tax compliance as merchant-of-record (LemonSqueezy, Paddle) than to providers that leave it to the seller (Stripe), but that trade-off has real margin implications and is the kind of decision an ADR is for, not a code change buried in this one. Deferring the choice keeps the surface clean — nothing here will need to change when the provider ADR lands, because nothing here talks to a provider. The waitlist row carries `plan_requested` and `customer_id` and that is all any provider needs to start a Checkout session for that customer when the time comes.

   This would be wrong if the surface had a checkout button that needed a provider URL today. It does not — decision 1 holds the surface at "join the waitlist", which is provider-agnostic by construction.

## Out of scope

- **Real subscription state.** The `subscription_status` column (`active`, `past_due`, `cancelled`, `trialing`) and its lifecycle transitions live in the billing-engine ADR, not here. `customer.plan` stays a single text column for now; the engine's ADR may add `subscription_status` and a `plan_effective_at` timestamp alongside.
- **Webhook handlers.** No `/billing/webhook` route ships from this ADR. Every webhook concern (idempotency keys, signature verification, replay protection, eventual-consistency reconciliation) is engine work.
- **Plan-change flow.** Upgrade, downgrade, cancel-mid-cycle, prorate, downgrade-takes-effect-next-cycle — all engine. The pre-billing surface only knows two transitions: "join waitlist" and "leave waitlist".
- **Failed-payment / dunning UX.** Past-due banners, grace-period countdowns, account-suspended states — engine.
- **Usage metering instrumentation for AI calls + build minutes.** The Build minutes meter is removed (decision 2). When metering lands, it lands as its own ADR-able concern (per-customer counter table, where it increments, how it resets per billing cycle) and the meter comes back. Knowing storage/site counts is useful Owner telemetry today regardless of billing, but counting AI calls and build minutes is not — it is billing telemetry, and waiting for billing to need it is the right ordering.
- **Tax / VAT / invoice numbering / accounting export.** All merchant-of-record concerns, deferred to the provider ADR.
- **Per-feature plan-gating beyond site-limit and storage-limit.** Decision 5 holds the line; future feature ADRs that want plan-gating have to either get billing-engine ADR approval or wait for it.
- **The `BillingPlan` enum growing.** No `enterprise`, no `team-plus`, no `addon-only` tier. Three plans on the surface, three plans in the enum, no migration to widen it until the engine lands.

## Consequences

**Positive:**

- Session 11.M records as written. The viewer sees three plan tier cards, two real usage meters, an invoices block, and an Upgrade button that does something real (joins a waitlist) rather than something fake (Coming soon alert). The recording is honest about the product state without dropping the monetisation beat.
- Conversion intent is captured from day one. When billing v1 ships, the first email goes to a real list of pre-registered Owners rather than to a cold blast.
- The runtime stays single-tier. No plan-gating creep, no test-fixture plan choice, no demo-Owner-needs-pro-flipped manual setup. Every feature works for every Owner, and the engine ADR can introduce gating with full visibility of where it goes.
- The billing-provider choice stays open. Nothing here couples to Stripe / LemonSqueezy / Paddle; the engine ADR can pick on margin + merchant-of-record grounds without re-writing the Account page.
- The Build minutes meter and the fake invoice rows are removed. The surface stops lying about what it knows. Subsequent contributors reading `settings.tsx` will not have to figure out which numbers are real and which are placeholders.
- The waitlist table is reusable. A future ADR could open a public waitlist on the marketing page that writes to the same row shape, and the Account page already knows how to read from it.

**Negative:**

- The Account page still shows three plan tier cards no Owner can actually buy. A first-time viewer who skips the Upgrade-button copy ("Waitlisted for Pro — we'll email you when billing ships") might walk away thinking Pro is purchasable today. The waitlist copy has to carry that disambiguation alone; if the waitlist email never goes out, the page reads as vaporware.
- The waitlist creates a real customer-facing commitment. Every row is a person waiting for billing to launch. If billing v1 slips by months, the waitlist becomes a stale promise. The recording's existence does not bind the operator to a billing-launch date, but the waitlist's existence implicitly does — the longer the list, the louder the silence.
- The `billing_waitlist` table is new schema that exists before any billing engine schema does. When the engine ADR introduces `subscription`, `payment_method`, etc., the waitlist sits alongside them rather than being absorbed. The cleanup story is "waitlist rows whose customer has now subscribed get archived"; the ADR for the engine has to remember to write that.
- The runtime continues to ship plan-aware schema (`customer.plan`, `siteLimitForPlan`) with a runtime that only ever uses Free. A future contributor reading the column might assume there is a path to Pro and write code that branches on `plan === 'pro'` — that code will compile and pass tests because every test fixture is Free, and break the first time billing v1 sets a row to Pro. Decision 5 names this risk; enforcement is review-level, not type-level.
- Removing the existing fake invoice rows + the Build minutes meter is a visible regression to anyone who has seen the current build. The recording will not show those affordances; the script needs a corresponding rewrite so the voiceover does not narrate features that are no longer on screen.

## Follow-ups

- DB migration: add the `billing_waitlist` table with the schema described in decision 3, plus the unique index on `(customer_id, plan_requested)`. Add the corresponding Drizzle model in [`src/db/schema.ts`](../../src/db/schema.ts) and the query helpers in `src/billing/`.
- Edit [`src/routes/dashboard/settings.tsx`](../../src/routes/dashboard/settings.tsx) to: (a) remove the Build minutes meter, (b) replace the `disabled` Upgrade buttons with the waitlist join/leave action, (c) replace the `INVOICES` literal + `PDF`-alert rows with the empty-state invoice block from decision 4.
- Add a route `POST /dashboard/settings/waitlist` + `DELETE /dashboard/settings/waitlist/:plan` for the join/leave actions. The handlers are short — read `c.get('user')`, upsert / delete the row, redirect back to `/dashboard/settings#billing`.
- Update [`docs/demo/act-1-script.md`](../demo/act-1-script.md) Session 11.M to record the waitlist click (not the disabled-button hover) and to skip the Build minutes meter pan. Update the corresponding line in [`docs/demo/handoff-delta-resolution-2026-05-30.md`](../demo/handoff-delta-resolution-2026-05-30.md) item #15 so the "rewrite … out" resolution flips to "rewrite to waitlist + two real meters".
- Open the billing-provider ADR as the explicit successor. It picks Stripe vs. LemonSqueezy vs. Paddle on merchant-of-record + Workers-compat + margin grounds, introduces `subscription_status` on `customer`, defines the webhook contract, and schedules the deletion of the waitlist rows that the first batch of upgrade emails closes out.
- Open the usage-metering ADR for AI calls + build minutes when the billing engine is close enough that the meters will have a billing-cycle anchor to reset against. Until then, the meters stay off the page rather than rendering empty.
- Smoke: a fresh `customer` row sees three plan cards (Free marked as current, Pro highlighted, Team), two real meters (Sites + Storage), an empty-state invoices block, and an Upgrade-to-Pro button that creates a `billing_waitlist` row. A second click flips the button copy to "Waitlisted for Pro" with a working Cancel link.
- Mark this ADR Superseded when the billing-engine ADR lands and the Account page swaps the waitlist action for a real Checkout flow. The surface code (plan cards + meters + invoice block layout) survives the supersession; only the action behind the Upgrade buttons changes.
