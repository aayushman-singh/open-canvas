# Custom domains (Cloudflare for SaaS)

**Wishlist #:** 5 **Tier:** S **Wave:** 1 **Status:** queued
**Depends on:** Phase 0 ✓ (`customDomain` table, CF env vars)
**Blocks:** none

## User-visible outcome

An Owner adds a custom hostname (e.g. `www.acme.com`) in the dashboard for one of their sites. The dashboard shows the DNS record the Owner must add at their registrar. Once added, the dashboard polls and shows status going from pending → verifying → active. Within roughly a minute of correct DNS, the Owner visits `https://www.acme.com` and sees their Published Site served from the rev01 Worker — with a valid TLS certificate. Visiting `https://www.acme.com/contact` shows the right page.

## Scope in

- `POST /api/sites/:id/domains` — Owner registers a hostname for a site.
  - Call Cloudflare for SaaS Custom Hostnames API (POST `/zones/:zone_id/custom_hostnames`).
  - Persist row to `customDomain` table with `cfHostnameId`, `status='pending'`, `verificationRecord` blob from CF response.
- `GET /api/sites/:id/domains` — list with current status + DNS instructions.
- `DELETE /api/sites/:id/domains/:hostname` — calls CF API DELETE + removes row.
- Background poller (cron via Workers scheduled trigger, or pull-on-read) that updates `customDomain.status` and `certIssuedAt` from CF API.
- Public host router: on request, look up `customDomain` by `Host` header, resolve to `siteId`, serve Published Snapshot. Fallback chain: app host → wildcard subdomain → custom domain → 404.
- Dashboard UI: add domain form, list of pending/active domains, per-domain DNS instructions, status badge.

## Scope out

- Apex-domain support requiring CNAME flattening at the Owner's DNS (left for follow-up; CNAME-only POC).
- Bulk import of domains.
- Custom redirects between domains.
- Auto-purchase / registrar integration.

## Schema delta

Already scaffolded in Phase 0:

```ts
// src/db/schema.ts (Phase 0)
customDomain = pgTable('custom_domain', {
  id,
  siteId,
  hostname: text('hostname').notNull().unique(),
  cfHostnameId: text('cf_hostname_id').notNull(),
  status: text('status').notNull().$type<'pending' | 'verifying' | 'active' | 'failed'>(),
  verificationRecord: jsonb('verification_record').notNull(),
  certIssuedAt: timestamp('cert_issued_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

## Files owned (write)

- `src/custom-domain/cf-api.ts` — typed Cloudflare for SaaS Custom Hostnames client.
- `src/custom-domain/register.ts` — handles `POST /domains`.
- `src/custom-domain/poll.ts` — status sync from CF.
- `src/custom-domain/delete.ts`.
- `src/custom-domain/router.ts` — public-host lookup helper consumed by `src/routes/public.ts`.
- `src/custom-domain/smoke.ts` — uses a fake CF API client for deterministic test.
- `src/routes/api/domains.ts` — Hono router mount.
- `src/routes/dashboard/domains.tsx` — UI.
- `src/index.ts` — single line to mount `/api/domains` route (Phase 0 leaves the slot).
- `src/routes/public.ts` — add custom-domain lookup arm to host resolution. Phase 0 inserts the call site.
- `wrangler.toml` — scheduled cron entry for polling (if used).
- `package.json` — `customdomain:smoke` stub.

## Files read-only (must not modify)

- `src/canvas/schema.ts`, `src/db/schema.ts`.
- Any other feature dir.

## Contract with neighbors

- Public host router calls `resolveCustomDomain(hostHeader)` → returns `siteId | null`.
- CF API client expects `env.CF_API_TOKEN` and `env.CF_ZONE_ID` (Phase 0 added these).
- Status sync runs every 5 minutes; pending rows older than 30 min mark `'failed'`.

## Smoke test

- `bun run customdomain:smoke`:
  - Stubs CF API with a fake responding with predictable `cfHostnameId`.
  - Registers hostname, asserts row exists with `status='pending'`.
  - Simulates CF reporting `active` + cert issued; poller updates row.
  - Public host lookup with `Host: www.acme.com` returns site id.
  - Delete removes row + calls fake CF DELETE.

## Acceptance criteria

- Register → DNS instruction visible → status flips to active → site serves at custom hostname with valid cert.
- All smokes green.

## Open questions

- Whether to use Workers Cron Triggers (scheduled) for polling or lazy refresh on dashboard read. Recommend cron + lazy refresh hybrid; document.
- Whether the `customDomain` lookup happens on every request (cold cost) or via in-memory cache in the Worker isolate (KV/cache API for warm hit).
