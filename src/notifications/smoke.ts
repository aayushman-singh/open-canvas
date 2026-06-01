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
import { writeNotification } from './writer.js';
import type { Db } from '../db/client.js';
import type { NotificationOwnerRoomMarker } from './owner-room.js';
import type {
  AccessEventPayload,
  CollaboratorEventPayload,
  FormSubmissionPayload,
  PublishEventPayload,
} from './kinds.js';
import { notificationsInboxScript } from './dashboard-inbox-script.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[notifications:smoke] ${message}`);
}

const CTX = { appOrigin: 'https://opencanvas.aayushman.dev' } as const;
const EMAIL_ENV = {
  APP_DOMAIN: 'opencanvas.aayushman.dev',
  AUTHORIZED_PARTIES: 'https://opencanvas.aayushman.dev',
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: 'Open Canvas <noreply@opencanvas.aayushman.dev>',
  RESEND_API_KEY: 'resend-smoke-key',
};

function fakeWriteDb(): Db {
  return {
    insert() {
      return {
        values() {
          return {
            returning: () => Promise.resolve([{ id: 'notif-smoke-1' }]),
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where: () => Promise.resolve([
              {
                id: 'cust-1',
                email: 'owner@example.com',
                displayName: 'Owner One',
              },
            ]),
          };
        },
      };
    },
  } as unknown as Db;
}

function fakeOwnerRoom(
  response = new Response(JSON.stringify({ ok: true, subscriberCount: 1 }), { status: 200 }),
): DurableObjectNamespace<NotificationOwnerRoomMarker> {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: () => Promise.resolve(response),
    }),
  } as unknown as DurableObjectNamespace<NotificationOwnerRoomMarker>;
}

async function assertRejects(
  fn: () => Promise<unknown>,
  expected: string,
  label: string,
): Promise<void> {
  let rejected = false;
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rejected = message.includes(expected);
  }
  assert(rejected, `${label}: expected rejection containing "${expected}"`);
}

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

  const onlooker = renderNotificationEmail('access_event', p, CTX, 'cust-onlooker');
  assert(
    !onlooker.html.includes('changed your role') && !onlooker.subject.includes('Your role'),
    'access_event site-recipient email copy must not say the onlooker role changed',
  );
}

process.stdout.write('[notifications:smoke] email render OK\n');

// ----------------------------------------------------------------------------
// 4. Writer failure contracts per ADR 0043 decisions 4, 5, and 7.
// ----------------------------------------------------------------------------

{
  const originalFetch = globalThis.fetch;
  const setFetch = (impl: typeof fetch) => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = impl;
  };

  const payload: FormSubmissionPayload = {
    siteId: 'site-acme',
    siteName: 'Acme',
    formElementId: 'el-form',
    formElementLabel: 'Contact form',
    pageSlug: '/contact',
    submissionId: 'sub',
    submittedAt: '2026-06-01T12:34:56Z',
  };
  try {
    setFetch(() => Promise.resolve(new Response('resend unavailable', { status: 503 })));
    await assertRejects(
      () =>
        writeNotification(
          {
            db: fakeWriteDb(),
            env: { ...EMAIL_ENV, NOTIFICATION_OWNER_ROOM: fakeOwnerRoom() },
          },
          buildCustomerNotif('form_submission', 'cust-1', payload),
        ),
      'Resend API error',
      'writeNotification must surface email send failure',
    );

    const publishPayload: PublishEventPayload = {
      siteId: 'site-p',
      siteName: 'Pub Site',
      outcome: 'succeeded',
      publishedVersion: 7,
      failureReason: null,
      actorCustomerId: 'cust-1',
      actorDisplayName: 'Owner One',
      occurredAt: '2026-06-01T00:00:00Z',
    };
    setFetch(() => Promise.resolve(Response.json({ id: 'email-smoke-1' })));
    await assertRejects(
      () =>
        writeNotification(
          { db: fakeWriteDb(), env: EMAIL_ENV as never },
          buildSiteNotif('publish_event', 'site-p', publishPayload, ['cust-1']),
        ),
      'NOTIFICATION_OWNER_ROOM',
      'writeNotification must fail loudly when live delivery binding is missing',
    );
  } finally {
    setFetch(originalFetch);
  }
}

process.stdout.write('[notifications:smoke] writer failure contracts OK\n');

// ----------------------------------------------------------------------------
// 5. Browser IIFE and invite acceptance structural contracts.
// ----------------------------------------------------------------------------

{
  assert(
    notificationsInboxScript.includes("es.addEventListener('open'") &&
      notificationsInboxScript.includes('since=') &&
      notificationsInboxScript.includes('lastSeenCreatedAt'),
    'notification IIFE must backfill on EventSource reconnect with since=lastSeenCreatedAt',
  );
  assert(
    notificationsInboxScript.includes('pendingNavigationHref') &&
      notificationsInboxScript.includes('e.preventDefault();') &&
      notificationsInboxScript.includes('window.location.assign(pendingNavigationHref);'),
    'notification click must wait for mark-read before navigating',
  );

  const publicRoute = readFileSync(join(process.cwd(), 'src', 'routes', 'public.ts'), 'utf8');
  assert(
    publicRoute.includes("buildSiteNotif('collaborator_event'"),
    'invite acceptance must emit a site-recipient collaborator_event joined row for onlookers',
  );
}

process.stdout.write('[notifications:smoke] browser + invite contracts OK\n');

process.stdout.write('[notifications:smoke] OK\n');
