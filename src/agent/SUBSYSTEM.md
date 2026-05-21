# agent

## Definition

`agent` owns the AI collaborator that edits a rev01 page on the user's behalf. Given a natural-language prompt from a signed-in editor sitting on a specific page, the agent reasons about that page's current document, picks one or more document operations from a tight constrained vocabulary, applies each operation against the live multiplayer state at a reserved participant identity, and explains what it did. The subsystem makes no decisions about how the document is stored, transported, or merged — those belong to `multiplayer` — no decisions about who is allowed to drive it or which page is targeted — those belong to `api` and the identity gate — and no decisions about how the user types in a prompt or watches the edits land — those belong to `editor`. It is purely the reasoning + tool-execution surface for "you and the agent edit the same document."

The choice of LLM is intentionally pluggable: the orchestrator depends on an `LlmAdapter` interface (`src/agent/llm.ts`) and nothing about a specific provider. The default adapter calls Google Gemini 2.5 Pro via `@google/genai`'s functional calling. Swapping to Anthropic Claude or OpenAI later is a new file implementing the same interface plus a one-line wiring change at the call site; no orchestrator changes.

The v0 tool surface is five operations: `setHeadingText`, `setParagraphText`, `insertSection`, `removeSection`, `setActionLabel`. Every tool maps 1:1 to a typed `DocOp` variant; every `DocOp` is pure-data applyable to a `DocumentJSON` (so the orchestrator can dry-run + validate before touching the live state) AND applyable to a live `Y.Doc` over the existing ProseMirror binding (so the actual mutation broadcasts on the multiplayer wire). Three of the five operations are idempotent — re-applying `setHeadingText`, `setParagraphText`, or `setActionLabel` with the same arguments produces no semantic change. `insertSection` and `removeSection` are NOT idempotent; the orchestrator therefore prompts the model to confirm before destructive operations and the validator rejects removing the last remaining section.

## Inputs

- **editor (signed-in user)** → a natural-language prompt for a specific page, scoped to one editor seat.
- **api (Worker)** → the resolved page identity, the current `DocumentJSON` from Postgres, and an `applyOp(op)` callback that hits the page's multiplayer owner over an internal RPC.
- **LLM provider (Gemini today)** → reasoning over the prompt, the system instruction, and the document outline, returning a stream of text parts and function-call parts plus a finish reason.

## Outputs

- **editor (signed-in user) via the Worker stream** → a sequence of `AgentEvent`s (`thinking`, `text`, `tool_call`, `tool_result`, `done`, `error`) describing what the agent is doing in real time.
- **multiplayer (live Y.Doc for the page)** → typed document operations applied at the reserved Yjs `clientID = 1`, broadcast to every connected editor over the same WebSocket wire as a human keystroke.
- **operator / logs** → loud diagnostics on LLM failures, ownership-check rejections from upstream, validator rejections that would have produced an invalid `DocumentJSON`, and DO RPC failures. No silent fallbacks.

## Loop semantics

Multi-turn dialog capped at six turns. Each turn the orchestrator calls the LLM with the full conversation history (user prompt, prior assistant text + tool calls, prior tool responses) and a compact JSON outline of the current document (sectionIndex / kind / block previews — NOT the full doc). For each tool call returned, the orchestrator parses the arguments into a typed `DocOp`, dry-runs the op against the in-memory `DocumentJSON`, validates the result with `validateDocument`, and only then hits `applyOp` to mutate the live state. If parsing, application, validation, or the live apply fails, the orchestrator emits a `tool_result` event with the error AND feeds the error back to the LLM as a tool response so the model can self-correct on its next turn. The loop terminates when a turn produces no tool calls (the model is done talking) or when the six-turn cap is hit.

## Why this shape

- A constrained tool vocabulary keeps the model from emitting raw document JSON that would have to be re-parsed and re-validated. Every output is well-formed by construction.
- Dry-running each op against the pure-data `applyDocOp` before touching the live `Y.Doc` means an invalid op is rejected without polluting the multiplayer state; the user sees a tool-result error in the chat panel, not a half-edited document.
- The reserved agent identity (`clientID = 1`) means agent edits and human keystrokes use the same wire format and the same broadcast path — the editor doesn't need a separate "agent update" channel, and the avatar list naturally shows the agent alongside humans.
- The model-agnostic adapter pattern decouples the loop from any specific LLM. The Gemini implementation is one file; swapping to Anthropic Claude or OpenAI later is another file plus one line at the call site.
