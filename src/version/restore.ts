// src/version/restore.ts
//
// Restore primitive — replaces a site's editable state with a captured snapshot.
//
// Flow (the order is load-bearing):
//
//   1. Load the target snapshot row + the site's current editableState in
//      one read each. Fail loud on missing snapshot or missing site.
//
//   2. Capture a `manual` pre-restore safety snapshot of the CURRENT
//      editable state, labelled `Auto-saved before restore on <ISO date>`.
//      This MUST happen before the swap — otherwise a crash mid-restore
//      would leave the Owner without a recoverable view of "where the
//      site was right before I rolled back". The label is exactly the
//      string the smoke pattern-matches against.
//
//   3. Decode the target snapshot bytes via the frozen Yjs projection
//      (`Y.applyUpdate` into a fresh `Y.Doc`, then `decodeYDoc`). The
//      decoded `EditableSite` is the new editable state.
//
//   4. Swap `site.editableState` atomically. Drizzle UPDATE is a single SQL
//      statement, so the swap is point-in-time atomic from the row's
//      perspective.
//
//   5. Broadcast `editable-state-replaced` to the SiteRoom DO so every
//      connected editor flips immediately. Broadcast failure is logged
//      loudly. Connected editors must not keep stale state behind a
//      successful restore response.
//
// Destructiveness: a restore overwrites any unsaved edits between the
// target snapshot and now. The pre-restore safety snapshot makes that
// reversible: an Owner who undoes the restore restores the safety
// snapshot itself.

import { eq } from 'drizzle-orm';
import * as Y from 'yjs';

import { decodeYDoc } from '../canvas/yjs-projection.js';
import type { EditableSite } from '../canvas/schema.js';
import type { Db } from '../db/client.js';
import { site, siteSnapshot } from '../db/schema.js';

import { captureManual } from './capture.js';

/**
 * Narrow env subset the restore primitive needs.
 *
 * `SITE_ROOM` is the Durable Object namespace binding declared in
 * `wrangler.toml`. The smoke passes a no-op stub so the broadcast call is
 * exercised without a live Workers runtime.
 *
 * `CaptureEnv` is currently `unknown` (see `prune.ts`), so we don't
 * intersect with it explicitly — every shape carrying SITE_ROOM already
 * satisfies CaptureEnv. If CaptureEnv grows non-trivial fields later, the
 * intersection comes back here.
 */
export interface RestoreEnv {
  SITE_ROOM: DurableObjectNamespace;
}

/**
 * Broadcast payload sent to the SiteRoom DO when a restore lands.
 *
 * The DO handler for this `kind` is owned by the co-edit subsystem
 * (`src/live/`). Until that body lands, the SiteRoom stub will reject with
 * HTTP 400 — the restore primitive fails loudly because connected editors
 * would otherwise keep stale state after the row swap.
 */
export interface EditableStateReplacedBroadcast {
  kind: 'editable-state-replaced';
  siteId: string;
  newState: EditableSite;
}

export interface RestoreResult {
  /** Snapshot id that was restored from. */
  snapshotId: string;
  /** The new editable state (decoded from the snapshot). */
  newState: EditableSite;
  /** True when the SiteRoom accepted the editor replacement broadcast. */
  broadcasted: true;
}

export class RestoreError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'RestoreError';
  }
}

function buildSafetyLabel(now: Date = new Date()): string {
  // The label format is part of the smoke contract — `/Auto-saved before
  // restore/`. The ISO date is the timezone-stamped capture moment, so the
  // Owner can identify multiple safety snapshots if they restore repeatedly.
  return `Auto-saved before restore on ${now.toISOString()}`;
}

/**
 * Restore a site's editable state from a snapshot.
 *
 * Atomicity is per-row (the UPDATE) — the safety snapshot insert happens
 * before the swap, and the broadcast happens after. If the broadcast
 * fails the row is already swapped; restoring from the safety snapshot
 * undoes that.
 */
export async function restoreSnapshot(
  siteId: string,
  snapshotId: string,
  db: Db,
  env: RestoreEnv,
): Promise<RestoreResult> {
  // Step 1 — load the target snapshot AND verify the site exists.
  const snapshotRows = await db
    .select({
      id: siteSnapshot.id,
      siteId: siteSnapshot.siteId,
      yjsSnapshotBytes: siteSnapshot.yjsSnapshotBytes,
    })
    .from(siteSnapshot)
    .where(eq(siteSnapshot.id, snapshotId))
    .limit(1);
  const snapshotRow = snapshotRows[0];
  if (!snapshotRow) {
    throw new RestoreError(404, `snapshot ${snapshotId} not found`);
  }
  if (snapshotRow.siteId !== siteId) {
    // The snapshot exists but belongs to a different site. The route
    // layer's `:siteId` path param is the boundary that pins the snapshot
    // to one site; a mismatch is either a client bug or a forged URL.
    // Either way: refuse.
    throw new RestoreError(404, `snapshot ${snapshotId} does not belong to site ${siteId}`);
  }

  const siteRows = await db.select({ id: site.id }).from(site).where(eq(site.id, siteId)).limit(1);
  if (!siteRows[0]) {
    throw new RestoreError(404, `site ${siteId} not found`);
  }

  // Step 2 — pre-restore safety snapshot of the CURRENT editable state.
  // captureManual reads the live editable state inside its own query so we
  // do not have to thread it. Label is the smoke-contract string.
  const safetyLabel = buildSafetyLabel();
  await captureManual(siteId, safetyLabel, db, env);

  // Step 3 — decode the target snapshot bytes back into EditableSite
  // via the frozen Yjs projection. Applying the update onto a fresh Doc
  // gives us a Doc whose state vector matches the captured moment exactly;
  // `decodeYDoc` then walks that Doc back into JSON.
  const replayDoc = new Y.Doc();
  Y.applyUpdate(replayDoc, snapshotRow.yjsSnapshotBytes);
  const newState = decodeYDoc(replayDoc);

  // Step 4 — atomic row swap. `editableState` and `styleKit` are both
  // touched because the styleKit denormalised column on `site` mirrors
  // `editableState.styleKit` and would otherwise drift after a restore
  // that crosses kit boundaries.
  await db
    .update(site)
    .set({
      editableState: newState,
      styleKit: newState.styleKit,
    })
    .where(eq(site.id, siteId));

  // Step 5 — SiteRoom broadcast. The co-edit subsystem (`src/live/`) owns
  // the inbound handler for this kind. If the DO rejects the payload, the
  // restore request fails instead of reporting ok=true while editors keep
  // stale state.
  await broadcastReplacement(env, siteId, newState);

  return {
    snapshotId: snapshotRow.id,
    newState,
    broadcasted: true,
  };
}

async function broadcastReplacement(
  env: RestoreEnv,
  siteId: string,
  newState: EditableSite,
): Promise<void> {
  try {
    const id = env.SITE_ROOM.idFromName(siteId);
    const stub = env.SITE_ROOM.get(id);
    const payload: EditableStateReplacedBroadcast = {
      kind: 'editable-state-replaced',
      siteId,
      newState,
    };
    const response = await stub.fetch('https://do.invalid/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[version/restore] SiteRoom broadcast non-ok status', response.status, text);
      throw new RestoreError(
        502,
        `restore broadcast failed with status ${String(response.status)}: ${text}`,
      );
    }
  } catch (error) {
    if (error instanceof RestoreError) throw error;
    console.error('[version/restore] SiteRoom broadcast failed', error);
    throw new RestoreError(
      502,
      `restore broadcast failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
