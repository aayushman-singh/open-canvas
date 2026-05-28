# agent

## Definition

`agent` owns the constrained AI edit vocabulary for the canvas-first editor.
Given an Owner prompt and the current `EditableSite`, the HTTP route asks an
LLM for tool calls, translates those calls into typed `CanvasAgentOp`s, applies
them to a cloned canvas state, validates the result, and returns a preview for
the Owner to accept or dismiss.

The subsystem does not persist state, authorize callers, choose public routing,
or render HTML. Those decisions belong to the API routes, identity gate, public
router, and canvas renderer respectively.

## Active Nodes

- **`llm.ts`** -> provider-neutral streaming/tool-call interface.
- **`llm-gemini.ts`** -> Gemini adapter used by the canvas-agent route.
- **`canvas-tools.ts`** -> JSON-schema tool descriptions exposed to the model.
- **`canvas-ops.ts`** -> pure application of `rewriteText`, `replaceMedia`,
  and `insertSection` against a cloned `EditableSite`.
- **`canvas-agent-smoke.ts`** -> runtime smoke for recipe coverage, op
  application, and tool schemas.

## Inputs

- **Owner prompt** -> free-text intent from the editor.
- **Canvas outline** -> section and element ids from the current editable
  state, supplied by the API route.
- **LLM provider** -> text and function-call chunks.

## Outputs

- **Preview ops** -> typed, validated operations plus a preview state.
- **Loud errors** -> unknown tools, bad arguments, bad element ids, invalid
  rich text, missing assets, and validation failures are surfaced as explicit
  route errors.
