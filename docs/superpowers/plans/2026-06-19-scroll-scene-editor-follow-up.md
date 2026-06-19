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

## Next

- Extend the editor from first-step controls to full multi-step Motion Sequence
  editing for scroll-driven timelines.
- Add a parity smoke that exercises the same Runtime Hydrator path from editor
  preview and visitor output.
- Add a full timeline editor for multiple steps, waits, repeats, and richer
  text-specific effects.
