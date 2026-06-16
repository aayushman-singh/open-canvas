# Designer Interactions Future Work

**Status:** Agent pickup index
**Last updated:** 2026-06-17

This is the obvious handoff point for future agents continuing the
designer-template fidelity work. It consolidates open items from ADR 0068
through ADR 0072 and the gap investigation.

## Shipped Baseline

The `feat/designer-interactions-runtime` branch already shipped these pieces:

- Motion Sequence and Scroll Scene schema, validation, rendering payload, and
  runtime hydration.
- Overlay contracts and Floating UI backed placement for anchored overlays.
- Lottie-backed Rich Motion Assets, Owner Asset upload/read/delete lifecycle,
  editor binding controls, and reduced-motion handling.
- Load Experience and Route Transition contracts, editor controls, visitor
  runtime hydration, live publish update rehydration, and failure-event tests.
- License-safe vendor bundling for Anime.js WAAPI, Floating UI, and lottie-web.

Do not re-open these as "missing" unless the code has regressed.

## Next Work

1. **Build actual designer template packs.**

   Goal: prove the new primitives on real template seeds or Section Library
   compositions, not only fixtures. Start with one portfolio/project-detail
   template and one product/landing template that use load choreography, route
   transition, overlays, and rich motion together.

2. **Add browser visual QA for representative flows.**

   Add Playwright coverage for first load, route transition, overlay open/close,
   Lottie hydration, reduced-motion behavior, and live publish update hydration.
   Smokes cover contracts; this must cover real browser rendering and timing.

3. **Add View Transition same-document adapter controls.**

   ADR 0071 allows View Transition API only behind the existing Route
   Transition runtime, only for same-document/root/named-target modes the schema
   can describe. Cross-document `@view-transition` and identity-free
   `match-element` remain out of scope.

4. **Extend Rich Motion beyond Lottie.**

   Add runtime adapters and validation for Rive, image-sequence playback, and
   bounded 3D scene descriptors. Do not accept arbitrary uploaded JavaScript,
   GLSL, or remote runtime dependencies.

5. **Add import inventory and warnings.**

   Scraper/import should report unsupported source choreography and rich-motion
   surfaces as explicit findings: pinned scroll, text splits, Lottie/Rive,
   image sequences, canvas/WebGL, shader-like effects, and route transitions.
   The importer must not silently flatten these into static layout.

6. **Define runtime bundle and performance budgets.**

   Add size and runtime cost checks for each optional adapter family. Lottie is
   conditionally injected today; keep future adapter injection conditional too.

7. **Decide Layout Transition as its own ADR.**

   When templates need shared-target movement across route transitions,
   overlays, or component state changes, write the Layout Transition ADR before
   implementation. Keep it schema-owned; do not solve it with raw DOM scripts.

8. **Consider Swup only if its concerns become load-bearing.**

   Swup remains an approved future adapter for cache/preload/head/history
   concerns. It is not the current Route Transition runtime and should not
   replace the schema-owned contract by default.

## Non-Goals To Preserve

- No GSAP in core.
- No arbitrary Owner-uploaded runtime scripts.
- No silent fallback rendering for failed animation/runtime dependencies.
- No cross-document View Transition modes until identity, head, cache,
  hydration, and restore semantics are schema-owned.

