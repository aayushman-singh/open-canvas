# ADR 0083 - Interactive Vector Rich Motion adapter

**Status:** Proposed
**Date:** 2026-06-19
**Author:** Aayushman Singh
**Follows:** ADR 0072, ADR 0081

## Context

Designer templates often use Rive-style interactive illustrations: state-machine
mascots, product explainers, toggles, scroll-aware diagrams, and hover/click
illustrations. ADR 0072 names interactive vector animation as a Rich Motion
Asset family, but ADR 0081 keeps it rejected until a real adapter exists.

The key difference from passive vector animation is the state relation. The
Owner must be able to inspect which Interaction Triggers drive which named
inputs, states, or animations. If those relations live inside runtime-specific
files alone, the Agent cannot edit them, validation cannot prove them, and the
Published Site can silently render an illustration that never responds.

## Decisions

1. **`interactive-vector-animation` is a separate family from passive vector
   animation.**

   **Why:** passive playback and state-machine interaction have different
   contracts. Combining them would make simple vector playback carry
   state-machine complexity and make interactive failures harder to name. This
   would be wrong if every vector animation exposed the same trigger/input
   surface. They do not.

2. **The schema owns the state-machine binding relation.**

   **Why:** the Owner needs to see which Interaction Trigger drives which
   runtime input, and validation needs to reject missing state machines, missing
   inputs, and incompatible input types. This would be wrong if the runtime file
   were the source of truth. Open Canvas behaviour must be inspectable and
   editable.

3. **V1 bindings are explicit trigger-to-input writes, not arbitrary code.**

   **Why:** hover, click, viewport enter, scroll progress, and route/load events
   can map to named boolean, number, or trigger inputs without Owner-authored
   JavaScript. This preserves template fidelity while keeping CSP and validation
   intact. This would be wrong if templates required arbitrary imperative logic
   for the first interactive illustrations. They do not.

4. **Validation rejects unresolved state machines and inputs at the write gate.**

   **Why:** a missing state machine or input creates a Visitor-facing no-op.
   The failure must name asset id, element id when known, state machine, input,
   and binding path. This would be wrong if an inert illustration were an
   acceptable partial result. It is not.

5. **Editor preview and Published Site playback use the same Runtime Hydrator
   adapter.**

   **Why:** interaction bugs only show when the same triggers and runtime run.
   A static editor preview would not prove the Owner's bindings. This would be
   wrong if interactive vector assets were purely decorative. Their purpose is
   visitor interaction.

## Out of scope

- Passive vector animation metadata; ADR 0082 covers that family.
- Bounded 3D scenes.
- Arbitrary uploaded JavaScript.
- Runtime-specific scripting languages as Owner-authored behaviour.
- Building a Rive-style editor inside Open Canvas.
- Audio-reactive or network-driven inputs.

## Consequences

- The Rich Motion metadata union needs an interactive-vector-animation arm with
  state-machine name, input bindings, playback policy, poster, and reduced
  motion behavior.
- The validator must inspect enough runtime metadata to prove named state
  machines and inputs exist.
- The Runtime Hydrator must translate schema-owned Interaction Triggers into
  adapter input writes and emit named failures.
- Import can report Rive-style surfaces as interactive-vector findings instead
  of flattening them into embeds or video.

## Follow-ups

- Define binding shapes for boolean, number, and trigger inputs.
- Choose the bundled interactive-vector runtime and bundle budget.
- Add editor/published parity smoke coverage for each supported binding type.
- Add import inventory output for detected interactive vector surfaces.
