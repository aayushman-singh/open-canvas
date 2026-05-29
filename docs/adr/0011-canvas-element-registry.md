# ADR 0011 — Canvas element registry as the single source of truth per element type

**Status:** Proposed
**Date:** 2026-05-28
**Author:** Aayushman Singh
**Drives:** the systemic per-element-drift finding from the rev01 OSS code review (handoff-rev01-batch-27 §"THE SYSTEMIC FINDING").

## Context

An Owner who asks for a new element type — say, a "video gallery" — expects a single coherent behavior across the editor and the visitor: the sidebar lets them drop one onto the page; the inspector lets them edit its properties; the visitor sees it render the same way the editor previews it; the AI assistant can read about it and emit one when asked. When any one of those surfaces lags behind, the Owner sees the bug as "rev01 is broken" — not as "rev01 forgot to wire one of fourteen places."

Today, adding or modifying a single element type requires synchronized edits across **fourteen** locations:

1. `src/canvas/schema.ts` — `ELEMENT_TYPES` + union type
2. `src/canvas/validate.ts` — element-type case in the validator
3. `src/canvas/elements/X.ts` — server-side renderer
4. `src/canvas/render.ts` — wrapper attributes + ARIA
5. `src/editor/canvas-client.ts` `buildXBody` — client-side renderer (mirrors #3)
6. `src/editor/canvas-client.ts` `buildXInspector` — inspector spec
7. `src/editor/canvas-client.ts` — context-menu actions
8. `src/editor/route.tsx` — sidebar drop-in button
9. `src/editor/canvas-styles.ts` — editor-only CSS
10. `src/canvas/public-styles.ts` — visitor-only CSS
11. `src/canvas/yjs-projection.ts` — Yjs encoder
12. `src/canvas/yjs-projection.ts` — Yjs decoder
13. `src/interactive/X.ts` — runtime-bearing elements only (popup, accordion, …)
14. `src/agent/canvas-tools.ts` — LLM JSON-schema + `src/agent/tool-parsers.ts` — LLM apply path

The verification pass (`handoff-rev01-batch-28` §4 row 8) confirmed that the server renderer and client renderer are still independent functions for every element type — `buildTextBody` lives at `src/editor/canvas-client.ts:1462`, `renderText` at `src/canvas/elements/text.ts`, and neither knows about the other. A drift in either one produces an editor/visitor visual divergence the Owner sees as a bug.

A partial registry exists: `RENDER_DISPATCH` (`src/canvas/elements/index.ts:137`) ties element type to server renderer with a `RenderDispatch` mapped type that fails to compile if a case is missed. That mechanism works for the server path. The other thirteen drift loci have no equivalent.

## Decisions

1. **Each element type has exactly one source-of-truth module that defines every behavior unique to that element.**

   **Why:** the only stable property of "what makes a video-gallery element a video-gallery" is the bundle of behaviors that move together — render shape, valid shape, inspectable fields, JSON-schema, encoder/decoder, sidebar label. Splitting those across fourteen files means the cost of adding an element is fourteen edits in fourteen mental models; bundling them collapses that to one file plus one registry entry. The module's exports describe the element to the rest of the system; the rest of the system reads only those exports.

   This would be wrong if elements legitimately needed independent lifecycles for their render and validate code (for instance, if validation were so heavy it needed to live behind an async boundary while rendering was sync) — but rev01's elements do not split that way. Every behavior in the list above is synchronous, pure, and depends only on the element's own data plus a small shared context.

2. **A typed dispatch table per concern is the only way the rest of the system reaches into element-specific behavior.**

   **Why:** the existing `RENDER_DISPATCH` is the existence proof: a `Record<ElementType, Fn>` typed via a mapped type makes "forgot to handle the new element type" a compile error, not a production crash. The decision here generalizes that idiom: one mapped-type dispatch table per concern (`RENDER_DISPATCH`, `VALIDATE_DISPATCH`, `INSPECTOR_DISPATCH`, `AGENT_TOOL_DISPATCH`, `YJS_ENCODE_DISPATCH`, `YJS_DECODE_DISPATCH`, etc.), each populated by one module per element. A consumer that needs to switch on element type imports the dispatch and indexes it; a consumer that does not need to switch imports nothing.

   The compile-time exhaustiveness check is the load-bearing property. If we shipped dispatches as plain dictionaries without the mapped-type constraint we would lose the only guarantee that makes the registry better than the existing scattered `switch` statements.

3. **Migration converts one concern at a time, starting with the concerns that block other ADRs.**

   **Why:** a single big-bang migration that moves all fourteen loci at once is the kind of churn that loses information — diff review breaks down, and any one mistake takes the whole change down. The drift is locus-by-locus, so the fix is locus-by-locus. Order:

   1. Inspector dispatch (`buildXInspector` from `canvas-client.ts` into per-element modules) — chosen first because it is the highest-frequency edit when product asks for "make the gallery have a caption field" type changes.
   2. Agent tool dispatch (`agent/canvas-tools.ts` JSON-schemas + `agent/tool-parsers.ts` apply paths) — second because it is currently the worst-coupled to schema.ts inline-string descriptions and unblocks ADR-γ.
   3. Sidebar/context-menu dispatch (`route.tsx` buttons + `canvas-client.ts` menu actions) — third because it is mechanical and once done removes the "added a type, forgot the button" failure mode entirely.
   4. Yjs encoder/decoder dispatch (`canvas/yjs-projection.ts`) — fourth, smaller surface but the failure mode (silent data loss on round-trip) is the highest-severity.
   5. Client renderer dispatch (`buildXBody` from `canvas-client.ts` into a build-time-injected client dispatch) — last because it depends on ADR-δ (inline-asset build pipeline) to even be expressible; today the dispatch cannot import TS modules because `canvas-client.ts` is a template literal.

   Each step ships independently and lands a smoke that pins its dispatch's completeness. Steps 1–4 do not need any of the other ADRs to land first.

4. **Each migration step ships with a "completeness smoke" that iterates the dispatch and asserts every entry resolves.**

   **Why:** the mapped-type check catches the "case missing entirely" failure mode. It does not catch the "case present but stub" failure mode (returns empty string, returns `undefined`, throws "not implemented"). A smoke that takes a fixture of one element per type and runs each dispatch entry over the matching fixture is the cheapest way to keep "the dispatch claims fourteen entries; one of them silently does nothing" out of the codebase. The smoke is small (~30 lines), runs in CI, and is the documentation of what every dispatch actually has to do.

5. **The registry does not own cross-server distribution; ADR-γ does.**

   **Why:** the client renderer dispatch (decision 3 step 5) is structurally the same shape as the server renderer dispatch, but the *delivery mechanism* — how a dispatch table defined in TS lands inside the `canvas-client.ts` template literal that the editor ships as a Worker — is a separate concern with its own design space (build-time substitution vs. true source split vs. dispatch-as-JSON-payload). Bundling that decision into this ADR would lock the registry shape to one specific delivery story. Keeping it out means the registry can land for the server-only consumers (validate, agent, yjs, render) immediately, and the client side picks up the same registry once ADR-γ chooses a delivery mechanism.

## Out of scope

- Which library or pattern defines the per-element module (interface vs. abstract class vs. plain object literal — the constraint is "is reachable by the dispatch" not "looks a specific way").
- Backwards-compatible wire format for stored sites — the on-disk shape of `CanvasElement` does not change.
- Inspector UI redesign — only the *dispatch* of "given element X, here is its inspector spec" moves. The UI that renders that spec stays put.
- Adding new element types — this ADR makes adding them cheaper; it does not propose any.
- The five "legacy original" element types (text, media, action, shape, container) keeping their type defs in `schema.ts` rather than per-element files — that is a separate cleanup, orthogonal to dispatch structure.

## Consequences

**Positive:**

- Adding a new element type drops from a fourteen-file change to a one-file-plus-one-registry-line change. The Owner-perceived "rev01 forgot to wire X" bug class disappears at the type system level.
- Each dispatch's completeness smoke turns "the registry claims to handle X but the function is a stub" into a build-time failure.
- The per-element module becomes the natural place to document the element's invariants (what its props mean, what the renderer guarantees), which today are scattered across the fourteen loci.
- Consumers that today do `switch (el.type)` (validate.ts is the biggest one) become `DISPATCH[el.type]` calls — easier to read and impossible to forget a case.

**Negative:**

- Per-element modules accumulate dependencies on every concern they own (renderer needs DOM/string utils, validator needs validation helpers, inspector spec needs UI metadata, agent tool needs JSON-schema). Module size grows; perceived cohesion may drop until readers internalize "this file IS the element."
- The migration phase has two registries for the same concern live simultaneously (old `switch`, new dispatch). Smokes must pin both during the transition or the new dispatch can disagree silently with the old `switch` until the cutover removes the switch.
- Compile-time exhaustiveness depends on `ElementType` staying a closed union. The day someone wants a plug-in element type loaded at runtime, the contract breaks (acceptable — that day deserves its own ADR).
- A bad initial choice of "what fields each dispatch returns" propagates through every element module. The first dispatch (inspector) sets the precedent; later dispatches will be pressured to match its shape even if their natural shape differs.

## Follow-ups

- ADR-γ (cross-server enum / dispatch sharing) — required before step 5 (client renderer dispatch) of the migration can land.
- ADR-δ (inline-asset build pipeline) — required by ADR-γ; transitively required by step 5.
- A small follow-up ADR or in-code policy doc once the first dispatch ships, fixing the dispatch-entry shape convention (what each entry returns, how it gets its context, how errors surface). That convention is implicit in the first migration step and worth lifting into an explicit contract before three more dispatches inherit it by imitation.
- A smoke that asserts every `ElementType` literal has a per-element module file at `src/canvas/elements/<type>.ts` (or is one of the five legacy types in `schema.ts`). Catches "added the type to the union, forgot the file" in CI.
