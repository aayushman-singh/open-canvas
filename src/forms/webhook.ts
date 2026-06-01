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
// Operational contract:
//   - The submit handler awaits delivery so failures are observable in the
//     same execution path. Every success or failure is logged with URL, status,
//     duration, and transport details.
//   - Delivery failure does not delete or mutate the stored submission; the
//     dashboard inbox remains the source of truth for captured form data.
//   - URL validation rejects credentials, non-http(s) schemes, and obvious
//     loopback/private literal hosts before fetch. This is an SSRF guardrail;
//     it is intentionally explicit instead of silently rewriting destinations.
//   - A 5-second timeout caps the outbound call so a hostile webhook URL cannot
//     pin a Worker invocation forever.

const SIGNATURE_HEADER = 'X-Opencanvas-Signature';
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
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      status: 0,
      durationMs: 0,
      error: 'invalid-url',
      message: 'webhookUrl must not include credentials',
    };
  }
  const blockedHost = blockedWebhookHost(parsed.hostname);
  if (blockedHost !== null) {
    return {
      ok: false,
      status: 0,
      durationMs: 0,
      error: 'invalid-url',
      message: `webhookUrl resolves to blocked private/reserved address: ${blockedHost}`,
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

function blockedWebhookHost(hostname: string): string | null {
  // Reject literal loopback/private/reserved hosts before making the outbound
  // request. DNS rebinding protection would need resolver-level checks; this
  // helper covers the cases visible from the configured URL itself.
  const host = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return host;
  if (isBlockedIpv4Host(host)) return host;
  if (isBlockedIpv6Host(host)) return host;
  return null;
}

function isBlockedIpv4Host(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const octets = host.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6Host(host: string): boolean {
  if (!host.includes(':')) return false;
  if (host === '::' || host === '::1') return true;
  const ipv4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (ipv4Mapped?.[1]) return isBlockedIpv4Host(ipv4Mapped[1]);
  const first = Number.parseInt(host.split(':')[0] || '0', 16);
  if (!Number.isFinite(first)) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (host.startsWith('2001:db8:') || host === '2001:db8::') return true;
  return false;
}

/** Exported constant for tests + receivers building their own verifier. */
export const WEBHOOK_SIGNATURE_HEADER = SIGNATURE_HEADER;
