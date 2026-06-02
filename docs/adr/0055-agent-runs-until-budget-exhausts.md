# ADR 0055 — Agent runs until budget exhausts, not until a fixed iteration count

**Status:** Accepted
**Date:** 2026-06-02 (proposed); 2026-06-02 (accepted)
**Author:** Aayushman Singh
**Drives:** Owner-reported symptom — sitewide revamps stop after ~5 modifications and the agent declines to continue. Audit traced this to `MAX_TOOL_CALL_ITERATIONS = 5` at [`src/agent/chat/orchestrator.ts:77`](../../src/agent/chat/orchestrator.ts), with five surrounding mechanisms that either silently truncate state or hide failures and make a naive cap-raise unsafe.

## Context

The user-perceived bug: an Owner asks for a sitewide revamp — "rewrite every heading in tighter editorial voice, swap the photos for the new shoot, regrid the section spacing" — and the agent stops after about five edits. The transcript ends with the agent emitting a `done` event mid-revamp, no error, no apology, no "I ran out of room." From the Owner's seat the work is half-done and the agent gave up.

What's actually happening in the code:

- `MAX_TOOL_CALL_ITERATIONS = 5` ([`orchestrator.ts:77`](../../src/agent/chat/orchestrator.ts)) is the hard ceiling. Each iteration is one tool-call round-trip (one "mod" from the Owner's view). The cap was added to defend against a runaway model burning through the token budget; in practice it terminates legitimate long-running work without telling the Owner why.
- Raising the cap naively is unsafe because five surrounding mechanisms were all written assuming the five-cap was the real backstop:
  - **Silent summarisation fallback** at [`orchestrator.ts:629-633`](../../src/agent/chat/orchestrator.ts): if the summarisation Gemini call returns empty, the orchestrator skips compaction with no log, no error. The comment labels itself "Loud-fail-safe" but the code is silent. The pattern violates the repo's no-fallbacks contract. With a low cap this rarely fires; raising the cap surfaces it as the dominant context-loss path.
  - **Trim runs once per turn, before the loop** at [`orchestrator.ts:154`](../../src/agent/chat/orchestrator.ts). A `query_site` returning the 12k-token cap inside iteration 1 stays resident through every subsequent iteration with no further trim.
  - **No abort or wall-clock guard** in [`llm-gemini.ts:60-91`](../../src/agent/llm-gemini.ts). The stream drains to completion or to Cloudflare Workers' default 600s wall-clock kill. A runaway model with a higher cap consumes the whole worker invocation before the Owner sees an error.
  - **Token count is a `length / 4` estimate** at [`session.ts:81-83`](../../src/agent/chat/session.ts). Gemini's actual tokenisation diverges meaningfully on tool-call JSON; the comment claims "neither corrupts state" but under-estimating overflows the model's real context window and yields a `MAX_TOKENS` finish that truncates the tool-call protocol mid-payload.
  - **The canvas-agent preview endpoint is single-shot** ([`canvas-agent.ts:280-366`](../../src/routes/api/canvas-agent.ts)) — no loop at all. Structural revamps invoked from the preview surface cannot iterate even once.

The contract today is "the agent runs five iterations then stops." The contract this ADR pins is "the agent runs until its budget exhausts, and the budget is loudly enforced."

## Decisions

1. **The chat orchestrator's stop condition is budget exhaustion, not a fixed iteration count. `MAX_TOOL_CALL_ITERATIONS` is removed as a stop condition; the budget is the contract.**

   **Why:** the iteration count is a proxy for "don't run forever." The real concerns it proxies are wall-clock (Cloudflare worker limit), token volume (Gemini context window), and bounded Owner wait time. Each of those is directly measurable; the iteration count is not. A model that needs nine small read-only tool calls to assemble enough context to propose one good change is held back by the cap-of-five for no benefit to any of the real concerns. Pinning the budget directly lets the agent finish work the Owner asked for, and lets us surface a *budget-exhausted* signal that explains *why* it stopped (rather than the current silent five-iteration cliff).

   This would be wrong if the iteration count were itself a load-bearing safety mechanism distinct from wall-clock and tokens — for example, if each iteration had an unbounded external side effect we could not afford to repeat. Tool dispatches in this orchestrator are bounded (read-only or preview-only) and have no external side effects; the iteration count's only role was a proxy. Pinning the underlying budgets is the conceptual minimum.

2. **The budget is three named limits, each enforced separately and loudly: a wall-clock deadline per turn, a token ceiling on the accumulated history including tool results, and a maximum tool-call count per turn as a runaway-loop safety net.**

   **Why:** one budget cannot meaningfully bound all three concerns. Wall-clock bounds Owner wait time and Cloudflare invocation; tokens bound Gemini context-window correctness; tool-call count bounds pathological loops (a confused model calling `query_site` forty times). Each is enforced loudly — when any one trips, the turn ends with a `done` event whose reason names which budget was exhausted (`wallclock-exceeded`, `tokens-exceeded`, `tool-call-cap`). The tool-call ceiling is set high enough that it never fires on legitimate work; it exists only to stop a degenerate loop, not legitimate long-running work.

   This would be wrong if one budget subsumed the others — for example, if a tight token budget reliably implied a tight wall-clock budget. It does not; a model that emits one short tool call and waits ten seconds for the next has spent zero tokens and all the wall-clock.

3. **The token budget uses Gemini's `countTokens` API for the cap check, not a `length / 4` estimate. The cheap estimate is acceptable only as a pre-filter to decide whether to spend an API round-trip on the precise count.**

   **Why:** under-estimating tokens lets the agent send a payload Gemini truncates with `MAX_TOKENS`, which corrupts the tool-call protocol — function-call arguments arrive truncated, the orchestrator translates a malformed call into an error, the turn ends. The current comment claiming "neither corrupts state" is wrong about that failure mode. The precise count fires only when the cheap estimate signals we're within 20% of the ceiling, so the cost is bounded to at most one extra API call per turn.

   This would be wrong if `countTokens` itself were prohibitively expensive (it is not — billed at a fraction of generate cost) or if Gemini's tokenisation drift turned out to be ≤5% on our workload (it does not — observed drift on tool-call JSON exceeds 25%).

4. **History trim re-runs after every tool dispatch, not only at the start of the turn. A large `query_site` or `query_assets` result that lands mid-iteration triggers compaction immediately.**

   **Why:** the current single trim at turn start was correct when the cap was five. With the cap removed, mid-iteration tool results are the dominant growth path; a single full-detail `query_site` on a large site already lands at 12k tokens. Without mid-loop trim, the second iteration sends a payload that overflows the real context window. Trimming after each tool dispatch keeps the history within budget without losing the active turn's reasoning — the trimmer drops the oldest non-system, non-summary messages, and the active turn's tool calls and results sit at the tail.

   This would be wrong if trimming itself were lossy enough that re-running it mid-loop dropped recently-relevant context the model still needed. Today's trimmer preserves the tail, so the in-flight turn is intact. The trim is safe to re-run.

5. **Summarisation failure is loud. If the summarisation Gemini call returns empty, errors, or produces output the orchestrator cannot parse, the turn ends with an `error` event followed by `done`. The current silent fallback to "skip compaction" is removed.**

   **Why:** the existing fallback violates the repo's no-fallbacks contract (`CLAUDE.md` global preference: "do not propose, write, or preserve fallbacks"). It also masks an active failure mode — summarisation is non-trivial to get right; silently failing it lets us ship a regression in summary quality with no signal. Failing loud surfaces the regression on the first occurrence, in production, where it can be diagnosed.

   This would be wrong if summarisation failure were so common that loud-failing produced a steady drip of error events. Today's summarisation runs once per turn after the 10-turn threshold; on a healthy provider it never returns empty. If it does, that itself is the diagnostic signal worth surfacing.

6. **The Gemini adapter accepts an `AbortSignal`, and the orchestrator threads a deadline-driven signal through every Gemini call. When the deadline fires the stream aborts, the partial tool-call buffer is discarded, and the turn ends with a `done` event whose reason is `wallclock-exceeded`.**

   **Why:** today the stream drains to completion or to Cloudflare's hidden 600s wall-clock kill, after which the Owner sees a request terminated with no SSE-level explanation. An explicit deadline gives the orchestrator the same control surface the Owner expects: the request is bounded in time, the Owner is told *why* it ended, and the partial work is discarded cleanly rather than written half-formed.

   This would be wrong if Gemini's stream did not honour abort signals (it does — `@google/genai` `generateContentStream` accepts a signal via `AbortController`), or if discarding the partial buffer lost work the Owner could not regenerate. The orchestrator only persists tool-call results that completed within the budget; the partial buffer is by definition mid-flight and ungrounded.

7. **The canvas-agent preview endpoint runs the same multi-turn loop as chat. Single-shot is removed.**

   **Why:** the symptom that motivates this ADR — sitewide revamps stopping mid-work — bites the canvas-agent path even harder than chat, because canvas-agent has *no* iteration at all today. An Owner who invokes the agent from the canvas surface (the most common surface for structural edits) gets exactly one Gemini call, one set of tool calls translated to a preview, and no opportunity for the model to refine after seeing intermediate state. Unifying on the orchestrator's loop closes that gap and removes a divergent code path.

   This would be wrong if the canvas-agent path needed *single-shot* semantics for product reasons — for example, if the Owner-visible UX depended on the model proposing exactly one batch of changes that the Owner accepted or rejected wholesale. It does not; the canvas-agent UX already accepts a batched preview, so the loop produces the same batched preview on its terminating iteration.

8. **Tier routing — running summarisation and read-only inspection sub-loops on Flash instead of Pro — is owned by ADR 0056 (separate decision cluster). This ADR pins the stamina contract; cost-per-iteration is independent.**

   **Why:** stamina (how long does it run) and tier routing (how much does each iteration cost) are orthogonal. Bundling them would couple two decisions whose reasoning is independent; deferring tier routing to its own ADR keeps the cluster clean. Today's "everything on Pro" is the conservative default until ADR 0056 is decided.

   This would be wrong if the cost of the longer stamina contract were unaffordable without tier routing — for example, if a single sitewide revamp on Pro cost more than the product can absorb. Estimated cost of the worst case (twenty iterations of Pro tool-calls on a large site) is in the low single-digit dollars; affordable.

## Out of scope

- **The Gemini 3.x migration.** The adapter's `thought_signature` round-trip work ([`orchestrator.ts:72-75`](../../src/agent/chat/orchestrator.ts)) is its own cluster; this ADR pins 2.5-pro as the current model and is silent on the upgrade path.
- **Tier routing.** Owned by ADR 0056 (proposed alongside).
- **The chat-session row write contract.** ADR 0048 pins last-writer-wins; this ADR makes no change to that contract.
- **Per-Owner / per-site budget overrides.** A future ADR may add Owner-level budget controls (paid tier gets a larger wall-clock budget, etc.); not in this cluster.
- **Observability of budget-exhaustion frequency.** A follow-up adds structured logging when a turn ends with a budget-exhausted reason, mirroring the ADR-0048 telemetry pattern.

## Consequences

**Positive:**
- Sitewide revamps finish. The Owner-reported symptom resolves directly.
- Failure modes are visible: a turn that ends with `wallclock-exceeded`, `tokens-exceeded`, `tool-call-cap`, or `summarise-failed` tells the Owner *why* the agent stopped. The current silent five-iteration cliff disappears.
- The canvas-agent path stops diverging from chat. One loop, one code path.
- The repo's no-fallbacks contract is enforced in the agent layer too — the summarisation silent-skip was the last residual fallback in this subsystem.

**Negative:**
- Per-turn cost rises. A revamp that used to stop at five iterations may now run twenty. Mitigation: ADR 0056 tier routing recovers the lion's share on read-only iterations.
- The wall-clock deadline becomes a tunable. Setting it too low reintroduces the symptom; setting it too high lets a confused model burn through a worker invocation. Initial setting: 120s per turn; revisit after first week of telemetry.
- The Gemini `countTokens` call adds an API round-trip per turn (not per iteration). Latency cost: ~150ms; acceptable.
- Loud summarisation failure may surface a steady drip of error events the first week as we learn the failure rate. That is the point of decision 5; the noise is the signal.

## Follow-ups

- ADR 0056 — LLM tier routing — pin which iterations run on Flash vs Pro.
- Structured log on every budget-exhausted `done` event, mirroring ADR 0048 decision 4's telemetry hook. Enables "how often does the wall-clock fire" measurement.
- Surface budget configuration in `OrchestratorContext` so smokes can pin deterministic budgets for stable test runs.
- Document the budget contract in `CONTEXT.md` under the agent subsystem section.
