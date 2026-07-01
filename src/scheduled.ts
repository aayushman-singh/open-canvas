// Worker cron dispatcher. The Worker default export in src/index.ts wires
// `scheduled` here; cron expressions live in wrangler.toml under `[triggers]`.
// Per-feature scheduled tasks live next to the feature they belong to and the
// dispatcher routes by event.cron so the entry stays free of per-feature
// knowledge.
//
// Cron map (kept in sync with wrangler.toml):
//   "0 3 * * *"     → src/notifications/retention.ts (daily at 03:00 UTC)

import { runNotificationRetention, type RetentionEnv } from './notifications/retention';

interface ScheduledEventLike {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export function scheduled(
  event: ScheduledEventLike,
  env: unknown,
  ctx: ExecutionContextLike,
): void {
  if (event.cron === '0 3 * * *') {
    ctx.waitUntil(runRetention(requireRetentionEnv(env)));
    return;
  }
  throw new Error(`Unsupported scheduled cron: ${event.cron}`);
}

function requireRetentionEnv(env: unknown): RetentionEnv {
  if (
    env === null ||
    typeof env !== 'object' ||
    typeof (env as { DATABASE_URL?: unknown }).DATABASE_URL !== 'string' ||
    (env as { DATABASE_URL: string }).DATABASE_URL.length === 0
  ) {
    throw new Error('DATABASE_URL is required for notification retention cron.');
  }
  return env as RetentionEnv;
}

async function runRetention(env: RetentionEnv): Promise<void> {
  const startedAt = Date.now();
  try {
    const outcome = await runNotificationRetention(env);
    console.log('[notifications:retention] sweep complete', {
      elapsedMs: Date.now() - startedAt,
      deletedNotifications: outcome.deletedNotifications,
      cutoff: outcome.cutoff,
    });
  } catch (err) {
    console.error('[notifications:retention] sweep failed', {
      elapsedMs: Date.now() - startedAt,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    });
    throw err;
  }
}
