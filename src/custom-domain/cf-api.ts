// src/custom-domain/cf-api.ts
//
// Typed Cloudflare for SaaS — Custom Hostnames API client.
//
// The CF API surface we depend on (per ADR 0005):
//
//   POST   /zones/:zone_id/custom_hostnames
//   GET    /zones/:zone_id/custom_hostnames/:id
//   DELETE /zones/:zone_id/custom_hostnames/:id
//
// Docs: https://developers.cloudflare.com/api/operations/custom-hostname-for-a-zone-create-custom-hostname
//
// Why the client is parameterised over a fetch-like function:
//   - The smoke and any future unit tests need to stub the network surface
//     without monkey-patching the global `fetch`.
//   - In production we pass the real `fetch` provided by the Workers runtime.
//
// Why we surface the full CF response on register:
//   - The dashboard needs to render verbatim DNS instructions to the Owner
//     (which CNAME target to add at their registrar). The CF response carries
//     `ownership_verification` and `ssl.dcv_method` fields whose exact
//     shape varies; we persist the whole `verificationRecord` blob to the
//     DB and let the UI extract what it needs without forcing the CF schema
//     into our type system.
//
// Failure mode (per global "all-or-nothing" preference):
//   - A non-2xx response or `success: false` in the payload throws
//     `CfApiError` with the full error array attached. No silent fallback.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CfApiConfig {
  apiToken: string;
  zoneId: string;
  /** Override for the API base. Production stays default; tests stub. */
  baseUrl?: string;
  /** Injectable fetch — defaults to globalThis.fetch. */
  fetch?: FetchLike;
}

const DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';

/**
 * Cloudflare Custom Hostname status — verbatim from CF API. We narrow our
 * persisted `customDomain.status` to four values; this enum carries every
 * value CF can hand back so the poller can map them.
 */
export type CfHostnameStatus =
  | 'active'
  | 'pending'
  | 'active_redeploying'
  | 'moved'
  | 'pending_deletion'
  | 'deleted'
  | 'pending_blocked'
  | 'pending_migration'
  | 'pending_provisioned'
  | 'test_pending'
  | 'test_active'
  | 'test_active_apex'
  | 'test_blocked'
  | 'test_failed'
  | 'provisioned'
  | 'blocked';

export interface CfCustomHostnameSsl {
  status?: string;
  method?: string;
  type?: string;
  validation_errors?: { message: string }[];
  validation_records?: { txt_name?: string; txt_value?: string; http_url?: string; http_body?: string }[];
}

export interface CfCustomHostname {
  id: string;
  hostname: string;
  status: CfHostnameStatus;
  ssl: CfCustomHostnameSsl;
  ownership_verification?: { type: string; name: string; value: string };
  ownership_verification_http?: { http_url: string; http_body: string };
  verification_errors?: string[];
  created_at?: string;
}

export interface CfApiEnvelope<T> {
  success: boolean;
  result: T;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
}

export class CfApiError extends Error {
  readonly status: number;
  readonly errors: { code: number; message: string }[];
  constructor(status: number, errors: { code: number; message: string }[], message: string) {
    super(message);
    this.name = 'CfApiError';
    this.status = status;
    this.errors = errors;
  }
}

export interface CfHostnamesClient {
  create(hostname: string): Promise<CfCustomHostname>;
  get(id: string): Promise<CfCustomHostname>;
  delete(id: string): Promise<void>;
}

export function createCfHostnamesClient(config: CfApiConfig): CfHostnamesClient {
  if (!config.apiToken) {
    throw new Error('createCfHostnamesClient: apiToken is required');
  }
  if (!config.zoneId) {
    throw new Error('createCfHostnamesClient: zoneId is required');
  }
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  const headers = {
    authorization: `Bearer ${config.apiToken}`,
    'content-type': 'application/json',
  };
  const root = `${baseUrl}/zones/${config.zoneId}/custom_hostnames`;

  async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
    // Build init incrementally so an absent body really is absent (rather
    // than `body: undefined`, which TS's exactOptionalPropertyTypes rejects
    // against the runtime `RequestInit` signature).
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await doFetch(url, init);
    // CF sometimes returns 200 with `success: false`. We parse the body either
    // way to surface the real error reason in CfApiError.
    let payload: CfApiEnvelope<T> | null = null;
    try {
      payload = await response.json<CfApiEnvelope<T>>();
    } catch (parseErr) {
      throw new CfApiError(
        response.status,
        [{ code: response.status, message: `non-JSON CF response: ${String(parseErr)}` }],
        `CF API ${method} ${url} returned non-JSON body (status ${String(response.status)})`,
      );
    }
    if (!response.ok || !payload.success) {
      throw new CfApiError(
        response.status,
        payload.errors ?? [],
        `CF API ${method} ${url} failed (status ${String(response.status)}): ${payload.errors
          ?.map((e) => `[${String(e.code)}] ${e.message}`)
          .join('; ')}`,
      );
    }
    return payload.result;
  }

  return {
    create(hostname) {
      // The dashboard form only accepts CNAME-targetable hostnames per ADR
      // 0005 out-of-scope (apex requires CNAME flattening); we still send
      // `ssl.method='http'` because http DCV is the only method that works
      // before the Owner has updated DNS for a CNAME target.
      return request<CfCustomHostname>('POST', root, {
        hostname,
        ssl: { method: 'http', type: 'dv' },
      });
    },
    get(id) {
      return request<CfCustomHostname>('GET', `${root}/${id}`);
    },
    async delete(id) {
      await request<{ id: string }>('DELETE', `${root}/${id}`);
    },
  };
}

/**
 * Map a CF hostname status to our persisted `customDomain.status` narrowing.
 *
 * CF carries a much wider lifecycle than we surface to Owners; the dashboard
 * only ever distinguishes four states. Mapping:
 *
 *   - `active` + ssl.status='active'  → 'active'
 *   - `active` (cert not yet issued)   → 'verifying'
 *   - `pending`, `pending_*`           → 'verifying' (CF has begun work)
 *   - `blocked`, `*_blocked`, `*failed`→ 'failed'
 *   - `moved`, `deleted`               → 'failed' (the hostname is no longer ours)
 *   - everything else                  → 'verifying' (safe default — still in flight)
 *
 * Initial state when we first persist the row from `create()` is 'pending'
 * (set by the register handler), not derived here.
 */
export function mapCfStatus(
  cf: CfCustomHostname,
): 'verifying' | 'active' | 'failed' {
  const status = cf.status;
  if (status === 'active') {
    const sslActive = (cf.ssl.status ?? '').toLowerCase() === 'active';
    return sslActive ? 'active' : 'verifying';
  }
  if (status === 'blocked' || status === 'pending_blocked' || status === 'test_blocked') {
    return 'failed';
  }
  if (status === 'test_failed') return 'failed';
  if (status === 'moved' || status === 'deleted' || status === 'pending_deletion') {
    return 'failed';
  }
  return 'verifying';
}
