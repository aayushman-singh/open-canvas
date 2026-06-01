// src/notifications/retention.ts
//
// Nightly retention sweep for ADR 0043's notification rows. Soft-deletes
// (DELETE FROM) rows older than NOTIFICATION_RETENTION_DAYS. The
// notification_read rows that reference a deleted notification are removed
// via the FK ON DELETE CASCADE declared in src/db/schema.ts.
//
// Wiring lives in:
//   - wrangler.toml [triggers].crons — the cron expression that schedules
//     the daily run.
//   - src/scheduled.ts — branches on event.cron to dispatch here.
//
// Failure mode: any DB error throws; the scheduled handler surfaces it as
// a red run in the CF dashboard. The retention sweep is idempotent — a
// failed run leaves the rows in place; the next nightly run picks up where
// it left off.

import { lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notification } from '../db/schema.js';

export const NOTIFICATION_RETENTION_DAYS = 90;

export interface RetentionEnv {
  DATABASE_URL: string;
}

export interface RetentionOutcome {
  deletedNotifications: number;
  cutoff: string;
}

export async function runNotificationRetention(env: RetentionEnv): Promise<RetentionOutcome> {
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const database = db(env);
  const result = await database
    .delete(notification)
    .where(lt(notification.createdAt, cutoff))
    .returning({ id: notification.id });
  return {
    deletedNotifications: result.length,
    cutoff: cutoff.toISOString(),
  };
}
