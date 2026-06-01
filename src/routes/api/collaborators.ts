import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { signInviteToken } from '../../auth/invite-token.js';
import { db, type Db } from '../../db/client.js';
import { customer, site, siteCollaborator, type CollaboratorRole } from '../../db/schema.js';
import { sendEmail } from '../../email/send.js';
import { inviteEmailHtml, inviteEmailSubject } from '../../email/templates/invite.js';
import { appDomain, appOrigin, type HostConfigEnv } from '../../host-config.js';
import { buildCustomerNotif, buildSiteNotif } from '../../notifications/constructors.js';
import { writeNotification, type WriteNotificationEnv } from '../../notifications/writer.js';
import type {
  AccessChange,
  AccessEventPayload,
  CollaboratorEventAction,
  CollaboratorEventPayload,
} from '../../notifications/kinds.js';
import type { NotificationOwnerRoomMarker } from '../../notifications/owner-room.js';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  UNLOCK_SIGNING_SECRET: string;
  RESEND_API_KEY: string;
  NOTIFICATION_OWNER_ROOM: DurableObjectNamespace<NotificationOwnerRoomMarker>;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const collaboratorsApi = new Hono<Env>();

collaboratorsApi.use('*', clerkAuth());
collaboratorsApi.use('*', requireAuth());

// RFC-ish email check: local-part has the usual allowed chars, domain has a
// dot, TLD is at least 2 letters. Rejects bare "@", "a@", "@b", "a b@c".
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

function parseRole(value: unknown): CollaboratorRole | null {
  if (value === 'viewer' || value === 'editor') return value;
  return null;
}

async function resolveCustomerId(c: Context<Env>): Promise<string | null> {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('collaborators api reached without authenticated user');
  const database = db(c.env);
  const rows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function requireSiteOwner(
  c: Context<Env>,
  siteId: string,
): Promise<{ customerId: string; siteName: string; siteSubdomain: string } | null> {
  const customerId = await resolveCustomerId(c);
  if (!customerId) return null;
  const database = db(c.env);
  const rows = await database
    .select({ id: site.id, name: site.name, subdomain: site.subdomain })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  if (!rows[0]) return null;
  return { customerId, siteName: rows[0].name, siteSubdomain: rows[0].subdomain };
}

interface InviteEmailContext {
  env: Bindings;
  siteId: string;
  siteName: string;
  siteSubdomain: string;
  collaboratorId: string;
  invitedEmail: string;
  role: CollaboratorRole;
  inviterName: string;
}

async function buildAndSendInviteEmail(ctx: InviteEmailContext): Promise<void> {
  const inviteToken = await signInviteToken(
    { siteId: ctx.siteId, collaboratorId: ctx.collaboratorId, invitedEmail: ctx.invitedEmail },
    ctx.env.UNLOCK_SIGNING_SECRET,
  );
  // Main-domain landing instead of the published subdomain so a later
  // subdomain rename doesn't break this link. The redirector resolves
  // siteId -> current subdomain at click time.
  const acceptUrl = `${appOrigin(ctx.env)}/__invite?token=${encodeURIComponent(inviteToken)}`;
  await sendEmail(ctx.env, {
    to: ctx.invitedEmail,
    subject: inviteEmailSubject(ctx.siteName),
    html: inviteEmailHtml({
      siteName: ctx.siteName,
      siteSubdomain: ctx.siteSubdomain,
      apex: appDomain(ctx.env),
      appOrigin: appOrigin(ctx.env),
      inviterName: ctx.inviterName,
      role: ctx.role,
      acceptUrl,
    }),
  });
}

function resolveInviterName(c: Context<Env>, fallbackEmail: string): string {
  const ownerUser = c.get('user');
  if (!ownerUser) return 'A user';
  const named = `${ownerUser.firstName ?? ''} ${ownerUser.lastName ?? ''}`.trim();
  return named || fallbackEmail;
}

// ---------------------------------------------------------------------------
// ADR 0043 notification helpers
// ---------------------------------------------------------------------------
//
// Each upstream collaborator/access mutation calls one of these helpers after
// the row commits. Failures are caught and logged at the route level so a
// notification fan-out failure does not 5xx the underlying collaborator API.

async function loadCustomerDisplay(
  database: Db,
  customerId: string,
): Promise<{ displayName: string; email: string }> {
  const rows = await database
    .select({ displayName: customer.displayName, email: customer.email })
    .from(customer)
    .where(eq(customer.id, customerId))
    .limit(1);
  const row = rows[0];
  if (!row) return { displayName: 'A teammate', email: '' };
  return { displayName: row.displayName ?? row.email, email: row.email };
}

// Site collaborators excluding `excludeCustomerId`. Only `acceptedAt IS NOT
// NULL` rows are returned — pending invitees do not see fan-out notifs.
// The site owner (site.customerId) is always included because they are not
// represented in `siteCollaborator`.
async function loadOtherSiteCollaborators(
  database: Db,
  siteId: string,
  excludeCustomerId: string,
): Promise<string[]> {
  const ownerRow = await database
    .select({ customerId: site.customerId })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1);
  const collabRows = await database
    .select({ customerId: siteCollaborator.customerId })
    .from(siteCollaborator)
    .where(
      and(
        eq(siteCollaborator.siteId, siteId),
        isNotNull(siteCollaborator.acceptedAt),
        ne(siteCollaborator.customerId, excludeCustomerId),
      ),
    );
  const ids = new Set<string>();
  if (ownerRow[0] && ownerRow[0].customerId !== excludeCustomerId) {
    ids.add(ownerRow[0].customerId);
  }
  for (const r of collabRows) ids.add(r.customerId);
  return [...ids];
}

interface CollaboratorEventEmitParams {
  action: CollaboratorEventAction;
  siteId: string;
  siteName: string;
  subjectCustomerId: string;
  subjectDisplayName: string;
  subjectEmail: string;
  actorCustomerId: string | null;
  actorDisplayName: string | null;
}

async function emitCollaboratorEvent(
  c: Context<Env>,
  params: CollaboratorEventEmitParams,
): Promise<void> {
  const database = db(c.env);
  const otherIds = await loadOtherSiteCollaborators(
    database,
    params.siteId,
    params.subjectCustomerId,
  );
  const payload: CollaboratorEventPayload = {
    siteId: params.siteId,
    siteName: params.siteName,
    action: params.action,
    subjectCustomerId: params.subjectCustomerId,
    subjectDisplayName: params.subjectDisplayName,
    subjectEmail: params.subjectEmail,
    actorCustomerId: params.actorCustomerId,
    actorDisplayName: params.actorDisplayName,
  };
  const env = c.env as WriteNotificationEnv;
  // Subject-addressed personal row first (email policy targets the subject).
  await writeNotification(
    { db: database, env },
    buildCustomerNotif('collaborator_event', params.subjectCustomerId, payload),
  );
  // Site-addressed row for onlookers (the rest of the site collaborators).
  if (otherIds.length > 0) {
    await writeNotification(
      { db: database, env },
      buildSiteNotif('collaborator_event', params.siteId, payload, otherIds),
    );
  }
}

interface AccessEventEmitParams {
  change: AccessChange;
  siteId: string;
  siteName: string;
  subjectCustomerId: string;
  subjectDisplayName: string;
  previousRole: string;
  nextRole: string | null;
  actorCustomerId: string;
  actorDisplayName: string;
}

async function emitAccessEvent(
  c: Context<Env>,
  params: AccessEventEmitParams,
): Promise<void> {
  const database = db(c.env);
  const otherIds = await loadOtherSiteCollaborators(
    database,
    params.siteId,
    params.subjectCustomerId,
  );
  const payload: AccessEventPayload = {
    siteId: params.siteId,
    siteName: params.siteName,
    change: params.change,
    subjectCustomerId: params.subjectCustomerId,
    subjectDisplayName: params.subjectDisplayName,
    previousRole: params.previousRole,
    nextRole: params.nextRole,
    actorCustomerId: params.actorCustomerId,
    actorDisplayName: params.actorDisplayName,
  };
  const env = c.env as WriteNotificationEnv;
  await writeNotification(
    { db: database, env },
    buildCustomerNotif('access_event', params.subjectCustomerId, payload),
  );
  if (otherIds.length > 0) {
    await writeNotification(
      { db: database, env },
      buildSiteNotif('access_event', params.siteId, payload, otherIds),
    );
  }
}

interface ClerkEmailForInviteLookup {
  emailAddress: string;
  verification: { status?: string } | null;
}

interface ClerkUserForInviteLookup {
  emailAddresses: ClerkEmailForInviteLookup[];
}

export function clerkUserHasVerifiedEmail(
  user: ClerkUserForInviteLookup,
  email: string,
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  return user.emailAddresses.some(
    (addr) =>
      addr.emailAddress.trim().toLowerCase() === normalizedEmail &&
      addr.verification?.status === 'verified',
  );
}

// Local lookup first (cheap), then Clerk Backend API fallback (covers
// secondary emails that Clerk knows about but we haven't denormalized).
// Returns null only when neither source can resolve a customer row — the
// invitee really doesn't have a rev01 account.
async function findCustomerByEmail(
  c: Context<Env>,
  email: string,
): Promise<string | null> {
  const database = db(c.env);
  const local = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.email, email))
    .limit(1);
  if (local[0]) return local[0].id;

  const clerk = c.get('clerk');
  if (!clerk) return null;
  const clerkResult = await clerk.users.getUserList({ emailAddress: [email] });
  const clerkUser = clerkResult.data?.find((user) => clerkUserHasVerifiedEmail(user, email));
  if (!clerkUser) return null;

  const byClerkId = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUser.id))
    .limit(1);
  return byClerkId[0]?.id ?? null;
}

collaboratorsApi.get('/sites/:siteId/collaborators', async (c) => {
  const siteId = c.req.param('siteId');
  const owner = await requireSiteOwner(c, siteId);
  if (!owner) return c.json({ error: 'site not found' }, 404);

  const database = db(c.env);
  const rows = await database
    .select({
      id: siteCollaborator.id,
      email: siteCollaborator.invitedEmail,
      role: siteCollaborator.role,
      acceptedAt: siteCollaborator.acceptedAt,
      createdAt: siteCollaborator.createdAt,
    })
    .from(siteCollaborator)
    .where(eq(siteCollaborator.siteId, siteId));

  return c.json({ collaborators: rows });
});

// Invite a new collaborator. Rejects with 409 if a row already exists — owner
// must use the resend endpoint (still-pending) or remove + re-invite. This is
// intentionally NOT an upsert: the previous onConflictDoUpdate path silently
// downgraded accepted collaborators to pending whenever it was re-hit.
collaboratorsApi.post('/sites/:siteId/collaborators', async (c) => {
  const siteId = c.req.param('siteId');
  const owner = await requireSiteOwner(c, siteId);
  if (!owner) return c.json({ error: 'site not found' }, 404);

  const body: unknown = await c.req.json();
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const rawEmail = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(rawEmail)) {
    return c.json({ error: 'enter a valid email address' }, 400);
  }
  const role = parseRole(record.role);
  if (role === null) {
    return c.json({ error: 'role must be "viewer" or "editor"' }, 400);
  }

  const database = db(c.env);

  const targetCustomerId = await findCustomerByEmail(c, rawEmail);
  if (!targetCustomerId) {
    return c.json(
      {
        error: 'no rev01 account found for this email — they need to sign up first',
      },
      404,
    );
  }

  if (targetCustomerId === owner.customerId) {
    return c.json({ error: 'you cannot invite yourself' }, 400);
  }

  const existing = await database
    .select({
      id: siteCollaborator.id,
      acceptedAt: siteCollaborator.acceptedAt,
      role: siteCollaborator.role,
    })
    .from(siteCollaborator)
    .where(
      and(eq(siteCollaborator.siteId, siteId), eq(siteCollaborator.customerId, targetCustomerId)),
    )
    .limit(1);

  if (existing[0]) {
    const status = existing[0].acceptedAt ? 'active' : 'pending';
    return c.json(
      {
        error:
          status === 'active'
            ? 'this person is already a collaborator on this site'
            : 'this person already has a pending invitation — use Resend to send a fresh email',
        status,
        collaboratorId: existing[0].id,
      },
      409,
    );
  }

  const inserted = await database
    .insert(siteCollaborator)
    .values({
      siteId,
      customerId: targetCustomerId,
      role,
      invitedByCustomerId: owner.customerId,
      invitedEmail: rawEmail,
    })
    .returning({ id: siteCollaborator.id, role: siteCollaborator.role });

  const collaboratorId = inserted[0]?.id;
  if (!collaboratorId) {
    return c.json({ error: 'failed to add collaborator' }, 500);
  }

  // Send email AFTER insert; if it fails, roll back the row so the owner can
  // retry cleanly instead of being blocked by a stale "pending" entry that
  // never received an email.
  try {
    await buildAndSendInviteEmail({
      siteId,
      siteName: owner.siteName,
      siteSubdomain: owner.siteSubdomain,
      collaboratorId,
      invitedEmail: rawEmail,
      role,
      inviterName: resolveInviterName(c, rawEmail),
      env: c.env,
    });
  } catch (err) {
    await database.delete(siteCollaborator).where(eq(siteCollaborator.id, collaboratorId));
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `invitation email failed to send: ${message}` }, 502);
  }

  // ADR 0043: emit collaborator_event 'invited' (best-effort).
  try {
    const subjectDisplay = await loadCustomerDisplay(database, targetCustomerId);
    await emitCollaboratorEvent(c, {
      action: 'invited',
      siteId,
      siteName: owner.siteName,
      subjectCustomerId: targetCustomerId,
      subjectDisplayName: subjectDisplay.displayName,
      subjectEmail: rawEmail,
      actorCustomerId: owner.customerId,
      actorDisplayName: resolveInviterName(c, rawEmail),
    });
  } catch (err) {
    console.error('[collaborators] collaborator_event invited notif failed', {
      siteId,
      collaboratorId,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    });
  }

  return c.json(
    {
      ok: true,
      collaborator: { id: collaboratorId, role, email: rawEmail, acceptedAt: null },
      status: 'invited',
    },
    201,
  );
});

// Update role only. Does not touch acceptedAt or send email. Works on both
// pending and accepted rows — owners may want to pre-set or adjust a role
// before/after acceptance.
collaboratorsApi.patch('/sites/:siteId/collaborators/:collabId', async (c) => {
  const siteId = c.req.param('siteId');
  const collabId = c.req.param('collabId');
  const owner = await requireSiteOwner(c, siteId);
  if (!owner) return c.json({ error: 'site not found' }, 404);

  const body: unknown = await c.req.json();
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const role = parseRole(record.role);
  if (role === null) {
    return c.json({ error: 'role must be "viewer" or "editor"' }, 400);
  }

  const database = db(c.env);

  // Snapshot the previous row first so the access_event notif knows the
  // previousRole + subjectCustomerId without re-querying after the UPDATE.
  const existing = await database
    .select({
      id: siteCollaborator.id,
      customerId: siteCollaborator.customerId,
      role: siteCollaborator.role,
    })
    .from(siteCollaborator)
    .where(and(eq(siteCollaborator.id, collabId), eq(siteCollaborator.siteId, siteId)))
    .limit(1);
  if (!existing[0]) {
    return c.json({ error: 'collaborator not found' }, 404);
  }

  const updated = await database
    .update(siteCollaborator)
    .set({ role })
    .where(and(eq(siteCollaborator.id, collabId), eq(siteCollaborator.siteId, siteId)))
    .returning({ id: siteCollaborator.id, role: siteCollaborator.role });

  if (!updated[0]) {
    return c.json({ error: 'collaborator not found' }, 404);
  }

  // ADR 0043: emit access_event 'role_changed' only when the role actually
  // changed. A no-op PATCH (same role) should not generate a notif.
  if (existing[0].role !== role) {
    try {
      const subjectDisplay = await loadCustomerDisplay(database, existing[0].customerId);
      await emitAccessEvent(c, {
        change: 'role_changed',
        siteId,
        siteName: owner.siteName,
        subjectCustomerId: existing[0].customerId,
        subjectDisplayName: subjectDisplay.displayName,
        previousRole: existing[0].role,
        nextRole: role,
        actorCustomerId: owner.customerId,
        actorDisplayName: resolveInviterName(c, subjectDisplay.email),
      });
    } catch (err) {
      console.error('[collaborators] access_event role_changed notif failed', {
        siteId,
        collabId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      });
    }
  }

  return c.json({ ok: true, collaborator: updated[0] });
});

// Resend the invite email for a still-pending row. Reissues a fresh token
// (same collaboratorId, new exp). Refuses if the collaborator has already
// accepted — there's nothing to resend.
collaboratorsApi.post('/sites/:siteId/collaborators/:collabId/resend', async (c) => {
  const siteId = c.req.param('siteId');
  const collabId = c.req.param('collabId');
  const owner = await requireSiteOwner(c, siteId);
  if (!owner) return c.json({ error: 'site not found' }, 404);

  const database = db(c.env);
  const rows = await database
    .select({
      id: siteCollaborator.id,
      acceptedAt: siteCollaborator.acceptedAt,
      role: siteCollaborator.role,
      invitedEmail: siteCollaborator.invitedEmail,
    })
    .from(siteCollaborator)
    .where(and(eq(siteCollaborator.id, collabId), eq(siteCollaborator.siteId, siteId)))
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ error: 'collaborator not found' }, 404);
  if (row.acceptedAt) {
    return c.json(
      {
        error: 'this person has already accepted — no need to resend',
        status: 'active',
      },
      409,
    );
  }

  try {
    await buildAndSendInviteEmail({
      siteId,
      siteName: owner.siteName,
      siteSubdomain: owner.siteSubdomain,
      collaboratorId: row.id,
      invitedEmail: row.invitedEmail,
      role: row.role,
      inviterName: resolveInviterName(c, row.invitedEmail),
      env: c.env,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `invitation email failed to send: ${message}` }, 502);
  }

  return c.json({ ok: true, status: 'resent' });
});

collaboratorsApi.delete('/sites/:siteId/collaborators/:collabId', async (c) => {
  const siteId = c.req.param('siteId');
  const collabId = c.req.param('collabId');
  const owner = await requireSiteOwner(c, siteId);
  if (!owner) return c.json({ error: 'site not found' }, 404);

  const database = db(c.env);

  // Snapshot the row before deleting so the access_event notif knows the
  // subjectCustomerId, previousRole, and acceptedAt status. We only emit
  // the access_event notif when the row had actually accepted — pending
  // rows revoke silently because the invitee never saw the site.
  const existing = await database
    .select({
      id: siteCollaborator.id,
      customerId: siteCollaborator.customerId,
      role: siteCollaborator.role,
      acceptedAt: siteCollaborator.acceptedAt,
    })
    .from(siteCollaborator)
    .where(and(eq(siteCollaborator.id, collabId), eq(siteCollaborator.siteId, siteId)))
    .limit(1);

  const deleted = await database
    .delete(siteCollaborator)
    .where(and(eq(siteCollaborator.id, collabId), eq(siteCollaborator.siteId, siteId)))
    .returning({ id: siteCollaborator.id });

  if (deleted.length === 0) {
    return c.json({ error: 'collaborator not found' }, 404);
  }

  // ADR 0043: emit access_event 'revoked' for accepted collaborators only.
  if (existing[0] && existing[0].acceptedAt) {
    try {
      const subjectDisplay = await loadCustomerDisplay(database, existing[0].customerId);
      await emitAccessEvent(c, {
        change: 'revoked',
        siteId,
        siteName: owner.siteName,
        subjectCustomerId: existing[0].customerId,
        subjectDisplayName: subjectDisplay.displayName,
        previousRole: existing[0].role,
        nextRole: null,
        actorCustomerId: owner.customerId,
        actorDisplayName: resolveInviterName(c, subjectDisplay.email),
      });
    } catch (err) {
      console.error('[collaborators] access_event revoked notif failed', {
        siteId,
        collabId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      });
    }
  }

  return c.json({ ok: true });
});

export default collaboratorsApi;
