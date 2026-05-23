// src/forms/webhook.ts
//
// Outbound webhook delivery for form submissions.
//
// When the Owner configures `webhookUrl` on a FormElement, every successful
// submission POSTs a JSON envelope (siteId, formElementId, pageSlug, payload,
// submittedAt) to that URL. The body is signed with HMAC-SHA256 using
// `env.WEBHOOK_SIGNING_SECRET`; receivers verify the signature to confirm the
// request came from rev01.
//
// Project-policy notes:
//   - The webhook is fire-and-forget from the request handler's perspective —
//     the submit response does NOT wait for the webhook before answering the
//     Visitor. But "fire-and-forget" is NOT "don't bother knowing the
//     outcome": every delivery is logged loud, success or failure, with the
//     URL + status + duration. A silent fallback (e.g. "retry queue") is
//     out of scope; the user gets the loud-log audit trail and the dashboard
//     inbox is the source of truth for the submission itself.
//   - A 5-second timeout caps the in-flight outbound call so a hostile
//     webhook URL can't pin a Worker invocation forever.

const SIGNATURE_HEADER = 'X-Rev01-Signature';
const DEFAULT_TIMEOUT_MS = 5000;

export interface WebhookPayload {
  siteId: string;
  formElementId: string;
  pageSlug: string;
  payload: Record<string, unknown>;
  submittedAt: string;
}

export interface WebhookDeliveryResult {
  ok: boolean;
  /** HTTP status on success, 0 for transport error. */
  status: number;
  /** Wall-clock latency observed by the caller. */
  durationMs: number;
  /** Failure mode when ok=false. */
  error?: 'timeout' | 'transport' | 'http-error' | 'invalid-url';
  message?: string;
}

export interface WebhookDeliveryOptions {
  /** Override the default 5s timeout. */
  timeoutMs?: number;
  /** Override fetch. Used by the smoke. */
  fetchImpl?: typeof fetch;
}

/**
 * Encode the signature header: `sha256=<base64>` over the JSON body bytes.
 *
 * Receivers verify by:
 *   1. Reading the raw request body bytes (NOT the parsed JSON — whitespace
 *      matters).
 *   2. Running HMAC-SHA256 with their shared `WEBHOOK_SIGNING_SECRET`.
 *   3. base64-encoding the result and comparing to the header value.
 */
export async function signWebhookBody(
  secret: string,
  bodyBytes: Uint8Array,
): Promise<string> {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error(
      '[forms/webhook] signWebhookBody called with empty secret — WEBHOOK_SIGNING_SECRET must be set',
    );
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  // bodyBytes.buffer can be a SharedArrayBuffer on some runtimes; pass a
  // sliced view rooted in a plain ArrayBuffer to keep WebCrypto happy.
  // Wrap in a Uint8Array first so .buffer is guaranteed ArrayBuffer.
  const copy = new Uint8Array(bodyBytes);
  const signature = await crypto.subtle.sign('HMAC', key, copy);
  return bytesToBase64(new Uint8Array(signature));
}

function bytesToBase64(bytes: Uint8Array): string {
  // Workers runtime ships btoa in the global; use it for portability instead
  // of pulling Node's Buffer.
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i] as number);
  }
  return btoa(str);
}

/**
 * Deliver one webhook with timeout + HMAC signature.
 *
 * On transport error or non-2xx response, returns `{ ok: false }` plus a
 * machine-readable `error` code. Never throws — the caller is the submit
 * handler which needs to continue regardless of webhook outcome.
 */
export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload,
  options: WebhookDeliveryOptions = {},
): Promise<WebhookDeliveryResult> {
  // URL validation: reject anything that fails to parse, anything outside
  // http(s), and explicit local-loopback/RFC1918 destinations.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      status: 0,
      durationMs: 0,
      error: 'invalid-url',
      message: `webhookUrl ${describeUrl(url)} failed to parse`,
    };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      ok: false,
      status: 0,
      durationMs: 0,
      error: 'invalid-url',
      message: `webhookUrl uses unsupported scheme ${parsed.protocol}`,
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const bodyString = JSON.stringify(payload);
  const bodyBytes = new TextEncoder().encode(bodyString);
  const signature = await signWebhookBody(secret, bodyBytes);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(parsed.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        [SIGNATURE_HEADER]: signature,
      },
      body: bodyString,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    const durationMs = Date.now() - startedAt;
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[forms/webhook] delivery failed', {
      url: parsed.toString(),
      error: isAbort ? 'timeout' : 'transport',
      durationMs,
      message,
    });
    return {
      ok: false,
      status: 0,
      durationMs,
      error: isAbort ? 'timeout' : 'transport',
      message,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }

  const durationMs = Date.now() - startedAt;
  if (!response.ok) {
    console.error('[forms/webhook] delivery returned non-2xx', {
      url: parsed.toString(),
      status: response.status,
      durationMs,
    });
    return {
      ok: false,
      status: response.status,
      durationMs,
      error: 'http-error',
      message: `webhook returned HTTP ${String(response.status)}`,
    };
  }

  console.log('[forms/webhook] delivered', {
    url: parsed.toString(),
    status: response.status,
    durationMs,
  });
  return { ok: true, status: response.status, durationMs };
}

function describeUrl(value: string): string {
  return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value);
}

/** Exported constant for tests + receivers building their own verifier. */
export const WEBHOOK_SIGNATURE_HEADER = SIGNATURE_HEADER;
