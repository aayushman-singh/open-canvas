// src/live/form-rate-limiter-client.ts
//
// Wire-protocol types + the `tryAcquireViaStub` helper. Pulled out of
// `src/live/form-rate-limiter.ts` so consumers (submit handler, smoke) don't
// transitively import `cloudflare:workers` — that module is only available
// inside the Worker runtime, but Bun-runnable smokes need to talk to the
// limiter through a stub namespace without pulling the DO class itself.
//
// Wave 2 #7. See plan 07-forms.

/**
 * Opaque marker interface for the FormRateLimiter Durable Object class. The
 * real class lives in `./form-rate-limiter.ts` and imports `cloudflare:workers`,
 * which is unavailable in Bun. Consumers use this opaque alias as a generic
 * parameter on `DurableObjectNamespace<…>` / `DurableObjectStub<…>` so the
 * type narrows correctly without forcing a runtime import.
 *
 * Satisfies the Cloudflare `Rpc.DurableObjectBranded` brand requirement so the
 * `<…>` generic parameter is accepted without further casts.
 */
export interface FormRateLimiterMarker {
  // Brand key mirrors workers-types' `Rpc.__DURABLE_OBJECT_BRAND` const, which
  // is exported as the string literal `"__DURABLE_OBJECT_BRAND"`. We restate it
  // here as a literal computed index so the type satisfies
  // `Rpc.DurableObjectBranded` without forcing a runtime `cloudflare:workers`
  // import. `never` value matches the brand convention — no instance of this
  // marker materialises at runtime.
  ['__DURABLE_OBJECT_BRAND']: never;
}

/** Allowed rate-limit kinds. Mirrors the production policy table. */
export type RateLimitKind = 'form-per-ip';

/** Result of a single `tryAcquire` call. */
export interface TryAcquireResult {
  ok: boolean;
  /** Remaining tokens in the current window AFTER this call (zero when ok=false). */
  remaining: number;
  /** Epoch-ms when the current window started. Useful for diagnostics. */
  windowStartMs: number;
}

/** Per-kind tuning. Server-side constant; not Owner-tweakable. */
export interface RateLimitPolicy {
  /** Tokens per window. */
  cap: number;
  /** Window duration in milliseconds (60_000 = one minute). */
  windowMs: number;
}

export const POLICIES: Record<RateLimitKind, RateLimitPolicy> = {
  'form-per-ip': { cap: 10, windowMs: 60_000 },
};

/**
 * Helper used by the submit handler to call the rate limiter through its
 * DO stub. Centralised here so the submit handler never has to know about
 * the `/try-acquire` URL convention.
 */
export async function tryAcquireViaStub(
  stub: DurableObjectStub<FormRateLimiterMarker>,
  ipHash: string,
  kind: RateLimitKind,
): Promise<TryAcquireResult> {
  const response = await stub.fetch('https://do.invalid/try-acquire', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ipHash, kind }),
  });
  if (response.status !== 200 && response.status !== 429) {
    throw new Error(
      `[FormRateLimiter] stub returned unexpected HTTP ${String(response.status)}`,
    );
  }
  const data: unknown = await response.json();
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as Record<string, unknown>).ok !== 'boolean'
  ) {
    throw new Error('[FormRateLimiter] stub returned non-conforming body');
  }
  return data as TryAcquireResult;
}
