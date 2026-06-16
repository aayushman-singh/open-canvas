# ADR 0068 - License-safe third-party interaction runtimes

**Status:** Accepted
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

The Owner-facing target is high-end template fidelity: a template author should
be able to reproduce designer-site choreography, overlays, route movement, text
reveals, scroll scenes, and rich animated media without pasting raw JavaScript.
The visitor should see intentional motion, and the Owner should preview and edit
that behaviour as part of the site model.

The constraint is stricter than "use free libraries." A zero-price dependency is
not acceptable if its terms restrict visual builders like Open Canvas. GSAP is
now free for commercial projects, but its current standard no-charge license
defines prohibited use around tools that let users create visual animations
without code and compete with Webflow-like visual animation building:
<https://gsap.com/community/standard-license/>. Open Canvas is close enough to
that category that making GSAP a core runtime dependency would put the product
on a weak legal foundation without written consent.

The current code also has a runtime shape that will not scale. Published pages
inject one visitor-side interactive IIFE, while the editor keeps a hand-written
mirror in `src/editor-client/hydrate-interactives.ts`. ADR 0066 already calls
that out as drift risk. Adding designer-grade motion on top of two runtime
sources would make the Owner's preview untrustworthy.

## Decisions

1. **Core designer interactions use license-safe runtime adapters, not raw
   dependency calls in saved site state.**

   **Why:** the Owner needs behaviours the editor, validator, Section Library,
   importer, agent, and published renderer can all understand. A saved template
   that contains library-specific calls cannot be inspected or safely rewritten.
   The dependency can change; the Open Canvas concept must remain stable. This
   would be wrong if the only valued outcome were "run this exact snippet on
   publish." ADR 0046 already owns that separate addon path.

2. **A third-party runtime is eligible for core only when it is free in money
   and compatible in terms with a visual site builder.**

   **Why:** "free" has to include licensing fit, not only price. MIT-licensed
   libraries such as Motion
   (<https://github.com/motiondivision/motion/blob/main/LICENSE.md>),
   Anime.js (<https://github.com/juliangarnier/anime/blob/master/LICENSE.md>),
   Swup (<https://swup.js.org/getting-started/>), Floating UI
   (<https://github.com/floating-ui/floating-ui>), lottie-web
   (<https://github.com/airbnb/lottie-web>), Rive runtimes
   (<https://github.com/rive-app/help-center/blob/master/runtimes/overview.md>),
   and Three.js (<https://github.com/mrdoob/three.js/blob/dev/package.json>)
   satisfy the starting evidence. GSAP does not enter core unless Webflow grants
   written permission for this product shape. This would be wrong if Open Canvas
   were not a visual builder; it is.

3. **The Runtime Hydrator is the single execution boundary for schema-owned
   interactions in both editor preview and published pages.**

   **Why:** every new behaviour must have one source of truth for visitor and
   editor execution. Otherwise a template author can choose a behaviour that
   looks correct in the editor and breaks after publish, or the reverse. This
   would be wrong only if the editor were an approximate preview. It is a live
   site builder, so approximation is a product bug.

4. **Runtime adapters are replaceable implementation nodes behind Open Canvas
   concepts.**

   **Why:** the concepts are Motion Sequence, Scroll Scene, Overlay, Load
   Experience, Route Transition, Layout Transition, Pointer-Reactive Effect, and
   Rich Motion Asset. Anime.js can execute timelines, text splitting, SVG,
   WAAPI, and scroll-synced progress; Motion can execute shared-layout
   transitions; Swup can own server-rendered page-transition lifecycle; native
   `<dialog>` and Floating UI can cover overlay mechanics; Lottie/Rive/Three can
   cover rich media. None of those names should leak into the saved schema as
   the concept itself. This would be wrong if one library were the product
   contract. It is not.

5. **`addon_custom_scripts` remains exceptional Owner-authored code and is not
   the template-fidelity path.**

   **Why:** custom scripts are useful for long-tail integrations, but they sit
   outside validation, import mapping, editor controls, Section Library
   composition, and agent editing. Using them for designer-template fidelity
   would recreate the gap under a different name. This would be wrong if the
   Owner explicitly asked to paste and own code for one site; ADR 0046 covers
   that case.

## Out of scope

- Selecting final package versions.
- Implementing the Runtime Hydrator.
- Rewriting existing `MotionPreset` fields.
- Auditing every transitive dependency of the listed libraries.
- Owner-authored custom scripts.
- Asking Webflow for GSAP permission.

## Consequences

- Every future designer-interaction ADR must name the Open Canvas concept first
  and the third-party runtime only as implementation evidence.
- Implementations need an explicit dependency-license check before package
  adoption. A zero-price but restricted dependency fails that check.
- The editor/public runtime split becomes blocking debt for new premium
  interactions, not a nice-to-have refactor.
- Open Canvas can still integrate strong third-party systems while keeping the
  persisted site model durable and editable.
- Some GSAP-specific effects may need re-expression through Anime.js, Motion,
  browser APIs, or richer Open Canvas concepts.

## Follow-ups

- ADR 0069 defines Motion Sequence and Scroll Scene.
- ADR 0070 defines Overlay as the successor to popup-section mutation.
- ADR 0071 defines Load Experience and Route Transition.
- ADR 0072 defines Rich Motion Asset runtimes.
- A later implementation plan must add a dependency-license verification step
  to the build or review checklist before these runtimes ship.
