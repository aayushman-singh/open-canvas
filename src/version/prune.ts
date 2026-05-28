// src/version/prune.ts
//
// Pruning policy for the `siteSnapshot` table.
//
// Per the brief:
//   * Keep the last 50 snapshots per site.
//   * Publish snapshots within the last 90 days are NEVER pruned, even when
//     they would otherwise fall outside the 50 newest.
//
// Algorithm — two phases, both bounded by the policy's own per-site cap:
//
//   1. Read every snapshot for the site (id, capturedAt, reason) ordered
//      newest-first. The per-site count is bounded by this very policy, so
//      the row count is O(50) in steady state and bursts up to "last
//      capture + 1" before the prune fires.
//
//   2. In application code, compute the retain set:
//        * the first 50 rows in newest-first order, unconditionally; PLUS
//        * any `reason='publish'` row whose `capturedAt >= now - 90 days`.
//      The union of those two sets is what stays. Everything else is
//      dropped in one bulk delete.
//
// Doing the union in JS rather than a single fancy SQL predicate keeps the
// behaviour easy to reason about + easy to test against the in-memory DB
// stub the smoke uses. The N is small (rarely above 60–70 in steady state)
// so a JS pass is cheaper than a recursive CTE — and the policy doesn't
// need transactional isolation: a missed prune means at most one extra
// row stays until the next capture's prune catches up. (Idempotent.)
//
// Failure posture: a prune error is logged loudly but does NOT throw back
// into the capture path. Pruning is housekeeping; a failed prune leaves
// the just-inserted snapshot row in place — the safe outcome for an Owner
// who cares about the history. Per the project's all-or-nothing posture,
// we still log every failure with full context so the failure mode is
// auditable.

import { desc, eq, inArray } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { siteSnapshot } from '../db/schema.js';

/**
 * Narrow env subset the prune primitive consumes. Empty today; declared so
 * a future tuning knob (e.g. a per-Owner retention override) propagates
 * through the capture call-chain without re-threading signatures.
 *
 * Declared as `unknown` (rather than `Record<string, never>` or `{}`) so
 * callers can pass any wider env object — exactly the shape the version
 * routes need so they can forward `c.env` (which carries SITE_ROOM,
 * DATABASE_URL, etc.) without re-narrowing at every call site.
 */
export type PruneEnv = unknown;

/**
 * Hard cap on the per-site snapshot count. Older rows beyond this are
 * dropped UNLESS they qualify under PUBLISH_RETENTION_DAYS.
 */
export const MAX_SNAPSHOTS_PER_SITE = 50;

/**
 * Publish-snapshot retention floor. Publish rows captured within this many
 * days of `now()` are never pruned, regardless of where they fall in the
 * newest-first order.
 */
export const PUBLISH_RETENTION_DAYS = 90;

/**
 * Pure decision function — given a list of snapshot rows for a site
 * (ordered newest-first) and the current time, return the ids to drop.
 *
 * Exposed for the smoke; the production caller goes through
 * `pruneSnapshots` which wires the DB read/delete around this function.
 */
export function computeDeletionIds(
  rows: ReadonlyArray<{ id: string; capturedAt: Date; reason: 'publish' | 'manual' }>,
  now: Date = new Date(),
): string[] {
  const retentionCutoffMs = now.getTime() - PUBLISH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  // Sort newest-first deterministically. The DB read already orders by
  // capturedAt DESC, but the in-memory stub (smoke) hands us rows in
  // insertion order — we re-sort here so the function is total over any
  // input ordering.
  const sorted = [...rows].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());

  const retainIds = new Set<string>();
  // Rule 1 — the newest 50 stay unconditionally.
  for (let i = 0; i < Math.min(sorted.length, MAX_SNAPSHOTS_PER_SITE); i += 1) {
    const entry = sorted[i];
    if (entry) retainIds.add(entry.id);
  }
  // Rule 2 — publish rows within the retention window stay even if outside
  // the newest 50.
  for (const entry of sorted) {
    if (entry.reason !== 'publish') continue;
    if (entry.capturedAt.getTime() < retentionCutoffMs) continue;
    retainIds.add(entry.id);
  }

  return sorted.filter((entry) => !retainIds.has(entry.id)).map((entry) => entry.id);
}

/**
 * Run the pruning policy for one site. Idempotent: calling twice in a row
 * with no new captures is a no-op.
 *
 * `env` is currently unused; declared so a future retention knob can
 * surface through it without re-threading every call site.
 */
export async function pruneSnapshots(siteId: string, db: Db, env: PruneEnv): Promise<void> {
  void env;
  try {
    const rows = await db
      .select({
        id: siteSnapshot.id,
        capturedAt: siteSnapshot.capturedAt,
        reason: siteSnapshot.reason,
      })
      .from(siteSnapshot)
      .where(eq(siteSnapshot.siteId, siteId))
      .orderBy(desc(siteSnapshot.capturedAt));

    // The `reason` column is `text` in the schema (with a `.$type<'publish'
    // | 'manual'>()` brand). Cast back to the narrow shape `computeDeletionIds`
    // expects — the column constraint ensures the cast is sound.
    const typedRows = rows.map((r) => ({
      id: r.id,
      capturedAt: r.capturedAt,
      reason: r.reason,
    }));
    const toDelete = computeDeletionIds(typedRows);
    if (toDelete.length === 0) return;

    await db.delete(siteSnapshot).where(inArray(siteSnapshot.id, toDelete));
  } catch (error) {
    // Housekeeping failure — log loudly, never throw. The just-inserted
    // capture row is still in place; the next prune catches up.
    console.error('[version/prune] pruneSnapshots failed', { siteId, error });
  }
}
