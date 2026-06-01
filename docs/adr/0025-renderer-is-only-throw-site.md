# ADR 0025 — The renderer is the only throw site in the canvas subsystem; the validator never throws

**Status:** Accepted
**Date:** 2026-05-29 (proposed); 2026-06-01 (accepted)
**Author:** Aayushman Singh
**Drives:** lifts the renderer-throws / validator-collects contract from `src/canvas/SUBSYSTEM.md` into canon. Reinforces and extends [ADR 0012](0012-validation-write-gate.md)'s "trust the gate" stance with the symmetric statement about what the *renderer* is allowed to do.
**Accepted-context:** the original draft of Decision 1 read "every other file in `src/canvas/` returns errors or sentinels" and audited against 30+ `throw` statements in `src/canvas/elements/*.ts` (action / accordion / chart / code / embed / form / …). Those throws are agent-tool parser entry points (`parsePatch`, type-narrowed argument validators) called from `src/agent/canvas-tools.ts`, not from the renderer or the validator. Decision 1 is tightened to **renderer + validator only**; per-element agent parsers are explicitly carved out because their failure mode (the LLM produced a malformed patch payload) flows back to the agent loop as a retryable error, not to the visitor as broken HTML — a different failure-mode contract than the one this ADR governs. The carve-out is named inline in Decision 1.

## Context

[ADR 0012](0012-validation-write-gate.md) decided that `canvas/validate.ts` is the only write gate and that consumers downstream of the gate (renderers, encoders, agent handlers) trust the gate's output. That ADR specified what the *validators* do (collect all errors, never throw, produce uniform error strings). It did not specify what the *renderer* is allowed to do when it encounters an unexpected shape — because in principle, if the gate worked, the renderer never sees an unexpected shape.

In practice, the renderer is a pure function that takes a `(snapshot, styleKit, assets)` triple and emits HTML. If the gate failed (or was bypassed by a malformed DB row, a code path that skipped it, or a future bug), the renderer encounters input the type system says is impossible. The current code's answer is documented in `src/canvas/SUBSYSTEM.md`:

> "The renderer is the only place a throw is acceptable in this subsystem; the validator never throws."

That is a real architectural decision: a thrown error from the renderer signals "the gate failed somewhere upstream"; thrown errors from anywhere else in the canvas subsystem mean nothing actionable. Lifting the decision into canon makes the failure-mode contract explicit and prevents future contributors from sprinkling `throw` statements through the canvas subsystem as a perceived "extra safety" layer.

## Decisions

1. **`src/canvas/render.ts` is the only renderer-path file in the canvas subsystem allowed to `throw` on Owner-content shape violations.** `validate.ts`, `style-kits.ts`, `recipes.ts`, and every other file the renderer-path consumes operates on validated input by contract; if they encounter something unexpected, the right response is to return an error description, not to throw — because the caller (the validator, the renderer, the agent) is the one with the context to decide what to do. A `throw` in the renderer is an explicit "this should be unreachable — the validator should have caught it" signal.

   **Why:** the renderer is the last gate before HTML reaches the visitor. A malformed snapshot that reaches the renderer cannot produce valid HTML; emitting partial HTML or silently substituting defaults would hide a real failure. Throwing surfaces the failure to the request handler, which can return a 5xx with a useful error message rather than serving broken HTML.

   This would be wrong if any canvas file legitimately needed to short-circuit beyond its caller's knowledge. None of the renderer-path files do today; if one does in the future, the decision is "add a controlled throw with an explicit comment citing this ADR" rather than "loosen the rule."

   **Per-element agent-parser carve-out.** The `parsePatch` entrypoints inside `src/canvas/elements/*.ts` (action, accordion, chart, code, embed, form, table, carousel, text, container, shape, media, nav, collection) DO `throw` on malformed inputs. They are not renderer-path files — they are agent-tool argument validators called from `src/agent/canvas-tools.ts` to type-narrow the LLM-produced patch payload before it lands in `editableState`. A throw there flows back to the agent loop as a retryable tool error ("your patch was malformed; here is why"), never to the visitor as broken HTML. That failure-mode contract is materially different from the renderer's — the renderer's throw is a 5xx to the visitor; the agent parser's throw is a re-prompt to the LLM. The carve-out is therefore deliberate. If a future contributor wants to move per-element parsers to result-typed (e.g. as part of [ADR 0011](0011-canvas-element-registry.md) Step 5), nothing in this ADR forbids it — but neither does this ADR demand it.

2. **`src/canvas/validate.ts` (and any sibling validator) collects every error in a single pass and returns `{ valid: true } | { valid: false, errors: string[] }`. It never throws, never short-circuits on the first error.** The full picture matters more than fail-fast.

   **Why:** the validator is consumed by the editor (which shows the Owner every error at once so they can fix all of them in one session) and by the smoke (which wants the full picture for a single seed). Fail-fast would force the Owner to fix-and-resave once per error, which is hostile to iteration. The validator's signature reflects this commitment — there is no path through it that throws.

3. **Style Kit changes are deterministic and require lockstep updates to the kit registry + the validator + the renderer.** Adding a new kit variant means editing all three; the canvas smoke catches any miss because its round-trip exercises all three.

   **Why:** the kit registry says "these are the valid kit names"; the validator says "the snapshot's kit must be one of these"; the renderer says "render each kit's CSS." A kit added to the registry but not the validator gets silently rejected. A kit added to the registry and validator but not the renderer renders to blank CSS. The lockstep is a real coupling; the smoke is its enforcement. This decision pins the coupling explicitly so it does not erode.

## Out of scope

- The validator's exhaustiveness over schema fields ([ADR 0012](0012-validation-write-gate.md) decision 2 handles that).
- The renderer's purity (it is a pure function of its inputs; that is a long-standing invariant not under threat).
- Throws in other subsystems (auth, db, routes, live). Those have their own conventions and are not constrained by this ADR.
- Specific error message formats — [ADR 0012](0012-validation-write-gate.md) decision 4 handles validator errors; renderer throws use a more freeform error message because they are signalling a contract violation, not user-fixable input errors.
- Logging or telemetry on renderer throws — operator concern; this ADR specifies the contract, not the alerting story.

## Consequences

**Positive:**
- The canvas subsystem has a single, predictable failure-mode contract. A new contributor reading the code knows: "if I want to signal an error inside the canvas subsystem, I return a result; if I'm in the renderer and the input is structurally impossible, I throw."
- Defensive `try/catch` blocks around canvas calls become unnecessary — callers know exactly when a throw can happen (renderer only) and can wrap one call site, not the whole subsystem.
- Style Kit additions are gated by the smoke. A kit added in registry but missing from validator or renderer fails CI immediately.

**Negative:**
- A renderer throw produces a 5xx for the visitor — there is no in-renderer recovery. The decision accepts this because the alternative (partial HTML, default substitution) is worse: the Owner sees a published site that looks wrong but does not know why. A loud 5xx surfaces the issue immediately; the operator sees it in `wrangler tail`; the visitor sees nothing rather than something broken.
- Style Kit lockstep adds friction to "just try a new kit experimentally." Every experiment is a three-file edit. The smoke is the brake; the brake is intentional because kit drift produces visible bugs the Owner notices.

## Follow-ups

- Delete `src/canvas/SUBSYSTEM.md` (its content is now in this ADR plus the file table which duplicates `ls src/canvas/` and the domain language which lives in `docs/CONTEXT.md`).
- If a renderer throw ever reaches a Visitor in production, treat it as a P1 — the validator missed a case the gate was meant to catch. The fix is in `validate.ts`, not in the renderer's throw site.
- The Style Kit smoke (`bun run canvas:smoke`) should be the only pre-deploy check needed to certify kit additions. If a kit change passes the smoke and breaks at runtime, the smoke needs strengthening.
