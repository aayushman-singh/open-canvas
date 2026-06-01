// src/notifications/smoke.ts
//
// Phase A smoke for ADR 0043's pure-function surface: constructors,
// email-policy, render-email. No DB, no network — write integration lives
// in Phase B and gets its own smoke (writer.smoke.ts) once the upstream
// event handlers call writeNotification.
//
// Run with `bun run notifications:smoke`.

import { buildCustomerNotif, buildSiteNotif } from './constructors.js';
import { shouldEmail } from './email-policy.js';
import { renderNotificationEmail } from './render-email.js';
import type {
  AccessEventPayload,
  CollaboratorEventPayload,
  FormSubmissionPayload,
  PublishEventPayload,
} from './kinds.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[notifications:smoke] ${message}`);
}

const CTX = { appOrigin: 'https://opencanvas.aayushman.dev' } as const;

// ----------------------------------------------------------------------------
// 1. Constructors produce the right row shape + fan-out targets.
// ----------------------------------------------------------------------------

{
  const payload: FormSubmissionPayload = {
    siteId: 'site-abc',
    siteName: 'Acme Marketing',
    formElementId: 'el-form-1',
    formElementLabel: 'Contact',
    pageSlug: '/contact',
    submissionId: 'sub-1',
    submittedAt: '2026-06-01T12:00:00.000Z',
  };
  const spec = buildSiteNotif('form_submission', 'site-abc', payload, ['cust-1', 'cust-2']);
  assert(spec.row.kind === 'form_submission', 'kind preserved');
  assert(spec.row.recipientKind === 'site', 'recipientKind site');
  assert(spec.row.recipientId === 'site-abc', 'recipientId siteId');
  assert(spec.fanOutCustomerIds.length === 2, 'site fan-out length');
  assert(spec.fanOutCustomerIds[0] === 'cust-1' && spec.fanOutCustomerIds[1] === 'cust-2', 'fan-out order');
}

{
  const payload: AccessEventPayload = {
    siteId: 'site-z',
    siteName: 'Site Z',
    change: 'revoked',
    subjectCustomerId: 'cust-affected',
    subjectDisplayName: 'Affected',
    previousRole: 'editor',
    nextRole: null,
    actorCustomerId: 'cust-actor',
    actorDisplayName: 'Actor',
  };
  const spec = buildCustomerNotif('access_event', 'cust-affected', payload);
  assert(spec.row.recipientKind === 'customer', 'recipientKind customer');
  assert(spec.row.recipientId === 'cust-affected', 'recipientId customerId');
  assert(spec.fanOutCustomerIds.length === 1, 'customer fan-out is single');
}

process.stdout.write('[notifications:smoke] constructors OK\n');

// ----------------------------------------------------------------------------
// 2. Email policy per kind matches ADR 0043 dec 7.
// ----------------------------------------------------------------------------

{
  // form_submission always emails
  const formP: FormSubmissionPayload = {
    siteId: 's',
    siteName: 'S',
    formElementId: 'f',
    formElementLabel: 'F',
    pageSlug: '/',
    submissionId: 'sb',
    submittedAt: '2026-06-01T00:00:00Z',
  };
  assert(shouldEmail('form_submission', formP, 'cust-any'), 'form_submission emails any recipient');

  // access_event always emails
  const accessP: AccessEventPayload = {
    siteId: 's',
    siteName: 'S',
    change: 'role_changed',
    subjectCustomerId: 'cust-x',
    subjectDisplayName: 'X',
    previousRole: 'editor',
    nextRole: 'viewer',
    actorCustomerId: 'cust-y',
    actorDisplayName: 'Y',
  };
  assert(shouldEmail('access_event', accessP, 'cust-x'), 'access_event emails the subject');
  assert(shouldEmail('access_event', accessP, 'cust-other'), 'access_event emails onlookers too');

  // publish_event: failed emails, succeeded does not
  const publishFailed: PublishEventPayload = {
    siteId: 's',
    siteName: 'S',
    outcome: 'failed',
    publishedVersion: null,
    failureReason: 'Validation rejected',
    actorCustomerId: 'cust-actor',
    actorDisplayName: 'Actor',
    occurredAt: '2026-06-01T00:00:00Z',
  };
  const publishOk: PublishEventPayload = { ...publishFailed, outcome: 'succeeded', publishedVersion: 7, failureReason: null };
  assert(shouldEmail('publish_event', publishFailed, 'cust-x'), 'publish failed emails');
  assert(!shouldEmail('publish_event', publishOk, 'cust-x'), 'publish succeeded does not email');

  // collaborator_event: only the subject is emailed
  const collabP: CollaboratorEventPayload = {
    siteId: 's',
    siteName: 'S',
    action: 'invited',
    subjectCustomerId: 'cust-invitee',
    subjectDisplayName: 'Invitee',
    subjectEmail: 'invitee@example.com',
    actorCustomerId: 'cust-inviter',
    actorDisplayName: 'Inviter',
  };
  assert(shouldEmail('collaborator_event', collabP, 'cust-invitee'), 'collaborator subject gets email');
  assert(!shouldEmail('collaborator_event', collabP, 'cust-onlooker'), 'collaborator onlooker skipped');
}

process.stdout.write('[notifications:smoke] email policy OK\n');

// ----------------------------------------------------------------------------
// 3. Email render per kind produces non-empty subject + html with key payload
//    content. We are not asserting on exact HTML — only on payload appearance.
// ----------------------------------------------------------------------------

function assertContains(html: string, needle: string, label: string): void {
  assert(html.includes(needle), `${label}: html missing "${needle}"`);
}

{
  const p: FormSubmissionPayload = {
    siteId: 'site-acme',
    siteName: 'Acme',
    formElementId: 'el-form',
    formElementLabel: 'Contact form',
    pageSlug: '/contact',
    submissionId: 'sub',
    submittedAt: '2026-06-01T12:34:56Z',
  };
  const e = renderNotificationEmail('form_submission', p, CTX);
  assert(e.subject.includes('Acme'), 'form_submission subject contains siteName');
  assertContains(e.html, 'Contact form', 'form_submission body');
  assertContains(e.html, '/contact', 'form_submission body page slug');
  assertContains(e.html, `${CTX.appOrigin}/dashboard/sites/site-acme/forms`, 'form_submission inbox URL');
}

{
  const p: CollaboratorEventPayload = {
    siteId: 'site-z',
    siteName: 'Site Z',
    action: 'invited',
    subjectCustomerId: 'cust-1',
    subjectDisplayName: 'Subject',
    subjectEmail: 's@example.com',
    actorCustomerId: 'cust-2',
    actorDisplayName: 'Alice',
  };
  const e = renderNotificationEmail('collaborator_event', p, CTX);
  assert(e.subject.includes('Site Z'), 'collaborator_event invited subject');
  assertContains(e.html, 'Alice', 'collaborator_event body inviter');
}

{
  const p: PublishEventPayload = {
    siteId: 'site-p',
    siteName: 'Pub Site',
    outcome: 'failed',
    publishedVersion: null,
    failureReason: 'validation: pages[0] missing slug',
    actorCustomerId: 'a',
    actorDisplayName: 'A',
    occurredAt: '2026-06-01T00:00:00Z',
  };
  const e = renderNotificationEmail('publish_event', p, CTX);
  assert(e.subject.includes('failed'), 'publish_event failed subject');
  assertContains(e.html, 'validation: pages[0] missing slug', 'publish failure reason');
}

{
  const p: AccessEventPayload = {
    siteId: 'site-a',
    siteName: 'Site A',
    change: 'role_changed',
    subjectCustomerId: 'cust-s',
    subjectDisplayName: 'Sub',
    previousRole: 'editor',
    nextRole: 'viewer',
    actorCustomerId: 'cust-act',
    actorDisplayName: 'Actor',
  };
  const e = renderNotificationEmail('access_event', p, CTX);
  assert(e.subject.includes('Site A'), 'access_event role_changed subject');
  assertContains(e.html, 'editor', 'access_event prev role');
  assertContains(e.html, 'viewer', 'access_event next role');
}

process.stdout.write('[notifications:smoke] email render OK\n');

process.stdout.write('[notifications:smoke] OK\n');
