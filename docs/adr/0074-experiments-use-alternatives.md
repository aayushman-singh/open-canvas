# ADR 0074 - Experiments use Alternatives

**Status:** Proposed
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

The Owner-facing gap after ADR 0073 is comparison. Analytics can tell an Owner
that visitors clicked or submitted, but it cannot answer the next question:
"which version of this page, section, or message works better?" Competitors
surface this as A/B testing, optimization, or experimentation. Open Canvas
needs the same growth loop without confusing it with the existing visual
Variant system.

The term **Variant** already means a designed look for one Content Element.
That meaning is live in the canvas schema, validators, inspector copy, and
Style Kit cascade. Reusing "Variant" for experiments would make two unrelated
relations share one word: visual styling on an element, and visitor assignment
between published states. This ADR uses **Alternative** for the experiment
concept.

The user-perceived "done" state is that the Owner chooses a page, section, or
content change to compare, chooses the Conversion Goal, publishes, and later
sees which Alternative performed better. The visitor should not see flicker,
mixed Alternatives, or hidden owner-side changes that bypass publish.

## Decisions

1. **Experiments compare Alternatives, not Variants.**

   **Why:** Variant is already a styling concept. An Experiment may compare
   different copy, layout, sections, pages, calls to action, or visual styles,
   but the comparison unit is the published state shown to visitors. Calling
   that unit a Variant would make the domain lie: not every experiment
   Alternative is a style Variant, and not every style Variant participates in
   an Experiment. This would be wrong if Open Canvas had no existing Variant
   concept. It does.

2. **An Experiment belongs to an Editable Site but runs only through the
   Published Site after publish.**

   **Why:** Open Canvas already separates owner editing from visitor behaviour.
   An Owner should be able to configure an Experiment without changing what
   visitors see until they publish. Letting experiment configuration mutate the
   live Published Site outside the publish path would create a second release
   mechanism and break the product's central mental model. This would be wrong
   if experiments were operational toggles managed outside the site builder.
   They are authored site behaviour.

3. **An Experiment has two or more Alternatives and exactly one Conversion
   Goal.**

   **Why:** the Owner needs a concrete comparison and a concrete outcome. More
   than one goal makes the result ambiguous; zero or one Alternative is not an
   experiment. This would be wrong if the first feature were exploratory
   analytics. ADR 0073 already covers measurement; this ADR covers comparison.

4. **A Visitor sees one Alternative for a given Experiment.**

   **Why:** a visitor who sees hero copy from one Alternative and form layout
   from another is not in either experience, so the result cannot be trusted.
   Assignment must be stable for the visitor for that Experiment on that
   Published Site. This would be wrong if Open Canvas were only rotating
   decorative elements. The goal is outcome comparison.

5. **Experiment evaluation reads Growth Signals through the chosen Conversion
   Goal.**

   **Why:** Open Canvas should not infer success from whichever metric moved
   after the fact. The Owner chooses the Conversion Goal before the Experiment
   runs, and the report evaluates Alternatives against that goal. This would be
   wrong if the product promise were automatic analytics mining. ADR 0073
   rejected broad behavioural streams, so the Experiment must depend on named
   owner intent.

6. **Invalid Experiment configuration fails publish validation.**

   **Why:** an Experiment with a deleted page, missing section, invalid
   Alternative target, missing Conversion Goal, or unmeasured Growth Signal
   would produce misleading results if allowed to publish. Showing only the
   first Alternative would be a silent fallback, not an experiment. Publish
   validation must name the experiment, failing relation, and target so the
   Owner can fix it before visitors see it. This would be wrong if analytics
   gaps were acceptable. They are not.

7. **Personalization is not Experimentation.**

   **Why:** an Experiment compares Alternatives under assignment rules designed
   to learn which one performs better. Personalization chooses an experience
   for a visitor based on segment, context, or owner-authored rules. Combining
   them now would hide two different behaviours inside one feature and make
   results harder to trust. This would be wrong if v1 needed targeted
   experiences. The current priority is a credible comparison loop.

## Out of scope

- Visitor segmentation and personalization rules.
- Statistical significance thresholds, confidence intervals, and winner
  declaration policy.
- Multi-armed bandit allocation or automatic traffic shifting.
- Revenue attribution and ecommerce checkout attribution.
- Experiments that run without a publish.
- Broad behavioural analytics outside the chosen Growth Signals.
- Visual design of the experiment dashboard.
- Detailed persistence schema and assignment-token format.

## Consequences

- The product vocabulary now distinguishes visual **Variant** from experiment
  **Alternative**.
- Published Snapshot and publish validation need to account for active
  Experiments and their Alternatives.
- The visitor runtime needs stable assignment per Experiment without showing
  mixed Alternatives.
- Growth reporting can compare Alternatives only after ADR 0073's Growth
  Signal and Conversion Goal contract exists.
- Personalization remains a separate later decision instead of being smuggled
  into the experiment model.

## Follow-ups

- Define the exact Experiment and Alternative schema shape.
- Decide assignment identity, persistence, expiry, and consent boundaries.
- Define reporting rules for sample size, confidence, and winner declaration.
- ADR 0075 defines Visitor Segment and Personalization Rule.
