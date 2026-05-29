import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { signInviteToken } from '../../auth/invite-token.js';
import { db } from '../../db/client.js';
import { customer, site, siteCollaborator, type CollaboratorRole } from '../../db/schema.js';
import { sendEmail } from '../../email/send.js';
import { inviteEmailHtml, inviteEmailSubject } from '../../email/templates/invite.js';
import { appDomain, appOrigin, type HostConfigEnv } from '../../host-config.js';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  UNLOCK_SIGNING_SECRET: string;
  RESEND_API_KEY: string;
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
  const updated = await database
    .update(siteCollaborator)
    .set({ role })
    .where(and(eq(siteCollaborator.id, collabId), eq(siteCollaborator.siteId, siteId)))
    .returning({ id: siteCollaborator.id, role: siteCollaborator.role });

  if (!updated[0]) {
    return c.json({ error: 'collaborator not found' }, 404);
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
  const deleted = await database
    .delete(siteCollaborator)
    .where(and(eq(siteCollaborator.id, collabId), eq(siteCollaborator.siteId, siteId)))
    .returning({ id: siteCollaborator.id });

  if (deleted.length === 0) {
    return c.json({ error: 'collaborator not found' }, 404);
  }

  return c.json({ ok: true });
});

export default collaboratorsApi;
