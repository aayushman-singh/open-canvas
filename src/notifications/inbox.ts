// src/notifications/inbox.ts
//
// Read-side queries for ADR 0043. Two operations: list the inbox + resolve
// the unread count. Both gate on "notifications visible to this customer":
// customer-recipient rows where recipientId = $me, OR site-recipient rows
// where recipientId is a site I'm a collaborator on (including owned).
//
// Read state per row:
//   - customer-recipient: `notification.read_at IS NOT NULL`
//   - site-recipient:     a row exists in `notification_read` for ($id, $me)

import { and, eq, gt, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  notification,
  notificationRead,
  site,
  siteCollaborator,
  type NotificationKind,
  type NotificationRecipientKind,
} from '../db/schema.js';

export interface InboxItem {
  id: string;
  createdAt: string; // ISO timestamp
  kind: NotificationKind;
  recipientKind: NotificationRecipientKind;
  payload: Record<string, unknown>;
  isRead: boolean;
}

export interface InboxQueryOptions {
  /** Cap on returned rows. Defaults to 30 per ADR 0043 dec 6 sketch. */
  limit?: number;
  /** Only return rows whose createdAt is strictly after this ISO timestamp. */
  since?: string;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// Sites the customer can see notifs for: owned + accepted collaborator. Used
// to scope the recipient-kind='site' branch of the inbox query.
async function loadVisibleSiteIds(db: Db, customerId: string): Promise<string[]> {
  const owned = await db
    .select({ id: site.id })
    .from(site)
    .where(eq(site.customerId, customerId));
  const collaborator = await db
    .select({ id: siteCollaborator.siteId })
    .from(siteCollaborator)
    .where(
      and(
        eq(siteCollaborator.customerId, customerId),
        isNotNull(siteCollaborator.acceptedAt),
      ),
    );
  const ids = new Set<string>();
  for (const r of owned) ids.add(r.id);
  for (const r of collaborator) ids.add(r.id);
  return [...ids];
}

// Build the visibility filter for `notification` rows the customer can see:
// customer-kind targeting them, plus site-kind targeting any of their sites.
// `siteIds` may be empty — in that case the site-kind branch drops out.
function buildVisibilityWhere(customerId: string, siteIds: string[]): SQL {
  const customerBranch = and(
    eq(notification.recipientKind, 'customer'),
    eq(notification.recipientId, customerId),
  );
  if (siteIds.length === 0) {
    return customerBranch as SQL;
  }
  const siteBranch = and(
    eq(notification.recipientKind, 'site'),
    inArray(notification.recipientId, siteIds),
  );
  return or(customerBranch, siteBranch) as SQL;
}

export async function listInbox(
  db: Db,
  customerId: string,
  options: InboxQueryOptions = {},
): Promise<InboxItem[]> {
  const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const siteIds = await loadVisibleSiteIds(db, customerId);

  const conds: SQL[] = [buildVisibilityWhere(customerId, siteIds)];
  if (options.since !== undefined) {
    conds.push(gt(notification.createdAt, new Date(options.since)));
  }

  // `isRead` is true when:
  //   - customer-kind AND read_at IS NOT NULL, OR
  //   - site-kind AND a notification_read row exists for (id, customerId)
  const rows = await db
    .select({
      id: notification.id,
      createdAt: notification.createdAt,
      kind: notification.kind,
      recipientKind: notification.recipientKind,
      payload: notification.payload,
      readAt: notification.readAt,
      siteReadAt: notificationRead.readAt,
    })
    .from(notification)
    .leftJoin(
      notificationRead,
      and(
        eq(notificationRead.notificationId, notification.id),
        eq(notificationRead.customerId, customerId),
      ),
    )
    .where(and(...conds))
    .orderBy(sql`${notification.createdAt} DESC`)
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    kind: r.kind,
    recipientKind: r.recipientKind,
    payload: r.payload,
    isRead:
      r.recipientKind === 'customer' ? r.readAt !== null : r.siteReadAt !== null,
  }));
}

// Unread count over the same visibility scope. One round-trip; counts in SQL.
export async function unreadCount(db: Db, customerId: string): Promise<number> {
  const siteIds = await loadVisibleSiteIds(db, customerId);

  // Unread = customer-kind addressed to me with no readAt, OR site-kind
  // visible to me with no matching notification_read row.
  const customerUnread = and(
    eq(notification.recipientKind, 'customer'),
    eq(notification.recipientId, customerId),
    isNull(notification.readAt),
  );
  const unreadFilter: SQL =
    siteIds.length === 0
      ? (customerUnread as SQL)
      : (or(
          customerUnread,
          and(
            eq(notification.recipientKind, 'site'),
            inArray(notification.recipientId, siteIds),
            isNull(notificationRead.readAt),
          ),
        ) as SQL);

  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .leftJoin(
      notificationRead,
      and(
        eq(notificationRead.notificationId, notification.id),
        eq(notificationRead.customerId, customerId),
      ),
    )
    .where(unreadFilter);

  return rows[0]?.count ?? 0;
}
