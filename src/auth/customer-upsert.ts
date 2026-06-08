// src/auth/customer-upsert.ts
//
// Centralized Clerk-user -> opencanvas-customer sync. Called on every
// authenticated dashboard request so the local customer row stays current
// with Clerk's primary email. Normalizes the email to lowercase here so
// downstream lookups (collaborator invites, owner-by-email reverse lookups)
// don't need to worry about Clerk delivering "User@Example.com" vs
// "user@example.com".
//
// Returns the full customer row via RETURNING so callers don't need a
// second SELECT to read id/plan/displayName — the resolve path already
// touched the row, so the columns are free to ship back over the same Neon
// round trip.
//
// -- Email-as-identity invariant ---------------------------------------
//
// One opencanvas customer per email, even when Clerk produces multiple
// users for the same email (e.g. an Owner signs up with email+password,
// then later "Continue with Google" lands them in Clerk as a fresh user
// with a new `userId` for the same email). Without dedup, our local
// customer table forked: a second `customer` row was inserted with the
// new `clerkUserId`, orphaning the first row's data (sites, assets, chat
// sessions, paid plan) behind the now-inactive Clerk identity.
//
// Resolution policy: look up by clerkUserId first (the hot path —
// returning Owner, no work to do). On miss, look up by email. If a row
// exists for the email under a different clerkUserId, REBIND that row to
// the new clerkUserId so the existing customer keeps their data and the
// new Clerk session takes over as the active identity. Only when both
// lookups miss do we INSERT a new row.
//
// This is the SERVER-SIDE half of the dedupe. The complementary fix is
// Clerk dashboard "account linking on email" so Clerk itself never mints
// a second user for the same verified email — but the data invariant
// belongs in our schema regardless. A UNIQUE constraint on
// `customer.email` (drizzle 0020) makes this physically impossible to
// regress.

import type { User } from '@clerk/backend';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { customer, type Customer } from '../db/schema';

/**
 * Pure decision over the two lookup results. Split out from the DB
 * orchestrator so the policy is unit-testable without a Postgres harness.
 *
 * Inputs:
 *   - byClerkId: the row whose `clerk_user_id` matches the incoming
 *     Clerk user id, or null.
 *   - byEmail:   the row whose `email` matches the incoming Clerk
 *     primary email AND whose `clerk_user_id` is different from the
 *     incoming one, or null. (Same-id matches collapse with byClerkId
 *     and are excluded here so the decision is unambiguous.)
 *
 * Outputs one of:
 *   - kind: 'refresh-email' — the existing clerk-id-matched row gets its
 *     email re-synced (Clerk's primary email rotated since last seen).
 *   - kind: 'rebind' — an email-matched row exists under a different
 *     clerk id; rebind it to the incoming clerk id (account-link merge).
 *   - kind: 'insert' — neither lookup matched; this is a fresh sign-up.
 */
export type CustomerResolution =
  | { kind: 'refresh-email'; row: Customer }
  | { kind: 'rebind'; row: Customer }
  | { kind: 'insert' };

export function decideCustomerResolution(
  byClerkId: Customer | null,
  byEmail: Customer | null,
): CustomerResolution {
  if (byClerkId !== null) {
    return { kind: 'refresh-email', row: byClerkId };
  }
  if (byEmail !== null) {
    return { kind: 'rebind', row: byEmail };
  }
  return { kind: 'insert' };
}

export async function upsertCustomerFromClerk(
  database: Db,
  user: User,
): Promise<Customer> {
  const primaryEmail = user.emailAddresses.find(
    (addr) => addr.id === user.primaryEmailAddressId,
  )?.emailAddress;
  if (!primaryEmail) {
    throw new Error(`clerk user ${user.id} has no primary email address`);
  }
  const normalizedEmail = primaryEmail.trim().toLowerCase();

  // Lookup 1: existing row with this Clerk user id (hot path).
  const byClerkIdRows = await database
    .select()
    .from(customer)
    .where(eq(customer.clerkUserId, user.id))
    .limit(1);
  const byClerkId = byClerkIdRows[0] ?? null;

  // Lookup 2: existing row with this email under a DIFFERENT Clerk user
  // id. Only meaningful when lookup 1 missed (otherwise it's the same
  // row and we'd be UPDATE'ing the row we already plan to update). Two
  // hits here would mean the unique constraint on email is missing AND
  // we've already forked — fail loudly per the all-or-nothing rule.
  let byEmail: Customer | null = null;
  if (byClerkId === null) {
    const byEmailRows = await database
      .select()
      .from(customer)
      .where(and(eq(customer.email, normalizedEmail), ne(customer.clerkUserId, user.id)))
      .limit(2);
    if (byEmailRows.length > 1) {
      const ids = byEmailRows.map((r) => r.id).join(', ');
      throw new Error(
        `customer-upsert: ${byEmailRows.length} existing rows for email ${normalizedEmail} ` +
          `with clerk_user_id != ${user.id} (ids: ${ids}). Email dedupe invariant violated. ` +
          'Add the UNIQUE constraint on customer.email and merge duplicates before retrying.',
      );
    }
    byEmail = byEmailRows[0] ?? null;
  }

  const decision = decideCustomerResolution(byClerkId, byEmail);

  if (decision.kind === 'refresh-email') {
    // Email may have rotated in Clerk since last visit. Re-sync.
    if (decision.row.email === normalizedEmail) {
      // No-op: skip the UPDATE round trip.
      return decision.row;
    }
    const updated = await database
      .update(customer)
      .set({ email: normalizedEmail, updatedAt: new Date() })
      .where(eq(customer.id, decision.row.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw new Error(`refresh-email returned no row for customer ${decision.row.id}`);
    }
    return row;
  }

  if (decision.kind === 'rebind') {
    // Account linking: a customer row already exists for this email
    // under a different Clerk user id (e.g. password sign-up exists,
    // user now signs in via Google → fresh Clerk user, same email).
    // Rewire the existing row's clerk_user_id to the new Clerk session
    // so the Owner keeps their sites/assets/plan.
    console.log(
      `[customer-upsert] account-link merge: rebinding customer ${decision.row.id} ` +
        `from clerk_user_id ${decision.row.clerkUserId} -> ${user.id} ` +
        `(email ${normalizedEmail})`,
    );
    const updated = await database
      .update(customer)
      .set({ clerkUserId: user.id, email: normalizedEmail, updatedAt: new Date() })
      .where(eq(customer.id, decision.row.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw new Error(`rebind returned no row for customer ${decision.row.id}`);
    }
    return row;
  }

  // First sign-up. Fresh INSERT.
  const inserted = await database
    .insert(customer)
    .values({ clerkUserId: user.id, email: normalizedEmail })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error(`insert returned no row for clerk user ${user.id}`);
  }
  return row;
}
