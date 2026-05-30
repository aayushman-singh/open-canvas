// src/live/form-rate-limiter.ts
//
// FormRateLimiter — shared Durable Object backing two surfaces:
//
//   1. Forms visitor submit (`src/forms/`): POST /try-acquire with
//      `{ ipHash, kind }` → fixed-window per-IP budget. Response shape
//      mirrors `TryAcquireResult` in `./form-rate-limiter-client.ts`:
//      `{ ok, remaining, windowStartMs }`. 200 when allowed, 429 when not.
//
//   2. Password unlock (`src/password/`): POST /check-and-record with
//      `{ kind, key, limit, windowSeconds }` → rolling-window failed-attempt
//      budget. Response shape mirrors `RateLimitResult` in
//      `src/password/rate-limit.ts`: `{ allowed, remaining, retryAfterMs }`.
//      200 when allowed, 429 when not.
//
// Storage namespace is partitioned at the DO-instance level by the callers'
// choice of `idFromName()` — forms passes `idFromName(ipHash)` and password
// passes `idFromName(`${kind}|${ipKey}`)`. Inside the instance we still key
// storage by the body's identifying fields so a single instance can serve
// multiple kinds without collision.
//
// All-or-nothing failure: malformed payloads, bad content-type, or unknown
// paths return 4xx with a structured body. We never silently allow on
// storage error — exceptions propagate so the caller sees a 500 and (per
// `src/password/rate-limit.ts`'s contract) fails closed.

import { DurableObject } from 'cloudflare:workers';

import { POLICIES, type RateLimitKind } from './form-rate-limiter-client.js';

interface FixedWindowState {
  count: number;
  windowStartMs: number;
}

interface PasswordWindowState {
  /** Sorted ascending epoch-ms timestamps of recorded attempts inside the window. */
  timestamps: number[];
}

interface TryAcquireBody {
  ipHash: string;
  kind: RateLimitKind;
}

interface CheckAndRecordBody {
  kind: string;
  key: string;
  limit: number;
  windowSeconds: number;
}

function isTryAcquireBody(value: unknown): value is TryAcquireBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ipHash !== 'string' || v.ipHash.length === 0) return false;
  if (typeof v.kind !== 'string') return false;
  return v.kind in POLICIES;
}

function isCheckAndRecordBody(value: unknown): value is CheckAndRecordBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.kind !== 'string' || v.kind.length === 0) return false;
  if (typeof v.key !== 'string' || v.key.length === 0) return false;
  if (typeof v.limit !== 'number' || !Number.isFinite(v.limit) || v.limit < 1) return false;
  if (typeof v.windowSeconds !== 'number' || !Number.isFinite(v.windowSeconds) || v.windowSeconds < 1) {
    return false;
  }
  return true;
}

export class FormRateLimiter extends DurableObject<unknown> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST') {
      return Response.json({ error: 'method not allowed' }, { status: 405 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    if (url.pathname === '/try-acquire') {
      if (!isTryAcquireBody(body)) {
        return Response.json({ error: 'invalid try-acquire body' }, { status: 400 });
      }
      const result = await this.handleTryAcquire(body);
      return Response.json(result, { status: result.ok ? 200 : 429 });
    }

    if (url.pathname === '/check-and-record') {
      if (!isCheckAndRecordBody(body)) {
        return Response.json({ error: 'invalid check-and-record body' }, { status: 400 });
      }
      const result = await this.handleCheckAndRecord(body);
      return Response.json(result, { status: result.allowed ? 200 : 429 });
    }

    return Response.json({ error: 'unknown path', path: url.pathname }, { status: 404 });
  }

  private async handleTryAcquire(
    body: TryAcquireBody,
  ): Promise<{ ok: boolean; remaining: number; windowStartMs: number }> {
    const policy = POLICIES[body.kind];
    const storageKey = `try-acquire:${body.ipHash}|${body.kind}`;
    const now = Date.now();
    const existing = (await this.ctx.storage.get<FixedWindowState>(storageKey)) ?? null;

    let state: FixedWindowState =
      existing && now - existing.windowStartMs < policy.windowMs
        ? { count: existing.count, windowStartMs: existing.windowStartMs }
        : { count: 0, windowStartMs: now };

    if (state.count >= policy.cap) {
      await this.ctx.storage.put(storageKey, state);
      return { ok: false, remaining: 0, windowStartMs: state.windowStartMs };
    }

    state = { count: state.count + 1, windowStartMs: state.windowStartMs };
    await this.ctx.storage.put(storageKey, state);
    return {
      ok: true,
      remaining: policy.cap - state.count,
      windowStartMs: state.windowStartMs,
    };
  }

  private async handleCheckAndRecord(
    body: CheckAndRecordBody,
  ): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number | null }> {
    const windowMs = body.windowSeconds * 1000;
    const storageKey = `check-and-record:${body.kind}|${body.key}`;
    const nowMs = Date.now();
    const cutoff = nowMs - windowMs;

    const existing = (await this.ctx.storage.get<PasswordWindowState>(storageKey)) ?? null;
    const pruned: number[] = [];
    if (existing) {
      for (const t of existing.timestamps) {
        if (t > cutoff) pruned.push(t);
      }
    }

    if (pruned.length >= body.limit) {
      // Over budget — do NOT append. Same semantics as InProcessRateLimiter
      // in `src/password/rate-limit.ts`: extending the array here would
      // extend the lockout window past what the policy promises.
      await this.ctx.storage.put(storageKey, { timestamps: pruned });
      const oldest = pruned[0] ?? nowMs;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: oldest + windowMs,
      };
    }

    pruned.push(nowMs);
    await this.ctx.storage.put(storageKey, { timestamps: pruned });
    return {
      allowed: true,
      remaining: Math.max(0, body.limit - pruned.length),
      retryAfterMs: null,
    };
  }
}
