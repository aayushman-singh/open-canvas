// src/notifications/kinds.ts
//
// Typed payload shapes per notification kind, per ADR 0043 decision 3. Each
// kind's payload is a closed object literal — adding a field requires editing
// here, the constructor (constructors.ts), and the renderer (UI side). The
// `NOTIFICATION_KINDS` constant ships in src/db/schema.ts so the DB layer and
// the application layer agree on the enum.

import type { NotificationKind } from '../db/schema.js';

// ----------------------------------------------------------------------------
// form_submission
// ----------------------------------------------------------------------------
//
// A visitor submitted a form on a site. Recipient is the site (every
// collaborator on the site sees it via notification_read fan-out).
export interface FormSubmissionPayload {
  siteId: string;
  siteName: string;
  formElementId: string;
  formElementLabel: string;
  pageSlug: string;
  submissionId: string;
  submittedAt: string; // ISO timestamp
}

// ----------------------------------------------------------------------------
// collaborator_event
// ----------------------------------------------------------------------------
//
// Membership of a site changed. Three sub-kinds inside the same notification
// kind so the inbox query stays single-shape. `action` discriminates.
//
// - `invited`: invitee gets a customer-recipient row; existing collaborators
//   each get a site-recipient row.
// - `joined`: invitee accepted; same fan-out.
// - `left`: collaborator removed themselves OR was removed by an admin.
//
// `subject` is the affected collaborator's display info. `actor` is who
// triggered the change (null for self-actions like accepting an invite).
export type CollaboratorEventAction = 'invited' | 'joined' | 'left';

export interface CollaboratorEventPayload {
  siteId: string;
  siteName: string;
  action: CollaboratorEventAction;
  subjectCustomerId: string;
  subjectDisplayName: string;
  subjectEmail: string;
  actorCustomerId: string | null;
  actorDisplayName: string | null;
}

// ----------------------------------------------------------------------------
// publish_event
// ----------------------------------------------------------------------------
//
// A site publish completed or failed. Recipient is the site (all collaborators
// see). Email fires only when `outcome === 'failed'` (per email policy).
export type PublishOutcome = 'succeeded' | 'failed';

export interface PublishEventPayload {
  siteId: string;
  siteName: string;
  outcome: PublishOutcome;
  publishedVersion: number | null; // null when failed
  failureReason: string | null; // populated when failed
  actorCustomerId: string;
  actorDisplayName: string;
  occurredAt: string; // ISO timestamp
}

// ----------------------------------------------------------------------------
// access_event
// ----------------------------------------------------------------------------
//
// A collaborator's role on a site changed, or their access was revoked.
// Recipient fan-out: the affected collaborator gets a customer-recipient row;
// the other site members get a site-recipient row.
export type AccessChange = 'role_changed' | 'revoked';

export interface AccessEventPayload {
  siteId: string;
  siteName: string;
  change: AccessChange;
  subjectCustomerId: string;
  subjectDisplayName: string;
  previousRole: string; // 'editor' | 'viewer' | 'owner' — past tense
  nextRole: string | null; // null when revoked
  actorCustomerId: string;
  actorDisplayName: string;
}

// ----------------------------------------------------------------------------
// PayloadByKind — index that maps each kind to its payload shape. The
// constructors module and the API layer use it to keep kind ↔ payload aligned
// at the type level.
// ----------------------------------------------------------------------------

export interface PayloadByKind {
  form_submission: FormSubmissionPayload;
  collaborator_event: CollaboratorEventPayload;
  publish_event: PublishEventPayload;
  access_event: AccessEventPayload;
}

// Compile-time check: every NotificationKind has a PayloadByKind entry AND no
// PayloadByKind entry exists for a kind outside NotificationKind. Adding or
// removing a kind without updating the other side fails the TS build.
type _BothDirections = [
  [NotificationKind] extends [keyof PayloadByKind] ? true : never,
  [keyof PayloadByKind] extends [NotificationKind] ? true : never,
];
const _check: _BothDirections = [true, true];
void _check;
