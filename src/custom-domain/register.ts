// src/custom-domain/register.ts
//
// POST /api/sites/:siteId/domains — Owner registers a hostname for a site.
//
// Flow:
//   1. Resolve current Owner from auth; reject if no customer row.
//   2. Verify the site exists and belongs to this Owner; 404 otherwise.
//   3. Validate the hostname:
//      - lowercase, RFC-1123 label-and-dot shape,
//      - not the public app host or any subdomain under the configured apex,
//      - not already present in the customDomain table (DB unique catches
//        the race, but we surface a friendly error here).
//   4. Call Cloudflare for SaaS `POST /custom_hostnames` to register it.
//      - If CF rejects, surface the error verbatim. NO retry.
//   5. Persist row with `status='pending'`, `verificationRecord` = the CF
//      response. The dashboard renders the verification record verbatim
//      so the Owner knows exactly what DNS record to add.
//
// Per ADR 0005 decision 3: one hostname binds to exactly one site. The DB
// unique constraint on `customDomain.hostname` enforces that across the
// whole table — we surface the 409 below.

import { and, eq } from 'drizzle-orm';
import type { CfCustomHostname, CfHostnamesClient } from './cf-api.js';
import { CfApiError } from './cf-api.js';
import type { Db } from '../db/client.js';
import { customDomain, type CustomDomain } from '../db/schema.js';
import { appDomain, type HostConfigEnv } from '../host-config.js';

export interface RegisterDeps {
  db: Db;
  cf: CfHostnamesClient;
}

export interface RegisterInput {
  siteId: string;
  customerId: string;
  hostname: string;
}

export type RegisterResult =
  | { status: 'created'; row: CustomDomain }
  | { status: 'site_not_found' }
  | { status: 'invalid_hostname'; reason: string }
  | { status: 'already_registered' }
  | { status: 'cf_rejected'; httpStatus: number; errors: { code: number; message: string }[] };

// RFC-1123 hostname: one or more dot-separated labels, each 1..63 chars of
// [a-z0-9-], not starting or ending with a hyphen. Total max 253.
//
// We require at least one dot (no apex bare-label like "localhost") and
// reject anything containing whitespace or uppercase to keep DB storage
// canonical.
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Always-forbidden literals — local-dev hosts that are never legitimate as
// Owner-claimed custom domains regardless of `APP_DOMAIN`. The apex itself
// and its parent zone are added per-request from `appDomain(env)` below.
const ALWAYS_FORBIDDEN_EXACT = new Set(['localhost', 'localhost:8787']);

function parentZone(hostname: string): string | null {
  const dot = hostname.indexOf('.');
  if (dot < 0 || dot === hostname.length - 1) return null;
  const parent = hostname.slice(dot + 1);
  return parent.includes('.') ? parent : null;
}

export function validateCustomHostname(
  env: HostConfigEnv,
  raw: string,
): { ok: true; hostname: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'hostname must be a string' };
  }
  const hostname = raw.trim().toLowerCase();
  if (hostname.length === 0) {
    return { ok: false, reason: 'hostname is required' };
  }
  if (hostname.length > 253) {
    return { ok: false, reason: 'hostname must be 253 characters or fewer' };
  }
  if (!HOSTNAME_RE.test(hostname)) {
    return {
      ok: false,
      reason:
        'hostname must be a valid DNS name (lowercase letters, digits, hyphens, at least one dot)',
    };
  }
  const apex = appDomain(env);
  const forbiddenExact = new Set<string>([apex, ...ALWAYS_FORBIDDEN_EXACT]);
  const apexParent = parentZone(apex);
  if (apexParent) forbiddenExact.add(apexParent);
  if (forbiddenExact.has(hostname)) {
    return { ok: false, reason: 'this hostname is reserved by the platform' };
  }
  const forbiddenSuffixes = [`.${apex}`];
  if (apexParent) forbiddenSuffixes.push(`.${apexParent}`);
  for (const suffix of forbiddenSuffixes) {
    if (hostname.endsWith(suffix)) {
      return {
        ok: false,
        reason: `hostnames under ${suffix} are served by the wildcard subdomain — pick a domain you own`,
      };
    }
  }
  return { ok: true, hostname };
}

export async function registerCustomDomain(
  deps: RegisterDeps,
  env: HostConfigEnv,
  input: RegisterInput,
): Promise<RegisterResult> {
  const check = validateCustomHostname(env, input.hostname);
  if (!check.ok) {
    return { status: 'invalid_hostname', reason: check.reason };
  }
  const hostname = check.hostname;

  // Confirm the site exists AND belongs to this Owner. We import `site` lazily
  // through the schema barrel because the only column we need beyond the
  // existence check is `customerId`.
  const { site } = await import('../db/schema.js');
  const siteRows = await deps.db
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, input.siteId), eq(site.customerId, input.customerId)))
    .limit(1);
  if (!siteRows[0]) {
    return { status: 'site_not_found' };
  }

  // Pre-check the hostname uniqueness. The DB unique catches the race, but a
  // pre-check produces a nicer error and avoids paying the CF API roundtrip
  // for a doomed insert.
  const existing = await deps.db
    .select({ id: customDomain.id })
    .from(customDomain)
    .where(eq(customDomain.hostname, hostname))
    .limit(1);
  if (existing[0]) {
    return { status: 'already_registered' };
  }

  let cfResult: CfCustomHostname;
  try {
    cfResult = await deps.cf.create(hostname);
  } catch (err) {
    if (err instanceof CfApiError) {
      return { status: 'cf_rejected', httpStatus: err.status, errors: err.errors };
    }
    throw err;
  }

  try {
    const inserted = await deps.db
      .insert(customDomain)
      .values({
        siteId: input.siteId,
        hostname,
        cfHostnameId: cfResult.id,
        status: 'pending',
        // Persist the entire CF response — the dashboard renders the
        // verification fields verbatim so the Owner sees the exact DNS
        // record CF expects.
        verificationRecord: cfResult as unknown as Record<string, unknown>,
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error('customDomain insert returned no row');
    }
    return { status: 'created', row };
  } catch (err) {
    // ANY DB error after a successful CF create leaves an orphan custom
    // hostname on Cloudflare that this rev01 instance no longer tracks.
    // That is a two-system split-brain (CF says the hostname exists, our
    // DB does not), and a subsequent retry from the Owner will fail with
    // CF's "hostname already exists" error — at which point the operator
    // has to clean up by hand. Roll back the CF side for every DB error,
    // not just unique-violation. The unique branch additionally remaps
    // the duplicate to the caller's expected shape; other DB errors
    // re-throw so the caller surfaces a 500.
    let rollbackErr: unknown = null;
    try {
      await deps.cf.delete(cfResult.id);
    } catch (cfErr) {
      rollbackErr = cfErr;
      // Log loudly per the global no-silent-fallback rule — the operator
      // needs to know that a CF hostname is orphaned.
      console.error('[custom-domain] CF rollback failed after DB error', {
        hostname,
        cfHostnameId: cfResult.id,
        originalErr: err,
        cfErr,
      });
    }
    if (rollbackErr !== null) {
      const originalMessage = describeThrownValue(err);
      const rollbackMessage = describeThrownValue(rollbackErr);
      throw new Error(
        `CF rollback failed after DB error for ${hostname} (cfHostnameId=${cfResult.id}): ${rollbackMessage}; original DB error: ${originalMessage}`,
      );
    }
    if (isUniqueViolation(err)) {
      return { status: 'already_registered' };
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === '23505') return true;
  if (typeof e.message === 'string' && e.message.includes('duplicate key value')) return true;
  if (e.cause) return isUniqueViolation(e.cause);
  return false;
}

function describeThrownValue(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '<unserializable thrown value>';
  }
}
