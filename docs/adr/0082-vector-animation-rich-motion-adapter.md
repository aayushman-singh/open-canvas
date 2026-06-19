# ADR 0082 - Vector Animation Rich Motion adapter

**Status:** Proposed
**Date:** 2026-06-19
**Author:** Aayushman Singh
**Follows:** ADR 0072, ADR 0081

## Context

Owners need Lottie-style vector animation surfaces for designer templates:
logo draws, icon loops, decorative scene motion, and branded loading moments.
ADR 0072 names vector animation as a Rich Motion Asset family, but ADR 0081
keeps V1 image-sequence-only until each additional family has real metadata,
validation, Runtime Hydrator playback, editor/published parity, and named
failure events.

The wrong implementation is to accept arbitrary animation JSON as an opaque
blob and hope the visitor runtime can render it. That hides unsupported features,
remote asset references, bundle/CSP needs, and reduced-motion behavior from the
Owner and Agent. Vector animation must become a schema-owned Rich Motion Asset
adapter, not an embed or custom script.

## Decisions

1. **`vector-animation` is accepted only when the bundled adapter ships.**

   **Why:** accepting the family before playback exists would recreate the
   exact blank-rendering failure ADR 0081 prevents. This would be wrong if
   metadata alone were useful to Owners. It is not; a playable template is the
   user-visible outcome.

2. **The asset metadata owns the vector document and playback contract.**

   **Why:** the Owner and Agent need inspectable controls: autoplay, loop,
   speed, segment, viewport-enter, pause-when-hidden, poster frame, reduced
   motion behavior, and accessible label. Runtime-specific config remains
   behind the adapter. This would be wrong if vector animation were only a
   static media file; it is timed behaviour.

3. **Validation parses enough of the vector document to reject unsupported
   dependencies before publish.**

   **Why:** a vector animation that references remote images, external fonts, or
   unsupported renderer features must not pass the write gate and fail blank for
   Visitors. Validation must name asset id, element id when known, family, and
   failing field. This would be wrong if the adapter could safely ignore missing
   parts. It cannot.

4. **Editor preview and Published Site playback use the same Runtime Hydrator
   adapter.**

   **Why:** Owners judge rich motion visually. A separate editor placeholder
   would give false confidence and violate ADR 0072. The editor may show a
   named load/error surface, but successful preview must use the visitor
   adapter. This would be wrong if vector animation were decorative only. In
   designer templates it often carries brand identity.

5. **The adapter fetches only Published Snapshot-reachable Owner Asset bytes.**

   **Why:** asset reachability and CSP must stay with Open Canvas. Vector
   playback cannot fetch remote dependencies from the uploaded document or widen
   script execution to Owner data. This would be wrong if vector animations were
   third-party embeds. They are Owner Assets.

## Out of scope

- Interactive vector state machines.
- Bounded 3D scenes.
- Arbitrary uploaded JavaScript.
- Remote runtime dependencies referenced by animation files.
- A vector animation editor.
- Audio-reactive playback.

## Consequences

- `RICH_MOTION_KINDS` can add `vector-animation` only in the adapter slice.
- The Rich Motion metadata union needs a vector-animation arm with playback,
  poster, reduced-motion, and validation fields.
- The Runtime Hydrator gains a vector adapter and named failure codes for parse,
  asset dependency, runtime load, and playback failures.
- Import can report Lottie-compatible surfaces as vector-animation findings
  instead of flattening them into images.

## Follow-ups

- Define the exact metadata arm and validator.
- Choose the bundled vector runtime and bundle budget.
- Add editor/published parity smoke coverage.
- Add import inventory output for detected vector animation surfaces.
