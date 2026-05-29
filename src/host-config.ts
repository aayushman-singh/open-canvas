// src/host-config.ts
//
// Single source of truth for the apex host and every value derived from it.
// Every production consumer reads cookie scope, public-host suffix, accepted
// origins, dev-public-host overrides, and the outbound email sender through
// this module — never from a hardcoded literal. A fork rebrands by setting
// `APP_DOMAIN`, `AUTHORIZED_PARTIES`, and `EMAIL_FROM` in `.dev.vars` /
// `wrangler secret put`, plus two lines in `wrangler.toml` route patterns
// (see ADR 0013 decision 6).
//
// Owns:
//   - ADR 0013: `appDomain`, `appOrigin`, `publicHostSuffix`, `cookieDomain`,
//     `authorizedParties`, `resolveDevPublicOrigin`.
//   - ADR 0017: `cookieNamePrefix`, `cookieName.edit`, `cookieName.unlock`,
//     `cookieName.colorScheme`.
//   - ADR 0018: `emailFrom`.
//
// Failure stance (CLAUDE.md + ADR 0013 decision 2 + ADR 0017 decision 2 +
// ADR 0018 decision 2): every accessor throws synchronously when its env var
// is missing, empty, or fails syntactic validation. There is no fallback. A
// misconfigured Worker surfaces in `wrangler tail` on the first request that
// consults the helper, not three hours later as a Clerk-rejected sign-in.

/**
 * Env shape consumed by this module. Every Worker `Bindings` type that hits
 * any accessor below must include these fields (consumers spread the type
 * into their own Bindings).
 */
export interface HostConfigEnv {
  APP_DOMAIN: string;
  AUTHORIZED_PARTIES: string;
  COOKIE_NAME_PREFIX: string;
  EMAIL_FROM: string;
  /** Optional dev override; consumed only by `resolveDevPublicOrigin`. */
  DEV_PUBLIC_HOST?: string;
}

// RFC-1123 hostname: 1+ dot-separated labels, each 1-63 chars of [a-z0-9-],
// not starting or ending with `-`. At least one dot — apex bare-labels
// (`localhost`) are rejected because every consumer of APP_DOMAIN expects to
// build subdomains under it, which a bare label cannot host.
const HOSTNAME_RE =
  /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function validateHostname(value: string, varName: string): string {
  const lower = value.toLowerCase();
  if (!HOSTNAME_RE.test(lower)) {
    throw new Error(
      `${varName} must be a valid public hostname with at least one dot (got ${JSON.stringify(value)})`,
    );
  }
  return lower;
}

/**
 * The apex hostname the deployment serves under (e.g. `opencanvas.aayushman.dev`).
 * Validated as an RFC-1123 hostname; lowercased.
 */
export function appDomain(env: HostConfigEnv): string {
  const value = env.APP_DOMAIN;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      'APP_DOMAIN is required and must be a non-empty hostname (e.g. "example.com")',
    );
  }
  return validateHostname(value, 'APP_DOMAIN');
}

/**
 * The canonical https origin for the apex (`https://opencanvas.aayushman.dev`).
 * Used by URL builders that need an absolute target on the app host.
 */
export function appOrigin(env: HostConfigEnv): string {
  return `https://${appDomain(env)}`;
}

/**
 * The leading-dot suffix used to recognise published-site subdomains
 * (`.opencanvas.aayushman.dev`). A request whose Host ends with this suffix
 * (and has exactly one extra label) belongs to a Published Site.
 */
export function publicHostSuffix(env: HostConfigEnv): string {
  return `.${appDomain(env)}`;
}

/**
 * The cookie `Domain=` value for cross-subdomain edit-token / sign-out /
 * unlock cookies. Same string as `appDomain`, exposed under a behaviour name
 * so call sites read as cookie-scope rather than apex.
 */
export function cookieDomain(env: HostConfigEnv): string {
  return appDomain(env);
}

/**
 * The Clerk frontend-API CNAME for this deployment (`clerk.<apex>`). Forks
 * point a CNAME under their apex at Clerk's edge; the Worker reads this
 * value when it needs to assert or assemble keys that encode the frontend API.
 */
export function clerkFrontendApiHost(env: HostConfigEnv): string {
  return `clerk.${appDomain(env)}`;
}

/**
 * The accepted-origins list Clerk's `authenticateRequest` consults. Parsed
 * from `AUTHORIZED_PARTIES` (comma-separated origins). Every entry must be a
 * valid origin (`scheme://host[:port]`) with no path / query / hash.
 */
export function authorizedParties(env: HostConfigEnv): string[] {
  const value = env.AUTHORIZED_PARTIES;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      'AUTHORIZED_PARTIES is required and must be a comma-separated list of origins',
    );
  }
  const parties = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parties.length === 0) {
    throw new Error(
      'AUTHORIZED_PARTIES must contain at least one origin (got only empty entries)',
    );
  }
  const origins: string[] = [];
  for (const party of parties) {
    let parsed: URL;
    try {
      parsed = new URL(party);
    } catch (error) {
      throw new Error(`AUTHORIZED_PARTIES entry is not a valid URL: ${party}`, { cause: error });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`AUTHORIZED_PARTIES entry must be http(s): ${party}`);
    }
    if (parsed.pathname !== '/' || parsed.search.length > 0 || parsed.hash.length > 0) {
      throw new Error(`AUTHORIZED_PARTIES entry must be an origin only (no path / query / hash): ${party}`);
    }
    origins.push(parsed.origin);
  }
  return origins;
}

/**
 * The outbound `From:` address for transactional email. Accepts both
 * `addr@domain` and `Display Name <addr@domain>`. Validates the domain part
 * as a hostname; does NOT validate provider-side verified-sender status —
 * that surfaces at first send.
 */
export function emailFrom(env: HostConfigEnv): string {
  const value = env.EMAIL_FROM;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('EMAIL_FROM is required and must be a sender address');
  }
  const trimmed = value.trim();
  const match =
    trimmed.includes('<') || trimmed.includes('>')
      ? trimmed.match(/^[^<>\r\n]*<\s*([^\s@<>]+)@([a-z0-9.-]+)\s*>$/i)
      : trimmed.match(/^([^\s@<>]+)@([a-z0-9.-]+)$/i);
  if (!match) {
    throw new Error(`EMAIL_FROM must be RFC 5322 syntactically valid (got ${JSON.stringify(value)})`);
  }
  const domain = match[2];
  if (typeof domain !== 'string' || domain.length === 0) {
    throw new Error(`EMAIL_FROM is missing a domain part: ${value}`);
  }
  validateHostname(domain, 'EMAIL_FROM domain');
  return trimmed;
}

/**
 * Cookie name prefix (ADR 0017) — every Worker-issued cookie carries this
 * leading string (`__opencanvas_edit`, `__opencanvas_unlock_<id>`, etc.).
 * Forks rebrand cookies by setting `COOKIE_NAME_PREFIX` in their env. The
 * helper throws on missing/malformed values; consumers call it through
 * `cookieName.*` rather than embedding the literal.
 */
export function cookieNamePrefix(env: HostConfigEnv): string {
  const value = env.COOKIE_NAME_PREFIX;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('COOKIE_NAME_PREFIX is required (e.g. "__opencanvas_")');
  }
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) {
    throw new Error(
      `COOKIE_NAME_PREFIX must be a valid cookie-name token (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

/**
 * Behaviour-named cookie accessors. Each returns the fully-qualified cookie
 * name for a specific cross-Worker contract: edit-token cookie, per-site
 * unlock cookie, visitor color-scheme cookie. Consumers must not assemble
 * cookie names by string concatenation; that scattering is what ADR 0017
 * names. Per-site `unlock` validates the siteId shape because the cookie
 * name embeds it and an RFC 6265 `token` violation would break parsing.
 */
export const cookieName = {
  edit(env: HostConfigEnv): string {
    return `${cookieNamePrefix(env)}edit`;
  },
  unlock(env: HostConfigEnv, siteId: string): string {
    if (typeof siteId !== 'string' || siteId.length === 0) {
      throw new Error('cookieName.unlock: siteId must be a non-empty string');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(siteId)) {
      throw new Error(`cookieName.unlock: siteId contains invalid characters: ${siteId}`);
    }
    return `${cookieNamePrefix(env)}unlock_${siteId}`;
  },
  colorScheme(env: HostConfigEnv): string {
    return `${cookieNamePrefix(env)}theme`;
  },
};

/**
 * Dev override for the public origin. When set, must be a complete origin
 * (`scheme://host[:port]`) with no path / query / hash. When unset, defaults
 * to `http://127.0.0.1:8787`. Moved here from `src/auth/middleware.ts` per
 * ADR 0013 follow-up #1.
 */
export function resolveDevPublicOrigin(env: HostConfigEnv): string {
  if (env.DEV_PUBLIC_HOST === '') {
    throw new Error('DEV_PUBLIC_HOST must be a non-empty origin when set');
  }
  const origin = env.DEV_PUBLIC_HOST ?? 'http://127.0.0.1:8787';
  let url: URL;
  try {
    url = new URL(origin);
  } catch (error) {
    throw new Error(`DEV_PUBLIC_HOST must be a valid origin: ${origin}`, { cause: error });
  }
  if (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`DEV_PUBLIC_HOST must be an origin without path, query, or hash: ${origin}`);
  }
  return url.origin;
}
