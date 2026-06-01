// Worker cron dispatcher. The Worker default export in src/index.ts wires
// `scheduled` here; cron expressions live in wrangler.toml under `[triggers]`.
// Per-feature scheduled tasks live next to the feature they belong to and the
// dispatcher routes by event.cron so the entry stays free of per-feature
// knowledge.
//
// Cron map (kept in sync with wrangler.toml):
//   "*/5 * * * *"   → src/custom-domain/cron.ts (every 5 minutes)
//   "0 3 * * *"     → src/notifications/retention.ts (daily at 03:00 UTC)

import { scheduled as customDomainScheduled } from './custom-domain/cron';
import { runNotificationRetention, type RetentionEnv } from './notifications/retention';
import type { PollEnv } from './custom-domain/poll';

interface ScheduledEventLike {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

type CronEnv = PollEnv & RetentionEnv;

export function scheduled(
  event: ScheduledEventLike,
  env: CronEnv,
  ctx: ExecutionContextLike,
): void {
  if (event.cron === '0 3 * * *') {
    ctx.waitUntil(runRetention(env));
    return;
  }
  // Default: custom-domain status poller (every 5 minutes).
  customDomainScheduled(event, env, ctx);
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
