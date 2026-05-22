import { Hono } from 'hono';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';
import { clerkAuth } from '../../auth/middleware';
import { buildSignOutUrl, requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { DashboardShell } from './shell';

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

  const database = db(c.env);

  await database
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

  // Surface a one-click jump into the editor for the most recent owned site.
  // Two queries (no joins) so the neon-http driver stays happy.
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, user.id))
    .limit(1);
  const customerId = customerRow[0]?.id;

  let editorLink: { siteId: string; siteName: string } | null = null;
  if (customerId) {
    const latestSite = await database
      .select({ id: site.id, name: site.name })
      .from(site)
      .where(eq(site.customerId, customerId))
      .orderBy(desc(site.createdAt))
      .limit(1);
    const siteRow = latestSite[0];
    if (siteRow) {
      editorLink = {
        siteId: siteRow.id,
        siteName: siteRow.name,
      };
    }
  }

  const signOutUrl = buildSignOutUrl(
    c.env.CLERK_PUBLISHABLE_KEY,
    new URL('/', c.req.url).toString(),
  );

  return c.html(
    <DashboardShell
      title="rev01 — dashboard"
      tabs={[
        { href: '/dashboard', label: 'Sites', active: true },
        { href: '/dashboard/templates', label: 'Templates', active: false },
      ]}
    >
      <h1>rev01</h1>
      <p>Signed in as {primaryEmail}.</p>
      {editorLink ? (
        <p>
          Continue editing{' '}
          <a href={`/dashboard/sites/${editorLink.siteId}/edit`}>{editorLink.siteName}</a>.
        </p>
      ) : (
        <p>
          No sites yet — <a href="/dashboard/templates">pick a template</a> to start.
        </p>
      )}
      <p>
        <a href={signOutUrl}>Sign out</a>
      </p>
    </DashboardShell>,
  );
});
