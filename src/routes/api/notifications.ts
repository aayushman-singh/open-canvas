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
import { db } from '../../db/client.js';
import { customer } from '../../db/schema.js';
import { listInbox, unreadCount } from '../../notifications/inbox.js';
import { markAllNotificationsRead, markNotificationRead } from '../../notifications/writer.js';
import type { PublicEnv } from '../public.js';

// Mounted inside `ownerApi`, which lives at `/api/*` (Clerk session) and
// `/__api/*` (on-site editor edit-token) — both prefixes set `c.get('auth')`
// with a `userId` claim before this sub-app runs (see src/index.ts wiring),
// so resolveCustomerId works identically at either mount.
const notificationsApi = new Hono<PublicEnv>();

async function resolveCustomerId(c: {
  get: (k: 'auth') => { userId: string | null };
  env: { DATABASE_URL: string };
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

// Bulk mark-read per ADR 0043 dec 6 Follow-up. Two confirmations live on the
// client (the dropdown's "Mark all read" button + a confirm modal); the
// server endpoint is best-effort idempotent and echoes the count of rows
// newly flipped so the client can render "{N} notifications marked read."
notificationsApi.post('/notifications/mark-all-read', async (c) => {
  const customerId = await resolveCustomerId(c);
  if (!customerId) {
    return c.json({ error: 'account not found' }, 404);
  }
  const database = db(c.env);
  const { markedRead } = await markAllNotificationsRead({ db: database, env: c.env }, customerId);
  return c.json({ ok: true, markedRead });
});

// SSE live-delivery channel per ADR 0043 dec 4. Holds a streaming Response
// against the per-Customer NotificationOwnerRoom DO. The client (dashboard
// or editor IIFE) attaches via `new EventSource('/api/notifications/stream')`
// and listens for 'notification' + 'read-state-changed' events. Each event
// payload carries `{ id }` only — clients re-fetch /api/notifications to
// learn the row body, per the no-buffer-in-DO contract.
notificationsApi.get('/notifications/stream', async (c) => {
  const customerId = await resolveCustomerId(c);
  if (!customerId) {
    return c.json({ error: 'account not found' }, 404);
  }
  const ns = c.env.NOTIFICATION_OWNER_ROOM;
  if (ns === undefined) {
    return c.json({ error: 'NOTIFICATION_OWNER_ROOM binding not configured' }, 503);
  }
  const stubId = ns.idFromName(customerId);
  const stub = ns.get(stubId);
  return stub.fetch('https://internal/subscribe', { method: 'GET' });
});

export default notificationsApi;
