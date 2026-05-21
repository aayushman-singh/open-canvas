// WebSocket upgrade entrypoint — /api/pages/:pageId/socket
//
// Auth-gates via Clerk, verifies the signed-in customer owns the site that
// owns the page, then forwards the WS upgrade to the PageDocument DO keyed
// by pageId.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { db } from '../../db/client';
import { customer, page, site } from '../../db/schema';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  PAGE_DO: DurableObjectNamespace;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const pages = new Hono<Env>();

pages.use('*', clerkAuth());

pages.get('/:pageId/socket', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    return c.text('unauthorized', 401);
  }

  const upgrade = c.req.header('upgrade');
  if (upgrade !== 'websocket') {
    return c.text('expected websocket upgrade', 426);
  }

  const pageId = c.req.param('pageId');
  if (!pageId) {
    return c.text('missing pageId', 400);
  }

  // Verify ownership: page -> site -> customer -> clerk user.
  const database = db(c.env);
  const rows = await database
    .select({ pageId: page.id })
    .from(page)
    .innerJoin(site, eq(site.id, page.siteId))
    .innerJoin(customer, eq(customer.id, site.customerId))
    .where(and(eq(page.id, pageId), eq(customer.clerkUserId, auth.userId)))
    .limit(1);

  if (rows.length === 0) {
    return c.text('page not found or not owned by current user', 404);
  }

  const stub = c.env.PAGE_DO.get(c.env.PAGE_DO.idFromName(pageId));
  const doRequest = new Request(`https://do.invalid/socket?pageId=${pageId}`, {
    method: 'GET',
    headers: c.req.raw.headers,
  });
  return stub.fetch(doRequest);
});

export default pages;
