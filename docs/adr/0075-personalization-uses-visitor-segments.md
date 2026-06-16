# ADR 0075 - Personalization uses Visitor Segments

**Status:** Proposed
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

The Owner-facing gap after ADR 0074 is targeted relevance. Experiments answer
"which Alternative performs better?" Personalization answers a different
question: "what should this visitor see because their current context is
different?" Competitors expose this as audience personalization, targeting,
localization-adjacent content, campaign landing variants, or optimization.
Open Canvas needs the capability, but not a hidden visitor-profiling system.

The user-perceived "done" state is that the Owner writes an explicit rule such
as "visitors from this campaign see this hero" or "returning visitors see this
section," publishes, and matching Visitors see the chosen page, section, or
content state. The Owner can explain why that visitor saw that state. A
non-matching Visitor sees the base Published Site.

The existing word "profile" is already used for owner/customer profile surfaces
in the dashboard. "Audience" and "cohort" both imply broader marketing or
analytics systems. This ADR uses **Visitor Segment** for the matching rule and
**Personalization Rule** for the relation that changes what matching Visitors
see.

## Decisions

1. **Personalization uses explicit Owner-authored Visitor Segments, not inferred
   visitor profiles.**

   **Why:** the Owner should be able to name the rule and explain why a Visitor
   matched it. Inferred profiles would create hidden state, privacy ambiguity,
   and results the Owner cannot debug. This would be wrong if the product goal
   were ad-tech audience modelling. Open Canvas is a site builder; v1
   personalization should be authored, visible, and bounded.

2. **V1 Visitor Segment predicates are limited to explicit request and site
   context.**

   **Why:** useful first segments do not require a behavioural dossier. Page or
   path, locale, campaign/referrer, device class, and site-scoped returning
   visitor state cover common website-builder needs: campaign landing copy,
   localized offers, mobile-specific emphasis, and returning-visitor messages.
   This would be wrong if v1 needed cross-site identity, demographics, or
   predictive behavioural scoring. It does not.

3. **A Personalization Rule maps one Visitor Segment to one page, section, or
   content state on the Published Site.**

   **Why:** personalization needs a clear directed relation: when this segment
   matches, show this authored state. Mapping directly from Segment to visible
   state keeps the Owner's model small and inspectable. This would be wrong if
   personalization needed arbitrary scripts. ADR 0046 already covers
   owner-authored custom scripts as a separate Addon boundary.

4. **Personalization runs only through the Published Site after publish.**

   **Why:** the Owner should configure and preview rules in the Editable Site
   without changing Visitor behaviour until publish. Letting personalization
   change live output outside publish would create a second release path,
   competing with the central Editable Site to Published Site contract. This
   would be wrong if personalization were an operational feature external to
   the builder. It is authored site behaviour.

5. **When multiple Personalization Rules can affect the same surface, explicit
   priority resolves the match; equal priority conflicts fail publish
   validation.**

   **Why:** a Visitor can be both mobile and campaign-sourced. The product must
   not silently choose whichever rule happens to be stored first. Priority makes
   the Owner choose the relation. Equal priority on the same surface means the
   system cannot know which authored state should win, so publish must fail and
   name the conflicting rules. This would be wrong if mixed personalized states
   were acceptable. They are not.

6. **Non-matching Visitors see the base Published Site.**

   **Why:** the base Published Site is the Owner-authored control state, not a
   fallback. A Personalization Rule only changes behaviour for matching
   Visitors. This would be wrong if every Visitor were required to belong to a
   segment. That would force Owners to create artificial catch-all segments and
   make the model larger for no visible benefit.

7. **Personalization may be measured with Growth Signals, but it does not learn
   or optimize automatically in v1.**

   **Why:** automatic optimization would merge personalization, experimentation,
   and AI recommendation into one opaque mechanism. The Owner should first be
   able to author and inspect the rule. This would be wrong if the immediate
   product promise were autonomous growth optimization. The current priority is
   controlled, explainable targeting.

8. **Invalid Visitor Segment or Personalization Rule configuration fails publish
   validation.**

   **Why:** a rule pointing at a deleted section, invalid page, unsupported
   predicate, or ambiguous conflict must not publish and then quietly show the
   base state. Publish validation must name the rule, predicate, target, and
   failing relation. This would be wrong if silent personalization gaps were
   acceptable. They are not.

## Out of scope

- Inferred visitor profiles.
- Cross-site visitor identity or advertising-style audience tracking.
- Demographic, interest, or lookalike audiences.
- IP geolocation personalization.
- CRM imports, account-based marketing lists, or uploaded audience files.
- Automatic AI personalization or self-optimizing rules.
- Experiment allocation, statistical significance, and winner declaration.
- Detailed predicate grammar, storage schema, cookie format, and consent UI.
- Dashboard visual design.

## Consequences

- The product gets a personalization vocabulary that stays separate from
  Experiment and Alternative.
- Published Snapshot and publish validation need to carry Visitor Segments and
  Personalization Rules as authored site behaviour.
- The visitor runtime needs a deterministic matcher for explicit request and
  site context.
- Rule conflicts become an Owner-visible authoring problem instead of a runtime
  guess.
- Growth reporting can later show segment performance, but v1 does not
  automatically move traffic or rewrite rules.
- Any future move toward inferred profiles requires a new ADR because it would
  change the privacy, debugging, and product contract.

## Follow-ups

- Define the exact Visitor Segment predicate grammar.
- Decide site-scoped returning-visitor state, expiry, consent, and deletion.
- Define preview/testing surfaces for segment matches and priority conflicts.
- Define how Growth Signal reports group results by Visitor Segment.
