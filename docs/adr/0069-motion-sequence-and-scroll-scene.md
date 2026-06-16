# ADR 0069 - Motion Sequence and Scroll Scene

**Status:** Accepted
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

The Owner-facing gap is choreography. A template author can choose a Motion
Preset today, but cannot express the staged hero intros, word reveals, scrubbed
scroll stories, SVG draws, mask wipes, and timed media handoffs common in high
end designer sites. The visitor sees static layout plus simple entrance effects
instead of an authored sequence.

The current model is a set of independent fields: element `motion`, section
`entrance`, page `entranceAnimation`, page `scrollTriggerMode`, pointer-fx, and
component runtime state. Published output uses an IntersectionObserver for
once-on-enter animation. Import currently collapses source animation into the
nearest Motion Preset. That loses the most valuable part of a reference site:
the choreography.

Anime.js v4 is a strong free adapter candidate because it is MIT licensed, has
timeline sequencing, text splitting, SVG/WAAPI animation, and scroll progress
synchronisation:
<https://animejs.com/documentation/timeline/sync-waapi-animations>,
<https://animejs.com/documentation/text/splittext>,
<https://animejs.com/documentation/events/onscroll/scrollobserver-synchronisation-modes/playback-progress>.

## Decisions

1. **Motion Sequence is the canonical model for authored time-based
   choreography.**

   **Why:** a single Motion Preset plus delay cannot represent staged motion
   across multiple targets. A Motion Sequence can: it names the Interaction
   Trigger, Interaction Targets, ordered steps, properties, timings, easing,
   delay, stagger, repeat policy, and completion behaviour. This would be wrong
   if template fidelity only required one-off entrance effects. The reference
   behaviour requires choreography.

2. **Motion Preset remains as shorthand that compiles into a Motion Sequence.**

   **Why:** existing templates and simple Owners still need "fade up" without
   opening a timeline editor. Keeping Motion Preset as a shorthand preserves the
   current editing affordance while giving the renderer one stronger execution
   shape. This would be wrong if Motion Preset and Motion Sequence needed
   independent runtime paths. They do not; the preset is a named macro.

3. **Scroll Scene is a separate scroll-progress relation, not another Motion
   Preset.**

   **Why:** scroll stories are driven by position, not elapsed time. A Scroll
   Scene owns trigger range, axis, progress bounds, optional pinning, snap
   points, and the Motion Sequence it drives. Treating scrubbed progress as a
   preset would hide the key relation and make pinning, range, and progress
   impossible to inspect. This would be wrong if scroll motion meant only
   "animate once when visible"; the current IntersectionObserver already covers
   that smaller case.

4. **Motion targets are schema-owned targets, not arbitrary selectors.**

   **Why:** arbitrary selectors break validation, Section Instance scoping,
   import mapping, and agent editing. Targets must resolve to page, section,
   element, component part, text split, overlay, or layout-transition endpoints.
   Unsupported targets fail validation with the target id and step id. This
   would be wrong if templates were meant to own raw DOM. They are not.

5. **Text Split is an explicit target mode with a semantic accessibility
   contract.**

   **Why:** word, line, and character reveals are common in designer templates,
   but wrapping text in spans can damage reading order and screen-reader output.
   The stored Text Element remains the semantic source; generated split spans
   are presentational animation targets. This would be wrong if text animation
   were purely decorative and invisible to assistive technology. It is visible
   content, so the semantic contract is part of the feature.

6. **The initial Motion Sequence adapter is Anime.js v4; Layout Transition is
   intentionally outside this ADR.**

   **Why:** Anime.js covers the first missing cluster with one MIT package:
   timelines, WAAPI coordination, text splitting, SVG attributes, and scroll
   progress sync. Layout Transition has a different geometry-capture relation
   and should not be hidden inside the same sequence object. This would be wrong
   if layout continuity were just another property animation. It is not; it
   needs named source and destination targets.

7. **Import records animation inventory before mapping to Open Canvas
   primitives.**

   **Why:** the current nearest-preset mapping can make a designer-site import
   look plausible while silently losing choreography. Import should record
   detected animation names, durations, delays, easings, transformed properties,
   triggers, and mapped primitive. If no exact supported primitive exists, the
   import result must say so explicitly. This would be wrong if import were only
   a static layout copier. The product ask is template fidelity.

## Out of scope

- Overlay open/close behaviour.
- Route transitions and first-load choreography.
- Rich Motion Assets such as Lottie, Rive, or 3D scenes.
- Layout Transition between two geometry states.
- A visual timeline editor design.
- Removing existing Motion Preset fields in this ADR.
- Using GSAP in core.

## Consequences

- The schema needs Motion Sequence, Interaction Trigger, Interaction Target,
  Motion Step, and Scroll Scene shapes.
- Validation must whitelist animatable properties and target kinds. Unknown
  properties fail the write gate.
- Existing element, section, and page entrance fields need a deterministic
  translation into Motion Sequence.
- The editor needs one motion panel that shows sequence steps and scroll scenes
  together instead of scattering behaviour across element, section, and page
  inspectors.
- The Runtime Hydrator from ADR 0068 becomes required before shipping broad
  Motion Sequence support, because editor and visitor execution must match.
- The scraper must stop treating "nearest preset" as the whole animation result.

## Follow-ups

- Motion Sequence shape, validator, property whitelist, editor controls, and
  visitor runtime hydration shipped in the designer-interactions branch.
- Add import animation inventory output and publish warnings for unsupported
  source choreography.
- Add a focused ADR for Layout Transition once route transitions and overlays
  need shared-target movement.
- Keep future adapter work centralized in
  [Designer Interactions Future Work](../specs/designer-interactions-future-work.md).
