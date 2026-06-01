// src/notifications/writer.ts
//
// `writeNotification` — the single side-effecting entry point for ADR 0043.
// Callers (upstream event handlers) build a NotificationWriteSpec via the
// constructors and hand it here. The writer:
//
//   1. Inserts the `notification` row → id is returned to the caller.
//   2. For each fanOutCustomerId: looks up the Customer, applies the per-kind
//      email policy, and sends the email (best-effort; failures are logged
//      and swallowed because the row IS the contract, the email is the
//      accelerant — same posture as the existing forms/route.ts pattern).
//   3. Pushes a live-delivery hint to the per-Owner DO (Phase D — stubbed
//      here as `notifyOwnerLive` no-op so writer integration can land first).
//
// Notif row write is loud-fail: if INSERT fails, the caller sees the throw.
// Email + live-delivery are best-effort: failures log but do not throw.

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
// optional in the writer's env so Phase B routes that haven't yet had their
// Bindings updated (or smoke runtimes without a DO binding) still compile.
// When undefined, live delivery silently no-ops — polling (Phase C) backfills.
export type WriteNotificationEnv = SendEmailEnv &
  HostConfigEnv & {
    NOTIFICATION_OWNER_ROOM?: DurableObjectNamespace<NotificationOwnerRoomMarker>;
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

  // 2. Fan out emails. Best-effort per kind. Resolve all customers in one
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
        console.error('[notifications/writer] fanOut customer not found', {
          notificationId: inserted.id,
          recipientId,
        });
        continue;
      }
      if (!shouldEmail(spec.row.kind, spec.row.payload as PayloadByKind[K], recipientId)) {
        continue;
      }
      try {
        const rendered = renderNotificationEmail(
          spec.row.kind,
          spec.row.payload as PayloadByKind[K],
          { appOrigin: origin },
        );
        await sendEmail(ctx.env, {
          to: target.email,
          subject: rendered.subject,
          html: rendered.html,
        });
      } catch (err) {
        // Email failure is best-effort per ADR 0043 dec 7: the notif row IS
        // the contract; the email is a surface on top of it. Log loudly so
        // operator sees the failure in wrangler tail; do not surface to the
        // upstream caller (the upstream event already committed and the
        // user-perceived outcome is the row, not the email).
        console.error('[notifications/writer] email send failed', {
          notificationId: inserted.id,
          recipientId,
          kind: spec.row.kind,
          err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
        });
      }
    }
  }

  // 3. Live-delivery push (Phase D). The Owner-DO is added in the same PR
  // that lands the SSE route; until then this is a no-op so writer
  // integration in Phase B can land independently.
  for (const recipientId of spec.fanOutCustomerIds) {
    void notifyOwnerLive(ctx.env, recipientId, { kind: 'notification', id: inserted.id });
  }

  return { id: inserted.id };
}

// Push a live-delivery hint to the per-Customer NotificationOwnerRoom DO. The
// DO fans out to every SSE stream the Customer's dashboard / editor tabs
// have open against /api/notifications/stream. Best-effort: a DO failure or
// missing binding logs and returns — the row in Neon is the contract, the
// SSE push is the accelerant (ADR 0043 dec 5).
async function notifyOwnerLive(
  env: WriteNotificationEnv,
  customerId: string,
  msg: { kind: 'notification' | 'read-state-changed'; id: string },
): Promise<void> {
  if (env.NOTIFICATION_OWNER_ROOM === undefined) return;
  try {
    const stubId = env.NOTIFICATION_OWNER_ROOM.idFromName(customerId);
    const stub = env.NOTIFICATION_OWNER_ROOM.get(stubId);
    await stub.fetch('https://internal/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(msg),
    });
  } catch (err) {
    console.error('[notifications/writer] notifyOwnerLive failed', {
      customerId,
      msg,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    });
  }
}

// `markNotificationRead` is the read-state mutator referenced by the API
// layer (Phase C). It lives here because it shares the same DO-notify path:
// when a tab marks a row read, the other tabs need to update their badge.
import { and, isNotNull } from 'drizzle-orm';
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
  void notifyOwnerLive(ctx.env, customerId, { kind: 'read-state-changed', id: notificationId });
}
