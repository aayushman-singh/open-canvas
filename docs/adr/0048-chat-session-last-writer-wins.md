# ADR 0048 — Chat session is last-writer-wins; concurrent tab writes are out of scope

**Status:** Proposed
**Date:** 2026-06-01
**Author:** Aayushman Singh
**Drives:** the 2026-06-01 second-opinion audit pass named the chat-session UPDATE as a concurrent-write hole. The bug-fix triage deferred a schema migration for it; this ADR ratifies the deferral and names the migration shape.

## Context

`chat_session` rows hold the entire message array as a JSONB column ([`src/db/schema.ts:396-418`](../../src/db/schema.ts)). The `saveMessages` function does a plain whole-row replace:

```ts
await database
  .update(chatSession)
  .set({ messages: messages as unknown as Array<Record<string, unknown>> })
  .where(eq(chatSession.id, sessionId));
```

No version column, no compare-and-swap, no row-level lock, no advisory lock. The race window:

1. Tab A reads session, baseline messages `[m0, m1, m2]`.
2. Tab B reads session, baseline messages `[m0, m1, m2]`.
3. Tab A's turn completes, calls `saveMessages` with `[m0, m1, m2, mA, rA]`.
4. Tab B's turn completes, calls `saveMessages` with `[m0, m1, m2, mB, rB]`.
5. Tab B's UPDATE overwrites Tab A's. Tab A's `mA` (Owner message) and `rA` (assistant reply) are lost.

The route loads the session by `sessionId` from the POST body, runs the LLM turn, then saves ([`src/agent/chat/route.ts:174-205`](../../src/agent/chat/route.ts)). The race is real.

The realistic frequency is low: most Owners chat from one tab. A power user with two tabs racing on the same session would observe a missing message and a chat history that disagrees with the model's stated context. The damage is bounded to the lost-tab's user-perceived "I sent that and it disappeared."

## Decisions

1. **The chat-session row is last-writer-wins under concurrent UPDATEs. Two tabs on the same session can overwrite each other; the product does not attempt to merge or detect.**

   **Why:** chat is single-conversation, single-Owner, single-site. The expected access pattern is one tab. Adding optimistic concurrency (version column + CAS retry) costs a schema migration, a refresh-on-conflict path, a `409 Conflict` response shape the client must handle, and an Owner-facing "the chat updated, refresh to see" affordance — for a race that the product does not observe today at any noticeable rate. The conceptual minimum: one row, one writer at a time, last write wins. This ADR ratifies that posture for the current product stage rather than letting the implementation drift away from a documented contract.

   This would be wrong if a real Owner cohort routinely chatted across tabs — opening the same site in two windows during a long working session became a measurable pattern. The mitigation path is decision 3.

2. **The route does not detect concurrent writes. There is no `409 Conflict` response from chat POST.**

   **Why:** detection requires a version column in the row. Without one, the route cannot distinguish "two concurrent writes happened" from "one overwriting write happened." Returning a 409 in the absence of detection capability would be theatre — the route would still UPDATE the row, still lose the message, still return some HTTP code. The choice is between (a) detect and return 409, which requires the migration, and (b) accept LWW silently. Decision 1 picks (b); this decision pins that the absence of 409 is deliberate, not an oversight.

   This would be wrong if chat moved to a multi-Owner context — for example, a collaborator-chat surface where multiple authenticated editors converse against a shared session. At that point the loss probability multiplies with the number of writers and detection becomes load-bearing.

3. **The migration path to optimistic concurrency is named in this ADR but not scheduled. The shape is: add `version int not null default 0` to `chat_session`; update `saveMessages` to `UPDATE … SET messages = ?, version = version + 1 WHERE id = ? AND version = ?`; surface a `409 Conflict` from the route when zero rows are affected; the client refreshes session state and may re-issue. This ADR is superseded the day that migration lands.**

   **Why:** the migration is small but it is not free — a Drizzle migration file, a route-level retry / refresh path, a smoke for the conflict case, and a client-side handler that re-fetches session state and decides how to surface the conflict to the Owner. Bundling it into a security-fix sweep would conflate concerns and ship a behavioural change under a "fix" commit. Naming the migration here means a future contributor faced with the concurrency observation does not re-derive the design — they read this ADR, see the migration shape spelled out, and either implement it directly or supersede with a different model.

   This would be wrong if "do it later" were the entire instruction. It is not; the migration shape above is concrete enough to land as a single PR when the use case justifies it.

4. **There is no telemetry today that measures the race's actual frequency. The claim that it is rare is unmeasured. The follow-up adds a cheap server-side hook that catches the race post-hoc and logs it.**

   **Why:** "we accept this trade because the use case is rare" is only a defensible answer if the claim is measured. Today it is asserted from product intuition. The fix is cheap to instrument: on every `saveMessages`, compare the incoming `messages.length` against the persisted row's pre-update length; if the persisted length is greater than the request's baseline-length expectation, log a structured event. That converts the assertion into measurement without requiring the migration.

   This would be wrong if the instrumentation itself were load-bearing for correctness. It is not — it is observability, downstream of the LWW contract.

## Out of scope

- Inter-Owner chat surfaces (collaborator chat). A different concurrency model; a different ADR.
- Real-time chat sync via WebSocket where multiple tabs see each other's messages live. The chat route is SSE-streaming for model output, not for cross-tab message-list sync.
- Chat row deletion or archiving policy — orthogonal to the concurrency model.
- The chat session's per-site / per-customer uniqueness shape — owned by [`src/agent/chat/session.ts`](../../src/agent/chat/session.ts); not relitigated here.

## Consequences

**Positive:**
- Chat ships as it is today; no schema migration overhead, no client-side conflict handling.
- One write path, one failure mode (the row update succeeds or throws). No "did I get the right version" branching.
- The contract is explicit. A senior reviewer reading this ADR sees the trade, sees the migration path, and sees that the deferral is bounded by the named supersession trigger.

**Negative:**
- A power user with two tabs on the same chat session can lose a message. The system gives them no signal that this happened — they observe a missing turn in their local tab's transcript.
- Without instrumentation (decision 4's follow-up), the assertion "the race is rare" is unmeasured. The senior-review answer "we accept LWW because the use case does not justify the migration" is credible only when the rarity claim is backed by data.
- The instrumentation itself, once shipped, may surface a higher race rate than expected and force the migration sooner than this ADR anticipates. That is a feature of measurement, not a defect of this ADR.

## Follow-ups

- Ship the observability hook from decision 4: on `saveMessages`, log a structured event when the persisted row's `messages.length` already exceeds the request's expected baseline length. Cheap to add, decisive when read.
- When the observability hook surfaces meaningful race frequency, OR when the chat moves to a multi-Owner / multi-writer use case, land the version-column migration named in decision 3 and supersede this ADR.
- Cross-reference this ADR from the `src/agent/chat/session.ts` file header so a contributor reading `saveMessages` sees the contract without grepping for the ADR.
