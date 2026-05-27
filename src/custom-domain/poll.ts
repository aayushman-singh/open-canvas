// src/custom-domain/poll.ts
//
// Polls Cloudflare for each non-terminal customDomain row and updates the
// persisted `status` + `certIssuedAt` columns from the CF API response.
//
// Trigger sources:
//   - The Workers Cron Trigger handler in `cron.ts` calls
//     `pollAllPending(env)` every 5 minutes (cadence documented in
//     SUBSYSTEM.md).
//   - The dashboard GET handler can call `pollOne(deps, row)` for a single
//     row on read to surface fresh state without waiting for cron — lazy
//     refresh hybrid per the plan's open question.
//
// Auto-failure rule (per the brief):
//   Rows in `pending` or `verifying` for more than 30 minutes since
//   `createdAt` flip to `'failed'`. This is what the brief calls the
//   "owner-DNS misconfigured" surface — the dashboard renders a friendly
//   "we couldn't verify your DNS, double-check it and re-register" copy.
//   Failure is sticky: once `failed`, the row does not auto-recover —
//   the Owner must DELETE + re-register. This matches ADR 0005 decision 4.

import { eq, inArray } from 'drizzle-orm';
import type { CfHostnamesClient, CfCustomHostname } from './cf-api.js';
import { CfApiError, mapCfStatus } from './cf-api.js';
import { db as createDb, type Db } from '../db/client.js';
import { customDomain, type CustomDomain } from '../db/schema.js';

export interface PollEnv {
  DATABASE_URL: string;
  CF_API_TOKEN: string;
  CF_ZONE_ID: string;
}

export interface PollDeps {
  db: Db;
  cf: CfHostnamesClient;
  /** Override "now" — only the smoke supplies this. */
  now?: () => Date;
}

const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface PollOutcome {
  rowId: string;
  hostname: string;
  before: CustomDomain['status'];
  after: CustomDomain['status'];
  /** Whether the row's `certIssuedAt` was set or moved on this poll. */
  certUpdated: boolean;
  /** Reason for a `failed` transition, if applicable. */
  failureReason?: string;
}

/**
 * Poll a single row. Returns a structured outcome for logging/tests.
 *
 * Behaviour:
 *   - If the row is older than PENDING_TTL_MS and still pending/verifying,
 *     mark it `failed` without touching CF.
 *   - Otherwise GET the CF hostname. Map CF status → our 4-value enum.
 *   - Update `status` and, when ssl is active, `certIssuedAt`.
 *   - A CF API error (network or 5xx) does NOT mark the row failed — that
 *     would punish a transient CF outage. We log loudly and leave the row
 *     untouched; the next poll retries.
 */
export async function pollOne(
  deps: PollDeps,
  row: CustomDomain,
): Promise<PollOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const age = now.getTime() - row.createdAt.getTime();

  // 30-minute stuck-pending guard. Active rows don't fall back to failed; the
  // contract is one-way once a hostname has flipped active.
  if ((row.status === 'pending' || row.status === 'verifying') && age >= PENDING_TTL_MS) {
    await deps.db
      .update(customDomain)
      .set({ status: 'failed' })
      .where(eq(customDomain.id, row.id));
    return {
      rowId: row.id,
      hostname: row.hostname,
      before: row.status,
      after: 'failed',
      certUpdated: false,
      failureReason: `pending for more than ${String(PENDING_TTL_MS / 60000)} minutes`,
    };
  }

  // Terminal states: 'active' rows still get polled (CF may revoke or move),
  // but 'failed' rows do not — they're sticky until the Owner deletes.
  if (row.status === 'failed') {
    return {
      rowId: row.id,
      hostname: row.hostname,
      before: row.status,
      after: row.status,
      certUpdated: false,
    };
  }

  let cfResult: CfCustomHostname;
  try {
    cfResult = await deps.cf.get(row.cfHostnameId);
  } catch (err) {
    if (err instanceof CfApiError && err.status === 404) {
      // CF dropped the hostname — the row is orphaned. Flip to failed so the
      // Owner sees it instead of staring at a perpetual "verifying".
      await deps.db
        .update(customDomain)
        .set({ status: 'failed' })
        .where(eq(customDomain.id, row.id));
      return {
        rowId: row.id,
        hostname: row.hostname,
        before: row.status,
        after: 'failed',
        certUpdated: false,
        failureReason: 'Cloudflare no longer recognises this hostname',
      };
    }
    console.error('[custom-domain] CF poll failed for row', {
      rowId: row.id,
      hostname: row.hostname,
      err,
    });
    return {
      rowId: row.id,
      hostname: row.hostname,
      before: row.status,
      after: row.status,
      certUpdated: false,
    };
  }

  const nextStatus = mapCfStatus(cfResult);
  const sslActive = (cfResult.ssl.status ?? '').toLowerCase() === 'active';

  let certIssuedAt = row.certIssuedAt;
  let certUpdated = false;
  if (nextStatus === 'active' && sslActive && !certIssuedAt) {
    // CF surfaces issuance time on the hostname object as `created_at` for
    // the hostname itself (not the cert), so we stamp it ourselves when we
    // first observe the cert go active.
    certIssuedAt = now;
    certUpdated = true;
  }

  if (nextStatus === row.status && !certUpdated) {
    // No-op poll — refresh the verification record anyway so the dashboard
    // sees the latest CF state (validation_errors, etc.).
    await deps.db
      .update(customDomain)
      .set({ verificationRecord: cfResult as unknown as Record<string, unknown> })
      .where(eq(customDomain.id, row.id));
    return {
      rowId: row.id,
      hostname: row.hostname,
      before: row.status,
      after: row.status,
      certUpdated: false,
    };
  }

  await deps.db
    .update(customDomain)
    .set({
      status: nextStatus,
      verificationRecord: cfResult as unknown as Record<string, unknown>,
      ...(certUpdated ? { certIssuedAt } : {}),
    })
    .where(eq(customDomain.id, row.id));

  return {
    rowId: row.id,
    hostname: row.hostname,
    before: row.status,
    after: nextStatus,
    certUpdated,
  };
}

/**
 * Cron entry point: pull every row that is NOT in a terminal-failure state,
 * poll each, and return the per-row outcomes for logging.
 *
 * Rows in `failed` are skipped — they're terminal and the Owner has to
 * DELETE + re-register to clear them.
 *
 * The poller is intentionally serial. CF rate-limits Custom Hostname GETs
 * per zone; firing N concurrent GETs from a single cron tick risks 429s.
 * If the row count grows we batch by hostname instead.
 */
export async function pollAllPending(
  deps: PollDeps,
): Promise<PollOutcome[]> {
  const rows = await deps.db
    .select()
    .from(customDomain)
    .where(inArray(customDomain.status, ['pending', 'verifying', 'active']));
  const outcomes: PollOutcome[] = [];
  for (const row of rows) {
    try {
      outcomes.push(await pollOne(deps, row));
    } catch (err) {
      // A per-row error must not stop the whole tick. Log and continue.
      console.error('[custom-domain] poll iteration failed', {
        rowId: row.id,
        hostname: row.hostname,
        err,
      });
    }
  }
  return outcomes;
}

/**
 * Convenience wrapper for the dashboard GET — fetches the row, polls once,
 * returns the fresh state. The dashboard uses this so the Owner sees the
 * current status without waiting for the next cron tick.
 */
export async function pollOneById(
  deps: PollDeps,
  rowId: string,
): Promise<PollOutcome | null> {
  const rows = await deps.db
    .select()
    .from(customDomain)
    .where(eq(customDomain.id, rowId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return pollOne(deps, row);
}

/**
 * Build a PollDeps from the worker env. The route layer / cron handler call
 * this; the smoke wires its own deps with a stub CF client.
 */
export async function buildPollDepsFromEnv(env: PollEnv): Promise<PollDeps> {
  const { createCfHostnamesClient } = await import('./cf-api.js');
  return {
    db: createDb(env),
    cf: createCfHostnamesClient({
      apiToken: env.CF_API_TOKEN,
      zoneId: env.CF_ZONE_ID,
    }),
  };
}

