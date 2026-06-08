// src/auth/customer-resolution-dedup.smoke.ts
//
// Pins the dedupe contract that closes the "two customer rows for one
// email" bug. Two surfaces:
//
//   1. `decideCustomerResolution` — the pure policy table. Given the two
//      lookups (by clerk_user_id, by email), the function must produce
//      exactly one of: refresh-email | rebind | insert. The smoke walks
//      every cell of that policy.
//
//   2. `upsertCustomerFromClerk` — the orchestrator. The smoke drives it
//      through four scenarios with a Db-shape fake that records the
//      sequence of operations issued:
//        (A) Returning Owner: clerk_user_id matches → no INSERT, no
//            rebind. Returns the existing row.
//        (B) Account-link merge: clerk_user_id misses but email matches
//            an existing row with a different clerk_user_id → UPDATE the
//            existing row's clerk_user_id, no INSERT.
//        (C) Fresh sign-up: both lookups miss → INSERT.
//        (D) Re-visit after rebind: clerk_user_id (the rebound one) hits
//            → no further work.
//        (E) Missing primary email → throws.
//
// The fake honours just enough of drizzle's builder shape: each call
// (.from/.where/.set/.values/.limit/.returning) returns the builder; the
// builder is awaitable (then) so `await db.select()....limit(1)` resolves
// to the staged rows. The fake doesn't introspect drizzle condition
// objects — it identifies the operation by the chain shape (select vs
// update vs insert) and by which staged result the orchestrator hasn't
// consumed yet. The first select must be the clerk-id lookup, the second
// must be the email lookup; the migration SQL itself is exercised against
// a real Neon branch in the migration step.

import type { User } from '@clerk/backend';

import {
  decideCustomerResolution,
  upsertCustomerFromClerk,
} from './customer-upsert.js';
import { customer, type Customer } from '../db/schema.js';
import type { Db } from '../db/client.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[customer-resolution-dedup:smoke] ${message}`);
}

// ---------- (1) decideCustomerResolution truth table -----------------------

const sampleRow = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'cust_A',
  clerkUserId: 'user_old',
  email: 'kremzylo@gmail.com',
  displayName: null,
  bio: null,
  timezone: 'UTC',
  plan: 'free',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

{
  const r = decideCustomerResolution(sampleRow(), null);
  assert(r.kind === 'refresh-email', 'clerk-id hit alone => refresh-email');
}
{
  const r = decideCustomerResolution(null, sampleRow({ clerkUserId: 'user_old' }));
  assert(r.kind === 'rebind', 'email hit alone (different clerk id) => rebind');
}
{
  const r = decideCustomerResolution(null, null);
  assert(r.kind === 'insert', 'both miss => insert');
}
{
  // Both hit: should be impossible in practice (clerk-id matched row
  // already has the email) but the decision must still prefer
  // clerk-id (no rebind). The orchestrator skips the email lookup when
  // clerk-id hits, but the pure decision function must still be sane.
  const r = decideCustomerResolution(sampleRow(), sampleRow({ clerkUserId: 'user_old' }));
  assert(r.kind === 'refresh-email', 'both hit => refresh-email, never rebind');
}

// ---------- (2) upsertCustomerFromClerk orchestrator ----------------------

type FakeOp =
  | { op: 'select-1-by-clerk-id'; result: Customer | null }
  | { op: 'select-2-by-email'; result: Customer | null }
  | { op: 'update'; payload: Record<string, unknown> }
  | { op: 'insert'; payload: Record<string, unknown> };

interface FakeStore {
  selectByClerkIdResult: Customer | null;
  selectByEmailResult: Customer | null;
  insertReturns: Customer | null;
  updateReturns: Customer | null;
  ops: FakeOp[];
  // The orchestrator issues at most two SELECTs (by clerk id, then by
  // email). The fake hands them out in order so we don't need to parse
  // drizzle condition objects.
  selectCallNumber: number;
}

function makeDb(store: FakeStore): Db {
  const selectChain = () => {
    const builder = {
      from() {
        return builder;
      },
      where() {
        return builder;
      },
      limit() {
        return builder;
      },
      // Awaitable: the orchestrator `await`s the chain.
      then(resolve: (rows: Customer[]) => void) {
        store.selectCallNumber += 1;
        if (store.selectCallNumber === 1) {
          const r = store.selectByClerkIdResult;
          store.ops.push({ op: 'select-1-by-clerk-id', result: r });
          resolve(r ? [r] : []);
          return;
        }
        if (store.selectCallNumber === 2) {
          const r = store.selectByEmailResult;
          store.ops.push({ op: 'select-2-by-email', result: r });
          resolve(r ? [r] : []);
          return;
        }
        throw new Error('fake select: orchestrator issued more than 2 SELECTs');
      },
    };
    return builder;
  };

  const updateChain = () => {
    let payload: Record<string, unknown> = {};
    const builder = {
      set(values: Record<string, unknown>) {
        payload = values;
        return builder;
      },
      where() {
        return builder;
      },
      returning() {
        store.ops.push({ op: 'update', payload });
        const base = store.updateReturns;
        if (!base) throw new Error('fake update: no updateReturns configured');
        const row: Customer = {
          ...base,
          ...(typeof payload.clerkUserId === 'string'
            ? { clerkUserId: payload.clerkUserId }
            : {}),
          ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
        };
        return Promise.resolve([row]);
      },
    };
    return builder;
  };

  const insertChain = () => {
    const builder = {
      values(v: Record<string, unknown>) {
        store.ops.push({ op: 'insert', payload: v });
        const row = store.insertReturns;
        if (!row) throw new Error('fake insert: no insertReturns configured');
        return {
          returning() {
            return Promise.resolve([
              {
                ...row,
                clerkUserId: typeof v.clerkUserId === 'string' ? v.clerkUserId : row.clerkUserId,
                email: typeof v.email === 'string' ? v.email : row.email,
              },
            ]);
          },
        };
      },
    };
    return builder;
  };

  return {
    select: () => selectChain(),
    update: () => updateChain(),
    insert: () => insertChain(),
  } as unknown as Db;
}

const baseRow = (overrides: Partial<Customer>): Customer => ({
  id: 'cust_X',
  clerkUserId: 'user_X',
  email: 'x@example.com',
  displayName: null,
  bio: null,
  timezone: 'UTC',
  plan: 'free',
  createdAt: new Date('2026-05-22T00:00:00Z'),
  updatedAt: new Date('2026-05-22T00:00:00Z'),
  ...overrides,
});

const mkUser = (id: string, email: string): User =>
  ({
    id,
    emailAddresses: [{ id: 'email_1', emailAddress: email }],
    primaryEmailAddressId: 'email_1',
  } as unknown as User);

// ---------- Scenario A: returning Owner, email unchanged -------------------
{
  const existing = baseRow({
    id: 'cust_existing_A',
    clerkUserId: 'user_returning',
    email: 'kremzylo@gmail.com',
    displayName: 'Aayushman',
    plan: 'pro',
  });
  const store: FakeStore = {
    selectByClerkIdResult: existing,
    selectByEmailResult: null,
    insertReturns: null,
    updateReturns: existing,
    ops: [],
    selectCallNumber: 0,
  };
  const row = await upsertCustomerFromClerk(makeDb(store), mkUser('user_returning', 'kremzylo@gmail.com'));
  assert(row.id === existing.id, 'A: returns the existing row by id');
  assert(row.plan === 'pro', 'A: preserves paid plan');
  assert(
    store.selectCallNumber === 1,
    'A: only one SELECT issued (clerk-id hit short-circuits email lookup)',
  );
  assert(
    !store.ops.some((op) => op.op === 'insert'),
    'A: no INSERT issued on returning-owner hot path',
  );
  assert(
    !store.ops.some((op) => op.op === 'update'),
    'A: no UPDATE when email is unchanged — pure hot path',
  );
}

// ---------- Scenario A': returning Owner with email rotation ---------------
{
  const existing = baseRow({
    id: 'cust_existing_Aprime',
    clerkUserId: 'user_rotated_email',
    email: 'old@example.com',
    plan: 'pro',
  });
  const store: FakeStore = {
    selectByClerkIdResult: existing,
    selectByEmailResult: null,
    insertReturns: null,
    updateReturns: existing,
    ops: [],
    selectCallNumber: 0,
  };
  const row = await upsertCustomerFromClerk(
    makeDb(store),
    mkUser('user_rotated_email', 'new@example.com'),
  );
  assert(row.email === 'new@example.com', "A': UPDATE refreshes the email column");
  assert(row.id === existing.id, "A': still the same row id");
  assert(
    store.ops.some(
      (op) => op.op === 'update' && (op.payload.email as string) === 'new@example.com',
    ),
    "A': UPDATE issued with the new email",
  );
  assert(
    !store.ops.some((op) => op.op === 'insert'),
    "A': still no INSERT — refresh-email is an UPDATE not an INSERT",
  );
}

// ---------- Scenario B: account-link merge ---------------------------------
// THE HEADLINE FIX. Two Clerk users for the same email must collapse to
// one customer row. Lookup by clerk_user_id misses (fresh Google user
// id), lookup by email hits the existing customer. We UPDATE the
// existing row's clerk_user_id rather than INSERT-ing a fork.
{
  const existing = baseRow({
    id: 'cust_existing_B',
    clerkUserId: 'user_old_password',
    email: 'kremzylo@gmail.com',
    displayName: 'Aayushman',
    plan: 'pro',
    createdAt: new Date('2026-05-22T11:19:51Z'),
  });
  const store: FakeStore = {
    selectByClerkIdResult: null, // fresh Clerk user id — no row yet
    selectByEmailResult: existing, // same email as the original password row
    insertReturns: null,
    updateReturns: existing,
    ops: [],
    selectCallNumber: 0,
  };
  const row = await upsertCustomerFromClerk(
    makeDb(store),
    mkUser('user_new_google', 'kremzylo@gmail.com'),
  );
  assert(row.id === existing.id, 'B: returns the EXISTING customer row, not a forked one');
  assert(
    row.clerkUserId === 'user_new_google',
    'B: rebinds clerk_user_id to the new Clerk session',
  );
  assert(row.plan === 'pro', 'B: preserves paid plan across the rebind');
  assert(
    store.selectCallNumber === 2,
    'B: orchestrator falls through to the email lookup after clerk-id miss',
  );
  assert(
    !store.ops.some((op) => op.op === 'insert'),
    'B: NO INSERT — this is the fork-prevention path',
  );
  assert(
    store.ops.some(
      (op) =>
        op.op === 'update' && (op.payload.clerkUserId as string) === 'user_new_google',
    ),
    'B: UPDATE issued that rebinds clerk_user_id to the new Clerk id',
  );
}

// ---------- Scenario C: fresh sign-up --------------------------------------
{
  const inserted = baseRow({
    id: 'cust_new',
    clerkUserId: 'user_brand_new',
    email: 'newbie@example.com',
  });
  const store: FakeStore = {
    selectByClerkIdResult: null,
    selectByEmailResult: null,
    insertReturns: inserted,
    updateReturns: null,
    ops: [],
    selectCallNumber: 0,
  };
  const row = await upsertCustomerFromClerk(
    makeDb(store),
    mkUser('user_brand_new', 'newbie@example.com'),
  );
  assert(row.clerkUserId === 'user_brand_new', 'C: returns the inserted row');
  assert(row.email === 'newbie@example.com', 'C: email normalised + persisted');
  assert(
    store.ops.filter((op) => op.op === 'insert').length === 1,
    'C: exactly one INSERT for fresh sign-up',
  );
  assert(
    !store.ops.some((op) => op.op === 'update'),
    'C: no UPDATE for fresh sign-up',
  );
}

// ---------- Scenario D: re-visit after rebind ------------------------------
// After scenario B, the new Clerk user signs in again. The clerk-id
// lookup hits the rebound row directly; no further work needed.
{
  const reboundRow = baseRow({
    id: 'cust_existing_B',
    clerkUserId: 'user_new_google',
    email: 'kremzylo@gmail.com',
    displayName: 'Aayushman',
    plan: 'pro',
  });
  const store: FakeStore = {
    selectByClerkIdResult: reboundRow,
    selectByEmailResult: null,
    insertReturns: null,
    updateReturns: reboundRow,
    ops: [],
    selectCallNumber: 0,
  };
  const row = await upsertCustomerFromClerk(
    makeDb(store),
    mkUser('user_new_google', 'kremzylo@gmail.com'),
  );
  assert(row.id === reboundRow.id, 'D: re-visit returns the same row');
  assert(store.selectCallNumber === 1, 'D: single SELECT — hot path');
  assert(
    !store.ops.some((op) => op.op === 'update' || op.op === 'insert'),
    'D: no UPDATE / INSERT on hot-path re-visit',
  );
}

// ---------- Scenario E: missing primary email throws -----------------------
{
  const store: FakeStore = {
    selectByClerkIdResult: null,
    selectByEmailResult: null,
    insertReturns: null,
    updateReturns: null,
    ops: [],
    selectCallNumber: 0,
  };
  const user = {
    id: 'user_no_email',
    emailAddresses: [],
    primaryEmailAddressId: null,
  } as unknown as User;
  let threw = false;
  try {
    await upsertCustomerFromClerk(makeDb(store), user);
  } catch (err) {
    threw = true;
    assert(
      (err as Error).message.includes('no primary email'),
      'E: error message names the missing-email failure mode',
    );
  }
  assert(threw, 'E: no-primary-email user must throw, not silently insert');
  assert(store.ops.length === 0, 'E: nothing should be issued to the DB');
}

// ---------- Sanity: schema column constraint -------------------------------
assert(customer.email.notNull, 'customer.email column still present and notNull');

console.log('[customer-resolution-dedup:smoke] OK');
