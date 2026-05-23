// src/custom-domain/cron.ts
//
// Workers Cron Trigger entry point for the custom-domain status poller.
//
// Wiring (main thread responsibility per the brief):
//   - `wrangler.toml` adds a `[triggers]` block:
//       [triggers]
//       crons = ["*/5 * * * *"]
//   - `src/index.ts` exports `scheduled` from this module on the worker
//     default export.
//
// Cadence: every 5 minutes. CF rate-limits Custom Hostname GETs per zone;
// with 5-minute cadence the steady-state cost is bounded even with hundreds
// of pending hostnames. The 30-minute pending-to-failed flip works out to
// six poll attempts before a row is given up on.
//
// Failure mode: a scheduled handler that throws marks the run failed in the
// CF dashboard. We swallow nothing — `pollAllPending` already isolates
// per-row failures internally; if the wrapper itself throws (e.g. the env
// is missing CF_API_TOKEN), the cron run shows red and the operator gets a
// real signal instead of a silently-dead poller.

import { buildPollDepsFromEnv, pollAllPending, type PollEnv } from './poll.js';

/**
 * Cloudflare Workers scheduled-event handler signature. The main thread wires
 * this into the worker's default export.
 *
 * The `ScheduledEvent`, `ExecutionContext`, etc. types live on the workers
 * runtime; we accept the shape we need and let TypeScript infer the rest.
 */
export interface ScheduledEventLike {
  cron: string;
  scheduledTime: number;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export function scheduled(
  event: ScheduledEventLike,
  env: PollEnv,
  ctx: ExecutionContextLike,
): void {
  // `waitUntil` keeps the worker alive until the polling pass finishes.
  // Without it the runtime can recycle the isolate before all CF requests
  // complete, leaving some rows with stale status.
  ctx.waitUntil(runScheduled(event, env));
}

async function runScheduled(event: ScheduledEventLike, env: PollEnv): Promise<void> {
  const startedAt = Date.now();
  const deps = await buildPollDepsFromEnv(env);
  const outcomes = await pollAllPending(deps);
  const transitioned = outcomes.filter((o) => o.before !== o.after);
  console.log('[custom-domain:cron] tick complete', {
    cron: event.cron,
    elapsedMs: Date.now() - startedAt,
    polled: outcomes.length,
    transitioned: transitioned.length,
    transitions: transitioned.map((o) => ({
      hostname: o.hostname,
      from: o.before,
      to: o.after,
      reason: o.failureReason,
    })),
  });
}
