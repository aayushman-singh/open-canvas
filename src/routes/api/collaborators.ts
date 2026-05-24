import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { signInviteToken } from '../../auth/invite-token.js';
import { db } from '../../db/client.js';
import { customer, site, siteCollaborator } from '../../db/schema.js';
import { sendEmail } from '../../email/send.js';
import { inviteEmailHtml, inviteEmailSubject } from '../../email/templates/invite.js';

type Bindings = {
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

collaboratorsApi.post('/sites/:siteId/collaborators', async (c) => {
  const siteId = c.req.param('siteId');
  const owner = await requireSiteOwner(c, siteId);
  if (!owner) return c.json({ error: 'site not found' }, 404);

  const body: unknown = await c.req.json();
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  const role = record.role === 'viewer' ? ('viewer' as const) : ('editor' as const);

  if (!email || !email.includes('@')) {
    return c.json({ error: 'valid email is required' }, 400);
  }

  const database = db(c.env);

  const targetRows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.email, email))
    .limit(1);

  if (!targetRows[0]) {
    return c.json({
      error: 'no account found for this email — they need to sign up first',
    }, 404);
  }

  const targetCustomerId = targetRows[0].id;

  if (targetCustomerId === owner.customerId) {
    return c.json({ error: 'cannot add yourself as a collaborator' }, 400);
  }

  try {
    const inserted = await database
      .insert(siteCollaborator)
      .values({
        siteId,
        customerId: targetCustomerId,
        role,
        invitedByCustomerId: owner.customerId,
        invitedEmail: email,
      })
      .onConflictDoUpdate({
        target: [siteCollaborator.siteId, siteCollaborator.customerId],
        set: { role, acceptedAt: null },
      })
      .returning({
        id: siteCollaborator.id,
        role: siteCollaborator.role,
      });

    const collaboratorId = inserted[0]?.id;
    if (!collaboratorId) {
      throw new Error('insert returned no rows');
    }

    const inviteToken = await signInviteToken(
      { siteId, collaboratorId, invitedEmail: email },
      c.env.UNLOCK_SIGNING_SECRET,
    );

    const acceptUrl = `https://${owner.siteSubdomain}.rev01.aayushman.dev/__accept-invite?token=${encodeURIComponent(inviteToken)}`;

    const ownerUser = c.get('user');
    const inviterName = ownerUser
      ? `${ownerUser.firstName ?? ''} ${ownerUser.lastName ?? ''}`.trim() || email
      : 'A rev01 user';

    await sendEmail(c.env.RESEND_API_KEY, {
      to: email,
      subject: inviteEmailSubject(owner.siteName),
      html: inviteEmailHtml({
        siteName: owner.siteName,
        siteSubdomain: owner.siteSubdomain,
        inviterName,
        role,
        acceptUrl,
      }),
    });

    return c.json({
      ok: true,
      collaborator: inserted[0],
      status: 'invited',
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `failed to add collaborator: ${message}` }, 500);
  }
});

collaboratorsApi.delete('/sites/:siteId/collaborators/:collabId', async (c) => {
  const siteId = c.req.param('siteId');
  const collabId = c.req.param('collabId');
  const owner = await requireSiteOwner(c, siteId);
  if (!owner) return c.json({ error: 'site not found' }, 404);

  const database = db(c.env);
  const deleted = await database
    .delete(siteCollaborator)
    .where(
      and(
        eq(siteCollaborator.id, collabId),
        eq(siteCollaborator.siteId, siteId),
      ),
    )
    .returning({ id: siteCollaborator.id });

  if (deleted.length === 0) {
    return c.json({ error: 'collaborator not found' }, 404);
  }

  return c.json({ ok: true });
});

export default collaboratorsApi;
