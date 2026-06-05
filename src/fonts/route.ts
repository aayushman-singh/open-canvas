// src/fonts/route.ts
//
// Hono routers that own the custom-font surface, split by auth surface:
//
//   `fontsPublicRouter` (default export) — root-mounted, unauth visitor read:
//     GET /fonts/:contentHash
//
//   `fontsOwnerRouter` (named export) — owner-scoped CRUD, mounted inside
//   `ownerApi` so both /api/sites/:siteId/fonts (Clerk) and
//   /__api/sites/:siteId/fonts (edit-token) reach the same handlers:
//     POST   /                  — multipart upload
//     GET    /                  — list site fonts
//     DELETE /:id               — drop a row + R2 object
//
// The owner verbs are Clerk + customer-ownership gated; `clerkAuth()` is a
// no-op when editTokenAuth has already populated the auth context. The
// public read endpoint is intentionally unauth — visitors must be able to
// fetch font bytes without an account. The content-hash URL is unguessable
// enough (256-bit SHA) to be its own capability token; a brute-force read
// of the bucket is implausible.

import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';

import { createR2Client } from '../assets/r2-client.js';
import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import { db } from '../db/client.js';
import { customer, site, siteFont } from '../db/schema.js';

import { fontContentHashToR2Key, uploadSiteFont } from './upload.js';
import { FontValidationError } from './validate.js';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  ASSETS_BUCKET: R2Bucket;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const fontsPublicRouter = new Hono<Env>();

// --------------------------------------------------------------------------
// Public read — must NOT be behind auth. Visitors of the published site hit
// this URL via the @font-face `src: url('/fonts/<hash>')` declaration.
// --------------------------------------------------------------------------

const FONT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

fontsPublicRouter.get('/fonts/:contentHash', async (c) => {
  const contentHash = c.req.param('contentHash');
  // Strict shape check — only 64-hex addresses can resolve. Anything else
  // returns 404 without ever reaching R2, so a probe like
  // `/fonts/../path` cannot escape the prefix.
  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    return c.text('not found', 404);
  }
  const r2Key = fontContentHashToR2Key(contentHash);
  const r2 = createR2Client(c.env.ASSETS_BUCKET);
  const object = await r2.get(r2Key);
  if (!object) {
    return c.text('not found', 404);
  }
  return new Response(object.body, {
    headers: {
      'content-type': 'font/woff2',
      'cache-control': FONT_CACHE_CONTROL,
    },
  });
});

// --------------------------------------------------------------------------
// Owner-scoped verbs. Mounted inside ownerApi at `/sites/:siteId/fonts` so
// both /api/* and /__api/* surfaces reach the same handlers. Paths below
// are relative to that mount.
// --------------------------------------------------------------------------

export const fontsOwnerRouter = new Hono<Env>();
fontsOwnerRouter.use('*', clerkAuth());
fontsOwnerRouter.use('*', requireAuth());

async function resolveCustomerId(c: Context<Env>): Promise<string | null> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('fonts api reached without an authenticated user');
  }
  const database = db(c.env);
  const rows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function ownsSite(c: Context<Env>, siteId: string, customerId: string): Promise<boolean> {
  const database = db(c.env);
  const rows = await database
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  return rows.length > 0;
}

// ---- LIST ----------------------------------------------------------------

fontsOwnerRouter.get('/', async (c) => {
  const siteId = c.req.param('siteId');
  if (typeof siteId !== 'string' || siteId.length === 0) {
    return c.json({ error: 'siteId is required' }, 400);
  }
  const customerId = await resolveCustomerId(c);
  if (!customerId) return c.json({ error: 'site not found' }, 404);
  if (!(await ownsSite(c, siteId, customerId))) {
    return c.json({ error: 'site not found' }, 404);
  }
  const database = db(c.env);
  const rows = await database
    .select({
      id: siteFont.id,
      siteId: siteFont.siteId,
      name: siteFont.name,
      family: siteFont.family,
      weight: siteFont.weight,
      style: siteFont.style,
      contentHash: siteFont.contentHash,
      byteSize: siteFont.byteSize,
      createdAt: siteFont.createdAt,
    })
    .from(siteFont)
    .where(eq(siteFont.siteId, siteId));
  return c.json({ fonts: rows });
});

// ---- UPLOAD --------------------------------------------------------------

fontsOwnerRouter.post('/', async (c) => {
  const siteId = c.req.param('siteId');
  if (typeof siteId !== 'string' || siteId.length === 0) {
    return c.json({ error: 'siteId is required' }, 400);
  }
  const customerId = await resolveCustomerId(c);
  if (!customerId) return c.json({ error: 'site not found' }, 404);
  if (!(await ownsSite(c, siteId, customerId))) {
    return c.json({ error: 'site not found' }, 404);
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `multipart parse failed: ${message}` }, 400);
  }
  const file = formData.get('file');
  if (file === null || typeof file === 'string') {
    return c.json({ error: 'file field is required (multipart/form-data)' }, 400);
  }
  const blob = file as Blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const nameRaw = formData.get('name');
  const familyRaw = formData.get('family');
  const weightRaw = formData.get('weight');
  const styleRaw = formData.get('style');
  if (typeof nameRaw !== 'string' || nameRaw.length === 0) {
    return c.json({ error: 'name field is required' }, 400);
  }
  if (typeof familyRaw !== 'string' || familyRaw.length === 0) {
    return c.json({ error: 'family field is required' }, 400);
  }
  let weight: number | undefined;
  if (typeof weightRaw === 'string' && weightRaw.length > 0) {
    const parsed = parseInt(weightRaw, 10);
    if (!Number.isFinite(parsed)) {
      return c.json({ error: `weight must be an integer, got ${weightRaw}` }, 400);
    }
    weight = parsed;
  }
  let style: 'normal' | 'italic' | undefined;
  if (typeof styleRaw === 'string' && styleRaw.length > 0) {
    if (styleRaw !== 'normal' && styleRaw !== 'italic') {
      return c.json({ error: `style must be 'normal' or 'italic', got ${styleRaw}` }, 400);
    }
    style = styleRaw;
  }

  const database = db(c.env);
  const r2 = createR2Client(c.env.ASSETS_BUCKET);
  try {
    const input: Parameters<typeof uploadSiteFont>[1] = {
      siteId,
      bytes,
      name: nameRaw,
      family: familyRaw,
      ...(weight !== undefined ? { weight } : {}),
      ...(style !== undefined ? { style } : {}),
    };
    const result = await uploadSiteFont({ db: database, r2 }, input);
    return c.json(result);
  } catch (err) {
    if (err instanceof FontValidationError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    throw err;
  }
});

// ---- DELETE --------------------------------------------------------------

fontsOwnerRouter.delete('/:id', async (c) => {
  const siteId = c.req.param('siteId');
  const fontId = c.req.param('id');
  if (typeof siteId !== 'string' || siteId.length === 0) {
    return c.json({ error: 'siteId is required' }, 400);
  }
  if (typeof fontId !== 'string' || fontId.length === 0) {
    return c.json({ error: 'font not found' }, 404);
  }
  const customerId = await resolveCustomerId(c);
  if (!customerId) return c.json({ error: 'site not found' }, 404);
  if (!(await ownsSite(c, siteId, customerId))) {
    return c.json({ error: 'site not found' }, 404);
  }

  const database = db(c.env);
  const rows = await database
    .select({
      id: siteFont.id,
      contentHash: siteFont.contentHash,
    })
    .from(siteFont)
    .where(and(eq(siteFont.id, fontId), eq(siteFont.siteId, siteId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: 'font not found' }, 404);
  }

  await database.delete(siteFont).where(eq(siteFont.id, fontId));

  // The R2 object survives if any OTHER siteFont row (this site or any
  // other site) still references the same content hash. The bytes are
  // shared by content-hash addressing; orphan cleanup is a future ADR.
  const siblings = await database
    .select({ id: siteFont.id })
    .from(siteFont)
    .where(eq(siteFont.contentHash, row.contentHash))
    .limit(1);

  let r2ObjectDeleted = false;
  if (siblings.length === 0) {
    const r2 = createR2Client(c.env.ASSETS_BUCKET);
    r2ObjectDeleted = await r2.delete(fontContentHashToR2Key(row.contentHash));
  }

  return c.json({ ok: true, r2ObjectDeleted });
});

export default fontsPublicRouter;
