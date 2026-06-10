// src/billing/ai-rate-limit.ts
//
// Hard per-account AI usage caps for the public deployment. Gemini (canvas
// agent + chat) and Replicate (image generation) are metered providers, so an
// unbounded account could run up the provider bill. Each account gets a
// rolling-window budget, enforced through the shared FormRateLimiter Durable
// Object via the generic DurableObjectRateLimiter (src/password/rate-limit.ts).
//
// Two buckets, partitioned by the DO's (kind, key) storage namespace and keyed
// by customer id:
//   - 'ai-agent'  60 / hour — canvas-agent previews + chat turns (text LLM)
//   - 'ai-image'  15 / hour — Replicate image generation (the costly call)
//
// All-or-nothing: a limiter storage failure throws to the caller, which fails
// the AI request loudly. We never fall open — that would let an account bypass
// the cap by overloading the DO.

import {
  DurableObjectRateLimiter,
  type FormRateLimiterDoNamespace,
  type RateLimitResult,
} from '../password/rate-limit';

export type AiRateLimitKind = 'ai-agent' | 'ai-image';

interface AiRateLimitPolicy {
  /** Maximum AI actions allowed inside the rolling window. */
  limit: number;
  /** Rolling-window width in seconds. */
  windowSeconds: number;
}

/** Per-account hard caps. Server-side constants; not Owner-tweakable. */
export const AI_RATE_LIMITS: Record<AiRateLimitKind, AiRateLimitPolicy> = {
  'ai-agent': { limit: 60, windowSeconds: 3600 },
  'ai-image': { limit: 15, windowSeconds: 3600 },
};

/**
 * Check + record one AI action against the account's rolling-window budget.
 * Returns `{ allowed: false, retryAfterMs }` when the account is over budget —
 * the caller must respond 429 and skip the provider call. Throws when the DO is
 * unreachable (fail-closed; never falls open).
 */
export async function checkAiRateLimit(
  ns: FormRateLimiterDoNamespace,
  customerId: string,
  kind: AiRateLimitKind,
): Promise<RateLimitResult> {
  const policy = AI_RATE_LIMITS[kind];
  const limiter = new DurableObjectRateLimiter(ns);
  return limiter.checkAndRecord({
    kind,
    ipKey: customerId,
    limit: policy.limit,
    windowSeconds: policy.windowSeconds,
  });
}

/**
 * Seconds the caller should wait before retrying, derived from the limiter's
 * absolute `retryAfterMs` timestamp. Suitable for a `Retry-After` header.
 */
export function aiRateLimitRetryAfterSeconds(
  result: RateLimitResult,
  now: number = Date.now(),
): number {
  if (result.retryAfterMs === null) return 60;
  return Math.max(1, Math.ceil((result.retryAfterMs - now) / 1000));
}
