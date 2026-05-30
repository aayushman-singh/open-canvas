// src/auth/customer-upsert.ts
//
// Centralized Clerk-user -> rev01-customer sync. Called on every authenticated
// dashboard request so the local customer row stays current with Clerk's
// primary email. Normalizes the email to lowercase here so downstream lookups
// (collaborator invites, owner-by-email reverse lookups) don't need to worry
// about Clerk delivering "User@Example.com" vs "user@example.com".
//
// Returns the full customer row via RETURNING so callers don't need a second
// SELECT to read id/plan/displayName — the upsert already touched the row, so
// the columns are free to ship back over the same Neon HTTP round trip.

import type { User } from '@clerk/backend';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { customer, type Customer } from '../db/schema';

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
  const rows = await database
    .insert(customer)
    .values({ clerkUserId: user.id, email: normalizedEmail })
    .onConflictDoUpdate({
      target: customer.clerkUserId,
      set: { email: normalizedEmail, updatedAt: sql`now()` },
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error(`upsert returned no row for clerk user ${user.id}`);
  }
  return row;
}
