# ADR 0072 - Rich Motion Asset runtimes

**Status:** Accepted
**Date:** 2026-06-16
**Author:** Aayushman Singh
**Superseded (V1 only) by:** ADR 0081

## Context

The Owner-facing gap is rich animated media. Designer templates often use
Lottie-style vector animation, Rive-style interactive illustrations, image
sequence scrubs, canvas/WebGL scenes, particles, and 3D product moments. Today
Open Canvas supports image and video media, background video, iframe embeds, and
static SVG charts. Those are not enough to reproduce this class of reference
site.

The wrong shortcut is an "animation blob" field that accepts arbitrary files or
scripts. That would bypass asset lifecycle, CSP, editor preview, reduced-motion
handling, validation, and publish-time failure reporting. The correct product
concept is a Rich Motion Asset: owned media with a dedicated runtime and an
explicit playback contract.

The free runtime candidates are mature: lottie-web renders Bodymovin/Lottie
animations (<https://github.com/airbnb/lottie-web>), Rive publishes web
runtimes for interactive vector animations
(<https://github.com/rive-app/help-center/blob/master/runtimes/overview.md>),
and Three.js is MIT licensed for WebGL/3D scenes
(<https://github.com/mrdoob/three.js/blob/dev/package.json>).

## Decisions

1. **Rich Motion Asset is an Owner Asset category with a dedicated playback
   contract.**

   **Why:** the asset must survive across editable sites, publish snapshots, and
   visitor asset serving exactly like image and video assets. The difference is
   that rendering needs a runtime plus playback state. This would be wrong if
   rich animation were only a remote embed. The target templates need editable,
   previewable, schema-owned media.

2. **The first supported Rich Motion Asset families are vector animation,
   interactive vector animation, image sequence, and bounded 3D scene.**

   **Why:** these cover the common designer-site surface without opening raw
   script execution. Vector animation maps to Lottie-compatible runtimes;
   interactive vector animation maps to Rive-compatible runtimes; image sequence
   maps to local frame assets and scroll/time playback; bounded 3D scene maps to
   a declarative scene descriptor rendered by Three.js. This would be wrong if
   arbitrary uploaded JavaScript or shader code were required for the first
   templates. It is not.

3. **Playback is schema-owned and trigger-driven.**

   **Why:** a Rich Motion Asset needs controls the Owner can inspect: autoplay,
   loop, play once, viewport enter, hover, click, scroll progress, pause when
   hidden, speed, segment/state selection, and poster or static frame. Hiding
   those inside runtime-specific config makes the Agent and inspector blind.
   This would be wrong if the Owner never edits playback. They do.

4. **Runtime adapters may read asset bytes, but they do not own asset identity
   or publish reachability.**

   **Why:** Open Canvas already has Owner Asset visibility rules. A Rich Motion
   Asset must not fetch untracked remote dependencies at visitor time or become
   visible outside the current Published Snapshot. The runtime consumes bytes
   that asset storage has already made reachable. This would be wrong if these
   were third-party embeds. Embeds remain a separate element type.

5. **Editor preview and published render use the same Runtime Hydrator.**

   **Why:** rich media bugs are visual and timing-sensitive. An Owner cannot
   trust a Lottie/Rive/3D template if the editor uses a static stand-in while the
   visitor sees a different runtime. The editor may show a named load/error
   surface, but successful preview must be the same runtime contract. This would
   be wrong if rich media were decorative only. In designer templates, it is
   often central.

6. **Unsupported asset/runtime combinations fail validation or emit a named
   runtime failure event.**

   **Why:** a Lottie file with unsupported features, a Rive file without the
   named state machine, a missing image-sequence frame, or an invalid 3D
   descriptor should not quietly render blank. The validation or runtime event
   must name the asset id, element id, family, and failing phase. This would be
   wrong if blank media were an acceptable output. It is not.

7. **Custom shader code and arbitrary 3D scripts are out of core for this
   decision.**

   **Why:** Three.js can run almost anything, but Open Canvas should not accept
   arbitrary executable scene code as template data. A bounded declarative scene
   descriptor can cover product spins, particles, lighting, camera movement,
   and material controls while remaining inspectable. This would be wrong if the
   product intent were a code playground. It is a site builder.

## Out of scope

- Arbitrary uploaded JavaScript.
- Arbitrary uploaded GLSL shader code.
- Remote runtime dependencies fetched from asset files.
- Building a 3D editor.
- Rich Motion Asset marketplace.
- Audio-reactive visuals.
- GSAP or paid animation runtimes.

## Consequences

- Owner Asset needs typed rich-motion metadata and validation by family.
- Media Element or a future Rich Motion Element needs a playback contract that
  references Interaction Triggers and Motion/Scroll state.
- The public CSP must account for bundled runtimes without widening script
  execution to Owner-uploaded code.
- The editor needs load/error surfaces that identify the exact asset and phase.
- Import can map detected Lottie/Rive/canvas/video-sequence surfaces to explicit
  Rich Motion Asset findings instead of flattening them into images or embeds.
- Three.js enters as a renderer for bounded scene descriptors, not as permission
  to store executable scene code.

## Follow-ups

- Define the Rich Motion Asset metadata union.
- Define Lottie, Rive, image-sequence, and bounded-3D validation rules.
- Decide whether Rich Motion Asset playback lives on Media Element or a new
  element type.
- Add import inventory findings for detected rich-motion sources.
- Add bundle-size and performance budgets for each runtime family.
