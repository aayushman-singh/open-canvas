// src/forms/turnstile.ts
//
// Cloudflare Turnstile server-side verification.
//
// The Visitor's browser solves an invisible challenge using the public site
// key embedded in the form HTML (see `src/canvas/elements/form.ts`). The
// resulting token is posted alongside the form fields as `cf-turnstile-response`.
// This module hits Cloudflare's `siteverify` endpoint with the token + the
// per-deployment `TURNSTILE_SECRET` and returns a clean result.
//
// We do NOT swallow network errors. If `siteverify` itself errors, we return
// a failure with `error: 'siteverify-unreachable'` so the caller can decide
// the policy (the submit handler treats this as a 502 — never silently
// passes). This matches the all-or-nothing project posture: bot protection
// is not optional, so an outage in CF's verify endpoint blocks submissions
// loudly rather than allowing them through.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileVerifyOk {
  ok: true;
  challengeTs?: string;
  hostname?: string;
}

export interface TurnstileVerifyFail {
  ok: false;
  /** Machine-readable code: 'invalid-token' for a CF "no"; 'siteverify-unreachable' for transport. */
  error: 'invalid-token' | 'siteverify-unreachable' | 'missing-token';
  /** CF's reported error-codes array when applicable. */
  errorCodes?: string[];
  /** Underlying message, surfaced for logs. */
  message?: string;
}

export type TurnstileVerifyResult = TurnstileVerifyOk | TurnstileVerifyFail;

export interface TurnstileVerifyOptions {
  /** Optional remote IP forwarded to CF — `cf-connecting-ip` per CF docs. */
  remoteIp?: string;
  /**
   * Test-only override of the fetch implementation. Production callers leave
   * this undefined; the smoke harness injects a stubbed fetch that returns
   * `{ success: true }` for a known-good "stub-pass" token and a failure for
   * anything else. Keeping this as an explicit injection point (rather than
   * a `globalThis.fetch` monkey-patch) makes the smoke deterministic.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Verify a Turnstile token. Returns a clean result envelope; never throws on
 * transport errors — those become `ok: false, error: 'siteverify-unreachable'`.
 *
 * @param secret  Per-deployment `TURNSTILE_SECRET` from env. Must be set;
 *                callers SHOULD treat an empty secret as a config error.
 * @param token   The `cf-turnstile-response` value submitted by the visitor.
 *                Empty string returns `error: 'missing-token'` without hitting
 *                the network.
 * @param options Optional remote ip + fetch injection.
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  options: TurnstileVerifyOptions = {},
): Promise<TurnstileVerifyResult> {
  if (typeof secret !== 'string' || secret.length === 0) {
    // Loud failure rather than silent-pass: the submit handler treats this as
    // a 500. A Turnstile-protected endpoint MUST have a configured secret.
    throw new Error(
      '[turnstile] verifyTurnstile called with empty secret — TURNSTILE_SECRET must be set',
    );
  }
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, error: 'missing-token' };
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (options.remoteIp) body.set('remoteip', options.remoteIp);

  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    console.error('[turnstile] siteverify transport failed', err);
    return {
      ok: false,
      error: 'siteverify-unreachable',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: 'siteverify-unreachable',
      message: `siteverify returned HTTP ${String(response.status)}`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    console.error('[turnstile] siteverify body was not JSON', err);
    return {
      ok: false,
      error: 'siteverify-unreachable',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (typeof payload !== 'object' || payload === null) {
    return {
      ok: false,
      error: 'siteverify-unreachable',
      message: 'siteverify response was not an object',
    };
  }

  const obj = payload as Record<string, unknown>;
  if (obj.success === true) {
    const result: TurnstileVerifyOk = { ok: true };
    if (typeof obj.challenge_ts === 'string') result.challengeTs = obj.challenge_ts;
    if (typeof obj.hostname === 'string') result.hostname = obj.hostname;
    return result;
  }

  const errorCodes = Array.isArray(obj['error-codes'])
    ? (obj['error-codes'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : undefined;

  const fail: TurnstileVerifyFail = { ok: false, error: 'invalid-token' };
  if (errorCodes) fail.errorCodes = errorCodes;
  return fail;
}
