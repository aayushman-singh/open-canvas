// src/notifications/inbox-actions.smoke.ts
//
// Smoke for the inline mark-read + delete actions on each notification row
// (ADR 0043 Follow-up "Per-row delete shipped"). Three axes covered:
//
//   1. Browser IIFE renders a tick button (hidden on read rows) + a trash
//      button (always present) as siblings of the <a class="notif-item">.
//      Action clicks call apiBase + '/notifications/:id/read' and
//      apiBase + '/notifications/:id' (DELETE) respectively. No innerHTML.
//
//   2. `deleteNotification` enforces the same visibility scope as
//      `markNotificationRead` — customer-recipient must be the caller,
//      site-recipient must own/collaborate. A stranger row throws
//      "is not the recipient"; a missing row throws "not found". The
//      route maps both to 404 so this smoke pins the strings the route
//      branches on.
//
//   3. The opencanvas modal script registers `window.__opencanvasModal`
//      and the dashboard shell + editor route both inject it before the
//      notifications IIFE. The IIFE's `confirmStylized` rejects rather
//      than falling back when the global is missing, matching CLAUDE.md's
//      no-fallback rule — the smoke pins that contract.
//
// Run with `bun run inbox-actions:smoke`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { notificationsInboxScript } from './dashboard-inbox-script.js';
import { opencanvasModalScript } from '../ui/opencanvas-modal-script.js';
import { bellStyles } from './bell-styles.js';
import { deleteNotification } from './writer.js';
import type { Db } from '../db/client.js';
import type { NotificationOwnerRoomMarker } from './owner-room.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[inbox-actions:smoke] ${message}`);
}

function assertContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`[inbox-actions:smoke] ${label}: missing "${needle}"`);
  }
}

const EMAIL_ENV = {
  APP_DOMAIN: 'opencanvas.aayushman.dev',
  AUTHORIZED_PARTIES: 'https://opencanvas.aayushman.dev',
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: 'Open Canvas <noreply@opencanvas.aayushman.dev>',
  RESEND_API_KEY: 'not-used',
};

function fakeOwnerRoom(): DurableObjectNamespace<NotificationOwnerRoomMarker> {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: () => Promise.resolve(Response.json({ ok: true, subscriberCount: 1 })),
    }),
  } as unknown as DurableObjectNamespace<NotificationOwnerRoomMarker>;
}

interface FakeDbConfig {
  // Notification row the SELECT returns. `null` makes the first select
  // resolve to an empty array — the writer should throw 'not found'.
  selectFirst: { id: string; recipientKind: 'customer' | 'site'; recipientId: string } | null;
  // For site-kind: number of owned + collaborator rows. The second select
  // hits the `site` table (owner check); the third hits `siteCollaborator`.
  ownedSiteCount?: number;
  collaboratorCount?: number;
  // Tracks the .delete().where(...) call so we can assert it fired.
  deletes: Array<{ ranWhere: boolean }>;
}

function fakeDeleteDb(config: FakeDbConfig): Db {
  let selectCallIndex = 0;
  function resultFor(callIndex: number): Array<{ id: string }> {
    if (callIndex === 0) {
      return config.selectFirst === null
        ? []
        : ([config.selectFirst]);
    }
    if (callIndex === 1) {
      return Array.from({ length: config.ownedSiteCount ?? 0 }, (_v, i) => ({
        id: `owned-${i}`,
      }));
    }
    if (callIndex === 2) {
      return Array.from({ length: config.collaboratorCount ?? 0 }, (_v, i) => ({
        id: `collab-${i}`,
      }));
    }
    return [];
  }
  // Drizzle exposes the read chain as a thenable. `.from(t).where(cond)`
  // and `.from(t).where(cond).limit(n)` both await to rows. We model that
  // with an object exposing both `.limit(n)` (returns a thenable) and
  // `.then(resolve)` (so the where alone is awaitable).
  function makeThenable(rows: Array<{ id: string }>): unknown {
    return {
      then(resolve: (v: Array<{ id: string }>) => unknown) {
        return Promise.resolve().then(() => resolve(rows));
      },
      limit(_n: number) {
        return makeThenable(rows);
      },
    };
  }
  return {
    select() {
      const callIndex = selectCallIndex++;
      const rows = resultFor(callIndex);
      return {
        from() {
          return {
            where: (..._args: unknown[]) => makeThenable(rows),
          };
        },
      };
    },
    delete() {
      const record = { ranWhere: false };
      config.deletes.push(record);
      return {
        where: (..._args: unknown[]) => {
          record.ranWhere = true;
          return Promise.resolve();
        },
      };
    },
  } as unknown as Db;
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
    if (message.includes(expected)) rejected = true;
    else throw err;
  }
  assert(rejected, `${label}: expected rejection containing "${expected}"`);
}

// ----------------------------------------------------------------------------
// 1. Browser IIFE: tick + trash buttons emitted as siblings of <a>, with the
//    expected fetch shapes, and no innerHTML.
// ----------------------------------------------------------------------------

{
  // Action buttons exist and are typed correctly.
  assertContains(notificationsInboxScript, "tick.type = 'button';", 'tick is a real button');
  assertContains(notificationsInboxScript, "trash.type = 'button';", 'trash is a real button');
  assertContains(
    notificationsInboxScript,
    "tick.setAttribute('aria-label', 'Mark as read');",
    'tick a11y label',
  );
  assertContains(
    notificationsInboxScript,
    "trash.setAttribute('aria-label', 'Delete notification');",
    'trash a11y label',
  );
  assertContains(
    notificationsInboxScript,
    "tick.setAttribute('data-notif-action', 'mark-read');",
    'tick data-notif-action wires to mark-read',
  );
  assertContains(
    notificationsInboxScript,
    "trash.setAttribute('data-notif-action', 'delete');",
    'trash data-notif-action wires to delete',
  );
  // The action is appended to the wrapping <li>, NOT to the <a> — clicks
  // must not bubble through the row navigation handler.
  assertContains(
    notificationsInboxScript,
    'actions.appendChild(tick);',
    'tick mounted into action cluster',
  );
  assertContains(
    notificationsInboxScript,
    'actions.appendChild(trash);',
    'trash mounted into action cluster',
  );
  assertContains(
    notificationsInboxScript,
    'li.appendChild(actions);',
    'action cluster mounted on the <li>, sibling of <a>',
  );

  // Click handler short-circuits before the row-navigation branch.
  assertContains(
    notificationsInboxScript,
    "var actionBtn = target.closest('button.notif-item-action');",
    'click handler closes over action buttons first',
  );
  assertContains(
    notificationsInboxScript,
    'e.stopPropagation();',
    'action click stops propagation to outside-click handler',
  );

  // Fetch shapes the action handler dispatches.
  assertContains(
    notificationsInboxScript,
    "method: 'DELETE'",
    'trash dispatches DELETE',
  );
  assertContains(
    notificationsInboxScript,
    "actionKind === 'mark-read'",
    'mark-read branch wired',
  );
  assertContains(
    notificationsInboxScript,
    "actionKind === 'delete'",
    'delete branch wired',
  );

  // Tick is hidden when the row is already read so only unread rows expose it.
  assertContains(notificationsInboxScript, 'tick.hidden = n.isRead;', 'tick hidden on read rows');

  // No innerHTML in the new code (the rule from the file header).
  assert(
    !notificationsInboxScript.includes('.innerHTML ='),
    'no innerHTML assignment anywhere in the inbox IIFE',
  );

  // The action cluster styles must exist in bell-styles so the buttons
  // are actually visible-on-hover.
  for (const className of [
    '.notif-item-row',
    '.notif-item-actions',
    '.notif-item-action',
    '.notif-item-tick',
    '.notif-item-trash',
  ]) {
    assertContains(bellStyles, className, `bell-styles ships ${className}`);
  }
}

process.stdout.write('[inbox-actions:smoke] inline buttons + IIFE OK\n');

// ----------------------------------------------------------------------------
// 2. deleteNotification visibility + 404-leak posture.
// ----------------------------------------------------------------------------

{
  // 2a. customer-kind row, caller IS the recipient → deletes; DO push fires.
  const deletesA: FakeDbConfig['deletes'] = [];
  await deleteNotification(
    {
      db: fakeDeleteDb({
        selectFirst: { id: 'n1', recipientKind: 'customer', recipientId: 'cust-1' },
        deletes: deletesA,
      }),
      env: { ...EMAIL_ENV, NOTIFICATION_OWNER_ROOM: fakeOwnerRoom() },
    },
    'n1',
    'cust-1',
  );
  assert(deletesA.length === 1 && deletesA[0]!.ranWhere, 'customer-kind happy path issues DELETE');

  // 2b. customer-kind row, caller is NOT the recipient → "is not the recipient".
  await assertRejects(
    () =>
      deleteNotification(
        {
          db: fakeDeleteDb({
            selectFirst: { id: 'n2', recipientKind: 'customer', recipientId: 'cust-other' },
            deletes: [],
          }),
          env: { ...EMAIL_ENV, NOTIFICATION_OWNER_ROOM: fakeOwnerRoom() },
        },
        'n2',
        'cust-stranger',
      ),
    'is not the recipient',
    'customer-kind stranger row',
  );

  // 2c. Row does not exist → "not found".
  await assertRejects(
    () =>
      deleteNotification(
        {
          db: fakeDeleteDb({ selectFirst: null, deletes: [] }),
          env: { ...EMAIL_ENV, NOTIFICATION_OWNER_ROOM: fakeOwnerRoom() },
        },
        'ghost',
        'cust-1',
      ),
    'not found',
    'missing notification',
  );

  // 2d. site-kind row, caller IS owner → deletes.
  const deletesD: FakeDbConfig['deletes'] = [];
  await deleteNotification(
    {
      db: fakeDeleteDb({
        selectFirst: { id: 'n3', recipientKind: 'site', recipientId: 'site-1' },
        ownedSiteCount: 1,
        deletes: deletesD,
      }),
      env: { ...EMAIL_ENV, NOTIFICATION_OWNER_ROOM: fakeOwnerRoom() },
    },
    'n3',
    'cust-owner',
  );
  assert(deletesD.length === 1 && deletesD[0]!.ranWhere, 'site-kind owner path issues DELETE');

  // 2e. site-kind row, caller IS accepted collaborator (not owner) → deletes.
  const deletesE: FakeDbConfig['deletes'] = [];
  await deleteNotification(
    {
      db: fakeDeleteDb({
        selectFirst: { id: 'n4', recipientKind: 'site', recipientId: 'site-1' },
        ownedSiteCount: 0,
        collaboratorCount: 1,
        deletes: deletesE,
      }),
      env: { ...EMAIL_ENV, NOTIFICATION_OWNER_ROOM: fakeOwnerRoom() },
    },
    'n4',
    'cust-collab',
  );
  assert(
    deletesE.length === 1 && deletesE[0]!.ranWhere,
    'site-kind collaborator path issues DELETE',
  );

  // 2f. site-kind row, caller is neither owner nor collaborator → "is not the recipient".
  await assertRejects(
    () =>
      deleteNotification(
        {
          db: fakeDeleteDb({
            selectFirst: { id: 'n5', recipientKind: 'site', recipientId: 'site-private' },
            ownedSiteCount: 0,
            collaboratorCount: 0,
            deletes: [],
          }),
          env: { ...EMAIL_ENV, NOTIFICATION_OWNER_ROOM: fakeOwnerRoom() },
        },
        'n5',
        'cust-stranger',
      ),
    'is not the recipient',
    'site-kind stranger row',
  );

  // Pin the error string surface that src/routes/api/notifications.ts
  // branches on to issue 404 instead of 500. Either substring is acceptable
  // there — both map to the same response.
  const routeSrc = readFileSync(
    join(process.cwd(), 'src', 'routes', 'api', 'notifications.ts'),
    'utf8',
  );
  assertContains(routeSrc, "message.includes('not found')", 'route matches not-found branch');
  assertContains(
    routeSrc,
    "message.includes('is not the recipient')",
    'route matches stranger-row branch',
  );
  assertContains(
    routeSrc,
    "notificationsApi.delete('/notifications/:id'",
    'DELETE route mounted at the expected path',
  );
}

process.stdout.write('[inbox-actions:smoke] writer + route 404-leak posture OK\n');

// ----------------------------------------------------------------------------
// 3. Modal script registers on both surfaces, no fallback path.
// ----------------------------------------------------------------------------

{
  // 3a. The script registers the global with the three methods the IIFE
  // expects.
  assertContains(
    opencanvasModalScript,
    'window.__opencanvasModal={',
    'modal script registers the global',
  );
  for (const method of ['alert:function', 'confirm:function', 'prompt:function']) {
    assertContains(opencanvasModalScript, method, `modal script exposes ${method}`);
  }

  // 3b. Both surfaces inject the script before the notifications IIFE so
  // confirmStylized sees the registration on first dispatch.
  const shellSrc = readFileSync(
    join(process.cwd(), 'src', 'routes', 'dashboard', 'shell.tsx'),
    'utf8',
  );
  assertContains(shellSrc, 'opencanvasModalScript', 'dashboard shell imports modal script');
  const editorSrc = readFileSync(join(process.cwd(), 'src', 'editor', 'route.tsx'), 'utf8');
  assertContains(editorSrc, 'opencanvasModalScript', 'editor route imports modal script');
  // Ordering: the modal-script <script> tag must appear before the
  // notifications IIFE <script> tag so confirmStylized sees the global at
  // first dispatch. lastIndexOf skips past the top-of-file import lines
  // (which exist for both names and would otherwise both come first).
  const editorModalIdx = editorSrc.lastIndexOf('raw(opencanvasModalScript)');
  const editorInboxIdx = editorSrc.lastIndexOf('raw(notificationsInboxScript)');
  assert(
    editorModalIdx !== -1 && editorInboxIdx !== -1 && editorModalIdx < editorInboxIdx,
    'editor route emits modal script BEFORE the inbox IIFE',
  );
  const shellModalIdx = shellSrc.lastIndexOf('raw(opencanvasModalScript)');
  const shellInboxIdx = shellSrc.lastIndexOf('raw(notificationsInboxScript)');
  assert(
    shellModalIdx !== -1 && shellInboxIdx !== -1 && shellModalIdx < shellInboxIdx,
    'dashboard shell emits modal script BEFORE the inbox IIFE',
  );

  // 3c. The IIFE rejects rather than falling back to window.confirm when the
  // global is missing — pin the no-fallback contract from CLAUDE.md.
  assertContains(
    notificationsInboxScript,
    "Promise.reject(new Error('notification confirm modal is unavailable'))",
    'no-fallback contract: missing modal rejects loudly',
  );
  assert(
    !notificationsInboxScript.includes('window.confirm'),
    'IIFE must NOT route through window.confirm as a fallback',
  );
}

process.stdout.write('[inbox-actions:smoke] modal registration on both surfaces OK\n');

process.stdout.write('[inbox-actions:smoke] OK\n');
