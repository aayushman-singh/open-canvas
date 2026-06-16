# ADR 0073 - Owner-chosen Growth Signals

**Status:** Proposed
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

The Owner-facing gap is knowing whether a published site works. Webflow,
Framer, Wix, Squarespace, Shopify, and Canva all move beyond visual editing
toward performance loops: analytics, conversion reporting, experiments,
personalization, or AI recommendations. Open Canvas currently lets an Owner
publish a site and attach third-party scripts through Addons, including Google
Analytics, but it does not have a first-party way to measure outcomes that the
product itself can understand.

The user-perceived "done" state is simple: the Owner chooses the outcomes that
matter, publishes, and later sees whether visitors reached those outcomes. That
is the foundation for experiments and personalization. A broad default
behavioural stream would be the wrong first move: it would collect data the
Owner did not ask for, make privacy posture harder to explain, and produce
large volumes of low-intent data before Open Canvas has a clear product use for
it.

The existing term "event" is already overloaded across DOM events, SSE events,
notifications, interaction triggers, and operational publish activity. This ADR
uses **Growth Signal** for the product concept: an Owner-chosen visitor
occurrence that Open Canvas measures because it can inform site improvement.

## Decisions

1. **Open Canvas growth measurement is first-party product behaviour, not only
   an Addon integration.**

   **Why:** third-party analytics can tell an Owner something happened outside
   Open Canvas, but it cannot be the trusted input for Open Canvas-native
   experiments, AI suggestions, or conversion reporting unless the product owns
   the meaning of the measured outcome. This would be wrong if the desired
   feature were only "paste a tracking script." That feature already exists as
   the Google Analytics and Custom Scripts Addons.

2. **V1 records only Owner-chosen Growth Signals from a fixed built-in
   catalogue.**

   **Why:** the Owner should be able to point at the site and say what matters:
   this page view, this action click, this form submission, this search query.
   Collecting a broad behavioural stream by default would invert that relation:
   Open Canvas would collect first and justify later. This decision would be
   wrong if the core product promise were session replay or heatmap analytics.
   It is not; the first promise is outcome measurement that can later support
   experiments.

3. **The initial Growth Signal catalogue is page view, action click, form
   submission, and site search query.**

   **Why:** these are the smallest signals that map to existing Open Canvas
   visitor behaviours and common owner intent: visitors arrived, clicked the
   intended action, submitted the form, or searched for something. Adding scroll
   depth, cursor movement, rage clicks, recordings, or arbitrary custom events
   now would expand the system before there is a clear outcome relation. This
   would be wrong if the first customer segment were analytics specialists
   expecting full instrumentation. The current competitive gap is broader:
   website owners need a useful growth loop inside the builder.

4. **A Conversion Goal is an Owner-chosen desired outcome evaluated from Growth
   Signals.**

   **Why:** "traffic went up" is not the same as "the site improved." A
   Conversion Goal gives experiments, AI recommendations, and dashboards a
   named outcome to optimize against. Without it, Open Canvas can show counts
   but cannot honestly claim a variant, edit, or page performed better. This
   would be wrong if Open Canvas only needed raw analytics tables. The product
   direction is a builder that helps Owners improve published sites.

5. **No Growth Signal is recorded for an unchosen target.**

   **Why:** the measurement boundary must be visible to the Owner. If an action,
   form, search box, or page is not selected for measurement, Open Canvas does
   not silently turn it into a data source. This would be wrong if the product
   depended on later mining every visitor interaction. That is explicitly not
   the v1 behaviour.

6. **Invalid Growth Signal configuration fails loudly.**

   **Why:** a signal pointing at a deleted action, renamed form, missing page,
   or unsupported target must not produce zeroes that look like real visitor
   behaviour. Validation or runtime reporting must identify the site, signal,
   target, and failing phase so the Owner or operator can fix the broken
   relation. This would be wrong if silent analytics gaps were acceptable. They
   are not.

7. **Experiments and personalization depend on Growth Signals and Conversion
   Goals, but are not defined by this ADR.**

   **Why:** an experiment allocator, variant model, eligibility rules, and
   statistical evaluation all require more decisions. Defining them before the
   measurement vocabulary would hide unresolved questions inside a larger
   feature. This would be wrong if experiments could be built as a wrapper over
   arbitrary analytics events. Open Canvas needs a smaller, named contract first.

## Out of scope

- Broad default behavioural event streams.
- Heatmaps, session replay, cursor tracking, rage-click detection, or scroll
  analytics.
- Experiment allocation, variant bucketing, statistical significance, or
  personalization rules.
- Cross-site visitor identity or advertising-style audience tracking.
- Revenue attribution, ecommerce checkout attribution, and campaign attribution.
- Importing third-party analytics data into the native growth model.
- Dashboard visual design.
- Data-retention policy and consent UI.

## Consequences

- The product gets a native growth vocabulary that can feed later experiments,
  AI recommendations, and owner-facing reports.
- The Addon model remains valid: Google Analytics and Custom Scripts can still
  send third-party data, but Open Canvas does not treat that data as its native
  source of truth.
- Actions, forms, search boxes, and pages need stable owner-visible identities
  before they can be reliable Growth Signal targets.
- Publish validation needs to reject broken Growth Signal relations instead of
  letting the Published Site report misleading zeroes.
- Visitor runtime work must be scoped to the selected signals, not a universal
  interaction collector.
- Teams wanting full product analytics will need a later ADR rather than
  smuggling arbitrary instrumentation into v1.

## Follow-ups

- ADR 0074 should define Experiment, Alternative assignment, and Conversion Goal
  evaluation.
- Decide the consent and retention contract before collecting Growth Signals in
  production.
- Define the dashboard surfaces for signal counts, goal conversion, and broken
  signal warnings.
