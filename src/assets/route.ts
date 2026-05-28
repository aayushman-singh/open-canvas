// src/assets/route.ts
//
// Hono router mounted at `/api/owner/assets`. Authenticated via Clerk; the
// upload, list, and delete endpoints all resolve the current Owner from
// `auth.userId` before any asset work. Per ADR 0004 the asset root is the
// Owner — there is no `siteId` in the route shape.

import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { deleteOwnerAsset, type AssetReference } from './delete.js';
import { listOwnerAssets } from './list.js';
import { createR2Client } from './r2-client.js';
import { uploadOwnerAsset, UploadAssetError } from './upload.js';
import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import { db } from '../db/client.js';
import { customer } from '../db/schema.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  ASSETS_BUCKET: R2Bucket;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const ownerAssetsApi = new Hono<Env>();

ownerAssetsApi.use('*', clerkAuth());
ownerAssetsApi.use('*', requireAuth());

async function resolveCustomerId(c: Context<Env>): Promise<string | null> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('owner-assets api reached without an authenticated user');
  }
  const database = db(c.env);
  const rows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

ownerAssetsApi.get('/', async (c) => {
  const customerId = await resolveCustomerId(c);
  if (!customerId) {
    // Same contract as the canvas API: a Clerk-authenticated user without a
    // materialised customer row gets an empty gallery, not a 404. The
    // dashboard's first-visit hook creates the row.
    return c.json({ assets: [] });
  }
  const database = db(c.env);
  const assets = await listOwnerAssets(database, customerId);
  return c.json({ assets });
});

ownerAssetsApi.post('/', async (c) => {
  const customerId = await resolveCustomerId(c);
  if (!customerId) {
    return c.json(
      { error: 'no customer row for current user - visit /dashboard first to materialise it' },
      409,
    );
  }
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `multipart parse failed: ${message}` }, 400);
  }
  const file = formData.get('file');
  // FormData entries are `FormDataEntryValue` (string | File). Worker types
  // sometimes elide `Blob` from the union; the runtime check below covers
  // both shapes without depending on the precise lib version.
  if (file === null || typeof file === 'string') {
    return c.json({ error: 'file field is required (multipart/form-data)' }, 400);
  }
  const blob = file as Blob;
  const altRaw = formData.get('alt');
  const alt = typeof altRaw === 'string' ? altRaw : '';
  const siteIdRaw = formData.get('siteId');
  const elementIdRaw = formData.get('elementId');
  const siteId = typeof siteIdRaw === 'string' && siteIdRaw.length > 0 ? siteIdRaw : undefined;
  const elementId =
    typeof elementIdRaw === 'string' && elementIdRaw.length > 0 ? elementIdRaw : undefined;

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mediaType = blob.type;
  if (!mediaType) {
    return c.json({ error: 'file must carry a content type (multipart Content-Type header)' }, 400);
  }

  const database = db(c.env);
  const r2 = createR2Client(c.env.ASSETS_BUCKET);
  try {
    // `siteId` / `elementId` are explicitly omitted when absent so the
    // exactOptionalPropertyTypes check is satisfied — the upload primitive
    // treats the property's absence as "no slot history book-keeping".
    const input: Parameters<typeof uploadOwnerAsset>[1] = {
      customerId,
      bytes,
      mediaType,
      alt,
      ...(siteId !== undefined ? { siteId } : {}),
      ...(elementId !== undefined ? { elementId } : {}),
    };
    const result = await uploadOwnerAsset({ db: database, r2 }, input);
    return c.json(result);
  } catch (err) {
    if (err instanceof UploadAssetError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    throw err;
  }
});

ownerAssetsApi.delete('/:id', async (c) => {
  const customerId = await resolveCustomerId(c);
  if (!customerId) {
    return c.json({ error: 'asset not found' }, 404);
  }
  const assetId = c.req.param('id');
  const confirm = c.req.query('confirm') === '1';
  const database = db(c.env);
  const r2 = createR2Client(c.env.ASSETS_BUCKET);
  const result = await deleteOwnerAsset({ db: database, r2 }, { assetId, customerId, confirm });
  if (result.status === 'not_found') {
    return c.json({ error: 'asset not found' }, 404);
  }
  if (result.status === 'confirm_required') {
    return c.json(
      {
        error: 'confirmation required',
        references: result.references,
        confirmHint:
          'pass ?confirm=1 to proceed; editable slots are cleared and live published sites show missing media until re-published',
      },
      412,
    );
  }
  return c.json({
    ok: true,
    references: result.references satisfies AssetReference[],
    r2ObjectDeleted: result.r2ObjectDeleted,
  });
});

export default ownerAssetsApi;
