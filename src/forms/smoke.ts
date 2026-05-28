// src/forms/smoke.ts
//
// `bun run forms:smoke` — Wave 2 #7. Exercises the forms subsystem end-to-end
// without a Worker runtime or a live database. Topology:
//
//   - Pure-function tests: renderForm, validateSubmissionPayload, hashIp,
//     signWebhookBody, exportFormSubmissionsCsv.
//   - Stubbed Turnstile verifier (always-pass / always-fail variants).
//   - Stubbed FormRateLimiter DO namespace — a faithful re-implementation of
//     the tick-tock-60s counter from the production DO. The smoke can't
//     instantiate the real DO because `cloudflare:workers` isn't available
//     outside `wrangler dev`; instead, we mirror the policy + invariant.
//   - In-memory DB shim that supports the exact drizzle call patterns the
//     submit + inbox paths use (select / insert / count(*) over predicates).
//
// What the smoke proves (per the plan brief §"Smoke"):
//   1. renderForm() emits a real HTML <form> posting to the expected endpoint,
//      including the Turnstile widget when configured.
//   2. handleFormSubmit with stub Turnstile (always-pass) persists a row.
//   3. Eleven submits from the same ipHash — eleventh is 429.
//   4. Webhook stub receives a POST plus the X-Rev01-Signature header keyed
//      by WEBHOOK_SIGNING_SECRET (signature verifies against the body bytes).
//   5. exportFormSubmissionsCsv emits valid CSV with the expected header row.

import { and, count, eq, gte, lt, sql } from 'drizzle-orm';

import {
  renderForm,
  type FormElement,
  type FormFieldDef,
} from '../canvas/elements/form.js';
import type { CanvasSiteState, PublishedSnapshot, TextElement } from '../canvas/schema.js';
import type { Db } from '../db/client.js';
import {
  formSubmission as formSubmissionTable,
  site as siteTable,
  type FormSubmission,
  type NewFormSubmission,
  type Site,
} from '../db/schema.js';
import type {
  FormRateLimiterMarker,
  RateLimitKind,
  TryAcquireResult,
} from '../live/form-rate-limiter-client.js';

import { exportFormSubmissionsCsv, listFormSubmissions } from './inbox.js';
import { handleFormSubmit, hashIp, validateSubmissionPayload } from './submit.js';
import { WEBHOOK_SIGNATURE_HEADER, deliverWebhook, signWebhookBody } from './webhook.js';
import type { TurnstileVerifyResult } from './turnstile.js';

void and;
void count;
void eq;
void gte;
void lt;
void sql;

// ---------------------------------------------------------------------------
// Assertion harness — mirrors version:smoke style.
// ---------------------------------------------------------------------------

function ok(label: string): void {
  process.stdout.write(`[forms:smoke] OK   ${label}\n`);
}

function fail(label: string, detail?: string): never {
  process.stderr.write(`[forms:smoke] FAIL ${label}\n`);
  if (detail) process.stderr.write(`  ${detail}\n`);
  process.exit(1);
}

function assert(condition: unknown, label: string, detail?: string): asserts condition {
  if (condition) {
    ok(label);
    return;
  }
  fail(label, detail);
}

// ---------------------------------------------------------------------------
// Fixture form element + site.
// ---------------------------------------------------------------------------

const SITE_ID = 'site-forms';
const FORM_ID = 'contact-form-1';
const PAGE_SLUG = 'home';

const formFields: FormFieldDef[] = [
  { id: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Your name' },
  { id: 'email', label: 'Email', kind: 'email', required: true },
  { id: 'message', label: 'Message', kind: 'textarea', required: true },
  { id: 'subscribe', label: 'Subscribe me to updates', kind: 'checkbox', required: false },
];

const formElement: FormElement = {
  id: FORM_ID,
  type: 'form',
  box: { x: 0, y: 0, w: 600, h: 480, z: 1 },
  fields: formFields,
  submitLabel: 'Send message',
  successMessage: 'Thanks — we will get back to you.',
};

const heroHeading: TextElement = {
  id: 'hero-heading',
  type: 'text',
  box: { x: 0, y: 0, w: 600, h: 60, z: 1 },
  content: [{ text: 'Contact' }],
  role: 'heading',
  fontSize: 32,
  fontWeight: 700,
  align: 'left',
};

const editableState: CanvasSiteState = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: PAGE_SLUG,
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'section-hero',
          recipeId: 'hero-split',
          name: 'Hero',
          height: 600,
          elements: [heroHeading, formElement],
        },
      ],
    },
  ],
};

const publishedSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: editableState.pages,
};

// Webhook URL safety must reject local/private destinations before fetch.
{
  let fetchCalls = 0;
  const rejected = await deliverWebhook(
    'http://127.0.0.1:8080/hook',
    'secret',
    {
      siteId: SITE_ID,
      formElementId: FORM_ID,
      pageSlug: PAGE_SLUG,
      payload: {},
      submittedAt: '2026-05-28T00:00:00.000Z',
    },
    {
      fetchImpl: () => {
        fetchCalls += 1;
        return Promise.resolve(new Response('{}', { status: 200 }));
      },
    },
  );
  assert(
    rejected.ok === false && rejected.error === 'invalid-url',
    'webhook rejects loopback URL',
    JSON.stringify(rejected),
  );
  assert(fetchCalls === 0, 'webhook loopback rejection happens before fetch');
}

// ---------------------------------------------------------------------------
// In-memory DB shim. Supports the exact call patterns submit.ts + inbox.ts use:
//
//   db.select(...).from(siteTable).where(eq(siteTable.id, X)).limit(1)
//   db.select({ count: sql<number>... }).from(formSubmission).where(and(eq, eq, gte))
//   db.insert(formSubmission).values({...}).returning({ id: formSubmission.id })
//   db.select().from(formSubmission).where(and(eq, eq)).orderBy(...).limit(N+1)
//
// We compile drizzle expressions to predicate fns the same way version:smoke
// does: by walking the SQL `queryChunks` array. The recognised binary ops are
// `=`, `<`, `>=`, `in`; the recognised combinators are `and` / `or`.
// ---------------------------------------------------------------------------

type TableMarker = typeof siteTable | typeof formSubmissionTable;

const columnLookup = new Map<unknown, string>();
for (const table of [siteTable, formSubmissionTable]) {
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

interface CompiledPredicate {
  test: (row: Record<string, unknown>) => boolean;
}

function compilePredicate(expr: unknown): CompiledPredicate {
  if (!isDrizzleSql(expr)) return { test: () => true };
  const chunks = expr.queryChunks;

  if (chunks.length >= 3) {
    const open = stringChunkText(chunks[0]);
    const close = stringChunkText(chunks[chunks.length - 1]);
    const inner = chunks[1];
    if (open === '(' && close === ')' && isDrizzleSql(inner)) {
      const parts: CompiledPredicate[] = [];
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

  if (chunks.length === 5) {
    const colKey = columnLookup.get(chunks[1]) ?? null;
    const opText = stringChunkText(chunks[2]);
    const rawValue = chunks[3];
    if (colKey !== null && opText !== null) {
      const op = opText.trim();
      const value = unwrapParam(rawValue);
      if (op === '=') return { test: (row) => row[colKey] === value };
      if (op === '<') return { test: (row) => compare(row[colKey], value) < 0 };
      if (op === '>') return { test: (row) => compare(row[colKey], value) > 0 };
      if (op === '>=') return { test: (row) => compare(row[colKey], value) >= 0 };
    }
  }

  return { test: () => true };
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function compileOrderBy(expr: unknown): { column: string; direction: 'asc' | 'desc' } {
  // Drizzle accepts either a wrapped `asc(col)` / `desc(col)` SQL fragment OR
  // a bare column reference (which defaults to ASC). Handle both shapes.
  if (!isDrizzleSql(expr)) {
    const colKey = columnLookup.get(expr);
    return { column: colKey ?? 'submittedAt', direction: 'asc' };
  }
  let direction: 'asc' | 'desc' = 'asc';
  let column: string | null = null;
  for (const c of expr.queryChunks) {
    const sep = stringChunkText(c);
    if (sep === ' desc') direction = 'desc';
    else if (sep === ' asc') direction = 'asc';
    else if (sep === null) {
      const k = columnLookup.get(c);
      if (k !== undefined) column = k;
    }
  }
  return { column: column ?? 'submittedAt', direction };
}

class InMemoryDb {
  sites: Site[] = [];
  submissions: FormSubmission[] = [];

  seedSite(row: { id: string; publishedSnapshot: PublishedSnapshot | null }): void {
    this.sites.push({
      id: row.id,
      customerId: 'cust-1',
      name: 'Test',
      subdomain: 'test',
      styleKit: 'charcoal',
      editableState,
      publishedSnapshot: row.publishedSnapshot,
      publishedVersion: row.publishedSnapshot ? row.publishedSnapshot.version : 0,
      passwordEnabled: false,
      passwordHash: null,
      passwordSetAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // The shim's surface mirrors only the drizzle methods the production code
  // calls. Each method returns a chainable builder.
  select(projection?: Record<string, unknown>): SelectBuilder {
    return new SelectBuilder(this, projection);
  }
  insert(table: TableMarker): InsertBuilder {
    return new InsertBuilder(this, table);
  }
}

class SelectBuilder {
  private projection: Record<string, unknown> | undefined;
  private table: TableMarker | null = null;
  private predicate: CompiledPredicate | null = null;
  private orderKey: { column: string; direction: 'asc' | 'desc' } | null = null;
  private limitN: number | null = null;
  constructor(
    private db: InMemoryDb,
    projection?: Record<string, unknown>,
  ) {
    this.projection = projection;
  }
  from(table: TableMarker): this {
    this.table = table;
    return this;
  }
  where(expr: unknown): SelectBuilder & PromiseLike<unknown[]> {
    this.predicate = compilePredicate(expr);
    return this.thenable();
  }
  orderBy(expr: unknown): SelectBuilder & PromiseLike<unknown[]> {
    this.orderKey = compileOrderBy(expr);
    return this.thenable();
  }
  limit(n: number): SelectBuilder & PromiseLike<unknown[]> {
    this.limitN = n;
    return this.thenable();
  }
  private thenable(): SelectBuilder & PromiseLike<unknown[]> {
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
        if (onfulfilled) return Promise.resolve(onfulfilled(result));
        return Promise.resolve(result as unknown as TResult1);
      } catch (err) {
        if (onrejected) return Promise.resolve(onrejected(err));
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
  }
  private run(): unknown[] {
    if (!this.table) throw new Error('select.from() not called');
    let rows: Record<string, unknown>[];
    if (this.table === siteTable) {
      rows = this.db.sites.map((r): Record<string, unknown> => ({ ...r }));
    } else if (this.table === formSubmissionTable) {
      rows = this.db.submissions.map((r): Record<string, unknown> => ({ ...r }));
    } else {
      throw new Error('select.from(): unknown table');
    }
    if (this.predicate) rows = rows.filter((r) => this.predicate?.test(r) === true);
    if (this.orderKey) {
      const { column, direction } = this.orderKey;
      rows.sort((a, b) => {
        const diff = compare(a[column], b[column]);
        return direction === 'desc' ? -diff : diff;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    // count(*) projection — drizzle constructs it as a SQL fragment whose
    // alias is the only key in the projection. We detect by inspecting the
    // projection map: if it has exactly one key whose value is a SQL
    // expression containing "count", project as `{ count: rows.length }` (or
    // the chosen alias).
    if (this.projection) {
      const keys = Object.keys(this.projection);
      if (keys.length === 1) {
        const onlyKey = keys[0]!;
        const val = this.projection[onlyKey];
        if (isDrizzleSql(val) || isCountExpression(val)) {
          return [{ [onlyKey]: rows.length }];
        }
      }
      // Multi-column projection — return only the projected fields.
      return rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const [tsKey, columnRef] of Object.entries(this.projection!)) {
          const colName = columnLookup.get(columnRef);
          if (colName) out[tsKey] = r[colName];
        }
        return out;
      });
    }
    return rows;
  }
}

function isCountExpression(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  // drizzle's count() returns a SQL with `.queryChunks` containing the
  // `count(*)` literal; isDrizzleSql catches it above. This helper handles
  // the edge case where the projection value is a wrapped sql fragment.
  return Array.isArray(v.queryChunks);
}

class InsertBuilder {
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  constructor(
    private db: InMemoryDb,
    private table: TableMarker,
  ) {}
  values(payload: Record<string, unknown> | Record<string, unknown>[]): InsertReturning {
    this.payload = payload;
    return new InsertReturning(this.db, this.table, payload);
  }
}

class InsertReturning {
  constructor(
    private db: InMemoryDb,
    private table: TableMarker,
    private payload: Record<string, unknown> | Record<string, unknown>[],
  ) {}
  returning(_columns?: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    void _columns;
    const list = Array.isArray(this.payload) ? this.payload : [this.payload];
    const inserted: Array<Record<string, unknown>> = [];
    if (this.table === formSubmissionTable) {
      for (const v of list) {
        const row: FormSubmission = {
          id: (v.id as string | undefined) ?? `sub-${String(this.db.submissions.length + 1)}`,
          siteId: v.siteId as string,
          formElementId: v.formElementId as string,
          pageSlug: v.pageSlug as string,
          payload: (v.payload as Record<string, unknown>) ?? {},
          ipHash: v.ipHash as string,
          userAgent: (v.userAgent as string | undefined) ?? '',
          submittedAt: (v.submittedAt as Date | undefined) ?? new Date(),
        };
        this.db.submissions.push(row);
        inserted.push({ id: row.id });
      }
    } else {
      throw new Error('insert(): unknown table');
    }
    return Promise.resolve(inserted);
  }
}

// ---------------------------------------------------------------------------
// FormRateLimiter stub — mirrors the production tick-tock policy without
// pulling cloudflare:workers in.
// ---------------------------------------------------------------------------

interface CounterState {
  count: number;
  windowStartMs: number;
}

class StubRateLimiter {
  private state = new Map<string, CounterState>();
  /** Same policy as the production class. */
  private readonly cap = 10;
  private readonly windowMs = 60_000;
  private now: () => number = () => Date.now();

  /** Test hook for advancing the simulated clock. */
  setNow(fn: () => number): void {
    this.now = fn;
  }

  tryAcquire(ipHash: string, kind: RateLimitKind): TryAcquireResult {
    const key = `${ipHash}|${kind}`;
    const current = this.state.get(key);
    const now = this.now();
    let counter: CounterState = current ? { ...current } : { count: 0, windowStartMs: now };
    if (now - counter.windowStartMs >= this.windowMs) {
      counter = { count: 0, windowStartMs: now };
    }
    if (counter.count >= this.cap) {
      this.state.set(key, counter);
      return { ok: false, remaining: 0, windowStartMs: counter.windowStartMs };
    }
    counter.count += 1;
    this.state.set(key, counter);
    return {
      ok: true,
      remaining: this.cap - counter.count,
      windowStartMs: counter.windowStartMs,
    };
  }
}

function makeRateLimiterNamespace(
  stub: StubRateLimiter,
): DurableObjectNamespace<FormRateLimiterMarker> {
  return {
    idFromName: (name: string) =>
      ({ toString: () => name, equals: () => false, name }) as unknown as DurableObjectId,
    get: () => {
      const stubInstance = {
        fetch: async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          if (!init || init.method !== 'POST' || typeof init.body !== 'string') {
            return Promise.resolve(new Response('bad', { status: 400 }));
          }
          const body = JSON.parse(init.body) as { ipHash: string; kind: RateLimitKind };
          const result = stub.tryAcquire(body.ipHash, body.kind);
          return Promise.resolve(
            new Response(JSON.stringify(result), {
              status: result.ok ? 200 : 429,
              headers: { 'content-type': 'application/json' },
            }),
          );
        },
      };
      return stubInstance as unknown as DurableObjectStub<FormRateLimiterMarker>;
    },
    newUniqueId: () => ({ toString: () => 'unique' }) as unknown as DurableObjectId,
    idFromString: (s: string) => ({ toString: () => s }) as unknown as DurableObjectId,
    jurisdiction: () => null as unknown as DurableObjectNamespace<FormRateLimiterMarker>,
  } as unknown as DurableObjectNamespace<FormRateLimiterMarker>;
}

// ---------------------------------------------------------------------------
// Test 1 — renderForm() emits real HTML form with action + Turnstile widget.
// ---------------------------------------------------------------------------

function runRenderForm(): void {
  const html = renderForm(formElement, {
    siteId: SITE_ID,
    pageSlug: PAGE_SLUG,
    styleKit: 'charcoal',
    turnstileSiteKey: 'turnstile-public-key-stub',
  });
  assert(
    html.includes(`action="/__rev01/forms/${SITE_ID}/${FORM_ID}"`),
    '1.1 renderForm: <form action> points at /__rev01/forms/:siteId/:formId',
  );
  assert(html.includes('method="post"'), '1.2 renderForm: method=post');
  assert(html.includes('name="name"'), '1.3 renderForm: text input present');
  assert(html.includes('name="email"'), '1.4 renderForm: email input present');
  assert(html.includes('name="message"'), '1.5 renderForm: textarea present');
  assert(
    html.includes('class="cf-turnstile"'),
    '1.6 renderForm: Turnstile widget always present (per-render ctx key)',
  );
  assert(
    html.includes('data-sitekey="turnstile-public-key-stub"'),
    '1.7 renderForm: Turnstile site key wired from ctx',
  );
  assert(html.includes('Send message'), '1.8 renderForm: submit label rendered');
}

// ---------------------------------------------------------------------------
// Test 2 — Submit with stub Turnstile (always-pass) → row exists.
// ---------------------------------------------------------------------------

async function runSubmitPersists(): Promise<{
  db: InMemoryDb;
  limiter: StubRateLimiter;
}> {
  const db = new InMemoryDb();
  db.seedSite({ id: SITE_ID, publishedSnapshot });
  const limiter = new StubRateLimiter();

  const turnstileAlwaysPass = (token: string): Promise<TurnstileVerifyResult> => {
    void token;
    return Promise.resolve({ ok: true });
  };

  const outcome = await handleFormSubmit(
    {
      db: db as unknown as Db,
      formRateLimiter: makeRateLimiterNamespace(limiter),
      verifyTurnstileToken: turnstileAlwaysPass,
      webhookSigningSecret: 'webhook-signing-secret',
    },
    {
      siteId: SITE_ID,
      formElementId: FORM_ID,
      rawFields: {
        name: 'Alice',
        email: 'alice@example.com',
        message: 'Hello world',
        subscribe: 'on',
      },
      turnstileToken: 'stub-pass',
      ip: '198.51.100.1',
      userAgent: 'Test/1.0',
    },
  );
  assert(outcome.status === 'ok', '2.1 submit returned ok status', JSON.stringify(outcome));
  assert(db.submissions.length === 1, '2.2 one row persisted to formSubmission');
  const row = db.submissions[0]!;
  assert(row.siteId === SITE_ID, '2.3 row.siteId matches');
  assert(row.formElementId === FORM_ID, '2.4 row.formElementId matches');
  assert(row.pageSlug === PAGE_SLUG, '2.5 row.pageSlug resolved from snapshot');
  assert(row.ipHash.length === 32, '2.6 row.ipHash is 32 chars (truncated sha256)');
  const persistedPayload: Record<string, unknown> = row.payload;
  assert(persistedPayload.name === 'Alice', '2.7 payload.name persisted');
  assert(persistedPayload.subscribe === true, '2.8 payload.subscribe coerced to boolean true');
  return { db, limiter };
}

// ---------------------------------------------------------------------------
// Test 3 — 11 submits from the same ipHash; 11th is rate-limited.
// ---------------------------------------------------------------------------

async function runRateLimitElevenSubmits(): Promise<void> {
  const db = new InMemoryDb();
  db.seedSite({ id: SITE_ID, publishedSnapshot });
  const limiter = new StubRateLimiter();
  const turnstileAlwaysPass = (token: string): Promise<TurnstileVerifyResult> => {
    void token;
    return Promise.resolve({ ok: true });
  };

  const submit = (n: number) =>
    handleFormSubmit(
      {
        db: db as unknown as Db,
        formRateLimiter: makeRateLimiterNamespace(limiter),
        verifyTurnstileToken: turnstileAlwaysPass,
        webhookSigningSecret: 'webhook-signing-secret',
      },
      {
        siteId: SITE_ID,
        formElementId: FORM_ID,
        rawFields: {
          name: `Bob${String(n)}`,
          email: 'bob@example.com',
          message: `attempt ${String(n)}`,
        },
        turnstileToken: 'stub-pass',
        ip: '203.0.113.42',
        userAgent: 'Test/1.0',
      },
    );

  // First 10 should succeed.
  for (let i = 1; i <= 10; i += 1) {
    const outcome = await submit(i);
    if (outcome.status !== 'ok') {
      fail(`3.${String(i)} submit ${String(i)}/10 expected ok`, `got ${outcome.status}`);
    }
  }
  ok('3.A first 10 submits accepted within 60s window');

  // 11th must be 429.
  const eleventh = await submit(11);
  assert(
    eleventh.status === 'rate-limited-ip',
    '3.B 11th submit rejected with rate-limited-ip',
    JSON.stringify(eleventh),
  );
  if (eleventh.status === 'rate-limited-ip') {
    assert(
      eleventh.remaining === 0,
      '3.C remaining=0 reported on rate limit',
      String(eleventh.remaining),
    );
  }
  assert(
    db.submissions.length === 10,
    '3.D exactly 10 rows persisted (the 11th never reaches DB)',
    String(db.submissions.length),
  );
}

// ---------------------------------------------------------------------------
// Test 4 — Webhook stub receives POST + signature header.
// ---------------------------------------------------------------------------

async function runWebhookDelivery(): Promise<void> {
  const db = new InMemoryDb();
  const formWithWebhook: FormElement = {
    ...formElement,
    webhookUrl: 'https://webhook-stub.invalid/inbox',
  };
  const editableStateWithWebhook: CanvasSiteState = {
    ...editableState,
    pages: editableState.pages.map((p) => ({
      ...p,
      sections: p.sections.map((s) => ({
        ...s,
        elements: s.elements.map((e) => (e.type === 'form' ? formWithWebhook : e)),
      })),
    })),
  };
  const snapshotWithWebhook: PublishedSnapshot = {
    ...publishedSnapshot,
    pages: editableStateWithWebhook.pages,
  };
  db.seedSite({ id: SITE_ID, publishedSnapshot: snapshotWithWebhook });

  const limiter = new StubRateLimiter();
  const captured: Array<{ url: string; body: string; signature: string | null }> = [];
  const webhookFetch: typeof fetch = (input, init): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const initObj = init ?? {};
    const headers = new Headers(initObj.headers ?? {});
    const body = typeof initObj.body === 'string' ? initObj.body : '';
    captured.push({
      url,
      body,
      signature: headers.get(WEBHOOK_SIGNATURE_HEADER),
    });
    return Promise.resolve(new Response('ok', { status: 200 }));
  };

  const turnstileAlwaysPass = (token: string): Promise<TurnstileVerifyResult> => {
    void token;
    return Promise.resolve({ ok: true });
  };

  const secret = 'webhook-signing-secret-v1';
  const outcome = await handleFormSubmit(
    {
      db: db as unknown as Db,
      formRateLimiter: makeRateLimiterNamespace(limiter),
      verifyTurnstileToken: turnstileAlwaysPass,
      webhookSigningSecret: secret,
      webhookFetchImpl: webhookFetch,
    },
    {
      siteId: SITE_ID,
      formElementId: FORM_ID,
      rawFields: {
        name: 'Charlie',
        email: 'charlie@example.com',
        message: 'webhook test',
      },
      turnstileToken: 'stub-pass',
      ip: '198.51.100.7',
      userAgent: 'Test/1.0',
    },
  );
  assert(outcome.status === 'ok', '4.1 webhook submit ok', JSON.stringify(outcome));
  assert(captured.length === 1, '4.2 webhook stub received exactly one POST');
  const call = captured[0]!;
  assert(
    call.url === 'https://webhook-stub.invalid/inbox',
    '4.3 webhook POST target matches form.webhookUrl',
  );
  assert(
    call.signature !== null && call.signature.length > 0,
    '4.4 webhook POST carries X-Rev01-Signature header',
  );
  // Signature must verify against the body bytes with our secret.
  const expected = await signWebhookBody(secret, new TextEncoder().encode(call.body));
  assert(
    call.signature === expected,
    '4.5 webhook signature is HMAC-SHA256 of body keyed by WEBHOOK_SIGNING_SECRET',
    `actual=${String(call.signature)} expected=${expected}`,
  );
  // Body shape — siteId, formElementId, pageSlug, payload, submittedAt.
  const parsed = JSON.parse(call.body) as Record<string, unknown>;
  assert(parsed.siteId === SITE_ID, '4.6 webhook body.siteId set');
  assert(parsed.formElementId === FORM_ID, '4.7 webhook body.formElementId set');
  assert(parsed.pageSlug === PAGE_SLUG, '4.8 webhook body.pageSlug set');
  assert(
    typeof parsed.submittedAt === 'string' && parsed.submittedAt.length > 0,
    '4.9 webhook body.submittedAt is ISO timestamp',
  );
  const payload = parsed.payload as Record<string, unknown>;
  assert(payload.name === 'Charlie', '4.10 webhook body.payload includes field values');
}

// ---------------------------------------------------------------------------
// Test 5 — CSV export.
// ---------------------------------------------------------------------------

async function runCsvExport(): Promise<void> {
  const db = new InMemoryDb();
  db.seedSite({ id: SITE_ID, publishedSnapshot });
  // Seed three submissions directly.
  db.submissions.push({
    id: 'sub-a',
    siteId: SITE_ID,
    formElementId: FORM_ID,
    pageSlug: PAGE_SLUG,
    payload: {
      name: 'Alice',
      email: 'alice@example.com',
      message: 'hi, with "quotes" and, commas',
      subscribe: true,
    },
    ipHash: '0'.repeat(32),
    userAgent: 'Test/1.0',
    submittedAt: new Date('2026-05-23T10:00:00.000Z'),
  });
  db.submissions.push({
    id: 'sub-b',
    siteId: SITE_ID,
    formElementId: FORM_ID,
    pageSlug: PAGE_SLUG,
    payload: { name: 'Bob', email: 'bob@example.com', message: 'plain', subscribe: false },
    ipHash: '1'.repeat(32),
    userAgent: 'Test/2.0',
    submittedAt: new Date('2026-05-23T11:00:00.000Z'),
  });
  const csv = await exportFormSubmissionsCsv(db as unknown as Db, {
    siteId: SITE_ID,
    formElementId: FORM_ID,
    fields: formFields,
  });
  const lines = csv.split(/\r\n/).filter((line) => line.length > 0);
  // Header + two data rows.
  assert(lines.length === 3, '5.1 CSV has 3 lines (header + 2 rows)', String(lines.length));
  const header = lines[0]!;
  for (const col of ['submission_id', 'submitted_at', 'page_slug', 'ip_hash', 'user_agent']) {
    assert(header.includes(col), `5.2 CSV header includes ${col}`);
  }
  for (const fieldId of formFields.map((f) => f.id)) {
    assert(header.includes(fieldId), `5.3 CSV header includes field "${fieldId}"`);
  }
  // Cells with quotes/commas must be properly escaped per RFC 4180.
  const aliceLine = lines[1]!;
  assert(
    aliceLine.includes('"hi, with ""quotes"" and, commas"'),
    '5.4 CSV escapes embedded quotes + commas per RFC 4180',
    aliceLine,
  );
  // CSV must end with CRLF per RFC.
  assert(csv.endsWith('\r\n'), '5.5 CSV ends with CRLF');

  // Also exercise listFormSubmissions newest-first.
  const list = await listFormSubmissions(db as unknown as Db, {
    siteId: SITE_ID,
    formElementId: FORM_ID,
  });
  assert(
    list.rows.length === 2 && list.rows[0]?.id === 'sub-b',
    '5.6 listFormSubmissions returns newest-first',
    JSON.stringify(list.rows.map((r) => r.id)),
  );
}

// ---------------------------------------------------------------------------
// Additional standalone checks — pure-function correctness.
// ---------------------------------------------------------------------------

async function runUnitChecks(): Promise<void> {
  // hashIp determinism and length.
  const h1 = await hashIp('198.51.100.1');
  const h2 = await hashIp('198.51.100.1');
  const h3 = await hashIp('198.51.100.2');
  assert(h1 === h2, '0.1 hashIp deterministic for same input');
  assert(h1 !== h3, '0.2 hashIp differs for different inputs');
  assert(h1.length === 32, '0.3 hashIp truncated to 32 hex chars', String(h1.length));

  // validateSubmissionPayload rejects missing required fields.
  const result = validateSubmissionPayload(formElement, { name: '  ', email: '', message: 'hi' });
  const errorFields = result.errors.map((e) => e.field);
  assert(errorFields.includes('name'), '0.4 validator flags empty trimmed required text');
  assert(errorFields.includes('email'), '0.5 validator flags empty required email');
  // Bad email shape.
  const bad = validateSubmissionPayload(formElement, {
    name: 'X',
    email: 'not-an-email',
    message: 'hi',
  });
  assert(
    bad.errors.some((e) => e.field === 'email' && e.reason === 'invalid-email'),
    '0.6 validator rejects malformed email shape',
  );

  // Webhook signature deterministic.
  const sigA = await signWebhookBody('secret', new TextEncoder().encode('payload'));
  const sigB = await signWebhookBody('secret', new TextEncoder().encode('payload'));
  assert(sigA === sigB, '0.7 webhook signature deterministic for same secret+body');
  const sigC = await signWebhookBody('secret', new TextEncoder().encode('different'));
  assert(sigA !== sigC, '0.8 webhook signature differs when body differs');

  // deliverWebhook rejects non-http URLs loudly.
  const bogus = await deliverWebhook('ftp://nope.example.com/x', 'secret', {
    siteId: SITE_ID,
    formElementId: FORM_ID,
    pageSlug: PAGE_SLUG,
    payload: {},
    submittedAt: new Date().toISOString(),
  });
  assert(!bogus.ok && bogus.error === 'invalid-url', '0.9 deliverWebhook rejects non-http URL');
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await runUnitChecks();
  runRenderForm();
  await runSubmitPersists();
  await runRateLimitElevenSubmits();
  await runWebhookDelivery();
  await runCsvExport();
  process.stdout.write('[forms:smoke] all assertions passed\n');
}

await main();

// Silence unused-import warnings — these symbols are imported to keep the
// type surface explicit. NewFormSubmission is here for documentation and as
// a guard that future schema renames break the smoke at typecheck.
function _unusedTypeGuard(_value: NewFormSubmission): void {
  void _value;
}
void _unusedTypeGuard;
