# Scroll Scene editor follow-up

## Done in this slice

- Added an Interactions panel Scroll Scenes surface for creating and editing a
  pinned Scroll Scene plus its linked Motion Sequence.
- Persisted `motionSequences` and `scrollScenes` through Yjs encode/decode.
- Added smoke coverage for the editor helper contract and Yjs round trip.
- Updated the designer fidelity gaps spec to mark the first editor authoring
  slice as addressed.
- Added a Text Split Target inspector path for word/line/character targets,
  backed by Motion Sequence steps and explicit runtime accessibility handling.
- Added Behaviour Load Experience editor controls for designer enter moments
  and linked `load-enter` Motion Sequence recovery.
- Added Runtime Hydrator boundary parity: editor render now consumes
  `window.__opencanvasHydrate`, matching visitor, live-publish, and route
  transition swap surfaces.
- Wired `runtime-hydrator-parity:smoke` into `ci:smoke`, so editor/visitor
  Runtime Hydrator drift fails in the normal gate.
- Added full Motion Sequence editor controls for schema-owned triggers, steps,
  targets, text-split units, numeric properties, duration, delay, stagger,
  easing, and reduced-motion policy.

## Next

- Extend the editor from first-step controls to full multi-step Motion Sequence
  editing for scroll-driven timelines.
- Add a visual timeline canvas, waits, repeats, yoyo/reverse, and richer
  text-specific effects.
- Add Behaviour Load Experience run policy, progress choreography, and
  media-readiness gates.
- Continue collapsing duplicated runtime adapter implementations behind shared
  generated modules.
