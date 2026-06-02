# ADR 0056 — Summarisation and read-only inspection iterations run on Flash; planning iterations run on Pro

**Status:** Accepted
**Date:** 2026-06-02 (proposed); 2026-06-02 (accepted)
**Author:** Aayushman Singh
**Drives:** with ADR 0055 lengthening the agent's stamina contract (a turn may now run twenty iterations instead of five), every iteration today still pays `gemini-2.5-pro` prices. Read-only inspection and history summarisation are low-stakes synthesis tasks where Pro's reasoning is wasted; tier routing recovers most of the added cost without quality loss on the planning path.

## Context

ADR 0055 removed the five-iteration cap and pinned a budget-shaped stop condition. Long revamps now finish. The cost trade-off it accepted: a worst-case turn on Pro is in the low single-digit dollars, affordable but not free.

Two iteration shapes do not benefit from Pro-tier reasoning:

- **Summarisation.** The summarisation call inside [`orchestrator.ts:summariseIfNeeded`](../../src/agent/chat/orchestrator.ts) is a constrained text-to-text synthesis with a prompt that explicitly instructs "summarise in 6-10 short bullets, preserve element / section / asset ids." Flash handles this within the quality envelope summarisation needs.
- **Inspection.** The model's "let me look around before I plan" calls to `query_site` and `query_assets` are read-only and rarely require planning-grade reasoning. The model only needs to surface element IDs and asset IDs into its working context for the next planning iteration to operate on.

The remaining iterations — proposing mutating ops, picking which section to redesign, sequencing dependent edits — are exactly the kind of multi-step planning where Pro's reasoning earns its cost. Routing those to Flash regresses revamp quality.

## Decisions

1. **Summarisation runs on `gemini-2.5-flash`.** The Gemini call inside `summariseIfNeeded` uses Flash regardless of the orchestrator's primary model.

   **Why:** summarisation is bounded, prompt-led, no tools, no chained reasoning. Flash handles it at a fraction of Pro's cost. The summary feeds back into the next planning iteration on Pro; quality at that downstream step is what matters, and a Flash summary of recent turns is sufficient context for the Pro planner.

   This would be wrong if summarisation quality were measurably degraded enough to mislead the downstream Pro planner — for example, if Flash routinely lost element-ID references the planner needed. Mitigation: the summarisation prompt explicitly instructs preservation of IDs ([`orchestrator.ts:616`](../../src/agent/chat/orchestrator.ts)); a pre-flight smoke verifies one Flash summarisation round-trip on a 20-turn fixture retains every ID present in the input. Loud summarisation failure (ADR 0055 decision 5) catches the empty / errored case before the planner consumes it.

2. **Read-only inspection iterations route to Flash. An iteration is classified as "read-only inspection" *after* its tool-call set is observed: if every tool call the model emitted on iteration N was read-only (`query_site`, `query_assets`), then iteration N+1 runs on Flash. The classification is reactive, not predictive.**

   **Why:** the orchestrator cannot know which tools the model will call in advance. The tier choice for iteration N+1 is made after iteration N's tool calls are observed. The first iteration after a fresh user message defaults to Pro — the model decides whether to inspect or propose; that decision itself belongs on Pro because misclassifying "this needs inspection first" as "this is read-only inspection" would route the wrong iteration to Flash.

   This would be wrong if the model mixed read-only and mutating calls within a single iteration regularly. In practice it does not — when the model has enough context to propose, it stops calling read-only tools and emits proposals; when it does not, it calls only read-only tools. The reactive heuristic matches the observed tool-use pattern.

3. **Tier choice is internal to the orchestrator. No env flag, no per-request override, no client-visible toggle.**

   **Why:** this is a cost optimisation, not a product feature. Surfacing it as a setting invites support load where an Owner has "tried disabling tier routing." The orchestrator owns the choice; smokes pin the chosen model per iteration for deterministic tests via the existing `model` override on `OrchestratorContext`.

   This would be wrong if a measurable Owner cohort needed deterministic per-call model choice for compliance or reproducibility reasons. That cohort does not exist today; revisit when it does.

## Out of scope

- Routing to non-Gemini providers. This ADR only pins Gemini tier choice; multi-provider routing is its own cluster.
- Adaptive cost limits — e.g., "Owner has spent $X this month, throttle harder." Owned by a future entitlement ADR.
- Quality-regression telemetry on tier-routed iterations. Worth doing; deferred to a follow-up so this ADR does not bundle measurement infrastructure with the routing decision itself.
- The Gemini 3.x migration. Adapter constraints (`thought_signature` round-trip) are owned by their own future ADR; this ADR pins Flash/Pro within the 2.5 family.

## Consequences

**Positive:**
- Per-turn cost drops substantially. Inspection iterations and summarisation together account for the majority of token volume on long revamps; routing them to Flash captures most of the cost win.
- The cost increase from ADR 0055's stamina extension is largely offset.
- Tier choice is observable in the SSE stream (a `model` field on each iteration's `done` event tells the Owner what ran).

**Negative:**
- Two model IDs in play introduce a small protocol risk: the Flash adapter's response shape must match Pro's for the orchestrator to consume without branching. Both share the `@google/genai` SDK and the same `chatWithTools` signature, so the risk is bounded.
- A Flash summary that omits a key ID degrades the next planning iteration. Mitigation: the smoke for decision 1; loud summarisation failure (ADR 0055 decision 5) catches the worst case.
- Cost variance widens. A workload that's "all planning, no inspection" sees less cost reduction than a workload that's "lots of inspection, light planning." Per-turn cost telemetry becomes load-bearing for budgeting.

## Follow-ups

- Pre-flight smoke: one Flash summarisation round-trip on a 20-turn fixture must retain every element / section / asset ID present in the input.
- Structured log per iteration recording which tier ran. Enables "Pro vs Flash iteration ratio" tracking and per-turn cost estimation.
- Decide whether tier choice should escalate when a budget-exhaustion signal fires on a Flash iteration (e.g., "next turn run all iterations on Pro to be safe"). Likely a small follow-up ADR if the question proves load-bearing.
