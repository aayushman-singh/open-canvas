// src/billing/ai-rate-limit.smoke.ts
//
// Pins the per-account AI caps: the policy values, the over-budget block, the
// per-account partitioning, the window refresh, and the Retry-After
// derivation. The Durable Object transport is covered by the password
// rate-limit smoke; here we drive the same rolling-window logic through the
// InProcessRateLimiter to stay hermetic.

import { AI_RATE_LIMITS, aiRateLimitRetryAfterSeconds } from './ai-rate-limit';
import { InProcessRateLimiter } from '../password/rate-limit';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[ai-rate-limit:smoke] ${msg}`);
}

// 1 — policy values are the agreed hard caps (60/h text, 15/h image).
assert(AI_RATE_LIMITS['ai-agent'].limit === 60, 'ai-agent cap is 60');
assert(AI_RATE_LIMITS['ai-agent'].windowSeconds === 3600, 'ai-agent window is 1h');
assert(AI_RATE_LIMITS['ai-image'].limit === 15, 'ai-image cap is 15');
assert(AI_RATE_LIMITS['ai-image'].windowSeconds === 3600, 'ai-image window is 1h');

// 2 — the bucket allows exactly `limit` actions per window, then blocks; a
// second account is unaffected; the window refreshes the budget.
{
  let nowMs = 1_000_000;
  const limiter = new InProcessRateLimiter(() => nowMs);
  const policy = AI_RATE_LIMITS['ai-agent'];
  const call = (ipKey: string) =>
    limiter.checkAndRecord({
      kind: 'ai-agent',
      ipKey,
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    });

  let remaining = -1;
  for (let i = 0; i < policy.limit; i += 1) {
    const r = await call('customer-A');
    assert(r.allowed, `call ${String(i + 1)} within budget is allowed`);
    remaining = r.remaining;
  }
  assert(remaining === 0, 'last in-budget call leaves 0 remaining');

  const blocked = await call('customer-A');
  assert(!blocked.allowed, `call ${String(policy.limit + 1)} is blocked`);
  assert(blocked.retryAfterMs !== null, 'blocked result carries a retryAfterMs');

  const other = await call('customer-B');
  assert(other.allowed, 'a second account keeps its own budget (per-account cap)');

  nowMs += policy.windowSeconds * 1000 + 1;
  const afterWindow = await call('customer-A');
  assert(afterWindow.allowed, 'budget refreshes after the window elapses');
}

// 3 — Retry-After derivation from the absolute retryAfterMs timestamp.
{
  const now = 2_000_000;
  const sec = aiRateLimitRetryAfterSeconds(
    { allowed: false, remaining: 0, retryAfterMs: now + 30_000 },
    now,
  );
  assert(sec === 30, `retry-after rounds to 30s, got ${String(sec)}`);
  const fallback = aiRateLimitRetryAfterSeconds(
    { allowed: true, remaining: 5, retryAfterMs: null },
    now,
  );
  assert(fallback === 60, 'null retryAfterMs falls back to 60s');
}

console.log('[ai-rate-limit:smoke] OK');
