// src/version/route-collab-access.smoke.ts
//
// Bug #11 regression smoke: the Versions tab was silently empty for
// accepted collaborators because `src/version/route.ts` resolved the site
// through an owner-only check (`resolveOwnedSiteId`). The route now uses
// `loadAccessibleSite` per-endpoint with a tier mapping:
//
//   GET    /                       — viewer
//   POST   /                       — editor
//   POST   /:snapshotId/restore    — editor
//   GET    /:snapshotId/preview    — viewer
//   DELETE /:snapshotId             — editor
//
// This smoke pins both halves of the fix:
//
//   1. Behavioural — `loadAccessibleSite` against an in-memory DB shim
//      that mirrors the `site` + `site_collaborator` rows the route reads.
//      Walks the access matrix: owner / accepted-editor / accepted-viewer
//      / pending-invite / unrelated, at each required tier.
//
//   2. Static — the source of `route.ts` calls `loadAccessibleSite` for
//      each handler with the tier above, and no longer references
//      `resolveOwnedSiteId`. Catches a future regression that re-pins the
//      owner-only check without breaking behaviour-1.
//
// Why a static check too: the behavioural test exercises the helper but
// not the route file directly. We deliberately don't reconstruct Clerk +
// drizzle predicates to run `versionRoute.fetch(...)` in the shim — that
// would be a full-app harness. The static assertion catches "someone
// imported the helper but forgot to call it" or "someone reverted the
// tier" failures the behavioural test alone wouldn't catch.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { and, eq, isNotNull } from 'drizzle-orm';

import { loadAccessibleSite, accessRoleMeetsRequirement } from '../auth/accessible-site.js';
import type { Db } from '../db/client.js';
import { customer, site, siteCollaborator } from '../db/schema.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[version-route-collab-access:smoke] ' + message);
}

// ---------------------------------------------------------------------------
// 0. Sanity — confirm the access-rank helper agrees with the tier mapping.
//     viewer < editor < owner.
// ---------------------------------------------------------------------------

assert(accessRoleMeetsRequirement('owner', 'editor'), 'owner must satisfy editor tier');
assert(accessRoleMeetsRequirement('editor', 'viewer'), 'editor must satisfy viewer tier');
assert(!accessRoleMeetsRequirement('viewer', 'editor'), 'viewer must not satisfy editor tier');

// ---------------------------------------------------------------------------
// 1. In-memory DB shim — implements just enough drizzle surface for
//    `loadAccessibleSite`. Stripped-down sibling of src/version/smoke.ts's
//    shim with the addition of:
//      - `customer` table (the `callerCustomerId` fallback SELECT path),
//      - `innerJoin(site, eq(site.id, siteCollaborator.siteId))`,
//      - `isNotNull(siteCollaborator.acceptedAt)` predicate.
// ---------------------------------------------------------------------------

interface SiteRow {
  id: string;
  customerId: string;
  name: string;
  subdomain: string;
  styleKit: string;
  editableState: unknown;
  publishedVersion: number;
}

interface CustomerRow {
  id: string;
  clerkUserId: string;
}

interface CollaboratorRow {
  id: string;
  siteId: string;
  customerId: string;
  role: 'editor' | 'viewer';
  acceptedAt: Date | null;
}

class InMemoryDb {
  sites = new Map<string, SiteRow>();
  customers: CustomerRow[] = [];
  collaborators: CollaboratorRow[] = [];

  insertSite(row: SiteRow): void {
    this.sites.set(row.id, row);
  }
  insertCustomer(row: CustomerRow): void {
    this.customers.push(row);
  }
  insertCollaborator(row: CollaboratorRow): void {
    this.collaborators.push(row);
  }

  select(_columns: Record<string, unknown>): SelectBuilder {
    void _columns;
    return new SelectBuilder(this);
  }
}

// Track the tables and join shape selected, then run the right query when
// the chain terminates with `.limit(n)`.
class SelectBuilder {
  private fromTable: unknown = null;
  private joinTable: unknown = null;
  private joinExpr: unknown = null;
  private predicate: ((row: Record<string, unknown>) => boolean) | null = null;
  private limitN: number | null = null;

  constructor(private db: InMemoryDb) {}

  from(table: unknown): this {
    this.fromTable = table;
    return this;
  }
  innerJoin(table: unknown, expr: unknown): this {
    this.joinTable = table;
    this.joinExpr = expr;
    return this;
  }
  where(expr: unknown): this {
    // Compile the predicate now that we know whether a join is in play.
    // For pure-table SELECTs, `site.customerId` keys the row as `customerId`.
    // For the siteCollaborator->site join, the SAME column object aliases to
    // `siteOwnerCustomerId` on the flattened row (otherwise it would collide
    // with `siteCollaborator.customerId`). compilePredicate takes a remap
    // function so both layouts share the same predicate machinery.
    const remap = this.joinTable === site && this.fromTable === siteCollaborator
      ? (columnObj: unknown, key: string): string => {
          if (key === 'customerId' && columnObj === site.customerId) return 'siteOwnerCustomerId';
          return key;
        }
      : (_columnObj: unknown, key: string): string => key;
    this.predicate = compilePredicate(expr, remap);
    return this;
  }
  limit(n: number): PromiseLike<unknown[]> {
    this.limitN = n;
    return {
      then: <T>(onfulfilled?: (rows: unknown[]) => T | PromiseLike<T>): PromiseLike<T> => {
        const rows = this.run();
        return Promise.resolve(onfulfilled ? onfulfilled(rows) : (rows as unknown as T));
      },
    };
  }

  private run(): unknown[] {
    // The function only joins `siteCollaborator` -> `site`, so handle
    // these two shapes explicitly and reject anything unexpected.
    if (this.fromTable === customer) {
      const rows = this.db.customers.filter((r) =>
        this.predicate ? this.predicate(r as unknown as Record<string, unknown>) : true,
      );
      return rows.slice(0, this.limitN ?? rows.length).map((r) => ({ id: r.id }));
    }
    if (this.fromTable === site && this.joinTable === null) {
      const rows = [...this.db.sites.values()].filter((r) =>
        this.predicate ? this.predicate(r as unknown as Record<string, unknown>) : true,
      );
      return rows.slice(0, this.limitN ?? rows.length).map((r) => ({
        id: r.id,
        customerId: r.customerId,
        name: r.name,
        subdomain: r.subdomain,
        styleKit: r.styleKit,
        editableState: r.editableState,
        publishedVersion: r.publishedVersion,
      }));
    }
    if (this.fromTable === siteCollaborator && this.joinTable === site) {
      // Join: each collaborator row joined to its site. Apply the where
      // predicate to the flattened row before projecting.
      void this.joinExpr; // shape is fixed; we don't need to re-check eq(site.id = siteCollaborator.siteId)
      const joined = this.db.collaborators
        .map((collab) => {
          const siteRow = this.db.sites.get(collab.siteId);
          if (!siteRow) return null;
          return {
            // siteCollaborator columns the predicate sees
            siteId: collab.siteId,
            customerId: collab.customerId,
            acceptedAt: collab.acceptedAt,
            role: collab.role,
            // site columns the predicate sees on the joined row
            id: siteRow.id,
            siteOwnerCustomerId: siteRow.customerId,
            name: siteRow.name,
            subdomain: siteRow.subdomain,
            styleKit: siteRow.styleKit,
            editableState: siteRow.editableState,
            publishedVersion: siteRow.publishedVersion,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      const filtered = joined.filter((r) =>
        this.predicate ? this.predicate(r as unknown as Record<string, unknown>) : true,
      );
      return filtered.slice(0, this.limitN ?? filtered.length).map((r) => ({
        role: r.role,
        siteId: r.siteId,
        customerId: r.siteOwnerCustomerId, // loadAccessibleSite SELECTs site.customerId, not collaborator.customerId
        name: r.name,
        subdomain: r.subdomain,
        styleKit: r.styleKit,
        editableState: r.editableState,
        publishedVersion: r.publishedVersion,
      }));
    }
    throw new Error('[shim] unhandled select shape');
  }
}

// ---------------------------------------------------------------------------
// Predicate compilation — mirrors the column-identity lookup from
// src/version/smoke.ts, but only for the predicate shapes
// loadAccessibleSite emits: `eq`, `and`, `isNotNull`.
// ---------------------------------------------------------------------------

const columnLookup = new Map<unknown, string>();
for (const tbl of [site, siteCollaborator, customer]) {
  for (const [tsKey, value] of Object.entries(tbl)) {
    if (value !== null && typeof value === 'object') {
      columnLookup.set(value, tsKey);
    }
  }
}

interface DrizzleSql {
  queryChunks: unknown[];
}

function isDrizzleSql(value: unknown): value is DrizzleSql {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray((value as { queryChunks?: unknown }).queryChunks);
}

function stringChunkText(chunk: unknown): string | null {
  if (!chunk || typeof chunk !== 'object') return null;
  const v = (chunk as { value?: unknown }).value;
  if (!Array.isArray(v)) return null;
  const first: unknown = v[0];
  return typeof first === 'string' ? first : null;
}

function unwrapParam(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if ('value' in obj && 'encoder' in obj && !('queryChunks' in obj)) {
    return obj.value;
  }
  return value;
}

function compileColumn(value: unknown): string | null {
  return columnLookup.get(value) ?? null;
}

type RemapFn = (columnObj: unknown, key: string) => string;

function compilePredicate(
  expr: unknown,
  remap: RemapFn,
): (row: Record<string, unknown>) => boolean {
  if (!isDrizzleSql(expr)) return () => true;
  const chunks = expr.queryChunks;

  // and(a, b, ...)
  if (chunks.length >= 3) {
    const open = stringChunkText(chunks[0]);
    const close = stringChunkText(chunks[chunks.length - 1]);
    const inner = chunks[1];
    if (open === '(' && close === ')' && isDrizzleSql(inner)) {
      const parts: Array<(row: Record<string, unknown>) => boolean> = [];
      let sep: 'and' | 'or' | null = null;
      for (const c of inner.queryChunks) {
        const t = stringChunkText(c);
        if (t !== null) {
          if (t === ' and ') sep = 'and';
          else if (t === ' or ') sep = 'or';
          continue;
        }
        parts.push(compilePredicate(c, remap));
      }
      if (sep === 'and') return (row) => parts.every((p) => p(row));
      if (sep === 'or') return (row) => parts.some((p) => p(row));
    }
  }

  // isNotNull(col): [SC(""), col, SC(" is not null")]
  if (chunks.length === 3) {
    const colKey = compileColumn(chunks[1]);
    const opText = stringChunkText(chunks[2]);
    if (colKey !== null && opText === ' is not null') {
      const key = remap(chunks[1], colKey);
      return (row) => row[key] !== null && row[key] !== undefined;
    }
  }

  // eq(col, v): [SC(""), col, SC(" = "), v, SC("")]
  if (chunks.length === 5) {
    const colKey = compileColumn(chunks[1]);
    const opText = stringChunkText(chunks[2]);
    if (colKey !== null && opText !== null) {
      const op = opText.trim();
      const value = unwrapParam(chunks[3]);
      const key = remap(chunks[1], colKey);
      if (op === '=') {
        return (row) => row[key] === value;
      }
    }
  }

  return () => true;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function setupFixtures(): InMemoryDb {
  const dbShim = new InMemoryDb();

  dbShim.insertCustomer({ id: 'cust-owner', clerkUserId: 'clerk-owner' });
  dbShim.insertCustomer({ id: 'cust-editor', clerkUserId: 'clerk-editor' });
  dbShim.insertCustomer({ id: 'cust-viewer', clerkUserId: 'clerk-viewer' });
  dbShim.insertCustomer({ id: 'cust-pending', clerkUserId: 'clerk-pending' });
  dbShim.insertCustomer({ id: 'cust-stranger', clerkUserId: 'clerk-stranger' });

  dbShim.insertSite({
    id: 'site-1',
    customerId: 'cust-owner',
    name: 'Test site',
    subdomain: 'test-site',
    styleKit: 'charcoal',
    editableState: { styleKit: 'charcoal', pages: [] },
    publishedVersion: 0,
  });

  dbShim.insertCollaborator({
    id: 'collab-editor',
    siteId: 'site-1',
    customerId: 'cust-editor',
    role: 'editor',
    acceptedAt: new Date('2026-05-01T00:00:00.000Z'),
  });
  dbShim.insertCollaborator({
    id: 'collab-viewer',
    siteId: 'site-1',
    customerId: 'cust-viewer',
    role: 'viewer',
    acceptedAt: new Date('2026-05-02T00:00:00.000Z'),
  });
  dbShim.insertCollaborator({
    id: 'collab-pending',
    siteId: 'site-1',
    customerId: 'cust-pending',
    role: 'editor',
    acceptedAt: null, // pending invite — must be rejected
  });

  return dbShim;
}

// ---------------------------------------------------------------------------
// 2. Behavioural matrix
// ---------------------------------------------------------------------------

const dbShim = setupFixtures();
const dbAsType = dbShim as unknown as Db;

// Smoke that the shim itself dispatches the join shape correctly — assert a
// raw query before exercising the helper, otherwise a buggy shim could
// false-pass the access checks.
const smokeJoin = await dbAsType
  .select({ role: siteCollaborator.role })
  .from(siteCollaborator)
  .innerJoin(site, eq(site.id, siteCollaborator.siteId))
  .where(
    and(
      eq(siteCollaborator.siteId, 'site-1'),
      eq(siteCollaborator.customerId, 'cust-editor'),
      isNotNull(siteCollaborator.acceptedAt),
    ),
  )
  .limit(1);
assert(smokeJoin.length === 1, 'shim join should return one row for the editor collab');

// --- Owner access ---
const ownerAccess = await loadAccessibleSite(dbAsType, 'clerk-owner', 'site-1', 'viewer');
assert(ownerAccess !== null, 'owner must see site at viewer tier');
assert(ownerAccess?.accessRole === 'owner', 'owner accessRole should be "owner"');

const ownerEditor = await loadAccessibleSite(dbAsType, 'clerk-owner', 'site-1', 'editor');
assert(ownerEditor !== null, 'owner must see site at editor tier');

const ownerOwner = await loadAccessibleSite(dbAsType, 'clerk-owner', 'site-1', 'owner');
assert(ownerOwner !== null, 'owner must see site at owner tier');

// --- Accepted editor collab ---
const editorViewer = await loadAccessibleSite(dbAsType, 'clerk-editor', 'site-1', 'viewer');
assert(editorViewer !== null, 'accepted editor must see site at viewer tier');
assert(editorViewer?.accessRole === 'editor', 'editor accessRole should be "editor"');
assert(
  editorViewer?.customerId === 'cust-owner',
  'editor accessibleSite.customerId must be site owner, not the collaborator',
);

const editorEditor = await loadAccessibleSite(dbAsType, 'clerk-editor', 'site-1', 'editor');
assert(editorEditor !== null, 'accepted editor must see site at editor tier');

const editorOwner = await loadAccessibleSite(dbAsType, 'clerk-editor', 'site-1', 'owner');
assert(editorOwner === null, 'accepted editor must NOT see site at owner tier');

// --- Accepted viewer collab ---
const viewerViewer = await loadAccessibleSite(dbAsType, 'clerk-viewer', 'site-1', 'viewer');
assert(viewerViewer !== null, 'accepted viewer must see site at viewer tier');
assert(viewerViewer?.accessRole === 'viewer', 'viewer accessRole should be "viewer"');

const viewerEditor = await loadAccessibleSite(dbAsType, 'clerk-viewer', 'site-1', 'editor');
assert(viewerEditor === null, 'accepted viewer must NOT see site at editor tier');

// --- Pending (unaccepted) invite ---
const pendingViewer = await loadAccessibleSite(dbAsType, 'clerk-pending', 'site-1', 'viewer');
assert(pendingViewer === null, 'pending (acceptedAt=null) invite must NOT see site');

// --- Unrelated stranger ---
const strangerViewer = await loadAccessibleSite(dbAsType, 'clerk-stranger', 'site-1', 'viewer');
assert(strangerViewer === null, 'unrelated customer must NOT see site');

// --- Non-existent customer ---
const ghostViewer = await loadAccessibleSite(dbAsType, 'clerk-not-in-db', 'site-1', 'viewer');
assert(ghostViewer === null, 'unknown Clerk user must NOT see site');

process.stdout.write(
  '[version-route-collab-access:smoke] OK 1 — access matrix matches tier model\n',
);

// ---------------------------------------------------------------------------
// 3. Static check — `route.ts` calls loadAccessibleSite for each handler at
//    the expected tier, and no longer references resolveOwnedSiteId.
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const routeSrc = await readFile(resolve(here, 'route.ts'), 'utf-8');

assert(
  !routeSrc.includes('resolveOwnedSiteId'),
  'route.ts must no longer reference resolveOwnedSiteId — collaborators were locked out',
);
assert(
  routeSrc.includes("import { loadAccessibleSite") &&
    routeSrc.includes("from '../auth/accessible-site"),
  'route.ts must import loadAccessibleSite from ../auth/accessible-site',
);

// Each handler must pass the expected tier. We pin the literal string each
// route's resolveAccessibleSiteId call ends with.
const expected: Array<{ marker: string; tier: 'viewer' | 'editor' }> = [
  { marker: "versionRoute.get('/'", tier: 'viewer' },
  { marker: "versionRoute.post('/'", tier: 'editor' },
  { marker: "versionRoute.post('/:snapshotId/restore'", tier: 'editor' },
  { marker: "versionRoute.get('/:snapshotId/preview'", tier: 'viewer' },
  { marker: "versionRoute.delete('/:snapshotId'", tier: 'editor' },
];
for (const { marker, tier } of expected) {
  const idx = routeSrc.indexOf(marker);
  assert(idx >= 0, `route.ts missing handler ${marker}`);
  // The handler body should call resolveAccessibleSiteId(c, siteId, '<tier>')
  // before the next handler declaration.
  const tail = routeSrc.slice(idx, idx + 1200);
  const tierCall = `resolveAccessibleSiteId(c, siteId, '${tier}')`;
  assert(
    tail.includes(tierCall),
    `handler ${marker} must call ${tierCall}; got snippet:\n${tail.slice(0, 400)}`,
  );
}

process.stdout.write(
  '[version-route-collab-access:smoke] OK 2 — route.ts wires loadAccessibleSite per handler\n',
);

// ---------------------------------------------------------------------------
// 4. Panel `r.ok` surfacing — assert versions-panel.ts no longer drops 4xx
//    bodies into "No snapshots yet." The source-pattern check is the
//    correct level here: the panel renders DOM via `document.createElement`
//    using closures over `loading` + `ctx.setStatus`; a behavioural test
//    would need a `document` stub AND a fake `EditorContext`, and the only
//    invariants worth pinning are exactly the lines that broke Bug #11.
// ---------------------------------------------------------------------------

const panelSrc = await readFile(
  resolve(here, '..', 'editor-client', 'versions-panel.ts'),
  'utf-8',
);

assert(
  panelSrc.includes('if (!r.ok)') && panelSrc.includes("'versions list failed: '"),
  'versions-panel.ts list fetch must check r.ok and throw a "versions list failed" error',
);
assert(
  panelSrc.includes("'Failed to load versions: '"),
  'versions-panel.ts must render the error message in the loading element, not just "Failed to load versions."',
);
assert(
  panelSrc.includes("ctx.setStatus('Versions: '"),
  'versions-panel.ts must call ctx.setStatus with "Versions: " on list fetch failure to fail loudly in the status bar',
);

process.stdout.write(
  '[version-route-collab-access:smoke] OK 3 — versions-panel surfaces non-ok list responses\n',
);

process.stdout.write('[version-route-collab-access:smoke] OK\n');
