// src/version/capture.ts
//
// Snapshot capture primitives for version history.
//
// Two entry points:
//
//   captureOnPublish(siteId, publishedVersion, db, env)
//     Called by the publish route AFTER it persists the new published
//     snapshot + bumps the publishedVersion. Stores the editable state at
//     the moment of publish as a `reason='publish'` snapshot tagged with
//     the publishedVersion. The materialised snapshot is what version-
//     history lists/timeline rows render from; the in-DB published snapshot
//     itself stays the source of truth for what visitors see.
//
//   captureManual(siteId, label, db, env)
//     Called by the manual `POST /api/sites/:id/snapshots` endpoint AND by
//     the restore primitive to record its pre-restore safety snapshot. The
//     caller controls the label; this primitive never invents one.
//
// Both primitives load the current `editableState`, encode it through the
// frozen Yjs projection in `src/canvas/yjs-projection.ts`, write a
// `siteSnapshot` row, then invoke the pruning policy. Pruning is idempotent
// — running it after every capture keeps the per-site row count bounded
// without any external scheduler.
//
// Failure posture: fail loudly. A missing site row throws (publish flow has
// already proven the site exists; manual route exposes the same exception
// to the caller). An encode error surfaces with full stack — there is no
// "silent skip the capture and let publish succeed" fallback. Per the
// project's all-or-nothing posture, a snapshot that cannot be written is a
// publish that must roll back so the timeline never lies about history.

import { eq } from 'drizzle-orm';
import * as Y from 'yjs';

import { encodeYDoc } from '../canvas/yjs-projection.js';
import type { Db } from '../db/client.js';
import { site, siteSnapshot } from '../db/schema.js';

import { pruneSnapshots, type PruneEnv } from './prune.js';

/**
 * Narrow env subset the capture primitives need. We do NOT take the full
 * Cloudflare `Bindings` shape because the capture path doesn't touch the
 * Durable Object, R2, or Clerk — keeping the surface narrow makes the
 * primitive callable from the smoke without faking a Workers runtime.
 *
 * Identical to `PruneEnv` today; declared as a distinct type alias so a
 * future env-bound prune knob (e.g. a per-Owner retention override) can
 * propagate to capture callers without re-threading every signature.
 */
export type CaptureEnv = PruneEnv;

interface CaptureCtx {
  siteId: string;
  reason: 'publish' | 'manual';
  publishedVersion: number | null;
  label: string | null;
  db: Db;
  env: CaptureEnv;
}

async function captureSnapshot(ctx: CaptureCtx): Promise<void> {
  const rows = await ctx.db
    .select({ editableState: site.editableState })
    .from(site)
    .where(eq(site.id, ctx.siteId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    // Fail loudly per the project posture. The publish path proves the row
    // exists before it calls us; a missing row here means concurrent
    // deletion or a bad siteId from the manual route.
    throw new Error(`[version/capture] site ${ctx.siteId} not found`);
  }

  // Encode → Y.Doc → state-as-update bytes. The encode path is centralised
  // in `src/canvas/yjs-projection.ts`; we never reach into the JSON shape
  // directly. The bytes are what `Y.applyUpdate` + `decodeYDoc` consume on
  // restore.
  const doc = encodeYDoc(row.editableState);
  const yjsSnapshotBytes = Y.encodeStateAsUpdate(doc);

  // `label` and `publishedVersion` are nullable; we pass null explicitly so
  // the inserted row matches the schema's `text` / `integer` nullability
  // rather than relying on drizzle to map `undefined` to NULL (which it does,
  // but being explicit makes the captured payload greppable in production
  // logs).
  await ctx.db.insert(siteSnapshot).values({
    siteId: ctx.siteId,
    yjsSnapshotBytes,
    reason: ctx.reason,
    label: ctx.label,
    publishedVersion: ctx.publishedVersion,
  });

  // Pruning runs after every capture — idempotent, cheap. The policy keeps
  // the per-site row count bounded so the timeline UI never has to paginate
  // beyond a single page in practice.
  await pruneSnapshots(ctx.siteId, ctx.db, ctx.env);
}

/**
 * Capture an automatic snapshot at publish time.
 *
 * Called by the publish route AFTER the publish row has been updated. The
 * `publishedVersion` argument is the version stamped onto the published
 * snapshot — recording it on the version-history row lets the timeline UI
 * show "v3" / "v4" labels without a join.
 */
export function captureOnPublish(
  siteId: string,
  publishedVersion: number,
  db: Db,
  env: CaptureEnv,
): Promise<void> {
  return captureSnapshot({
    siteId,
    reason: 'publish',
    publishedVersion,
    label: null,
    db,
    env,
  });
}

/**
 * Capture a manual snapshot with an Owner-supplied label.
 *
 * The label is required — version history's value to the Owner is the
 * ability to point at past moments by name. Callers that have no label
 * (e.g. the pre-restore safety snapshot) build one before calling.
 */
export function captureManual(
  siteId: string,
  label: string,
  db: Db,
  env: CaptureEnv,
): Promise<void> {
  if (label.length === 0) {
    throw new Error('[version/capture] captureManual requires a non-empty label');
  }
  return captureSnapshot({
    siteId,
    reason: 'manual',
    publishedVersion: null,
    label,
    db,
    env,
  });
}
