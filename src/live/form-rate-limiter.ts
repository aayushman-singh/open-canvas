// src/live/form-rate-limiter.ts
//
// Wave 2 #7 — Forms rate-limiter Durable Object.
//
// Per-IP rate limiting for form submissions. One DO instance is keyed by
// `FORM_RATE_LIMITER.idFromName(ipHash)`; the submit handler routes the
// submit's ipHash to this DO and asks `tryAcquire(ipHash, 'form-per-ip')`.
// The DO maintains a tick-tock 60-second window counter — when the visitor's
// 60s budget is exhausted, the call returns `{ ok: false, remaining: 0 }`.
//
// Why a DO and not Workers KV / D1: per-IP rate limits must be atomic
// against concurrent submits from the same IP. A DO instance serialises
// every call through a single isolate, so the increment-then-compare cycle
// is race-free without explicit locking. KV's eventual consistency would
// let a burst of parallel submits all read "9 remaining" before any of
// them write 10, breaking the cap.
//
// Per-form hourly limit (100/hour/form) is NOT enforced here — that's a
// site-wide concern, not per-IP, and the form submit handler enforces it
// via a direct `formSubmission` count over the last hour. See
// src/forms/submit.ts.
//
// Wire protocol + types live in `./form-rate-limiter-client.ts` so consumers
// can talk to a stub of this DO without pulling `cloudflare:workers` in.

import { DurableObject } from 'cloudflare:workers';

import { POLICIES, type RateLimitKind, type TryAcquireResult } from './form-rate-limiter-client.js';

interface PersistedCounterState {
  count: number;
  windowStartMs: number;
}

/**
 * Body envelope for /try-acquire POSTs from the submit handler. We expose the
 * fetch surface so the production submit handler can call via the DO's
 * standard Stub.fetch path; the smoke harness calls `tryAcquire` directly on
 * an in-process instance.
 */
interface TryAcquireRequestBody {
  ipHash: string;
  kind: RateLimitKind;
}

function isTryAcquireBody(value: unknown): value is TryAcquireRequestBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ipHash !== 'string' || v.ipHash.length === 0) return false;
  if (typeof v.kind !== 'string') return false;
  return v.kind === 'form-per-ip';
}

export class FormRateLimiter extends DurableObject<unknown> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/try-acquire' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch (err) {
        console.error('[FormRateLimiter] body parse failed', err);
        return new Response('invalid JSON body', { status: 400 });
      }
      if (!isTryAcquireBody(body)) {
        return new Response('expected { ipHash: string, kind: "form-per-ip" }', {
          status: 400,
        });
      }
      const result = await this.tryAcquire(body.ipHash, body.kind);
      return Response.json(result, {
        status: result.ok ? 200 : 429,
      });
    }
    return new Response('not found', { status: 404 });
  }

  /**
   * Attempt to acquire one token for `(ipHash, kind)` in the current window.
   * The ipHash is informational here — this DO instance is already keyed by
   * the caller via `FORM_RATE_LIMITER.idFromName(ipHash)`, so the ipHash arg
   * is only used to disambiguate between concurrent kinds in logs.
   */
  async tryAcquire(ipHash: string, kind: RateLimitKind): Promise<TryAcquireResult> {
    void ipHash; // already encoded in this DO instance's id
    const policy = POLICIES[kind];
    const now = Date.now();

    // Pull the current counter state. DurableObject storage round-trips
    // happen inside a single isolate so the read-modify-write below is
    // atomic against concurrent submits routed to the same DO.
    const countKey = `count:${kind}`;
    const windowKey = `window:${kind}`;

    const stored = await this.ctx.storage.get<PersistedCounterState>(`state:${kind}`);
    let count = 0;
    let windowStartMs = now;
    if (stored && typeof stored.count === 'number' && typeof stored.windowStartMs === 'number') {
      count = stored.count;
      windowStartMs = stored.windowStartMs;
    }

    // Tick-tock the window: if the stored window is older than the policy
    // window, reset count to 0 and slide the window forward to `now`.
    if (now - windowStartMs >= policy.windowMs) {
      count = 0;
      windowStartMs = now;
    }

    if (count >= policy.cap) {
      // No write — the cap is reached. The window will roll over naturally
      // on the next allowed call.
      return { ok: false, remaining: 0, windowStartMs };
    }

    count += 1;
    const next: PersistedCounterState = { count, windowStartMs };
    await this.ctx.storage.put(`state:${kind}`, next);

    // Legacy convenience keys: store split count/window scalars too. Future
    // observability paths read them by name. The combined `state:` key is
    // the source of truth.
    await this.ctx.storage.put(countKey, count);
    await this.ctx.storage.put(windowKey, windowStartMs);

    return { ok: true, remaining: policy.cap - count, windowStartMs };
  }

  /**
   * Reset the counter for a kind. Used by the smoke harness between
   * assertions; production never calls this.
   *
   * @internal Test-only.
   */
  async __resetForTest(kind: RateLimitKind): Promise<void> {
    await this.ctx.storage.delete(`state:${kind}`);
    await this.ctx.storage.delete(`count:${kind}`);
    await this.ctx.storage.delete(`window:${kind}`);
  }
}
