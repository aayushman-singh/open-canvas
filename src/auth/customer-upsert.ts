// src/auth/customer-upsert.ts
//
// Centralized Clerk-user -> rev01-customer sync. Called on every authenticated
// dashboard request so the local customer row stays current with Clerk's
// primary email. Normalizes the email to lowercase here so downstream lookups
// (collaborator invites, owner-by-email reverse lookups) don't need to worry
// about Clerk delivering "User@Example.com" vs "user@example.com".

import type { User } from '@clerk/backend';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { customer } from '../db/schema';

export async function upsertCustomerFromClerk(
  database: Db,
  user: User,
): Promise<{ email: string }> {
  const primaryEmail = user.emailAddresses.find(
    (addr) => addr.id === user.primaryEmailAddressId,
  )?.emailAddress;
  if (!primaryEmail) {
    throw new Error(`clerk user ${user.id} has no primary email address`);
  }
  const normalizedEmail = primaryEmail.trim().toLowerCase();
  await database
    .insert(customer)
    .values({ clerkUserId: user.id, email: normalizedEmail })
    .onConflictDoUpdate({
      target: customer.clerkUserId,
      set: { email: normalizedEmail, updatedAt: sql`now()` },
    });
  return { email: normalizedEmail };
}
