# ADR 0084 - Bounded 3D Rich Motion adapter

**Status:** Proposed
**Date:** 2026-06-19
**Author:** Aayushman Singh
**Follows:** ADR 0072, ADR 0081

## Context

Designer templates use bounded 3D moments for product spins, layered object
scenes, scroll-progress depth changes, simple particles, and hero canvases. ADR
0072 names bounded 3D scene as a Rich Motion Asset family, but ADR 0081 keeps it
rejected until Open Canvas has a declarative adapter with validation and Runtime
Hydrator parity.

The dangerous shortcut is accepting arbitrary Three.js, Spline, shader, or
canvas code. That would move behaviour outside the Editable Site schema, widen
CSP, and make validation impossible. The product need is not a code playground;
it is a bounded, inspectable 3D media primitive.

## Decisions

1. **`bounded-3d-scene` is a declarative Rich Motion Asset family, not uploaded
   executable scene code.**

   **Why:** Owners need editable, reusable 3D moments with predictable publish
   behavior. Arbitrary scripts would bypass validation and asset reachability.
   This would be wrong if Open Canvas were a creative coding host. It is a site
   builder.

2. **The scene descriptor owns only bounded scene graph, camera, lighting,
   material, and playback fields.**

   **Why:** product spins, simple staged scenes, and scroll depth effects need a
   small inspectable relation, not the entire 3D runtime surface. This would be
   wrong if first-template fidelity required arbitrary shaders or procedural
   code. It does not.

3. **All referenced model, texture, and poster bytes are Owner Assets reachable
   from the Published Snapshot.**

   **Why:** the adapter must not fetch remote dependencies hidden inside model
   files. Missing assets fail validation or emit named runtime failures with
   asset id, element id, family, and phase. This would be wrong if 3D assets
   were third-party embeds. They are Owner-owned media.

4. **V1 interaction is limited to schema-owned playback drivers.**

   **Why:** autoplay, loop, hover pause, pointer orbit, click toggle, viewport
   enter, and scroll progress can cover the first bounded 3D moments while
   keeping the trigger relation inspectable. This would be wrong if arbitrary
   visitor-driven scripts were required for the first templates. They are not.

5. **Performance budgets are validation inputs, not best-effort runtime
   warnings.**

   **Why:** a 3D scene can harm the Published Site even when it technically
   renders. Geometry, texture, animation, and canvas-size limits must fail
   publish with named context instead of silently producing a slow page. This
   would be wrong if runtime degradation were acceptable. It is not.

6. **Editor preview and Published Site playback use the same Runtime Hydrator
   adapter.**

   **Why:** framing, asset loading, and interaction are the product surface.
   Owners must preview the same adapter Visitors run. This would be wrong if 3D
   were only a static poster. It is rich motion.

## Out of scope

- Arbitrary uploaded JavaScript.
- Arbitrary uploaded GLSL shader code.
- A full 3D editor.
- Spline or external scene embeds as core Rich Motion Assets.
- Physics engines.
- Audio-reactive visuals.

## Consequences

- The Rich Motion metadata union needs a bounded-3d-scene arm with descriptor,
  asset references, playback policy, interaction policy, poster, and reduced
  motion fields.
- Validation must enforce descriptor shape, asset reachability, and performance
  budgets before publish.
- The Runtime Hydrator gains a bounded 3D adapter and named failure events for
  descriptor parse, asset load, renderer init, and playback phases.
- Import can report WebGL/Spline/3D surfaces as bounded-3D findings without
  accepting untrusted code.

## Follow-ups

- Define the scene descriptor grammar and performance budgets.
- Choose the bundled 3D runtime adapter and bundle budget.
- Add editor/published parity smoke coverage for poster, load, orbit, and scroll
  progress playback.
- Add import inventory output for detected bounded 3D surfaces.
