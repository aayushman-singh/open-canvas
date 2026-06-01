// src/routes/api/notifications.ts
//
// Read API for ADR 0043. Two endpoints, both Clerk-authed:
//
//   GET  /api/notifications?since=<iso>&limit=N
//        → { notifications: InboxItem[], unreadCount: number }
//        The recipient scope is the calling Customer: customer-recipient
//        rows addressed to them + site-recipient rows for sites they own
//        or are an accepted collaborator on.
//
//   POST /api/notifications/:id/read
//        → { ok: true }
//        Marks the given notification read for the current Customer.
//        Customer-recipient: writes to notification.read_at.
//        Site-recipient:     writes to notification_read (id, customerId).
//        Rejects 404 if the row is not visible to the caller.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { db } from '../../db/client.js';
import { customer } from '../../db/schema.js';
import { type HostConfigEnv } from '../../host-config.js';
import { listInbox, unreadCount } from '../../notifications/inbox.js';
import { markNotificationRead } from '../../notifications/writer.js';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  RESEND_API_KEY: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const notificationsApi = new Hono<Env>();
notificationsApi.use('*', clerkAuth());
notificationsApi.use('*', requireAuth());

async function resolveCustomerId(c: {
  get: (k: 'auth') => { userId: string | null };
  env: Bindings;
}): Promise<string | null> {
  const auth = c.get('auth');
  if (!auth.userId) return null;
  const database = db(c.env);
  const rows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

notificationsApi.get('/notifications', async (c) => {
  const customerId = await resolveCustomerId(c);
  if (!customerId) {
    return c.json({ error: 'account not found' }, 404);
  }

  const sinceRaw = c.req.query('since');
  const limitRaw = c.req.query('limit');
  const since =
    sinceRaw !== undefined && sinceRaw !== '' && !Number.isNaN(Date.parse(sinceRaw))
      ? sinceRaw
      : undefined;
  const limitParsed = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : NaN;
  const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : undefined;

  const database = db(c.env);
  const [notifications, unread] = await Promise.all([
    listInbox(database, customerId, {
      ...(since !== undefined ? { since } : {}),
      ...(limit !== undefined ? { limit } : {}),
    }),
    unreadCount(database, customerId),
  ]);

  return c.json({ notifications, unreadCount: unread });
});

notificationsApi.post('/notifications/:id/read', async (c) => {
  const customerId = await resolveCustomerId(c);
  if (!customerId) {
    return c.json({ error: 'account not found' }, 404);
  }
  const notificationId = c.req.param('id');
  if (!notificationId) {
    return c.json({ error: 'notification id required' }, 400);
  }

  const database = db(c.env);
  try {
    await markNotificationRead({ db: database, env: c.env }, notificationId, customerId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The writer throws on either "not found" or "not your row". Both surface
    // to the client as 404 — leaking "exists but not yours" is itself a small
    // info leak.
    if (message.includes('not found') || message.includes('is not the recipient')) {
      return c.json({ error: 'notification not found' }, 404);
    }
    throw err;
  }

  return c.json({ ok: true });
});

export default notificationsApi;
