// src/custom-domain/smoke.ts
//
// `bun run customdomain:smoke` — exercises the custom-domain pipeline
// against an in-memory CF API stub and an in-memory DB shim. The smoke
// covers (per the plan):
//
//   1. Register hostname with a stubbed CF API; row exists with
//      status='pending' and the stub's predictable cfHostnameId.
//   2. Simulate CF reporting status='active' + ssl.status='active'; pollOne
//      updates the row to 'active' with certIssuedAt set.
//   3. Public host lookup with the registered hostname returns siteId.
//   4. DELETE removes the row + invokes the fake CF DELETE.
//   5. Pending row older than 30 minutes flips to 'failed' on poll, without
//      hitting the CF API.
//   6. Validation: invalid hostnames are rejected.

import {
  type CfCustomHostname,
  type CfHostnamesClient,
  type CfHostnameStatus,
} from './cf-api.js';
import { deleteCustomDomain } from './delete.js';
import { pollOne } from './poll.js';
import { registerCustomDomain, validateCustomHostname } from './register.js';
import { resolveCustomDomain } from './router.js';
import type { Db } from '../db/client.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[customdomain:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// In-memory CF API stub
// ---------------------------------------------------------------------------

interface StubCfHostname {
  id: string;
  hostname: string;
  status: CfHostnameStatus;
  sslStatus: 'pending_validation' | 'active' | 'failed';
}

class StubCfClient implements CfHostnamesClient {
  hostnames = new Map<string, StubCfHostname>();
  createCount = 0;
  getCount = 0;
  deleteCount = 0;
  private nextId = 1;

  create(hostname: string): Promise<CfCustomHostname> {
    this.createCount += 1;
    const id = `cf-stub-${String(this.nextId++)}`;
    const record: StubCfHostname = {
      id,
      hostname,
      status: 'pending',
      sslStatus: 'pending_validation',
    };
    this.hostnames.set(id, record);
    return Promise.resolve(this.toCf(record));
  }

  get(id: string): Promise<CfCustomHostname> {
    this.getCount += 1;
    const record = this.hostnames.get(id);
    if (!record) {
      // Simulate the CF 404 path so pollOne's "row orphaned" branch runs.
      throw Object.assign(new Error('cf 404'), {
        name: 'CfApiError',
        status: 404,
        errors: [{ code: 1436, message: 'custom hostname not found' }],
      });
    }
    return Promise.resolve(this.toCf(record));
  }

  delete(id: string): Promise<void> {
    this.deleteCount += 1;
    this.hostnames.delete(id);
    return Promise.resolve();
  }

  /** Test-only: advance a hostname to active + cert issued. */
  flipActive(id: string): void {
    const record = this.hostnames.get(id);
    if (!record) throw new Error(`stub: hostname ${id} not found`);
    record.status = 'active';
    record.sslStatus = 'active';
  }

  private toCf(record: StubCfHostname): CfCustomHostname {
    return {
      id: record.id,
      hostname: record.hostname,
      status: record.status,
      ssl: { status: record.sslStatus, method: 'http', type: 'dv' },
      ownership_verification: {
        type: 'txt',
        name: `_cf-custom-hostname.${record.hostname}`,
        value: `stub-ownership-${record.id}`,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// In-memory DB shim
// ---------------------------------------------------------------------------
//
// We mimic just the surface area the production paths touch:
//
//   - `db.select().from(customDomain).where(...).limit(?)` — used by register
//     (existence check), delete (joined fetch), poll (single + listing), and
//     resolveCustomDomain.
//   - `db.select().from(site).where(...).limit(?)` — used by register for
//     site-existence + ownership.
//   - `db.insert(customDomain).values(...).returning()` — register.
//   - `db.update(customDomain).set(...).where(eq(id, ...))` — poll.
//   - `db.delete(customDomain).where(...)` — delete handler.
//
// drizzle resolves the chosen table by the first `.from()` / `.delete()`
// argument; we dispatch by inspecting which schema table object was passed.
// The shim keeps two arrays — siteRows + customDomainRows — and returns
// drizzle-compatible promise-thenables.

import { customDomain as customDomainTable, site as siteTable } from '../db/schema.js';

interface SimSite {
  id: string;
  customerId: string;
}

interface SimCustomDomain {
  id: string;
  siteId: string;
  hostname: string;
  cfHostnameId: string;
  status: 'pending' | 'verifying' | 'active' | 'failed';
  verificationRecord: Record<string, unknown>;
  certIssuedAt: Date | null;
  createdAt: Date;
}

interface ShimState {
  sites: SimSite[];
  domains: SimCustomDomain[];
}

// Predicate descriptors — we don't try to interpret drizzle's SQL AST. Each
// call site that uses `.where(...)` instead hands the shim a function that
// returns whether a row matches. The production code passes drizzle
// expressions; the shim flips behaviour by detecting that the argument is a
// drizzle internal and instead routes selects through the most-recently
// declared selector. This is a smoke shim, not a drizzle re-implementation
// — we recognise the call shapes the code uses and bake the matching logic
// into the shim methods.
//
// Approach: each production callsite that matters runs through one of
// register/poll/delete/router. The shim exposes a stateful "next predicate"
// hook the production code can't see. Instead of guessing the predicate, we
// implement a near-shim where the WHERE just executes a closure we configure
// per-test. Production drizzle code expects to chain — we satisfy the shape
// by returning chainable proxies.
//
// To avoid full re-implementation, we route every production query through
// a single chooser:
//   - select from siteTable → return rows whose customerId matches the
//     latest "currentCustomerId" we set OR all sites (for register's
//     site-existence check).
//   - select from customDomainTable → return rows matching the latest
//     hostname (router, register pre-check) OR siteId (route handler).
//
// We keep a context object and set the relevant filters before each call.

function makeShim(state: ShimState): {
  db: Db;
  context: {
    currentHostname: string | null;
    currentSiteId: string | null;
    currentCustomerId: string | null;
    currentRowId: string | null;
    // For pollAllPending — return ALL non-failed rows.
    selectMode: 'one-by-hostname' | 'one-by-siteid' | 'one-by-id' | 'all-non-failed' | 'by-siteid';
  };
} {
  const context = {
    currentHostname: null as string | null,
    currentSiteId: null as string | null,
    currentCustomerId: null as string | null,
    currentRowId: null as string | null,
    selectMode: 'one-by-hostname' as
      | 'one-by-hostname'
      | 'one-by-siteid'
      | 'one-by-id'
      | 'all-non-failed'
      | 'by-siteid',
  };

  function selectFromCustomDomain(): SimCustomDomain[] {
    switch (context.selectMode) {
      case 'one-by-hostname':
        return context.currentHostname
          ? state.domains.filter((d) => d.hostname === context.currentHostname).slice(0, 1)
          : [];
      case 'one-by-id':
        return context.currentRowId
          ? state.domains.filter((d) => d.id === context.currentRowId).slice(0, 1)
          : [];
      case 'one-by-siteid':
        return context.currentSiteId
          ? state.domains.filter((d) => d.siteId === context.currentSiteId).slice(0, 1)
          : [];
      case 'by-siteid':
        return context.currentSiteId
          ? state.domains.filter((d) => d.siteId === context.currentSiteId)
          : [];
      case 'all-non-failed':
        return state.domains.filter((d) => d.status !== 'failed');
    }
  }

  function selectFromSite(): SimSite[] {
    if (context.currentSiteId && context.currentCustomerId) {
      return state.sites.filter(
        (s) => s.id === context.currentSiteId && s.customerId === context.currentCustomerId,
      );
    }
    if (context.currentSiteId) {
      return state.sites.filter((s) => s.id === context.currentSiteId);
    }
    return [];
  }

  type WhereStub = {
    limit: (n: number) => Promise<unknown[]>;
    then: (resolve: (rows: unknown[]) => void) => Promise<unknown[]>;
  };

  function chainable(rows: unknown[]): WhereStub {
    const promise = Promise.resolve(rows);
    return Object.assign(promise, {
      limit: () => promise,
      then: promise.then.bind(promise),
    }) as unknown as WhereStub;
  }

  // The Db type is a heavy drizzle generic; the cast through `unknown` keeps
  // the shim's surface narrow to exactly what production touches.
  const db: Db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === customDomainTable) {
            return chainable(selectFromCustomDomain());
          }
          if (table === siteTable) {
            return chainable(selectFromSite());
          }
          return chainable([]);
        },
        // delete.ts uses an innerJoin path.
        innerJoin: () => ({
          where: () => {
            if (table === customDomainTable) {
              // delete.ts joins customDomain ↔ site and filters by siteId +
              // hostname + customerId. The shim filter combines all three.
              const matchingDomains = state.domains.filter(
                (d) =>
                  d.siteId === context.currentSiteId && d.hostname === context.currentHostname,
              );
              const owned = matchingDomains.filter((d) =>
                state.sites.some(
                  (s) => s.id === d.siteId && s.customerId === context.currentCustomerId,
                ),
              );
              return chainable(owned);
            }
            return chainable([]);
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          if (table !== customDomainTable) {
            return Promise.reject(new Error('shim insert only supports customDomain table'));
          }
          const row: SimCustomDomain = {
            id: `dom-${String(state.domains.length + 1)}`,
            siteId: String(values.siteId),
            hostname: String(values.hostname),
            cfHostnameId: String(values.cfHostnameId),
            status: values.status as SimCustomDomain['status'],
            verificationRecord: values.verificationRecord as Record<string, unknown>,
            certIssuedAt: null,
            createdAt: new Date(),
          };
          state.domains.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          if (table !== customDomainTable) {
            return Promise.reject(new Error('shim update only supports customDomain table'));
          }
          if (!context.currentRowId) return Promise.resolve(undefined);
          const idx = state.domains.findIndex((d) => d.id === context.currentRowId);
          if (idx < 0) return Promise.resolve(undefined);
          const current = state.domains[idx];
          if (!current) return Promise.resolve(undefined);
          state.domains[idx] = { ...current, ...patch };
          return Promise.resolve(undefined);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        if (table !== customDomainTable) {
          return Promise.reject(new Error('shim delete only supports customDomain table'));
        }
        if (!context.currentRowId) return Promise.resolve(undefined);
        state.domains = state.domains.filter((d) => d.id !== context.currentRowId);
        return Promise.resolve(undefined);
      },
    }),
  } as unknown as Db;

  return { db, context };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// Test APP_DOMAIN (ADR 0013 decision 7) — the smoke asserts behaviour against
// the configured apex, not a brand literal.
const SMOKE_HOST_ENV = {
  APP_DOMAIN: 'opencanvas.aayushman.dev',
  AUTHORIZED_PARTIES: 'https://opencanvas.aayushman.dev',
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: 'noreply@opencanvas.aayushman.dev',
};

function runValidation(): void {
  // Reserved hostnames: a subdomain under the configured apex is rejected.
  const rejected = validateCustomHostname(SMOKE_HOST_ENV, `foo.${SMOKE_HOST_ENV.APP_DOMAIN}`);
  assert(!rejected.ok, 'expected apex subdomain to be rejected');

  const invalid = validateCustomHostname(SMOKE_HOST_ENV, 'not a hostname');
  assert(!invalid.ok, 'expected hostname with space to be rejected');

  const empty = validateCustomHostname(SMOKE_HOST_ENV, '');
  assert(!empty.ok, 'expected empty hostname to be rejected');

  const apex = validateCustomHostname(SMOKE_HOST_ENV, 'singlelabel');
  assert(!apex.ok, 'expected single-label hostname to be rejected (no dot)');

  const ok = validateCustomHostname(SMOKE_HOST_ENV, '  WWW.Acme.COM  ');
  assert(ok.ok, 'expected www.acme.com (mixed case) to be accepted');
  assert(ok.ok && ok.hostname === 'www.acme.com', 'expected hostname to be normalised lowercased');
}

async function runRouteRegressionChecks(): Promise<void> {
  const routeResponse = await fetch(new URL('./route.ts', import.meta.url));
  const routeSource = await routeResponse.text();
  const getStart = routeSource.indexOf("router.get('/', async (c) => {");
  const deleteStart = routeSource.indexOf("router.delete('/:hostname'", getStart);
  assert(getStart !== -1 && deleteStart !== -1, 'expected custom-domain route source to include GET and DELETE handlers');
  const getHandler = routeSource.slice(getStart, deleteStart);
  const guardIndex = getHandler.indexOf('missingCfConfig(c.env)');
  const pollDepsIndex = getHandler.indexOf('buildPollDepsFromEnv(c.env)');
  assert(
    guardIndex !== -1 && pollDepsIndex !== -1 && guardIndex < pollDepsIndex,
    'expected GET /domains to validate CF config before building poll deps',
  );
}

async function runRegisterAndActivate(): Promise<{
  shim: ReturnType<typeof makeShim>;
  state: ShimState;
  cf: StubCfClient;
  hostname: string;
  siteId: string;
  customerId: string;
}> {
  const customerId = 'cust-1';
  const siteId = 'site-1';
  const state: ShimState = {
    sites: [{ id: siteId, customerId }],
    domains: [],
  };
  const shim = makeShim(state);
  const cf = new StubCfClient();

  shim.context.currentSiteId = siteId;
  shim.context.currentCustomerId = customerId;
  shim.context.currentHostname = 'www.acme.com';
  shim.context.selectMode = 'one-by-hostname';

  // Register path runs:
  //   1. select site → ok (sets selectMode by hand below)
  //   2. select customDomain by hostname → empty
  //   3. cf.create
  //   4. insert customDomain → row
  //
  // We toggle selectMode between calls because the shim's branchy logic is
  // controlled by the test scaffold. The production code performs the
  // queries in this fixed order:
  //
  //   site-existence check  →   one-by-siteid     (site table chooser)
  //   customDomain pre-check →  one-by-hostname   (customDomain chooser)
  //
  // Because the dispatcher inside the shim chooses by table, both can use
  // the same selectMode value as long as the hostname/siteId filters are
  // populated correctly. We leave currentHostname set above; the site
  // lookup uses currentSiteId + currentCustomerId via selectFromSite().

  const result = await registerCustomDomain(
    { db: shim.db, cf },
    SMOKE_HOST_ENV,
    { siteId, customerId, hostname: 'www.acme.com' },
  );
  assert(result.status === 'created', `expected register status created, got ${result.status}`);
  if (result.status !== 'created') return Promise.reject(new Error('unreachable'));

  assert(
    result.row.status === 'pending',
    `expected new row status='pending', got ${result.row.status}`,
  );
  assert(
    result.row.cfHostnameId === 'cf-stub-1',
    `expected cfHostnameId 'cf-stub-1', got ${result.row.cfHostnameId}`,
  );
  assert(
    cf.createCount === 1,
    `expected one cf.create call, got ${String(cf.createCount)}`,
  );
  assert(
    cf.hostnames.has(result.row.cfHostnameId),
    'expected CF stub to hold the new hostname id',
  );

  // Re-registering the same hostname returns already_registered (CF not
  // called twice).
  shim.context.currentHostname = 'www.acme.com';
  shim.context.selectMode = 'one-by-hostname';
  const dupe = await registerCustomDomain(
    { db: shim.db, cf },
    SMOKE_HOST_ENV,
    { siteId, customerId, hostname: 'www.acme.com' },
  );
  assert(
    dupe.status === 'already_registered',
    `expected duplicate register to return already_registered, got ${dupe.status}`,
  );
  assert(
    cf.createCount === 1,
    `expected still one cf.create call after dupe, got ${String(cf.createCount)}`,
  );

  // Site-not-found: a siteId that doesn't exist in the shim returns
  // site_not_found WITHOUT invoking CF.
  shim.context.currentSiteId = 'site-not-here';
  const ghost = await registerCustomDomain(
    { db: shim.db, cf },
    SMOKE_HOST_ENV,
    { siteId: 'site-not-here', customerId, hostname: 'wat.acme.com' },
  );
  assert(
    ghost.status === 'site_not_found',
    `expected unknown-site register to return site_not_found, got ${ghost.status}`,
  );
  shim.context.currentSiteId = siteId;

  // ---- pollOne: CF active + ssl active → row flips to 'active' ----
  cf.flipActive('cf-stub-1');
  const rowAfterRegister = state.domains[0]!;
  shim.context.currentRowId = rowAfterRegister.id;
  const outcome = await pollOne({ db: shim.db, cf }, { ...rowAfterRegister });
  assert(outcome.after === 'active', `expected pollOne to flip to active, got ${outcome.after}`);
  assert(outcome.certUpdated === true, 'expected certUpdated=true on the active flip');
  const polledRow = state.domains.find((d) => d.id === rowAfterRegister.id);
  assert(polledRow?.status === 'active', 'expected stored row to be active after poll');
  assert(polledRow?.certIssuedAt !== null, 'expected certIssuedAt to be populated after poll');

  return { shim, state, cf, hostname: 'www.acme.com', siteId, customerId };
}

async function runPublicLookup(
  shim: ReturnType<typeof makeShim>,
  hostname: string,
  expectedSiteId: string,
): Promise<void> {
  // resolveCustomDomain runs:
  //   - select customDomain by hostname → returns row + status
  shim.context.currentHostname = hostname;
  shim.context.selectMode = 'one-by-hostname';
  const result = await resolveCustomDomain(
    hostname,
    { DATABASE_URL: 'unused-by-shim' },
    { db: shim.db, cache: null },
  );
  assert(result !== null, 'expected resolveCustomDomain to return a hit for the active row');
  assert(
    result?.siteId === expectedSiteId,
    `expected resolveCustomDomain.siteId='${expectedSiteId}', got '${String(result?.siteId)}'`,
  );

  // A different hostname returns null.
  shim.context.currentHostname = 'not-registered.example.com';
  const miss = await resolveCustomDomain(
    'not-registered.example.com',
    { DATABASE_URL: 'unused-by-shim' },
    { db: shim.db, cache: null },
  );
  assert(miss === null, 'expected resolveCustomDomain to return null for an unknown host');
}

async function runDelete(
  shim: ReturnType<typeof makeShim>,
  state: ShimState,
  cf: StubCfClient,
  hostname: string,
  siteId: string,
  customerId: string,
): Promise<void> {
  // delete path:
  //   1. select customDomain INNER JOIN site on (siteId=..., hostname=...,
  //      customerId=...) → row
  //   2. cf.delete(cfHostnameId)
  //   3. delete customDomain where id=...
  shim.context.currentSiteId = siteId;
  shim.context.currentHostname = hostname;
  shim.context.currentCustomerId = customerId;
  shim.context.selectMode = 'one-by-hostname';
  // Tee up the row id the production delete-where step will key against. The
  // shim's delete branch filters state.domains by currentRowId, so the test
  // pre-sets that to the row's id before invoking the handler.
  const targetRow = state.domains.find(
    (d) => d.hostname === hostname && d.siteId === siteId,
  );
  if (!targetRow) throw new Error('runDelete pre-check: no row to delete in shim state');
  shim.context.currentRowId = targetRow.id;

  const deleteCountBefore = cf.deleteCount;
  const result = await deleteCustomDomain(
    { db: shim.db, cf },
    { siteId, customerId, hostname },
  );
  assert(result.status === 'deleted', `expected delete status='deleted', got ${result.status}`);
  assert(
    cf.deleteCount === deleteCountBefore + 1,
    `expected cf.delete called exactly once, got ${String(cf.deleteCount - deleteCountBefore)}`,
  );
  assert(
    cf.hostnames.size === 0,
    `expected CF stub to be empty after delete, has ${String(cf.hostnames.size)}`,
  );

  // The row is gone — a follow-up lookup returns null.
  shim.context.currentHostname = hostname;
  const after = await resolveCustomDomain(
    hostname,
    { DATABASE_URL: 'unused-by-shim' },
    { db: shim.db, cache: null },
  );
  assert(after === null, 'expected resolveCustomDomain to return null after delete');
}

async function runStuckPendingFlip(): Promise<void> {
  // Build a fresh shim with one pending row, createdAt set 31 minutes ago.
  const state: ShimState = {
    sites: [{ id: 'site-stuck', customerId: 'cust-2' }],
    domains: [
      {
        id: 'dom-stuck',
        siteId: 'site-stuck',
        hostname: 'forgotten.example.com',
        cfHostnameId: 'cf-stub-stuck',
        status: 'pending',
        verificationRecord: {},
        certIssuedAt: null,
        // 31 minutes ago
        createdAt: new Date(Date.now() - 31 * 60 * 1000),
      },
    ],
  };
  const shim = makeShim(state);
  const cf = new StubCfClient();
  // We do NOT add the hostname to the CF stub — pollOne should flip the row
  // to failed WITHOUT calling CF because the age-based guard fires first.
  shim.context.currentRowId = 'dom-stuck';

  const cfGetsBefore = cf.getCount;
  const outcome = await pollOne({ db: shim.db, cf }, state.domains[0]!);
  assert(
    outcome.after === 'failed',
    `expected stuck-pending row to flip to failed, got ${outcome.after}`,
  );
  assert(
    cf.getCount === cfGetsBefore,
    `expected age-based flip to skip CF; saw ${String(cf.getCount - cfGetsBefore)} extra cf.get calls`,
  );
  assert(state.domains[0]?.status === 'failed', 'expected stored row status to be failed');
}

async function main(): Promise<void> {
  runValidation();
  await runRouteRegressionChecks();
  const {
    shim,
    state,
    cf,
    hostname,
    siteId,
    customerId,
  } = await runRegisterAndActivate();
  await runPublicLookup(shim, hostname, siteId);
  await runDelete(shim, state, cf, hostname, siteId, customerId);
  await runStuckPendingFlip();
  console.log('[customdomain:smoke] OK');
}

await main();
