# Version history + restore

**Wishlist #:** 3 **Tier:** S **Wave:** 1 **Status:** queued
**Depends on:** Phase 0 ✓ (Yjs projection, `siteSnapshot` table)
**Blocks:** none

## User-visible outcome

An Owner sees a timeline of past publishes for a site, each labelled with a timestamp and an optional name. The Owner can preview any past published version and, with one confirm step, restore it — the editable site flips back to that moment, and the next publish promotes it to Visitors. The pre-restore state is itself captured as a snapshot, so a restore can be undone.

## Scope in

- Snapshot capture at every publish (reason = `'publish'`).
- Snapshot capture on Owner request (reason = `'manual'`, with label).
- Timeline panel in editor sidebar listing snapshots, newest first, with relative time + label.
- Preview-snapshot mode: load snapshot into a read-only editor view.
- Restore op: atomic swap of `editableState` to snapshot's materialised state, broadcast `replace-state` op to open editors via SiteRoom, save pre-restore state as `manual` snapshot named `Auto-saved before restore on …`.
- Pruning policy: keep last 50 snapshots per site; drop oldest beyond. Publish snapshots never pruned within last 90 days.

## Scope out

- Per-edit op log persistence (Q10 locked this out).
- Branching / forking a snapshot into a parallel timeline.
- Cross-site copy of snapshots.
- Diff visualization between two snapshots (defer).

## Schema delta

Already scaffolded in Phase 0:

```ts
// src/db/schema.ts (Phase 0)
siteSnapshot = pgTable('site_snapshot', {
  id,
  siteId,
  yjsSnapshotBytes: bytea('yjs_snapshot_bytes').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason').notNull().$type<'publish' | 'manual'>(),
  label: text('label'),
  publishedVersion: integer('published_version'),
});
```

## Files owned (write)

- `src/version/capture.ts` — capture-on-publish hook + manual-snapshot route handler.
- `src/version/restore.ts` — restore op, pre-restore safety snapshot, SiteRoom broadcast.
- `src/version/prune.ts` — pruning policy.
- `src/version/list.ts` — paginated snapshot listing.
- `src/version/preview-render.ts` — server-side render of snapshot for preview (reuses public renderer).
- `src/version/route.ts` — `/api/sites/:id/snapshots` GET/POST + `/restore` POST.
- `src/version/smoke.ts`.
- `src/routes/dashboard/version-timeline.tsx` — sidebar UI.
- `src/routes/api/publish.ts` — **call** capture hook (single line edit allowed; touched by Phase 0 to insert the hook stub).
- `package.json` — fill in `version:smoke` stub.

## Files read-only (must not modify)

- `src/canvas/schema.ts`, `src/db/schema.ts`.
- `src/canvas/yjs-projection.ts` (consume only).
- `src/live/site-room.ts` (use via existing broadcast helper; do not modify).

## Contract with neighbors

- Reads `Yjs encode/decode` from `src/canvas/yjs-projection.ts`.
- Calls `SiteRoom.broadcast({ type: 'editable-state-replaced', siteId, newState })` on restore. The Phase 0 SiteRoom stub must include this message kind.
- The `/api/publish` route fires `captureOnPublish(siteId, publishedVersion)` after successful snapshot publish.

## Smoke test

- `bun run version:smoke`:
  - Creates a site, publishes twice, asserts two `siteSnapshot` rows with `reason='publish'`.
  - Inserts a manual snapshot, asserts label persists.
  - Restores to first snapshot, asserts editable state matches, asserts a third snapshot exists with reason `'manual'` and a label matching `/Auto-saved before restore/`.
  - Prune step with >50 snapshots asserts oldest dropped, publish snapshots within 90 days retained.

## Acceptance criteria

- Owner sees timeline with at least 2 entries after two publishes.
- Restore flips the editable site visibly within 500ms on a connected editor.
- Pre-restore snapshot exists and itself restorable.
- All smokes green.

## Open questions

- Whether to materialise preview-snapshot into a `Y.Doc` server-side (heavier) or hydrate the public renderer directly from decoded JSON. Recommend: latter for preview, former only on restore. Document choice in code.
