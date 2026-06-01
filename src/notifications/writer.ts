// src/notifications/writer.ts
//
// `writeNotification` — the single side-effecting entry point for ADR 0043.
// Callers (upstream event handlers) build a NotificationWriteSpec via the
// constructors and hand it here. The writer:
//
//   1. Inserts the `notification` row → id is returned to the caller.
//   2. For each fanOutCustomerId: looks up the Customer, applies the per-kind
//      email policy, and sends the email. Failures are logged with context
//      and thrown to the caller.
//   3. Pushes a live-delivery hint to the per-Owner DO.
//
// Notif row write is loud-fail: if INSERT fails, the caller sees the throw.
// Email + live-delivery failures log with context and then throw.

import { eq, inArray } from 'drizzle-orm';
import { customer, notification, type NotificationKind } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { sendEmail, type SendEmailEnv } from '../email/send.js';
import { appOrigin, type HostConfigEnv } from '../host-config.js';
import type { NotificationWriteSpec } from './constructors.js';
import type { PayloadByKind } from './kinds.js';
import { shouldEmail } from './email-policy.js';
import { renderNotificationEmail } from './render-email.js';
import type { NotificationOwnerRoomMarker } from './owner-room.js';

// `NOTIFICATION_OWNER_ROOM` is the SSE pub-sub hub (ADR 0043 Phase D). It is
// required at the writer boundary so a missing binding fails loudly.
export type WriteNotificationEnv = SendEmailEnv &
  HostConfigEnv & {
    NOTIFICATION_OWNER_ROOM: DurableObjectNamespace<NotificationOwnerRoomMarker>;
  };

export interface WriteNotificationCtx {
  db: Db;
  env: WriteNotificationEnv;
}

export async function writeNotification<K extends NotificationKind>(
  ctx: WriteNotificationCtx,
  spec: NotificationWriteSpec<K>,
): Promise<{ id: string }> {
  // 1. Insert the row. Loud-fail on DB error — caller sees the throw and
  // decides what to do (typically: surface as 500, since the upstream event
  // is mid-handler).
  const [inserted] = await ctx.db
    .insert(notification)
    .values(spec.row)
    .returning({ id: notification.id });
  if (!inserted) {
    throw new Error('writeNotification: insert returned no row');
  }

  // 2. Fan out emails. Resolve all customers in one
  // query so the worst case is one DB round-trip plus one email per
  // recipient; for a small site (<10 collaborators) this is fine.
  if (spec.fanOutCustomerIds.length > 0) {
    const customers = await ctx.db
      .select({
        id: customer.id,
        email: customer.email,
        displayName: customer.displayName,
      })
      .from(customer)
      .where(inArray(customer.id, spec.fanOutCustomerIds));

    const byId = new Map(customers.map((c) => [c.id, c]));
    const origin = appOrigin(ctx.env);

    for (const recipientId of spec.fanOutCustomerIds) {
      const target = byId.get(recipientId);
      if (!target) {
        const err = new Error(`writeNotification: fanOut customer ${recipientId} not found`);
        console.error('[notifications/writer] fanOut customer not found', {
          notificationId: inserted.id,
          recipientId,
          err: { message: err.message, stack: err.stack },
        });
        throw err;
      }
      if (!shouldEmail(spec.row.kind, spec.row.payload as PayloadByKind[K], recipientId)) {
        continue;
      }
      try {
        const rendered = renderNotificationEmail(
          spec.row.kind,
          spec.row.payload as PayloadByKind[K],
          { appOrigin: origin },
          recipientId,
        );
        await sendEmail(ctx.env, {
          to: target.email,
          subject: rendered.subject,
          html: rendered.html,
        });
      } catch (err) {
        console.error('[notifications/writer] email send failed', {
          notificationId: inserted.id,
          recipientId,
          kind: spec.row.kind,
          err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
        });
        throw err;
      }
    }
  }

  // 3. Live-delivery push.
  for (const recipientId of spec.fanOutCustomerIds) {
    await notifyOwnerLive(ctx.env, recipientId, { kind: 'notification', id: inserted.id });
  }

  return { id: inserted.id };
}

// Push a live-delivery hint to the per-Customer NotificationOwnerRoom DO. The
// DO fans out to every SSE stream the Customer's dashboard / editor tabs
// have open against /api/notifications/stream. A DO failure or missing
// binding logs with context and then throws.
async function notifyOwnerLive(
  env: WriteNotificationEnv,
  customerId: string,
  msg: { kind: 'notification' | 'read-state-changed'; id: string },
): Promise<void> {
  if (env.NOTIFICATION_OWNER_ROOM === undefined) {
    const err = new Error('NOTIFICATION_OWNER_ROOM binding is required for notification delivery');
    console.error('[notifications/writer] notifyOwnerLive missing binding', {
      customerId,
      msg,
      err: { message: err.message, stack: err.stack },
    });
    throw err;
  }
  try {
    const stubId = env.NOTIFICATION_OWNER_ROOM.idFromName(customerId);
    const stub = env.NOTIFICATION_OWNER_ROOM.get(stubId);
    const response = await stub.fetch('https://internal/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(msg),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`NotificationOwnerRoom push failed: ${response.status} ${body}`);
    }
  } catch (err) {
    console.error('[notifications/writer] notifyOwnerLive failed', {
      customerId,
      msg,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    });
    throw err;
  }
}

// `markNotificationRead` is the read-state mutator referenced by the API
// layer (Phase C). It lives here because it shares the same DO-notify path:
// when a tab marks a row read, the other tabs need to update their badge.
import { and, isNotNull, isNull } from 'drizzle-orm';
import { notificationRead, site, siteCollaborator } from '../db/schema.js';

export async function markNotificationRead(
  ctx: WriteNotificationCtx,
  notificationId: string,
  customerId: string,
): Promise<void> {
  // First, fetch the row to learn its recipientKind.
  const [row] = await ctx.db
    .select({
      id: notification.id,
      recipientKind: notification.recipientKind,
      recipientId: notification.recipientId,
    })
    .from(notification)
    .where(eq(notification.id, notificationId));

  if (!row) {
    throw new Error(`markNotificationRead: notification ${notificationId} not found`);
  }

  if (row.recipientKind === 'customer') {
    if (row.recipientId !== customerId) {
      throw new Error(
        `markNotificationRead: customer ${customerId} is not the recipient of ${notificationId}`,
      );
    }
    await ctx.db
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.id, notificationId), eq(notification.recipientId, customerId)));
  } else {
    // site-kind — must verify the customer can see the site before recording
    // read state. Owner of the site OR accepted collaborator. Refusing here
    // closes a small attack surface: a stranger could otherwise write rows
    // into notification_read for sites they have no business knowing about.
    const siteId = row.recipientId;
    const ownsRows = await ctx.db
      .select({ id: site.id })
      .from(site)
      .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
      .limit(1);
    let visible = ownsRows.length > 0;
    if (!visible) {
      const collabRows = await ctx.db
        .select({ id: siteCollaborator.id })
        .from(siteCollaborator)
        .where(
          and(
            eq(siteCollaborator.siteId, siteId),
            eq(siteCollaborator.customerId, customerId),
            isNotNull(siteCollaborator.acceptedAt),
          ),
        )
        .limit(1);
      visible = collabRows.length > 0;
    }
    if (!visible) {
      throw new Error(
        `markNotificationRead: customer ${customerId} is not the recipient of ${notificationId}`,
      );
    }
    // Write a per-customer notification_read row. Idempotent via
    // ON CONFLICT DO NOTHING — re-reading should not bump the timestamp.
    await ctx.db
      .insert(notificationRead)
      .values({ notificationId, customerId })
      .onConflictDoNothing();
  }

  // Fan out read-state-changed to the customer's open SSE streams.
  await notifyOwnerLive(ctx.env, customerId, { kind: 'read-state-changed', id: notificationId });
}

// Bulk mark-read for the calling Customer. Two writes (one per recipient
// kind) in a single round-trip per kind. The customer-kind branch updates
// every unread customer-recipient row addressed to the caller; the site-kind
// branch inserts a notification_read row for every site-recipient row visible
// to the caller that does not already have one.
//
// Visibility scope mirrors src/notifications/inbox.ts's `loadVisibleSiteIds`:
// sites the caller owns or is an accepted collaborator on.
//
// Returns the number of rows newly marked read across both branches so the
// API can echo it back to the caller for the confirmation modal's display
// text.
export async function markAllNotificationsRead(
  ctx: WriteNotificationCtx,
  customerId: string,
): Promise<{ markedRead: number }> {
  // Customer-kind: simple UPDATE.
  const customerKindUpdate = await ctx.db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.recipientKind, 'customer'),
        eq(notification.recipientId, customerId),
        isNull(notification.readAt),
      ),
    )
    .returning({ id: notification.id });

  // Site-kind: insert notification_read rows for every visible site-recipient
  // notif that lacks a read row for this customer. Owner-set + collaborator-
  // set scoped sites.
  const ownedSites = await ctx.db
    .select({ id: site.id })
    .from(site)
    .where(eq(site.customerId, customerId));
  const collabSites = await ctx.db
    .select({ siteId: siteCollaborator.siteId })
    .from(siteCollaborator)
    .where(
      and(
        eq(siteCollaborator.customerId, customerId),
        isNotNull(siteCollaborator.acceptedAt),
      ),
    );
  const siteIds = Array.from(
    new Set<string>([...ownedSites.map((s) => s.id), ...collabSites.map((s) => s.siteId)]),
  );

  let siteKindInserted = 0;
  if (siteIds.length > 0) {
    const unreadSiteRows = await ctx.db
      .select({ id: notification.id })
      .from(notification)
      .leftJoin(
        notificationRead,
        and(
          eq(notificationRead.notificationId, notification.id),
          eq(notificationRead.customerId, customerId),
        ),
      )
      .where(
        and(
          eq(notification.recipientKind, 'site'),
          inArray(notification.recipientId, siteIds),
          isNull(notificationRead.readAt),
        ),
      );
    if (unreadSiteRows.length > 0) {
      await ctx.db
        .insert(notificationRead)
        .values(unreadSiteRows.map((r) => ({ notificationId: r.id, customerId })))
        .onConflictDoNothing();
      siteKindInserted = unreadSiteRows.length;
    }
  }

  const markedRead = customerKindUpdate.length + siteKindInserted;

  // One DO push covers the whole bulk action; the client refetches the inbox
  // and badge in response to a single read-state-changed event rather than
  // N events per row.
  if (markedRead > 0) {
    await notifyOwnerLive(ctx.env, customerId, { kind: 'read-state-changed', id: 'bulk' });
  }

  return { markedRead };
}
