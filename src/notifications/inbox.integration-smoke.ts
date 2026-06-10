// src/notifications/inbox.integration-smoke.ts
//
// Integration smoke for ADR 0043 Phase C read API. Hits the live Neon
// `notification` + `notification_read` tables. Run with `.env` providing
// `DATABASE_URL`.
//
// Test plan:
//   1. Pick a fixed test customer + one of their sites.
//   2. Insert 3 notification rows: one customer-kind unread, one site-kind
//      unread, one customer-kind already read.
//   3. Call listInbox + unreadCount → verify counts + read flags.
//   4. Call markNotificationRead on the customer-kind unread row → verify
//      its readAt populates.
//   5. Call markNotificationRead on the site-kind row → verify a
//      notification_read row lands.
//   6. Re-run listInbox/unreadCount → verify the unread count drops.
//   7. Negative case: try to mark a row not visible to a different customer
//      → expect rejection.
//   8. Clean up — delete all rows this smoke inserted.

import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notification, notificationRead } from '../db/schema.js';
import { listInbox, unreadCount } from './inbox.js';
import { markNotificationRead } from './writer.js';
import type { NotificationOwnerRoomMarker } from './owner-room.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[inbox-integration-smoke] ${message}`);
}

const CUSTOMER_ID = '90829df1-2f52-4f89-90a2-03d0739f6d75'; // fixed test customer
const SITE_ID = '74a8854d-6f2a-45f8-af18-19b0f74bf215'; // a site owned by the test customer
// Picked deliberately: a customer who is not the owner of SITE_ID and not in
// site_collaborator for it. Picking the wrong customer here (one who IS a
// collaborator) silently passes the negative case for the wrong reason.
const OTHER_CUSTOMER_ID = 'cd51638b-8a34-4a97-84f4-efbc732af700';

const RUN_ID = `inbox-integration-${Date.now()}`;

interface InsertedIds {
  customerUnread: string;
  siteUnread: string;
  customerAlreadyRead: string;
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.length === 0) {
  throw new Error('DATABASE_URL is required (load .env via bunfig.toml or `bun --env-file=.env`)');
}
const database = db({ DATABASE_URL });

function fakeOwnerRoom(): DurableObjectNamespace<NotificationOwnerRoomMarker> {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: () => Promise.resolve(Response.json({ ok: true, subscriberCount: 1 })),
    }),
  } as unknown as DurableObjectNamespace<NotificationOwnerRoomMarker>;
}

const MARK_READ_ENV = {
  DATABASE_URL,
  APP_DOMAIN: 'opencanvas.aayushman.dev',
  AUTHORIZED_PARTIES: 'https://opencanvas.aayushman.dev',
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: 'Open Canvas <noreply@opencanvas.aayushman.dev>',
  RESEND_API_KEY: 'not-used-by-mark-read',
  NOTIFICATION_OWNER_ROOM: fakeOwnerRoom(),
};

async function seed(): Promise<InsertedIds> {
  const customerUnread = await database
    .insert(notification)
    .values({
      kind: 'collaborator_event',
      recipientKind: 'customer',
      recipientId: CUSTOMER_ID,
      payload: { runId: RUN_ID, marker: 'customer-unread' },
    })
    .returning({ id: notification.id });

  const siteUnread = await database
    .insert(notification)
    .values({
      kind: 'form_submission',
      recipientKind: 'site',
      recipientId: SITE_ID,
      payload: { runId: RUN_ID, marker: 'site-unread' },
    })
    .returning({ id: notification.id });

  const customerAlreadyRead = await database
    .insert(notification)
    .values({
      kind: 'access_event',
      recipientKind: 'customer',
      recipientId: CUSTOMER_ID,
      payload: { runId: RUN_ID, marker: 'customer-read' },
      readAt: new Date(),
    })
    .returning({ id: notification.id });

  return {
    customerUnread: customerUnread[0]!.id,
    siteUnread: siteUnread[0]!.id,
    customerAlreadyRead: customerAlreadyRead[0]!.id,
  };
}

async function cleanup(ids: InsertedIds): Promise<void> {
  await database.delete(notification).where(
    inArray(notification.id, [ids.customerUnread, ids.siteUnread, ids.customerAlreadyRead]),
  );
}

async function main(): Promise<void> {
  const ids = await seed();
  try {
    // 1. Baseline inbox + unread count.
    const initialItems = await listInbox(database, CUSTOMER_ID, { limit: 50 });
    const initialUnread = await unreadCount(database, CUSTOMER_ID);

    const seenIds = new Set(initialItems.map((i) => i.id));
    assert(seenIds.has(ids.customerUnread), 'customer-unread notif present');
    assert(seenIds.has(ids.siteUnread), 'site-unread notif present');
    assert(seenIds.has(ids.customerAlreadyRead), 'customer-already-read notif present');

    const initialReadFlags = new Map(initialItems.map((i) => [i.id, i.isRead]));
    assert(initialReadFlags.get(ids.customerUnread) === false, 'customer-unread isRead=false');
    assert(initialReadFlags.get(ids.siteUnread) === false, 'site-unread isRead=false');
    assert(initialReadFlags.get(ids.customerAlreadyRead) === true, 'customer-read isRead=true');

    assert(initialUnread >= 2, `unreadCount counts both unread (got ${initialUnread})`);

    process.stdout.write('[inbox-integration-smoke] baseline OK\n');

    // 2. Mark customer-kind unread as read.
    await markNotificationRead({ db: database, env: MARK_READ_ENV }, ids.customerUnread, CUSTOMER_ID);
    const afterCustomerRead = await listInbox(database, CUSTOMER_ID, { limit: 50 });
    const afterCustomerReadMap = new Map(afterCustomerRead.map((i) => [i.id, i.isRead]));
    assert(
      afterCustomerReadMap.get(ids.customerUnread) === true,
      'customer-unread flipped to read',
    );

    // 3. Mark site-kind as read.
    await markNotificationRead({ db: database, env: MARK_READ_ENV }, ids.siteUnread, CUSTOMER_ID);
    const afterSiteRead = await listInbox(database, CUSTOMER_ID, { limit: 50 });
    const afterSiteReadMap = new Map(afterSiteRead.map((i) => [i.id, i.isRead]));
    assert(afterSiteReadMap.get(ids.siteUnread) === true, 'site-unread flipped to read');

    const finalUnread = await unreadCount(database, CUSTOMER_ID);
    assert(
      finalUnread <= initialUnread - 2,
      `unreadCount dropped by at least 2 (initial=${initialUnread} final=${finalUnread})`,
    );

    process.stdout.write('[inbox-integration-smoke] read state propagates OK\n');

    // 4. Negative case: other customer cannot mark site-kind read for a site
    //    they don't have access to. We pick a customer who is not the owner
    //    and not a collaborator on SITE_ID. Insert a fresh site-kind notif
    //    and try.
    const otherSiteNotif = await database
      .insert(notification)
      .values({
        kind: 'publish_event',
        recipientKind: 'site',
        recipientId: SITE_ID,
        payload: { runId: RUN_ID, marker: 'site-other' },
      })
      .returning({ id: notification.id });
    const otherSiteNotifId = otherSiteNotif[0]!.id;

    let rejected = false;
    try {
      await markNotificationRead(
        { db: database, env: MARK_READ_ENV },
        otherSiteNotifId,
        OTHER_CUSTOMER_ID,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('is not the recipient')) rejected = true;
      else throw err;
    }
    assert(rejected, 'site-kind read by non-collaborator rejected');

    // Cleanup that fresh row too.
    await database.delete(notification).where(eq(notification.id, otherSiteNotifId));
    // And the notification_read row from step 2/3 for CUSTOMER_ID — the
    // ON DELETE CASCADE in step `cleanup` covers the joined row but only
    // because we are deleting the parent notif. Belt-and-suspenders: delete
    // explicitly here in case the cleanup order ever changes.
    await database
      .delete(notificationRead)
      .where(eq(notificationRead.notificationId, ids.siteUnread));

    process.stdout.write('[inbox-integration-smoke] negative case OK\n');
  } finally {
    await cleanup(ids);
  }

  process.stdout.write('[inbox-integration-smoke] OK\n');
}

await main();
