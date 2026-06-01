// src/notifications/email-policy.ts
//
// Per-kind email decision, per ADR 0043 decision 7. The policy maps a
// (kind, payload, recipientCustomerId) to either "send email" or "skip".
//
// Policy:
//   - form_submission        → always email
//   - access_event           → always email
//   - publish_event          → email only on outcome='failed'
//   - collaborator_event     → email only when *I* am the subject (invited,
//                              role changed). Skip when I am only a teammate
//                              of the affected collaborator (site-feed only).

import type {
  CollaboratorEventPayload,
  PayloadByKind,
  PublishEventPayload,
} from './kinds.js';
import type { NotificationKind } from '../db/schema.js';

// `kind` narrows `payload` via the mapped type. The recipientCustomerId is the
// concrete person the email would go to (i.e. who we resolved this row to in
// the fan-out loop).
export function shouldEmail<K extends NotificationKind>(
  kind: K,
  payload: PayloadByKind[K],
  recipientCustomerId: string,
): boolean {
  switch (kind) {
    case 'form_submission':
      return true;
    case 'access_event':
      return true;
    case 'publish_event':
      return (payload as PublishEventPayload).outcome === 'failed';
    case 'collaborator_event':
      return (
        (payload as CollaboratorEventPayload).subjectCustomerId === recipientCustomerId
      );
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return false;
    }
  }
}
