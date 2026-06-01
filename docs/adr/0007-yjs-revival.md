# ADR 0007 — Yjs revival as canonical operation model for co-edit and version history

**Status:** Accepted
**Date:** 2026-05-23
**Author:** Aayushman Singh
**Supersedes:** the ADR 0003 treatment that retired Yjs together with the
legacy flow-document editor path. The legacy path stays retired; Yjs is
reintroduced under different responsibilities.

## Context

The gamma-parity POC adds two features that fight each other if their underlying operation model is not unified up front:

- **Realtime co-editing.** Two Owners on the same site see each other's edits live. The natural shape is a stream of small operations broadcast through the existing `SiteRoom` Durable Object.
- **Version history.** An Owner sees a timeline of past published states and can restore one. The natural shape is point-in-time snapshots of the editable site.

Treated as separate paradigms, these two features build conflicting plumbing: co-edit wants the source of truth to be a mutable stream of ops, version history wants it to be an immutable sequence of frozen states. A site cannot have both, simultaneously, as the source of truth without one of them being a derivative view.

ADR 0003 retired the old flow-document page model and noted that the Yjs
supporting code was kept on disk as inert reference. The retirement of Yjs was
framed alongside that old page model because both pieces served the same
abandoned document shape. Yjs itself is paradigm-agnostic: it works as well
over canvas JSON as it did over flow documents.

Three options exist for the operation model:

1. **Yjs as canonical op log.** `Y.Doc` holds the canvas state; ops are Yjs updates; snapshots are `Y.encodeStateAsUpdate` of the doc at a moment. Battle-tested CRDT, awareness protocol built-in, retired code path already shaped for the structure.
2. **Automerge.** JSON-native CRDT, history API built in. More awkward bundle weight for a Cloudflare Worker; less production precedent in the Worker + Durable Object stack.
3. **Custom op log with last-writer-wins per field.** Hand-rolled. Cheapest scaffold; will lose data on concurrent edits to overlapping fields.

The choice is hard to reverse because the persistence shape — what bytes go on disk, in what column, with what migration path — is downstream of the engine. Switching engines later is a re-encoding of every persisted op log and every snapshot.

## Decisions

1. **The canonical operation model is a Yjs document. `EditableSite` becomes a projection of that document.**

   **Why:** the lived outcome that requires concurrent edits to feel correct — two Owners typing at once, neither losing work — is a CRDT problem, and Yjs is the most production-proven CRDT for the canvas shape we have. Hand-rolled LWW is rejected because the silent-data-loss failure mode is exactly the failure mode the project's all-or-nothing posture refuses. Automerge is rejected because its Cloudflare Worker integration story is less well-trodden and the previous code path the project carried for Yjs over a Durable Object reduces the scaffold cost of this option to roughly a day rather than a week.

2. **Snapshots are materialised projections of the Yjs document, captured at publish time only.**

   **Why:** the deferred decision in the design conversation — whether to also persist a per-edit op log between publishes — was resolved against persistence. The lived outcome of version history is "I can see my past published sites and roll back to one," which is precisely satisfied by snapshots tied to publish events. Persisting the op log between publishes adds storage cost, a compaction job, and a stronger durability guarantee than the published-version restore actually requires. The current decision keeps the in-memory `Y.Doc` inside `SiteRoom` as the live op log for connected editors; if all editors disconnect, the latest projection to `site.editableState` is the recoverable state, and the publish-time snapshot is what version history reads.

3. **The Yjs document and the JSON `EditableSite` form a bridge contract maintained in one place.**

   **Why:** every other feature that touches the editable state — agent ops, theme switches, asset references, validators — must continue to work against the JSON shape; they should not become Yjs-aware. A single projection module owns `encode(state) → Y.Doc` and `decode(doc) → state` and a debounced `attachAutosave` that writes the projection to Postgres. Co-edit consumes the doc directly; everything else consumes the projection. Pushing Yjs awareness into every feature would explode the surface area of the decision; centralising it keeps Yjs an internal organ rather than a system-wide colour.

4. **The previously retired `src/multiplayer/*` reference code is the seed for the projection module and the sync protocol; it is not revived wholesale.**

   **Why:** the retired files exist because they encoded old flow-document
   assumptions that no longer hold. Reviving them in place would drag those
   assumptions back in. The decision is to re-author the projection and sync
   protocol cleanly in `src/canvas/yjs-projection.ts` and `src/live/co-edit/`
   against the canvas schema, reading the retired code as reference for the
   WebSocket message handling and the `Y.Doc` ↔ Durable Object glue rather
   than as starting code.

## Out of scope

This ADR does not decide:

- Whether `TextElement.content: InlineRun[]` is itself a Yjs `Y.Array<Y.Map>` for per-keystroke text-level CRDT, or treated as an opaque array overwritten as a unit on each edit. The POC begins with the opaque-array treatment; per-text CRDT is a future refinement.
- The presence indicator UI for awareness data.
- Permission models that would distinguish read-only from read-write co-editors.
- Cross-site doc sharing, comment threads, or asynchronous review flows.
- The retention policy beyond "last N snapshots per site" — set at the plan layer, not the ADR layer.

## Consequences

**Positive:**

- Co-edit and version history sit on one operation model. Neither feature has to invent its own coordination shape; both consume the same `Y.Doc` and the same projection.
- Yjs awareness is a free byproduct: presence — which Owner is here, where their cursor is — falls out of the protocol without bespoke broadcasts.
- The agent op surface remains untouched at the JSON layer, which means agent edits, validators, and renderers do not need to learn Yjs.
- The publish-time snapshot is small (`Y.encodeStateAsUpdate` of a stable doc), cheap to store, and trivially restorable.

**Negative:**

- The retired `Y` dependency comes back into `package.json`. ADR 0003's
  framing of "retired" must be revised in this ADR; that framing turns out to
  have conflated the old editor path's retirement with Yjs's.
- Every editor mutation now flows through `Y.Doc` transactions instead of direct JSON mutation. Existing editor client code has to be re-wired with the discipline that "the doc is the truth"; bugs where some path mutates the projection without going through the doc are a real failure mode that smoke tests must catch.
- A debounced projection write is now part of the autosave path. Tuning the debounce window — too short wastes Postgres writes; too long widens the cold-recovery loss window — is a real decision that lands in the plan layer.
- Reasoning about a Yjs document inside a Durable Object is a more demanding model than the previous "mutate JSON, broadcast diff" approach. New contributors will need a primer.

## Follow-ups

- A future ADR if the `TextElement.content` representation is upgraded to a Yjs `Y.Array<Y.Map>` for per-keystroke text CRDT.
- A future ADR if the `Y.Doc` ↔ JSON projection becomes a performance bottleneck at scale and is replaced or restructured.
- [ADR 0045](0045-siteroom-broadcast-precedes-persistence.md) extends this ADR's "debounced projection" framing by pinning the broadcast-vs-persistence ordering and naming the failure modes peers can observe.
