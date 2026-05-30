// src/password/rate-limit.ts
//
// Per-IP rate limiter for failed unlock attempts. The plan budget is 5
// failed attempts per 60 seconds per IP — the 6th failure inside the window
// returns 429 from the unlock route. Successful attempts do NOT consume
// budget.
//
// Implementation strategy:
//
//   - In production we delegate to the `FormRateLimiter` Durable Object
//     class (declared in `wrangler.toml`, shared with `src/forms/`). The DO
//     is `kind`-aware: forms and password subsystems share the DO class but
//     its storage namespace partitions by `(kind, key)` so the two surfaces
//     don't collide. The contract we depend on is a `fetch(request)` that
//     takes a `{ kind, key, limit, windowSeconds }` JSON body and returns
//     `{ allowed: boolean, remaining: number }`.
//
//   - We route through a `RateLimiter` interface so the smoke can swap in
//     an in-process `Map<key, timestamps[]>` implementation that runs
//     without a DO binding. Production picks `DurableObjectRateLimiter`
//     when the binding is present.
//
// All-or-nothing failure: a rate-limit storage failure throws to the caller.
// The unlock route catches that and returns 503 — we do NOT silently let
// the request through, because that would let an attacker bypass the limit
// by overloading the DO. Better to fail closed than open.

export interface RateLimitCheckInput {
  /** Stable per-IP identifier; the unlock route passes the CF-Connecting-IP. */
  ipKey: string;
  /** Logical per-feature namespace. The DO partitions storage by this. */
  kind: 'password-unlock';
  /** Maximum failed attempts allowed inside the window. Default 5. */
  limit?: number;
  /** Sliding-window width in seconds. Default 60. */
  windowSeconds?: number;
}

export interface RateLimitResult {
  /** True if the attempt MAY proceed (count was below the limit before this call). */
  allowed: boolean;
  /** Remaining attempts after this call. Floors at 0. */
  remaining: number;
  /** When the next attempt becomes available (unix ms). Null when allowed. */
  retryAfterMs: number | null;
}

export interface RateLimiter {
  /**
   * Record a FAILED attempt against this IP / kind. If the recorded count
   * exceeds the limit inside the window, returns `{ allowed: false }` —
   * the caller should respond 429 and NOT verify the password.
   *
   * The caller invokes this BEFORE the password check. Successful checks do
   * not call `recordFailure`; only failed checks do. This avoids burning
   * budget on legitimate Visitors who get the password right first try.
   *
   * Naming nit: the function is `checkAndRecord` because it does both —
   * checks whether the IP is over budget, AND records the new attempt. A
   * separate check + record would race on concurrent attempts.
   */
  checkAndRecord(input: RateLimitCheckInput): Promise<RateLimitResult>;
}

const DEFAULT_LIMIT = 5;
const DEFAULT_WINDOW_SECONDS = 60;

// ---------------------------------------------------------------------------
// In-process implementation
// ---------------------------------------------------------------------------
//
// Used by the smoke (deterministic, no DO required) and by the unlock route
// when the DO binding is missing in dev. The Worker isolate is per-request
// short-lived in production, so this is NOT a viable production limiter —
// concurrent isolates each have their own Map and the budget is per-isolate,
// not per-IP-globally. The DO-backed adapter below is the production path.
//
// We keep the in-process limiter exported so the smoke can drive it directly
// without going through the route.

export class InProcessRateLimiter implements RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  /** Override for tests. Defaults to `Date.now`. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async checkAndRecord(input: RateLimitCheckInput): Promise<RateLimitResult> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const windowMs = (input.windowSeconds ?? DEFAULT_WINDOW_SECONDS) * 1000;
    const key = `${input.kind}|${input.ipKey}`;
    const nowMs = this.now();
    const cutoff = nowMs - windowMs;

    // Prune expired entries lazily on each call so the map doesn't grow
    // unbounded. We mutate in place to keep allocation pressure low.
    const arr = this.attempts.get(key) ?? [];
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < arr.length; readIdx += 1) {
      const value = arr[readIdx] ?? 0;
      if (value > cutoff) {
        arr[writeIdx] = value;
        writeIdx += 1;
      }
    }
    arr.length = writeIdx;

    if (arr.length >= limit) {
      // Over budget — the oldest entry is the one whose expiry decides when
      // the IP is allowed to retry. We do NOT append in this branch (already
      // over budget — counting more would extend the lockout).
      const oldest = arr[0] ?? nowMs;
      this.attempts.set(key, arr);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: oldest + windowMs,
      };
    }

    arr.push(nowMs);
    this.attempts.set(key, arr);
    return {
      allowed: true,
      remaining: Math.max(0, limit - arr.length),
      retryAfterMs: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Durable-Object-backed implementation
// ---------------------------------------------------------------------------
//
// The shared `FormRateLimiter` DO is the production limiter. The contract we depend on:
//
//   POST https://do.invalid/check-and-record
//     body: { kind, key, limit, windowSeconds }
//     response 200: { allowed, remaining, retryAfterMs }
//     response 429: { allowed: false, remaining: 0, retryAfterMs }
//     response 500: error message; we throw
//
// We use `idFromName(kind + '|' + ipKey)` so each (kind, IP) pair gets its
// own DO instance. The DO storage is per-instance so the partitioning is
// automatic — we don't have to trust the DO body to honour the `kind` field.
//
// The smoke pins an InProcessRateLimiter via the same `RateLimiter`
// interface — the DO-backed path runs only in production (and in dev when
// the DO binding is present).

export interface FormRateLimiterDoNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

export class DurableObjectRateLimiter implements RateLimiter {
  constructor(private readonly ns: FormRateLimiterDoNamespace) {}

  async checkAndRecord(input: RateLimitCheckInput): Promise<RateLimitResult> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const windowSeconds = input.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
    const name = `${input.kind}|${input.ipKey}`;
    const id = this.ns.idFromName(name);
    const stub = this.ns.get(id);
    const response = await stub.fetch(
      new Request('https://do.invalid/check-and-record', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: input.kind,
          key: input.ipKey,
          limit,
          windowSeconds,
        }),
      }),
    );
    // The DO returns the same JSON body for both 200 and 429 — the status is
    // the convenience signal. We parse the body unconditionally because a
    // missing field is more important to surface than the status code.
    if (!response.ok && response.status !== 429) {
      throw new Error(
        `DurableObjectRateLimiter: DO returned ${String(response.status)} ${response.statusText}`,
      );
    }
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== 'object') {
      throw new Error('DurableObjectRateLimiter: DO response was not an object');
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.allowed !== 'boolean') {
      throw new Error('DurableObjectRateLimiter: DO response missing boolean allowed');
    }
    const remaining = typeof obj.remaining === 'number' ? obj.remaining : 0;
    const retryAfterMs =
      typeof obj.retryAfterMs === 'number'
        ? obj.retryAfterMs
        : obj.retryAfterMs === null
          ? null
          : null;
    return {
      allowed: obj.allowed,
      remaining,
      retryAfterMs,
    };
  }
}
