# ADR 0045 — SiteRoom broadcasts Yjs updates to peers before autosave persistence completes

**Status:** Proposed
**Date:** 2026-06-01
**Author:** Aayushman Singh
**Drives:** the 2026-06-01 second-opinion audit pass named the broadcast-before-persist ordering as a contract that [ADR 0007](0007-yjs-revival.md)'s "750ms debounce loss window" framing under-specified. This ADR makes the ordering explicit and names its failure modes.

## Context

[ADR 0007](0007-yjs-revival.md) chose Yjs as the canonical operation model and named the publish-time snapshot as version history's source of truth. It also noted that an in-memory `Y.Doc` inside `SiteRoom` is the live op log, and that a debounced projection writes the JSON `editableState` to Postgres on a 750ms interval. What that ADR did not pin down is the ordering between two operations:

- **Broadcast.** When a Yjs update arrives at the DO from one editor, the DO immediately re-broadcasts it to every other connected editor on the same site, so they observe the change in real time.
- **Persistence.** The same Yjs update mutates the in-memory `Y.Doc`, which `attachAutosave` observes and debounces into a Postgres write 750ms later.

The DO does not await persistence before broadcasting. In `src/live/site-room.ts`:

- Inbound editor updates mutate the doc and return (`src/live/site-room.ts:560,565`).
- The doc-observer fans the update out to every connected peer (`src/live/site-room.ts:367,380`).
- `attachAutosave` is attached as a separate observer (`src/live/site-room.ts:412`).

`attachAutosave` itself does not await persistence inline; it schedules a debounced write that runs without blocking subsequent updates (`src/canvas/yjs-projection.ts:1337,1344,1353`). If that write fails (Postgres unreachable, validate.ts rejects the projection), the failure is logged and thrown asynchronously (`src/live/co-edit/autosave.ts:80,91`). By the time the throw surfaces, peers have already observed the operation.

The lived consequence: peers can see an operation whose persistence ultimately fails. After a DO eviction, that operation is gone — and the peers who saw it have no signal that their visual state ever lost the contract.

This ADR ratifies the broadcast-before-persist ordering as the correct trade for a live co-edit product and names the failure modes it implies.

## Decisions

1. **SiteRoom broadcasts every Yjs update to connected peers synchronously with the operation's arrival. Persistence runs downstream of the broadcast and never blocks it.**

   **Why:** a CRDT operation's value to peers is real-time observability — the lived outcome "I see your edit as you type" is the entire point of co-edit. Inserting a Postgres round trip between operation receipt and broadcast would add somewhere between 30ms and 200ms of perceived latency to every keystroke in a multi-editor session, on a network path where the operation itself has already merged into the doc and is monotonic and idempotent under further merges. A peer that receives an operation and later rejoins after a server-side recovery converges to the same state regardless of whether that specific operation survived the autosave window — the next non-failing autosave establishes the floor. The persistence floor is therefore *not* the broadcast floor; conflating them costs every editor every keystroke for a property the CRDT itself does not require.

   This would be wrong if the failure case (autosave write rejected) became frequent enough that peers were routinely observing operations whose state did not survive. Today `validate.ts` rejects ill-shaped projections at the autosave boundary and the failure surfaces loudly; that is the design's safety net. If that net started catching real flux, the answer would not be to delay the broadcast — it would be to fix what is producing invalid projections.

2. **A failed autosave throws loudly and surfaces in the DO's logs. The DO does not roll back the in-memory `Y.Doc` and does not signal peers to revert.**

   **Why:** rolling back the doc on a failed autosave would mean "the operation peers saw is now retracted." The Owner-perceived experience is content disappearing in front of them mid-typing with no explanation — a worse failure than the operation simply not surviving an isolate eviction. The chosen failure mode is: peers continue to observe the in-memory state; the next autosave attempt re-projects; if `validate.ts` is rejecting consistently, the editor session degrades visibly when the DO next evicts, and the Owner-perceived bug is "I edited and refreshed and lost work" — the contract this ADR ratifies. The Owner-perceived alternative bug — "my edits vanished on the screen mid-typing" — is the worse failure mode this ADR explicitly refuses.

   This would be wrong if the product introduced a "guaranteed persistence" tier where peers must not see un-persisted state. That is a different system with a different coordination shape (every operation acks back to the originator after a successful write); it is not what live co-edit is for in this product.

3. **The recoverable-state floor is the last successful autosave projection. Worst-case loss is the debounce window plus any ops queued behind a failing write sequence.**

   **Why:** this is the honest contract that ADR 0007's "750ms" framing was correct about in the steady-state happy path but did not extend to. After a failing write, the in-memory doc keeps advancing while the autosave keeps retrying (or keeps throwing). The recoverable floor stays pinned at the last successful write until the system catches up or the isolate evicts. Operators reading the DO logs see the failure timestamps and can correlate against Owner reports of "lost work." Owners see lost work as state that did not survive a refresh — a failure mode they already understand because no product survives a hostile eviction at the byte level.

   This would be wrong if autosave failures were silently dropped. They are not — they throw, they log, and the operator surface for those failures is bigger than zero. The contract holds because the failure path is loud.

4. **The Owner-facing affordance for "broadcast/persistence gap is open right now" is left to the presence indicator family, not built into this ADR.**

   **Why:** a "saving…" / "save failed" indicator in the editor UI is the right Owner-facing surface for "your edits may not survive a refresh." Its design (where it lives, what it says, how it animates) belongs to the editor's presence UI, not to a server-side ordering decision. This ADR pins the contract; the editor's UI ADR (if/when) pins the affordance.

   This would be wrong if the affordance were load-bearing for the server-side contract — for example, if "saved" were enforced by the editor blocking further edits until it lit up. The product does not block; it informs.

## Out of scope

- Per-edit op log persistence between publishes — explicitly rejected by [ADR 0007](0007-yjs-revival.md) decision 2.
- Stronger durability tiers ("guaranteed persistence" mode) — decision 2 above explicitly rules them out for this product.
- Alternative Yjs persistence backends (`y-leveldb`, `y-redis`) — neither runs on the Worker isolate model.
- The autosave debounce duration itself (750ms) — owned by `attachAutosave`; not relitigated here.
- The Owner-facing "saving…" indicator — see decision 4; belongs to its own decision.

## Consequences

**Positive:**
- Co-edit feels live. Every operation fans out at network-RTT, not at DB-RTT. The lived outcome "I see your edit as you type" survives in degraded-network conditions where the DB write is slow.
- Persistence cost is amortised over the debounce window; the DB is not hammered on every keystroke.
- The failure path is loud (validate.ts throws, autosave throws, operators see the logs) and bounded (the in-memory doc is the floor while connected; the last good projection is the floor after eviction).

**Negative:**
- Peers may observe state that never reaches Postgres. After a DO eviction with a failing autosave window, that observed-but-unpersisted state is gone.
- The 750ms loss floor extends under failure conditions — the actual loss window is "debounce window plus duration of any failing write retry sequence," which in pathological cases (Postgres unreachable for minutes) can grow.
- An Owner who refreshes mid-session after an unobserved autosave failure loses the work done after the last successful save. There is no client-side affordance today that warns this is about to happen.
- The contract is non-trivial to explain in a senior review: "peers see state before it persists" sounds like a bug. This ADR is the answer.

## Follow-ups

- Add a presence-area "saving…" / "save failed" indicator in the editor so Owners know when the broadcast/persistence gap is open. Surface autosave-failure events through SiteRoom to the editor UI.
- Consider a circuit-breaker that detaches the DO from broadcasting after N consecutive autosave failures — converting the contract to "stop accepting operations if we cannot persist." Defer until the failure rate is measured against real production traffic.
- Cross-reference this ADR from [ADR 0007](0007-yjs-revival.md) (the "every editor mutation now flows through Y.Doc transactions" Negative consequence already names the discipline; this ADR completes the picture for the broadcast side).
- If autosave persistence failures correlate with Owner-reported "lost work" tickets, prioritise the indicator follow-up before any operations-quality work.
