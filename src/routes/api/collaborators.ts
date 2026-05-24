import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { db } from '../../db/client.js';
import { customer, site, siteCollaborator } from '../../db/schema.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
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
): Promise<{ customerId: string } | null> {
  const customerId = await resolveCustomerId(c);
  if (!customerId) return null;
  const database = db(c.env);
  const rows = await database
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  if (!rows[0]) return null;
  return { customerId };
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
  const role = record.role === 'viewer' ? 'viewer' as const : 'editor' as const;

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
        acceptedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [siteCollaborator.siteId, siteCollaborator.customerId],
        set: { role },
      })
      .returning({
        id: siteCollaborator.id,
        role: siteCollaborator.role,
      });

    return c.json({ ok: true, collaborator: inserted[0] });
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
