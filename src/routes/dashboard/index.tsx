import { Hono } from 'hono';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { customer, page, site } from '../../db/schema';
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

  let editorLink: { siteId: string; siteName: string; pageId: string; pageTitle: string } | null =
    null;
  if (customerId) {
    const latestSite = await database
      .select({ id: site.id, name: site.name })
      .from(site)
      .where(eq(site.customerId, customerId))
      .orderBy(desc(site.createdAt))
      .limit(1);
    const siteRow = latestSite[0];
    if (siteRow) {
      const firstPage = await database
        .select({ id: page.id, title: page.title })
        .from(page)
        .where(and(eq(page.siteId, siteRow.id)))
        .orderBy(asc(page.position))
        .limit(1);
      const pageRow = firstPage[0];
      if (pageRow) {
        editorLink = {
          siteId: siteRow.id,
          siteName: siteRow.name,
          pageId: pageRow.id,
          pageTitle: pageRow.title,
        };
      }
    }
  }

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
          {editorLink ? (
            <p>
              Continue editing{' '}
              <a href={`/dashboard/sites/${editorLink.siteId}/pages/${editorLink.pageId}/edit`}>
                {editorLink.siteName} / {editorLink.pageTitle}
              </a>{' '}
              (open in two tabs to see the multiplayer demo).
            </p>
          ) : (
            <p>
              No sites yet — <a href="/dashboard/templates">pick a template</a> to start.
            </p>
          )}
          <p>
            <a href={signOutUrl}>Sign out</a>
          </p>
        </main>
      </body>
    </html>,
  );
});
