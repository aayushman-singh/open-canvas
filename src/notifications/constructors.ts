// src/notifications/constructors.ts
//
// Constructors per ADR 0043 decision 3. Each upstream event handler builds a
// `NotificationWriteSpec` and hands it to `writeNotification`. The spec is a
// pure value (no DB or env access); the writer is the side-effecting piece.
//
// Two recipient shapes:
//   - customer-recipient: one row addressed to one Customer (Owner).
//   - site-recipient: one row addressed to one Site, plus the fan-out list of
//     collaborator Customer IDs for email/live-delivery dispatch.
//
// `fanOutCustomerIds` is the email + DO-notify target list. For customer-
// recipient rows it is exactly `[recipientCustomerId]`; for site-recipient
// rows it is every collaborator on the site (resolved by the caller from
// siteCollaborator).

import type { PayloadByKind } from './kinds.js';
import type { NewNotification, NotificationKind } from '../db/schema.js';

export interface NotificationWriteSpec<K extends NotificationKind = NotificationKind> {
  row: NewNotification & { kind: K; payload: PayloadByKind[K] };
  fanOutCustomerIds: string[];
}

export function buildCustomerNotif<K extends NotificationKind>(
  kind: K,
  recipientCustomerId: string,
  payload: PayloadByKind[K],
): NotificationWriteSpec<K> {
  return {
    row: {
      kind,
      recipientKind: 'customer',
      recipientId: recipientCustomerId,
      payload: payload as unknown as Record<string, unknown>,
    } as NewNotification & { kind: K; payload: PayloadByKind[K] },
    fanOutCustomerIds: [recipientCustomerId],
  };
}

export function buildSiteNotif<K extends NotificationKind>(
  kind: K,
  siteId: string,
  payload: PayloadByKind[K],
  collaboratorCustomerIds: readonly string[],
): NotificationWriteSpec<K> {
  return {
    row: {
      kind,
      recipientKind: 'site',
      recipientId: siteId,
      payload: payload as unknown as Record<string, unknown>,
    } as NewNotification & { kind: K; payload: PayloadByKind[K] },
    fanOutCustomerIds: [...collaboratorCustomerIds],
  };
}
