# ADR 0057 — Every canvas element dispatch shares one shape: mapped-type record, typed dispatcher, runtime guard

**Status:** Accepted
**Date:** 2026-06-02 (proposed); 2026-06-02 (accepted)
**Author:** Aayushman Singh
**Drives:** [ADR 0011](0011-canvas-element-registry.md) Follow-ups — "A small follow-up ADR … fixing the dispatch-entry shape convention … worth lifting into an explicit contract before three more dispatches inherit it by imitation." Six dispatches have now inherited the shape by imitation; this ADR pins it before a seventh ([ADR-γ](#follow-ups), Step 5 client renderer) lands with a different delivery mechanism and pulls the convention sideways.
**Accepted-context:** verified 2026-06-02 — all six dispatches obey the shape:
- `RENDER_DISPATCH` ([`src/canvas/elements/index.ts:172`](../../src/canvas/elements/index.ts)) — function-valued, consumed via `renderElementBody` ([`:153`](../../src/canvas/elements/index.ts)) with the canonical runtime guard at lines 158–168.
- `Y_ENCODE_DISPATCH` ([`src/canvas/yjs-projection.ts:747`](../../src/canvas/yjs-projection.ts)) — function-valued, consumed via `encodeElement` ([`:765`](../../src/canvas/yjs-projection.ts)) with the same guard at 769–775.
- `Y_DECODE_DISPATCH` ([`src/canvas/yjs-projection.ts:1328`](../../src/canvas/yjs-projection.ts)) — function-valued, consumed via `decodeElement` ([`:1346`](../../src/canvas/yjs-projection.ts)) with the same guard at 1348–1357.
- `INSPECTOR_DISPATCH` ([`src/canvas/elements/index.ts:241`](../../src/canvas/elements/index.ts)) — spec-object, with the one documented type-level Exclude (`collection`) named in the comment at 231–238.
- `SIDEBAR_DISPATCH` ([`src/canvas/elements/index.ts:296`](../../src/canvas/elements/index.ts)) — spec-object.
- `AGENT_TOOL_DISPATCH` ([`src/canvas/elements/index.ts:314`](../../src/canvas/elements/index.ts)) — spec-object.

## Context

[ADR 0011](0011-canvas-element-registry.md) Decision 2 says "a typed dispatch table per concern is the only way the rest of the system reaches into element-specific behavior" — and pins the mapped-type constraint as the load-bearing property that makes the registry better than the scattered switches it replaced. What ADR 0011 does *not* pin is the shape of the dispatch entries themselves: how the consumer indexes the record, how it handles an element with a `type` that fell out of the union at runtime (legacy data, failed migration, JSONB drift), whether `default:` arms are permitted, where entries live.

The first dispatch (RENDER) set a precedent. Three more (INSPECTOR, SIDEBAR, AGENT_TOOL) copied it; the yjs encoder/decoder pair followed the same shape independently. Six dispatches now use the same idiom by imitation, not by named contract. The next dispatch will inherit it the same way — *if the next author looks at the existing ones*. They won't necessarily look: ADR-γ's cross-server dispatch may live in a different file under a different delivery mechanism, and the convention will be tempting to skip.

This ADR lifts the implicit convention into an explicit one before a seventh dispatch ships and the shape forks.

## Decisions

1. **Every per-element-type dispatch is `Record<CanvasElement['type'], EntryT>`, indexed by `ElementType`.**

   **Why:** the mapped-type exhaustiveness check — "if `EntryT` is `function (el: …) → X`, then missing a case is a TypeScript compile error" — is the only property that makes the dispatch better than a `switch (element.type)` statement. A `Partial<Record<…>>`, a `Map<ElementType, …>`, or a plain object without the mapped type all lose the check and reintroduce the runtime-only failure mode the registry was built to eliminate. The mapped-type record is non-negotiable.

2. **An element-type opt-out is expressed as `Record<Exclude<CanvasElement['type'], 'X'>, EntryT>` with a comment above the dispatch type alias naming `'X'` and the reason.**

   **Why:** the only existing opt-out is `INSPECTOR_DISPATCH` excluding `'collection'` (children carry their own inspectors; a collection's own inspector would be a no-op). An implicit opt-out — `Partial<Record<…>>`, or a `?` entry — turns "we didn't get to it yet" and "we deliberately don't want one" into the same shape, which is the same problem ADR 0011 Decision 2 set out to solve. Forcing the Exclude into the type and naming it in a comment makes opt-outs reviewable.

3. **A dispatch that is indexed by a runtime `element.type` (function-valued, consumed against an element that came from JSONB) is read only through a typed dispatcher function that guards with `Object.hasOwn(DISPATCH, element.type)` + `typeof handler === 'function'`, and throws `Error("<dispatcher>: no <DISPATCH> entry for element type=… id=…")` on failure.**

   **Why:** an element whose `type` is not in the union at runtime is possible (stored sites pre-date a removed type; a failed migration; legacy data). Letting the implicit `undefined()` minify to `"fn is not a function"` is the worst-case failure mode in production — the message names neither the type nor the id, so triage starts from zero. The explicit guard makes the message one log line. `Object.hasOwn` (not `in`) is load-bearing: it sidesteps prototype-chain weirdness if the dispatch ever serializes through JSON. The pattern is identical across `renderElementBody`, `encodeElement`, and `decodeElement`; new function-valued dispatches join the same shape.

4. **No `default:` arm appears anywhere in the dispatch path — neither in the dispatcher function nor in any helper it calls.**

   **Why:** the all-or-nothing failure mode (per `CLAUDE.md` global preferences) is what makes drift visible. A `default:` substitutes a silent value for the explicit throw, masking exactly the drift the registry was built to surface. The dispatcher throws; the caller can choose to catch.

5. **Spec-object dispatches (consumed by iteration at build/emit time, not by indexing at runtime against a JSONB element) rely on the mapped-type exhaustiveness alone; no runtime guard is required.**

   **Why:** `INSPECTOR_DISPATCH`, `SIDEBAR_DISPATCH`, and `AGENT_TOOL_DISPATCH` are read by JSON-stringifying the record at emit time (canvas-client.ts inspector / sidebar interpolation, agent LLM tool-schema build). The consumer iterates entries it knows about statically; no JSONB-sourced `type` enters the lookup path. Adding a runtime guard there would catch a failure mode that can't reach the code. The mapped type plus the completeness smoke (Decision 7) is the entire gate.

6. **Dispatch entries are imports from per-element files (`./<type>.js`), not inline object literals in `elements/index.ts`.**

   **Why:** ADR 0011 Decision 1 says each element has one source-of-truth module that owns every behavior unique to that element. An inline entry in `elements/index.ts` breaks that source-of-truth — the per-element file no longer owns the entry, the registry does. The registry is a wiring harness, not a place behavior lives.

7. **Each dispatch ships a completeness smoke at `src/canvas/elements/<dispatch>-dispatch.smoke.ts` (or sibling) that iterates entries and asserts each one resolves and is not a stub.**

   **Why:** restated from [ADR 0011 Decision 4](0011-canvas-element-registry.md#decisions). The mapped type catches "case missing entirely"; the smoke catches "case present but stub" (returns empty, references a path the element doesn't have, names a handler that isn't registered). Both checks together are what make the dispatch worth more than the switch it replaced.

## Out of scope

- **Whether dispatch entries return values or push into shared mutable state.** Both shapes exist in the current six (renderer returns strings; the yjs encoders return `Y.Map`s; the inspector/sidebar/agent-tool entries are spec objects, not functions). Picking a winner is a per-concern decision, not a convention-wide one.
- **Whether the dispatch is read directly or via a typed dispatcher when consumed by iteration (Decision 5 case).** Spec-object dispatches today are read directly by their consumers (`Object.values(SIDEBAR_DISPATCH)` in `route.tsx`). Wrapping them in a thin dispatcher is acceptable but not required by this ADR.
- **Cross-server delivery of a dispatch** (Step 5 of ADR 0011 — the client renderer dispatch inside `canvas-client.ts`). That is [ADR-γ](0011-canvas-element-registry.md#follow-ups)'s scope; the dispatch shape behind that seam may diverge if delivery imposes it, and a separate ADR will name the divergence rather than letting it sneak in.
- **Dispatches keyed by something other than `ElementType`.** A future per-section-recipe dispatch, a per-page-layout dispatch, or any dispatch keyed by a different union is outside this ADR by definition. The convention extends in spirit but the type signature is different and may need its own decisions (especially around the opt-out shape).

## Consequences

**Positive:**

- The next dispatch has a checklist instead of a precedent to imitate. "Mapped-type record, typed dispatcher (if runtime-indexed), runtime guard with type+id, no default, imports from per-element files, completeness smoke" is reviewable line-by-line in a PR.
- The runtime guard pattern is one of the few places where copy-pasted code across modules is correct — making it a convention rather than fighting the duplication.
- An ADR-γ dispatch that ends up shaped differently is forced to name the difference (in its own ADR) rather than silently breaking the convention.

**Negative:**

- A future dispatch that legitimately wants a different shape (e.g. for performance reasons — `Map<ElementType, Fn>` for V8 monomorphism) has to write an ADR to opt out. Acceptable: the cost is one short ADR, the benefit is that the opt-out is visible.
- The completeness smoke (Decision 7) requires a fixture per element type per dispatch. Fixture maintenance is real ongoing cost; the existing `INSPECTOR_DISPATCH` smoke already pays it for that concern.

## Follow-ups

- When [ADR-γ](0011-canvas-element-registry.md#follow-ups) (cross-server enum / dispatch sharing) lands, name whether the cross-server dispatch obeys this convention or opts out, and document the reason inline.
- If a future dispatch is keyed by something other than `ElementType` (per-recipe, per-page-layout, …), write a sibling convention ADR rather than extending this one — the type signature is different enough that the decisions wouldn't transfer cleanly.
