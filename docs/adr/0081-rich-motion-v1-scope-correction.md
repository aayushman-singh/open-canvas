# ADR 0081 - Rich Motion Asset V1 scope correction

**Status:** Superseded
**Date:** 2026-06-19
**Superseded by:** the shipped Rich Motion adapter catalog on main

## Context

ADR 0081 originally narrowed Rich Motion Asset V1 to `image-sequence` because
metadata-only acceptance for Rive, Lottie, and bounded 3D would have created
silent blank rendering. That correction was valid for the image-sequence slice:
Open Canvas must reject unsupported rich-motion kinds until each kind has schema,
validation, render metadata, Runtime Hydrator dispatch, editor/published parity,
and named failure events.

The consolidated main branch now includes concrete adapter kinds beyond
`image-sequence`:

- `rive`
- `lottie`
- `model-3d`
- `shader-scene`
- `video-stream`

## Decision

ADR 0081 no longer defines the active V1 catalog as image-sequence-only. The
active contract is the shipped `RICH_MOTION_KINDS` catalog, gated by
`src/canvas/adr-0072-rich-motion-scope.smoke.ts`.

Unknown conceptual family labels such as `vector-animation` remain rejected
until they are expressed as concrete Open Canvas adapter kinds with full schema,
validator, renderer, and Runtime Hydrator support.

## Consequences

- The validator accepts only the shipped concrete adapter kinds.
- Published rich-motion elements must reference a declared Rich Motion Asset.
- The Runtime Hydrator dispatches every declared kind and emits
  `rich-motion-unsupported-kind` if an unsupported kind reaches runtime.
- ADR 0081 remains as the historical reason metadata-only acceptance is not
  allowed.
