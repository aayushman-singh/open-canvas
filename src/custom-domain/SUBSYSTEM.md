# custom-domain

**Wishlist #:** 5  **Plan:** [`docs/superpowers/plans/2026-05-23-05-custom-domains.md`](../../docs/superpowers/plans/2026-05-23-05-custom-domains.md)
**ADR:** [`docs/adr/0005-custom-domains.md`](../../docs/adr/0005-custom-domains.md)
**Status:** Wave 1 — implemented.

Cloudflare for SaaS Custom Hostnames integration: an Owner registers a hostname for one of their sites, follows DNS instructions, and once Cloudflare verifies + issues the cert their Published Site serves at that hostname.

## Modules

- `cf-api.ts` — typed Cloudflare Custom Hostnames API client. Injectable `fetch` so the smoke can stub the network surface; production code passes the runtime `fetch`.
- `register.ts` — `POST /api/sites/:siteId/domains` handler. Validates the hostname (DNS shape, not a reserved suffix), calls CF, persists a row with `status='pending'`.
- `poll.ts` — pulls each non-terminal row from CF and reconciles `status` + `certIssuedAt`. Stuck-pending rows (older than 30 minutes) flip to `failed` without hitting CF.
- `delete.ts` — `DELETE /api/sites/:siteId/domains/:hostname` handler. CF DELETE first, then row drop. A CF 404 is tolerated (record already gone).
- `router.ts` — `resolveCustomDomain(hostHeader, env, deps)` consumed by `src/routes/public.ts`. Returns `{ siteId }` only for `status='active'` rows.
- `route.ts` — Hono router mounted by the main thread at the path documented under "Integration points" below.
- `cron.ts` — Workers Cron Trigger handler. Exports `scheduled(event, env, ctx)`; the main thread wires the cron expression in `wrangler.toml`.

## Status lifecycle

```
register  ──►  pending  ──►  verifying  ──►  active
                  │            │              │
                  │            │              ▼
                  └────────────┴────────►   failed
                  (>30 min OR CF reports terminal failure)
```

`failed` is sticky — the Owner must DELETE and re-register to recover. This matches ADR 0005 decision 4: silent retry would mask Owner-DNS errors.

## Polling cadence

- **Cron**: every 5 minutes (`*/5 * * * *`). The main thread adds this to `wrangler.toml` after Wave 1.
- **Lazy refresh**: the GET `/api/sites/:siteId/domains` handler polls each non-failed row on read so the dashboard surfaces fresh state without waiting for cron.
- **30-minute stuck guard**: a row that stays in `pending`/`verifying` for 30+ minutes since `createdAt` flips to `failed` on the next poll without invoking CF. With 5-minute cadence this is six poll attempts before giving up.

## Public-host cache

`resolveCustomDomain` is on the hot path of every visitor request whose Host is not the app host or a `*.rev01.aayushman.dev` subdomain. To bound DB cost:

- Positive cache: keyed on `Host` header, stored in the Workers Cache API, TTL **60 seconds**. Short enough that a status change (`active → failed`, or DELETE) propagates within a minute without manual cache purge.
- Negative cache: **disabled**. Caching misses would prolong recovery after a typo'd-hostname registration; the DB cost of a missed-lookup is acceptable.
- In the Bun smoke harness `caches.default` is undefined, so the cache layer is bypassed and lookups always hit the (shim) DB — that keeps the smoke deterministic.

## Integration points (consumed by main thread)

- Default export of `route.ts` — Hono router. Mount path:

  ```ts
  app.route('/api/sites/:siteId/domains', router);
  ```

  Inner routes are `POST /`, `GET /`, `DELETE /:hostname`. Hono forwards the parent `:siteId` param to the child context so the handlers read it via `c.req.param('siteId')`.

- `scheduled` from `cron.ts` — must be added to the worker's default export so the Workers runtime fires it on cron tick.
- `wrangler.toml` `[triggers]` block:

  ```toml
  [triggers]
  crons = ["*/5 * * * *"]
  ```

## Smoke

`bun run customdomain:smoke` exercises register → poll-to-active → public lookup → delete → 30-minute-stuck flip against in-memory stubs of the CF API and the DB.
