# version

**Wishlist #:** 3  **Plan:** [`docs/superpowers/plans/2026-05-23-03-version-history.md`](../../../docs/superpowers/plans/2026-05-23-03-version-history.md)
**Status:** Wave 1 implementation landed.

Publish-time snapshots, manual labelled snapshots, restore with pre-restore safety snapshot, timeline UI. Consumes `src/canvas/yjs-projection.ts`.

## Responsibilities

- `capture.ts` — `captureOnPublish(siteId, publishedVersion, db, env)` and `captureManual(siteId, label, db, env)`. Encodes the current `editableState` via `encodeYDoc` + `Y.encodeStateAsUpdate`, inserts a `siteSnapshot` row, then calls the pruning policy.
- `restore.ts` — restore primitive: read the target snapshot, capture a pre-restore safety snapshot (`reason='manual'`, label `Auto-saved before restore on <ISO date>`) of current state, swap `site.editableState` to the decoded snapshot, broadcast `editable-state-replaced` to SiteRoom.
- `prune.ts` — keep last 50 snapshots per site; publish snapshots within the last 90 days are NEVER pruned. Runs after every capture (idempotent).
- `list.ts` — paginated newest-first listing for the timeline UI.
- `preview-render.ts` — server-side render of a snapshot for the read-only preview. Decodes the Yjs bytes to `CanvasSiteState`, wraps as a `PublishedSnapshot`, then calls `renderCanvasSnapshot`.
- `route.ts` — Hono router (default export) mounted at `/api/sites/:siteId/snapshots`. Endpoints: `GET /`, `POST /`, `POST /:snapshotId/restore`, `GET /:snapshotId/preview`.

## Integration hooks (consumed by main thread)

- `captureOnPublish(siteId, publishedVersion, db, env): Promise<void>` — main thread wires this into `src/routes/api/publish.ts` after the publish row update.
- `default` Hono router from `src/version/route.ts` — main thread mounts at `/api/sites/:siteId/snapshots`.

## Cross-wave dependency: SiteRoom broadcast

`restore.ts` broadcasts the new editable state by POSTing to the SiteRoom DO at
`https://do.invalid/broadcast` with payload:

```ts
{ kind: 'editable-state-replaced', siteId, newState }
```

The Phase 0 SiteRoom in `src/live/site-room.ts` validates `BroadcastPayload` as
`{ version: number, html: string }` for the publish path and does NOT yet
handle the `editable-state-replaced` kind — that handler body lands with
**Wave 1 #4 (co-edit)** which fills in the inbound message router. Until then,
the SiteRoom DO will reject the restore broadcast with HTTP 400 and log it; the
restore operation itself still succeeds (row swap + safety snapshot are
durable). The restore handler logs the broadcast error loudly per the
`fail-loudly` posture and continues — the next visitor / editor page-load
reads the swapped `editableState`.

**Co-edit (Wave 1 #4) must extend `SiteRoom.fetch('/broadcast', …)` to accept
the `kind: 'editable-state-replaced'` payload and fan it out as a JSON envelope
to every connected editor socket.** No schema change in our subsystem — only
that handler change unblocks the live-restore acceptance criterion (≤ 500 ms).

## DB harness in smoke

`smoke.ts` uses an in-memory drizzle-compatible stub (`InMemoryDb`) instead of
a real Neon Postgres connection. The version-history primitives all flow
through a small set of drizzle query primitives (`select`, `update`,
`insert`, `delete`), so the stub mirrors exactly the call shapes used in
production. This keeps the smoke fast, hermetic, and runnable on Windows
without a local Postgres install — consistent with `src/assets/smoke.ts`.
