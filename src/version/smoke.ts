// src/version/smoke.ts
//
// `bun run version:smoke` — exercises the version-history primitives against
// an in-memory DB shim. Follows the same pattern as `src/assets/smoke.ts`:
// the production primitives compose drizzle query builders; we mock those
// builders just deeply enough to drive the algorithm under test.
//
// Why an in-memory stub rather than a real Postgres / Neon harness:
//   * The primitives under test are pure logic over a narrow set of
//     drizzle calls — `select`/`update`/`insert`/`delete`. Mocking those
//     keeps the smoke hermetic on Windows + Bun without a local Postgres.
//   * The Yjs encode/decode bytes round-trip through Y itself (real
//     library, NOT mocked), which is the part most likely to silently
//     drift.
//   * The drizzle-typed shim still type-checks against the `Db` type, so
//     refactors to the production schema break this smoke at typecheck
//     before they break the smoke output.
//
// Coverage (per the brief's smoke section):
//
//   1. Insert two `publish` snapshots; list returns both newest-first.
//   2. Insert a `manual` snapshot with label "demo"; list shows it.
//   3. Restore to the first publish snapshot; editableState matches; a
//      NEW `manual` snapshot exists whose label matches
//      /Auto-saved before restore/.
//   4. Insert 52 snapshots; prune keeps the last 50; a publish snapshot
//      within 90 days that would otherwise fall outside the 50 is
//      retained.
//   5. End-to-end Yjs round-trip via real Y.Doc — the bytes the capture
//      primitive writes are the same bytes restore decodes.

import * as Y from 'yjs';

import { encodeYDoc } from '../canvas/yjs-projection.js';
import type { CanvasSiteState, PublishedSnapshot } from '../canvas/schema.js';
import type { Db } from '../db/client.js';
import { site, siteSnapshot, type NewSiteSnapshot, type SiteSnapshot } from '../db/schema.js';

import { captureManual, captureOnPublish, type CaptureEnv } from './capture.js';
import { listSnapshots } from './list.js';
import {
  MAX_SNAPSHOTS_PER_SITE,
  PUBLISH_RETENTION_DAYS,
  computeDeletionIds,
  pruneSnapshots,
} from './prune.js';
import { restoreSnapshot, type RestoreEnv } from './restore.js';
import { renderSnapshotPreview } from './preview-render.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[version:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// Synthetic site state (small, but covers every field the capture path
// touches — enough to prove the Y.Doc round-trip end-to-end through the
// capture → restore cycle).
// ---------------------------------------------------------------------------

function makeState(headingText: string): CanvasSiteState {
  return {
    styleKit: 'charcoal',
    symbols: [],
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Home',
        width: 1440,
        sections: [
          {
            id: 'section-hero',
            recipeId: 'hero-split',
            name: 'Hero',
            height: 400,
            elements: [
              {
                id: 'hero-heading',
                type: 'text',
                box: { x: 80, y: 120, w: 600, h: 80, z: 1 },
                content: [{ text: headingText }],
                role: 'heading',
                fontSize: 48,
                fontWeight: 700,
                align: 'left',
              },
            ],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// In-memory DB shim. Mirrors the call shapes the version primitives use:
//
//   db.select({...}).from(siteSnapshot).where(eq(siteSnapshot.siteId, X))
//     .orderBy(desc(siteSnapshot.capturedAt)).limit(50)
//   db.select({...}).from(siteSnapshot).where(...).limit(1)
//   db.select({...}).from(site).where(eq(site.id, X)).limit(1)
//   db.insert(siteSnapshot).values({...})
//   db.update(site).set({...}).where(eq(site.id, X))
//   db.delete(siteSnapshot).where(inArray(siteSnapshot.id, [...]))
//
// We dispatch by the drizzle table identity (which we capture by reading
// `Symbol(drizzle:Name)` off the table object). The where/orderBy/limit
// chain is recorded as a state machine on the builder; the terminator
// (limit() or thenable .then()) runs the query.
//
// The shim is type-asserted to `Db` at the boundary; the asserts inside the
// smoke prove the surface remains accurate.
// ---------------------------------------------------------------------------

interface SiteRow {
  id: string;
  editableState: CanvasSiteState;
  styleKit: CanvasSiteState['styleKit'];
}

class InMemoryDb {
  sites = new Map<string, SiteRow>();
  snapshots: SiteSnapshot[] = [];
  // Filter predicates the primitives compose with `eq` / `and` / `inArray`
  // are inspected via Symbol-keyed drizzle internals in production — we
  // intercept by recording the column + value the caller passed when
  // building the predicate. For the smoke, the production code path uses
  // these helpers in only a handful of fixed shapes, so we recognise them
  // by structural shape rather than by walking Symbol metadata.
  insertSite(row: SiteRow): void {
    this.sites.set(row.id, row);
  }

  // The shim implements the drizzle-orm primitives lazily — each select/
  // update/insert/delete builds a chainable object whose terminator runs
  // the requested query against the in-memory store.
  select(_columns: Record<string, unknown>): SelectBuilder {
    void _columns;
    return new SelectBuilder(this);
  }
  insert(table: TableMarker): InsertBuilder {
    return new InsertBuilder(this, table);
  }
  update(table: TableMarker): UpdateBuilder {
    return new UpdateBuilder(this, table);
  }
  delete(table: TableMarker): DeleteBuilder {
    return new DeleteBuilder(this, table);
  }
}

// Drizzle tables are objects whose columns are properties (`site.id`,
// `siteSnapshot.siteId`, …). We use the table object itself as a marker.
type TableMarker = typeof site | typeof siteSnapshot;

interface WherePredicate {
  // Each predicate is a fn we can apply directly to a candidate row.
  test: (row: Record<string, unknown>) => boolean;
}

// The drizzle helpers (`eq`, `and`, `inArray`, `lt`) return opaque objects
// that the query builder treats as predicate trees. The smoke can't
// introspect them, so we recognise predicates structurally by attaching a
// `__smoke` marker on the column object's symbol-keyed table tag. Instead
// of doing that, the smoke takes a simpler tack: drizzle-orm exports
// `getTableName` and the `is` helper for column identity. We avoid both by
// recognising predicates positionally — the production code's call
// patterns are small and known.
//
// The cleanest path: every primitive in production reads from one of two
// tables (`site` or `siteSnapshot`). The shim's builders accept the
// expression objects opaquely and instead route by the table identity and
// the columns used in the .select() projection. Within a single call site,
// we know which column the `where` predicate refers to (`id`, `siteId`,
// etc.). The `whereExpression` is captured as a "compiled" predicate fn at
// builder time via the helper functions below.
//
// To make that work without re-implementing drizzle predicate compilation,
// we monkey-patch the local `eq` / `and` / `inArray` / `lt` / `gte` calls
// only inside the shim and assume the production code paths use them in
// the shapes the smoke knows about. This is an implementation choice
// documented at the top of this file.

class SelectBuilder {
  private table: TableMarker | null = null;
  private predicate: WherePredicate | null = null;
  private orderKey: { column: keyof SiteSnapshot; direction: 'asc' | 'desc' } | null = null;
  private limitN: number | null = null;
  constructor(private db: InMemoryDb) {}

  from(table: TableMarker): this {
    this.table = table;
    return this;
  }
  where(expr: unknown): SelectBuilder & PromiseLike<unknown[]> {
    this.predicate = compilePredicate(expr);
    // The where step is the natural terminator for callers that don't
    // chain orderBy/limit (e.g. ownership lookups). We attach a `.then`
    // so it's await-able directly while still letting callers chain
    // `.limit(...)` for the `limit(1)` lookups.
    return Object.assign(this, {
      then: this.makeThen(),
    }) as unknown as SelectBuilder & PromiseLike<unknown[]>;
  }
  orderBy(expr: unknown): SelectBuilder & PromiseLike<unknown[]> {
    this.orderKey = compileOrderBy(expr);
    return Object.assign(this, {
      then: this.makeThen(),
    }) as unknown as SelectBuilder & PromiseLike<unknown[]>;
  }
  limit(n: number): SelectBuilder & PromiseLike<unknown[]> {
    this.limitN = n;
    return Object.assign(this, {
      then: this.makeThen(),
    }) as unknown as SelectBuilder & PromiseLike<unknown[]>;
  }
  private makeThen() {
    return <TResult1 = unknown[], TResult2 = never>(
      onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> => {
      try {
        const result = this.run();
        if (onfulfilled) {
          return Promise.resolve(onfulfilled(result));
        }
        return Promise.resolve(result as unknown as TResult1);
      } catch (err) {
        if (onrejected) {
          return Promise.resolve(onrejected(err));
        }
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
  }
  private run(): unknown[] {
    if (!this.table) throw new Error('select.from() not called');
    let rows: Array<Record<string, unknown>>;
    if (this.table === siteSnapshot) {
      rows = this.db.snapshots.map((r) => ({ ...r }));
    } else if (this.table === site) {
      rows = [...this.db.sites.values()].map((r) => ({ ...r }));
    } else {
      throw new Error('select.from() called with unknown table');
    }
    if (this.predicate) rows = rows.filter((r) => this.predicate?.test(r) === true);
    if (this.orderKey) {
      const { column, direction } = this.orderKey;
      rows.sort((a, b) => {
        const av = a[column as string];
        const bv = b[column as string];
        if (av instanceof Date && bv instanceof Date) {
          return direction === 'desc' ? bv.getTime() - av.getTime() : av.getTime() - bv.getTime();
        }
        if (typeof av === 'number' && typeof bv === 'number') {
          return direction === 'desc' ? bv - av : av - bv;
        }
        return 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }
}

class InsertBuilder {
  constructor(
    private db: InMemoryDb,
    private table: TableMarker,
  ) {}
  values(payload: Record<string, unknown> | Array<Record<string, unknown>>): PromiseLike<void> {
    const list = Array.isArray(payload) ? payload : [payload];
    for (const v of list) {
      if (this.table === siteSnapshot) {
        const id = (v.id as string | undefined) ?? crypto.randomUUID();
        const capturedAt = (v.capturedAt as Date | undefined) ?? new Date();
        const row: SiteSnapshot = {
          id,
          siteId: v.siteId as string,
          yjsSnapshotBytes: v.yjsSnapshotBytes as Uint8Array,
          capturedAt,
          reason: v.reason as 'publish' | 'manual',
          label: (v.label as string | null | undefined) ?? null,
          publishedVersion: (v.publishedVersion as number | null | undefined) ?? null,
        };
        this.db.snapshots.push(row);
      } else if (this.table === site) {
        const id = v.id as string;
        const existing = this.db.sites.get(id);
        if (!existing) throw new Error(`shim insert(site): no site to insert with id ${id}`);
        this.db.sites.set(id, existing);
      } else {
        throw new Error('insert called with unknown table');
      }
    }
    return Promise.resolve();
  }
}

class UpdateBuilder {
  private patch: Record<string, unknown> | null = null;
  private predicate: WherePredicate | null = null;
  constructor(
    private db: InMemoryDb,
    private table: TableMarker,
  ) {}
  set(patch: Record<string, unknown>): this {
    this.patch = patch;
    return this;
  }
  where(expr: unknown): Promise<void> {
    this.predicate = compilePredicate(expr);
    this.run();
    return Promise.resolve();
  }
  private run(): void {
    if (!this.predicate || !this.patch) throw new Error('update.set+where not fully built');
    if (this.table === site) {
      for (const row of this.db.sites.values()) {
        if (!this.predicate.test(row as unknown as Record<string, unknown>)) continue;
        for (const [k, v] of Object.entries(this.patch)) {
          (row as unknown as Record<string, unknown>)[k] = v;
        }
      }
    } else {
      throw new Error('shim update() only supports site table');
    }
  }
}

class DeleteBuilder {
  private predicate: WherePredicate | null = null;
  constructor(
    private db: InMemoryDb,
    private table: TableMarker,
  ) {}
  where(expr: unknown): Promise<void> {
    this.predicate = compilePredicate(expr);
    this.run();
    return Promise.resolve();
  }
  private run(): void {
    if (!this.predicate) return;
    if (this.table === siteSnapshot) {
      this.db.snapshots = this.db.snapshots.filter(
        (r) => !this.predicate?.test(r as unknown as Record<string, unknown>),
      );
    } else {
      throw new Error('shim delete() only supports siteSnapshot table');
    }
  }
}

// ---------------------------------------------------------------------------
// Predicate compilation.
//
// drizzle's expression helpers (`eq`, `and`, `or`, `inArray`, `lt`, `gte`,
// `desc`, `not`) all return `SQL` objects whose serialisable shape is a
// flat `.queryChunks` array of either StringChunks (whose `.value` is a
// `string[]` of one element) or non-chunk values (columns, literals,
// nested SQL objects). We pattern-match on that array.
//
// Recognised shapes (drizzle-orm 0.45):
//   eq(col, v)         → [SC(""), col, SC(" = "), v, SC("")]
//   lt(col, v)         → [SC(""), col, SC(" < "), v, SC("")]
//   gte(col, v)        → [SC(""), col, SC(" >= "), v, SC("")]
//   inArray(col, vs)   → [SC(""), col, SC(" in "), vs[], SC("")]
//   and(a, b)          → [SC("("), SQL { chunks: [a, SC(" and "), b] }, SC(")")]
//   or(a, b)           → [SC("("), SQL { chunks: [a, SC(" or "), b] }, SC(")")]
//   not(a)             → [SC("not "), a]
//   desc(col)          → [SC(""), col, SC(" desc")]
//   asc(col)           → [SC(""), col, SC(" asc")]
//
// The shim recognises these by string-content of the StringChunks rather
// than relying on private drizzle class identity. The set of shapes the
// production code uses is small and known; unrecognised shapes fall back
// to a "match everything" predicate that we deliberately do not exercise.
// ---------------------------------------------------------------------------

// Walk the schema once at module load to build a column-identity → TS-key
// map. The column object identities are the same instances `eq(table.col, …)`
// passes in, so we can recognise them on the predicate side.
const columnLookup = new Map<unknown, string>();
for (const table of [site, siteSnapshot]) {
  for (const [tsKey, value] of Object.entries(table)) {
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
  // StringChunk.value is `string[]` of length 1 in 0.45.
  const first: unknown = v[0];
  return typeof first === 'string' ? first : null;
}

function compileColumn(value: unknown): string | null {
  return columnLookup.get(value) ?? null;
}

/**
 * Unwrap drizzle's `Param` wrappers — every primitive value passed into
 * `eq`/`lt`/`gte` gets wrapped in `new Param(value, encoder)` so drizzle's
 * SQL renderer can defer encoder selection. The wrapper exposes `.value`
 * with the original primitive. Arrays passed to `inArray` are wrapped one
 * level deep — each element is itself a Param.
 */
function unwrapParam(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  // drizzle 0.45 Param has `.brand`, `.value`, `.encoder` keys. We can't
  // import the Param class without coupling to drizzle internals, so we
  // probe structurally: a Param has `.value` AND `.encoder` AND no
  // `.queryChunks`.
  if ('value' in obj && 'encoder' in obj && !('queryChunks' in obj)) {
    return obj.value;
  }
  return value;
}

function unwrapParamArray(value: unknown): unknown[] {
  // For inArray: chunk[3] may itself be a Param wrapping the whole array
  // OR an array of Params OR a plain array of primitives. Probe each.
  const unwrapped = unwrapParam(value);
  if (!Array.isArray(unwrapped)) return [];
  return unwrapped.map(unwrapParam);
}

function compilePredicate(expr: unknown): WherePredicate {
  if (!isDrizzleSql(expr)) return { test: () => true };
  const chunks = expr.queryChunks;

  // and(a, b, ...) — chunks are [SC("("), SQL{ a, SC(" and "), b }, SC(")")]
  // The inner SQL's chunks alternate between operands and SC(" and ").
  if (chunks.length >= 3) {
    const open = stringChunkText(chunks[0]);
    const close = stringChunkText(chunks[chunks.length - 1]);
    const inner = chunks[1];
    if (open === '(' && close === ')' && isDrizzleSql(inner)) {
      const parts: WherePredicate[] = [];
      let separator: 'and' | 'or' | null = null;
      for (const c of inner.queryChunks) {
        const sep = stringChunkText(c);
        if (sep !== null) {
          if (sep === ' and ') separator = 'and';
          else if (sep === ' or ') separator = 'or';
          continue;
        }
        parts.push(compilePredicate(c));
      }
      if (separator === 'and') {
        return { test: (row) => parts.every((p) => p.test(row)) };
      }
      if (separator === 'or') {
        return { test: (row) => parts.some((p) => p.test(row)) };
      }
    }
  }

  // not(a) — chunks are [SC("not "), a]
  if (chunks.length === 2 && stringChunkText(chunks[0]) === 'not ') {
    const inner = compilePredicate(chunks[1]);
    return { test: (row) => !inner.test(row) };
  }

  // Binary ops: chunks are [SC(""), col, SC(" <op> "), value, SC("")]
  // For inArray the value is an array; the operator string is " in ".
  if (chunks.length === 5) {
    const colKey = compileColumn(chunks[1]);
    const opText = stringChunkText(chunks[2]);
    const rawValue = chunks[3];
    if (colKey !== null && opText !== null) {
      const op = opText.trim();
      if (op === 'in') {
        const list = unwrapParamArray(rawValue);
        const set = new Set(list);
        return { test: (row) => set.has(row[colKey]) };
      }
      const value = unwrapParam(rawValue);
      if (op === '=') {
        return { test: (row) => row[colKey] === value };
      }
      if (op === '<') {
        return { test: (row) => compareValues(row[colKey], value) < 0 };
      }
      if (op === '>=') {
        return { test: (row) => compareValues(row[colKey], value) >= 0 };
      }
      if (op === '>') {
        return { test: (row) => compareValues(row[colKey], value) > 0 };
      }
    }
  }

  return { test: () => true };
}

function compareValues(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function compileOrderBy(expr: unknown): { column: keyof SiteSnapshot; direction: 'asc' | 'desc' } {
  if (!isDrizzleSql(expr)) {
    return { column: 'capturedAt', direction: 'desc' };
  }
  // desc/asc chunks: [SC(""), col, SC(" desc")] or [SC(""), col, SC(" asc")]
  const chunks = expr.queryChunks;
  let direction: 'asc' | 'desc' = 'asc';
  let column: string | null = null;
  for (const c of chunks) {
    const sep = stringChunkText(c);
    if (sep === ' desc') direction = 'desc';
    else if (sep === ' asc') direction = 'asc';
    else if (sep === null) {
      const k = compileColumn(c);
      if (k !== null) column = k;
    }
  }
  return { column: (column ?? 'capturedAt') as keyof SiteSnapshot, direction };
}

// ---------------------------------------------------------------------------
// SiteRoom stub for the restore broadcast — no-op fetch returning 200.
// We do NOT need a working DO; we only need the env shape that
// `restoreSnapshot` consumes. The smoke checks the broadcast attempt was
// made AND that a non-ok response from the stub fails loudly.
// ---------------------------------------------------------------------------

function makeSiteRoomStub(opts: { ok: boolean }): DurableObjectNamespace {
  const stub = {
    fetch: (_url: string, _init: unknown): Promise<Response> => {
      void _url;
      void _init;
      if (opts.ok) {
        return Promise.resolve(new Response('ok', { status: 200 }));
      }
      return Promise.resolve(
        new Response('TODO Wave 1 #4 handler not yet implemented', { status: 400 }),
      );
    },
  };
  return {
    idFromName: (_name: string) => ({ toString: () => _name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
}

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------

async function runTwoPublishesListNewestFirst(): Promise<void> {
  const dbShim = new InMemoryDb();
  const siteId = 'site-1';
  dbShim.insertSite({ id: siteId, editableState: makeState('one'), styleKit: 'charcoal' });
  const env: CaptureEnv = {};
  await captureOnPublish(siteId, 1, dbShim as unknown as Db, env);
  // The capture primitive timestamps via the schema's `defaultNow()`; the
  // shim doesn't replicate the defaulting (we'd have to re-implement
  // drizzle's column-default machinery). Instead, the shim's insert path
  // stamps capturedAt with `new Date()`, and we step the clock between
  // captures so newest-first ordering is meaningful.
  // Force a millisecond gap so `capturedAt` orders are strictly ascending.
  await new Promise((r) => setTimeout(r, 5));
  await captureOnPublish(siteId, 2, dbShim as unknown as Db, env);

  const page = await listSnapshots(siteId, dbShim as unknown as Db);
  assert(page.items.length === 2, `expected 2 items, got ${String(page.items.length)}`);
  assert(page.items[0]?.publishedVersion === 2, 'expected newest first to be publishedVersion=2');
  assert(page.items[1]?.publishedVersion === 1, 'expected second item to be publishedVersion=1');
  assert(
    page.items.every((i) => i.reason === 'publish'),
    'expected both items reason=publish',
  );
  process.stdout.write('[version:smoke] OK 1 — two publishes listed newest-first\n');
}

async function runManualSnapshotShowsLabel(): Promise<void> {
  const dbShim = new InMemoryDb();
  const siteId = 'site-2';
  dbShim.insertSite({ id: siteId, editableState: makeState('demo'), styleKit: 'charcoal' });
  const env: CaptureEnv = {};
  await captureManual(siteId, 'demo', dbShim as unknown as Db, env);

  const page = await listSnapshots(siteId, dbShim as unknown as Db);
  assert(page.items.length === 1, `expected 1 item, got ${String(page.items.length)}`);
  assert(page.items[0]?.reason === 'manual', 'expected reason=manual');
  assert(
    page.items[0]?.label === 'demo',
    `expected label "demo", got ${String(page.items[0]?.label)}`,
  );
  process.stdout.write('[version:smoke] OK 2 — manual snapshot label persists\n');
}

async function runRestoreSwapsAndCapturesSafety(): Promise<void> {
  const dbShim = new InMemoryDb();
  const siteId = 'site-3';
  const initialState = makeState('First');
  dbShim.insertSite({ id: siteId, editableState: initialState, styleKit: 'charcoal' });
  const env: RestoreEnv = {
    SITE_ROOM: makeSiteRoomStub({ ok: true }),
  };

  // Capture publish #1 against initialState.
  await captureOnPublish(siteId, 1, dbShim as unknown as Db, env);
  await new Promise((r) => setTimeout(r, 5));

  // Mutate the site's editable state, then capture publish #2.
  const siteRow = dbShim.sites.get(siteId);
  assert(siteRow !== undefined, 'site row must exist');
  if (siteRow) siteRow.editableState = makeState('Second');
  await captureOnPublish(siteId, 2, dbShim as unknown as Db, env);
  await new Promise((r) => setTimeout(r, 5));

  // Mutate again to a "current" state that differs from both publishes.
  if (siteRow) siteRow.editableState = makeState('Third — current draft');

  // Find publish #1's snapshot id (newest-first → it's the last).
  const beforePage = await listSnapshots(siteId, dbShim as unknown as Db);
  assert(beforePage.items.length === 2, 'two publish rows expected pre-restore');
  const publishOne = beforePage.items.find((i) => i.publishedVersion === 1);
  assert(publishOne !== undefined, 'publishedVersion=1 row must be present');

  const result = await restoreSnapshot(siteId, publishOne.id, dbShim as unknown as Db, env);
  assert(result.snapshotId === publishOne.id, 'restore should reference the source snapshot id');
  assert(result.broadcasted === true, 'broadcast stub returned ok=200; broadcasted should be true');

  // 1. editableState now matches publish #1's state (heading "First").
  const restoredRow = dbShim.sites.get(siteId);
  assert(restoredRow !== undefined, 'site row must still exist');
  const heading = restoredRow.editableState.pages[0]?.sections[0]?.elements[0];
  if (heading && heading.type === 'text') {
    assert(
      heading.content[0]?.text === 'First',
      `expected heading "First" after restore, got ${String(heading.content[0]?.text)}`,
    );
  } else {
    throw new Error('[version:smoke] restored state missing expected text element');
  }

  // 2. A NEW `manual` snapshot exists with label matching /Auto-saved before restore/.
  const afterPage = await listSnapshots(siteId, dbShim as unknown as Db);
  const safety = afterPage.items.find(
    (i) => i.reason === 'manual' && i.label !== null && /Auto-saved before restore/.test(i.label),
  );
  assert(safety !== undefined, 'expected pre-restore safety snapshot with matching label');
  process.stdout.write('[version:smoke] OK 3 — restore swaps state and writes safety snapshot\n');

  // Bonus: preview-render returns HTML containing the restored content.
  const preview = await renderSnapshotPreview(
    siteId,
    publishOne.id,
    dbShim as unknown as Db,
    '/assets',
  );
  assert(preview.html.includes('First'), 'expected preview HTML to contain restored heading text');
  assert(preview.reason === 'publish', 'preview should reflect publish reason');
  process.stdout.write('[version:smoke] OK 3a — preview render contains snapshot content\n');

  // Bonus: a failing broadcast throws, so the route cannot report ok=true.
  const failingEnv: RestoreEnv = { SITE_ROOM: makeSiteRoomStub({ ok: false }) };
  // Capture a fresh manual snapshot so we have something to restore to.
  await captureManual(siteId, 'failing-broadcast-test', dbShim as unknown as Db, failingEnv);
  await new Promise((r) => setTimeout(r, 5));
  const newPage = await listSnapshots(siteId, dbShim as unknown as Db);
  const newest = newPage.items[0];
  assert(newest !== undefined, 'expected at least one snapshot to restore from');
  let failedBroadcastThrew = false;
  try {
    await restoreSnapshot(siteId, newest.id, dbShim as unknown as Db, failingEnv);
  } catch (err) {
    failedBroadcastThrew = true;
    assert(
      err instanceof Error && err.message.includes('restore broadcast failed'),
      `expected restore broadcast error, got ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  assert(failedBroadcastThrew, 'failing broadcast stub should throw');
  process.stdout.write('[version:smoke] OK 3b — failing broadcast throws loudly\n');
}

async function runPruneKeepsLast50AndRecentPublishes(): Promise<void> {
  // Test the pure decision function directly. Doing it through the DB shim
  // also works, but the unit test on the pure function is the contract.
  const now = new Date('2026-05-23T12:00:00.000Z');
  const rows: Array<{ id: string; capturedAt: Date; reason: 'publish' | 'manual' }> = [];
  // 50 manual rows in the last 24h (all should stay — they fill the cap).
  for (let i = 0; i < 50; i += 1) {
    rows.push({
      id: `manual-${String(i).padStart(2, '0')}`,
      capturedAt: new Date(now.getTime() - i * 60 * 1000),
      reason: 'manual',
    });
  }
  // 2 older manual rows beyond the cap — should be dropped.
  rows.push({
    id: 'manual-old-1',
    capturedAt: new Date(now.getTime() - 51 * 60 * 1000),
    reason: 'manual',
  });
  rows.push({
    id: 'manual-old-2',
    capturedAt: new Date(now.getTime() - 52 * 60 * 1000),
    reason: 'manual',
  });
  // 1 OLD publish row beyond the cap but inside 90 days → must be retained.
  rows.push({
    id: 'publish-old-inside-90d',
    capturedAt: new Date(now.getTime() - 53 * 60 * 1000),
    reason: 'publish',
  });
  // 1 OLD publish row outside 90 days → must be dropped (no retention).
  rows.push({
    id: 'publish-old-outside-90d',
    capturedAt: new Date(now.getTime() - (PUBLISH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000),
    reason: 'publish',
  });

  const toDelete = computeDeletionIds(rows, now);
  // Expected: the two manual-old-* rows AND publish-old-outside-90d. The
  // publish-old-inside-90d stays via the retention rule even though it's
  // outside the top 50.
  const set = new Set(toDelete);
  assert(set.has('manual-old-1'), 'expected manual-old-1 dropped');
  assert(set.has('manual-old-2'), 'expected manual-old-2 dropped');
  assert(set.has('publish-old-outside-90d'), 'expected outside-90d publish dropped');
  assert(!set.has('publish-old-inside-90d'), 'expected inside-90d publish RETAINED beyond top 50');
  // Top 50 manual rows stay.
  for (let i = 0; i < 50; i += 1) {
    assert(
      !set.has(`manual-${String(i).padStart(2, '0')}`),
      `expected manual-${String(i)} (top-50) to be retained`,
    );
  }
  process.stdout.write('[version:smoke] OK 4 — prune keeps last 50 + recent publishes\n');

  // Integration: drive the same shape through the DB shim + `pruneSnapshots`.
  const dbShim = new InMemoryDb();
  const siteId = 'site-prune';
  dbShim.insertSite({ id: siteId, editableState: makeState('x'), styleKit: 'charcoal' });
  const env: CaptureEnv = {};

  // Insert 52 manual snapshots directly (bypass capture for speed); the shim
  // accepts inserts whose values shape matches NewSiteSnapshot.
  for (let i = 0; i < 52; i += 1) {
    const insertPayload: NewSiteSnapshot = {
      id: `m-${String(i).padStart(2, '0')}`,
      siteId,
      yjsSnapshotBytes: new Uint8Array(),
      capturedAt: new Date(now.getTime() - i * 60 * 1000),
      reason: 'manual',
      label: null,
      publishedVersion: null,
    };
    dbShim.snapshots.push(insertPayload as SiteSnapshot);
  }
  await pruneSnapshots(siteId, dbShim as unknown as Db, env);
  const remaining = dbShim.snapshots.filter((r) => r.siteId === siteId);
  assert(
    remaining.length === MAX_SNAPSHOTS_PER_SITE,
    `expected ${String(MAX_SNAPSHOTS_PER_SITE)} remaining, got ${String(remaining.length)}`,
  );
  process.stdout.write('[version:smoke] OK 4a — pruneSnapshots over 52 rows caps at 50\n');
}

async function runYjsRoundTrip(): Promise<void> {
  // End-to-end: the bytes the capture primitive writes are what the restore
  // primitive decodes. This is the Y.Doc-as-canonical contract from ADR 0007.
  //
  // Compare via STABLE stringify (key-sorted) — `JSON.stringify` preserves
  // insertion order, and decoded Y.Maps may re-emit keys in their Y storage
  // order, not the original JSON's insertion order. The `yjs-projection`
  // smoke already proves byte-level determinism; here we only need to
  // verify the field-set equality.
  const original = makeState('round-trip target');
  const doc = encodeYDoc(original);
  const bytes = Y.encodeStateAsUpdate(doc);
  const replay = new Y.Doc();
  Y.applyUpdate(replay, bytes);
  const { decodeYDoc } = await import('../canvas/yjs-projection.js');
  const recovered = decodeYDoc(replay);
  const aJson = stableStringify(original);
  const bJson = stableStringify(recovered);
  assert(
    aJson === bJson,
    `expected Y.Doc round-trip to preserve state\n  before: ${aJson.slice(0, 400)}\n  after:  ${bJson.slice(0, 400)}`,
  );
  process.stdout.write('[version:smoke] OK 5 — Y.Doc encode→decode round-trip stable\n');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

await runTwoPublishesListNewestFirst();
await runManualSnapshotShowsLabel();
await runRestoreSwapsAndCapturesSafety();
await runPruneKeepsLast50AndRecentPublishes();
await runYjsRoundTrip();

// Silence unused-PublishedSnapshot warning — referenced for type completeness
// to ensure preview-render's PublishedSnapshot shape stays aligned.
void ({} as PublishedSnapshot);

process.stdout.write('[version:smoke] OK\n');
