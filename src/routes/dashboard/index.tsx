import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { customer } from '../../db/schema';
import { clerkAuth } from '../../auth/middleware';
import { buildSignOutUrl, requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

export const dashboard = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

dashboard.use('*', clerkAuth());
dashboard.use('*', requireAuth());

dashboard.get('/', async (c) => {
  const user = c.get('user');
  if (!user) {
    // requireAuth would have redirected; this branch is just to satisfy the type narrowing.
    throw new Error('dashboard reached without a resolved user');
  }

  const primaryEmail = user.emailAddresses.find(
    (addr) => addr.id === user.primaryEmailAddressId,
  )?.emailAddress;

  if (!primaryEmail) {
    throw new Error(`clerk user ${user.id} has no primary email address`);
  }

  await db(c.env)
    .insert(customer)
    .values({
      clerkUserId: user.id,
      email: primaryEmail,
    })
    .onConflictDoUpdate({
      target: customer.clerkUserId,
      set: {
        email: primaryEmail,
        updatedAt: sql`now()`,
      },
    });

  const signOutUrl = buildSignOutUrl(
    c.env.CLERK_PUBLISHABLE_KEY,
    new URL('/', c.req.url).toString(),
  );

  return c.html(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>rev01 — dashboard</title>
      </head>
      <body>
        <main>
          <nav>
            <a href="/dashboard">Dashboard</a> · <a href="/dashboard/templates">Templates</a>
          </nav>
          <h1>rev01</h1>
          <p>Signed in as {primaryEmail}.</p>
          <p>
            <a href={signOutUrl}>Sign out</a>
          </p>
        </main>
      </body>
    </html>,
  );
});
