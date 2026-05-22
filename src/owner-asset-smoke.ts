// src/owner-asset-smoke.ts
//
// Smoke test for the Owner Asset routes (/api/me/assets).
// Uses the SMOKE bypass (env.SMOKE = '1' + x-smoke-customer-id header) so no
// Clerk session is needed.
//
// Run: bun run asset:smoke

import { count, eq } from 'drizzle-orm';
import app from './index';
import { db } from './db/client';
import { customer, ownerAsset, site } from './db/schema';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// The 1×1 transparent PNG payload — identical bytes to TRANSPARENT_PNG_BASE64
// in src/canvas/seed-assets.ts. Stable; do not change.
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

const TRANSPARENT_PNG_DATA_URL = `data:image/png;base64,${TRANSPARENT_PNG_BASE64}`;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    '[owner-asset-smoke] DATABASE_URL is required (no fallback — set process.env.DATABASE_URL)',
  );
}

const smokeEnv: Record<string, string> = {
  DATABASE_URL,
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY ?? '',
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
  REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN ?? '',
  SMOKE: '1',
};

const smokeDb = db({ DATABASE_URL });

// ── Step 1: Setup ────────────────────────────────────────────────────────────
console.log('[owner-asset-smoke] setup');

const SMOKE_CLERK_USER = 'smoke-asset-' + crypto.randomUUID().slice(0, 8);

let customerId: string | undefined;
let smokeSiteId: string | undefined;
try {
  const inserted = await smokeDb
    .insert(customer)
    .values({
      clerkUserId: SMOKE_CLERK_USER,
      email: `${SMOKE_CLERK_USER}@example.invalid`,
    })
    .returning({ id: customer.id });

  customerId = inserted[0]?.id;
  assert(
    typeof customerId === 'string' && customerId.length > 0,
    'expected customer insert to return an id',
  );

  console.log('[owner-asset-smoke] setup ok');

  // ── Step 2: Upload PNG ─────────────────────────────────────────────────────
  console.log('[owner-asset-smoke] upload');

  const uploadResp = await app.request(
    'http://rev01.test/api/me/assets',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-smoke-customer-id': customerId,
      },
      body: JSON.stringify({ dataUrl: TRANSPARENT_PNG_DATA_URL, alt: 'smoke upload' }),
    },
    smokeEnv,
  );
  assert(
    uploadResp.status === 200,
    `expected POST /api/me/assets to return 200, got ${uploadResp.status}`,
  );

  const uploadBody = (await uploadResp.json()) as unknown;
  assert(
    typeof uploadBody === 'object' && uploadBody !== null,
    'expected POST /api/me/assets to return a JSON object',
  );
  const uploadJson = uploadBody as Record<string, unknown>;
  assert(
    typeof uploadJson.assetId === 'string' && uploadJson.assetId.startsWith('up-'),
    `expected assetId to start with "up-", got ${JSON.stringify(uploadJson.assetId)}`,
  );
  assert(
    uploadJson.kind === 'image',
    `expected kind to be "image", got ${JSON.stringify(uploadJson.kind)}`,
  );
  assert(
    uploadJson.mediaType === 'image/png',
    `expected mediaType to be "image/png", got ${JSON.stringify(uploadJson.mediaType)}`,
  );

  const assetId = uploadJson.assetId as string;
  console.log('[owner-asset-smoke] upload ok', assetId);

  // ── Step 3: Verify owner_asset row ────────────────────────────────────────
  console.log('[owner-asset-smoke] verify-row');

  const rows = await smokeDb
    .select({ id: ownerAsset.id, customerId: ownerAsset.customerId })
    .from(ownerAsset)
    .where(eq(ownerAsset.id, assetId));

  assert(rows.length === 1, `expected exactly one owner_asset row for ${assetId}, got ${rows.length}`);
  const row = rows[0];
  assert(
    row !== undefined && row.customerId === customerId,
    `expected owner_asset.customer_id to be ${customerId}, got ${JSON.stringify(row?.customerId)}`,
  );

  console.log('[owner-asset-smoke] verify-row ok');

  // ── Step 4: Peek bytes ────────────────────────────────────────────────────
  console.log('[owner-asset-smoke] peek-bytes');

  const peekResp = await app.request(
    `http://rev01.test/api/me/assets/${assetId}`,
    {
      method: 'GET',
      headers: {
        'x-smoke-customer-id': customerId,
      },
    },
    smokeEnv,
  );
  assert(
    peekResp.status === 200,
    `expected GET /api/me/assets/${assetId} to return 200, got ${peekResp.status}`,
  );

  const contentType = peekResp.headers.get('content-type') ?? '';
  assert(
    contentType.startsWith('image/png'),
    `expected content-type to start with "image/png", got ${JSON.stringify(contentType)}`,
  );

  const peekBuffer = new Uint8Array(await peekResp.arrayBuffer());
  let peekBinary = '';
  for (let i = 0; i < peekBuffer.length; i++) {
    peekBinary += String.fromCharCode(peekBuffer[i] as number);
  }
  const peekBase64 = btoa(peekBinary);
  assert(
    peekBase64 === TRANSPARENT_PNG_BASE64,
    `expected peek bytes to round-trip to the same base64 payload sent in upload`,
  );

  console.log('[owner-asset-smoke] peek-bytes ok');

  // ── Step 5: Generate (conditional) ────────────────────────────────────────
  if (process.env.REPLICATE_API_TOKEN) {
    console.log('[owner-asset-smoke] generate');

    const countBefore = await smokeDb
      .select({ n: count() })
      .from(ownerAsset)
      .where(eq(ownerAsset.customerId, customerId));
    const rowCountBefore = countBefore[0]?.n ?? 0;

    const genResp = await app.request(
      'http://rev01.test/api/me/assets/generate',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-smoke-customer-id': customerId,
        },
        body: JSON.stringify({
          prompt: 'a tiny smoke test image',
          alt: 'smoke gen',
          boxW: 100,
          boxH: 100,
        }),
      },
      smokeEnv,
    );
    assert(
      genResp.status === 200,
      `expected POST /api/me/assets/generate to return 200, got ${genResp.status}`,
    );

    const genBody = (await genResp.json()) as unknown;
    assert(
      typeof genBody === 'object' && genBody !== null,
      'expected generate response to be a JSON object',
    );
    const genJson = genBody as Record<string, unknown>;
    assert(genJson.kind === 'image', `expected generate kind to be "image", got ${JSON.stringify(genJson.kind)}`);
    assert(
      typeof genJson.mediaType === 'string' && genJson.mediaType.length > 0,
      `expected generate mediaType to be a non-empty string, got ${JSON.stringify(genJson.mediaType)}`,
    );
    assert(
      typeof genJson.bytesBase64 === 'string' && genJson.bytesBase64.length > 0,
      'expected generate bytesBase64 to be a non-empty string',
    );
    assert(
      genJson.alt === 'smoke gen',
      `expected generate alt to be "smoke gen", got ${JSON.stringify(genJson.alt)}`,
    );

    const countAfter = await smokeDb
      .select({ n: count() })
      .from(ownerAsset)
      .where(eq(ownerAsset.customerId, customerId));
    const rowCountAfter = countAfter[0]?.n ?? 0;

    assert(
      rowCountAfter === rowCountBefore,
      `expected generate NOT to insert an owner_asset row (count before=${String(rowCountBefore)}, after=${String(rowCountAfter)})`,
    );

    console.log('[owner-asset-smoke] generate ok');
  } else {
    console.log('[skip] generate (no REPLICATE_API_TOKEN)');
  }

  // ── Step 6: Slot history ──────────────────────────────────────────────────
  console.log('[owner-asset-smoke] slot-history');

  // 6a. Create a test site owned by the smoke customer.
  smokeSiteId = crypto.randomUUID();
  const smokeSubdomain = 'smoke-' + smokeSiteId.slice(0, 8);
  const minimalState = { styleKit: 'charcoal' as const, pages: [] };

  await smokeDb.insert(site).values({
    id: smokeSiteId,
    customerId,
    name: 'Smoke Site',
    subdomain: smokeSubdomain,
    styleKit: 'charcoal',
    editableState: minimalState,
  });

  // 6b. PUT — record first history entry.
  const put1Resp = await app.request(
    `http://rev01.test/api/sites/${smokeSiteId}/elements/test-element-1/history/${assetId}`,
    {
      method: 'PUT',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    put1Resp.status === 200,
    `expected PUT history to return 200, got ${put1Resp.status}`,
  );

  // 6c. GET — assert exactly one entry with the expected assetId.
  const get1Resp = await app.request(
    `http://rev01.test/api/sites/${smokeSiteId}/elements/test-element-1/history`,
    {
      method: 'GET',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    get1Resp.status === 200,
    `expected GET history to return 200, got ${get1Resp.status}`,
  );
  const get1Body = (await get1Resp.json()) as { entries: Array<{ assetId: string; lastUsedAt: string }> };
  assert(
    get1Body.entries.length === 1,
    `expected exactly 1 history entry, got ${get1Body.entries.length}`,
  );
  assert(
    get1Body.entries[0]?.assetId === assetId,
    `expected history entry assetId to be ${assetId}, got ${JSON.stringify(get1Body.entries[0]?.assetId)}`,
  );
  const firstLastUsedAt = get1Body.entries[0]?.lastUsedAt as string;

  // 6d. PUT same triplet again — MRU dedup: still one entry but lastUsedAt advances.
  // Introduce a short delay so the timestamp differs.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const put2Resp = await app.request(
    `http://rev01.test/api/sites/${smokeSiteId}/elements/test-element-1/history/${assetId}`,
    {
      method: 'PUT',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    put2Resp.status === 200,
    `expected second PUT history to return 200, got ${put2Resp.status}`,
  );

  const get2Resp = await app.request(
    `http://rev01.test/api/sites/${smokeSiteId}/elements/test-element-1/history`,
    {
      method: 'GET',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    get2Resp.status === 200,
    `expected GET history (after second PUT) to return 200, got ${get2Resp.status}`,
  );
  const get2Body = (await get2Resp.json()) as { entries: Array<{ assetId: string; lastUsedAt: string }> };
  assert(
    get2Body.entries.length === 1,
    `expected still exactly 1 history entry after MRU dedup, got ${get2Body.entries.length}`,
  );
  assert(
    get2Body.entries[0]?.lastUsedAt !== firstLastUsedAt,
    `expected lastUsedAt to advance after second PUT (was ${firstLastUsedAt}, got ${String(get2Body.entries[0]?.lastUsedAt)})`,
  );

  // 6e. PUT with an asset id that does NOT belong to this customer → 403.
  const put403Resp = await app.request(
    `http://rev01.test/api/sites/${smokeSiteId}/elements/test-element-1/history/up-does-not-belong`,
    {
      method: 'PUT',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    put403Resp.status === 403,
    `expected PUT with foreign assetId to return 403, got ${put403Resp.status}`,
  );

  // 6f. DELETE — purge history; GET returns 0 entries.
  const deleteResp = await app.request(
    `http://rev01.test/api/sites/${smokeSiteId}/elements/test-element-1/history`,
    {
      method: 'DELETE',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    deleteResp.status === 200,
    `expected DELETE history to return 200, got ${deleteResp.status}`,
  );

  const get3Resp = await app.request(
    `http://rev01.test/api/sites/${smokeSiteId}/elements/test-element-1/history`,
    {
      method: 'GET',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    get3Resp.status === 200,
    `expected GET history after DELETE to return 200, got ${get3Resp.status}`,
  );
  const get3Body = (await get3Resp.json()) as { entries: unknown[] };
  assert(
    get3Body.entries.length === 0,
    `expected 0 history entries after DELETE, got ${get3Body.entries.length}`,
  );

  console.log('[owner-asset-smoke] slot-history ok');

  // ── Step 7: Negative cases ────────────────────────────────────────────────
  console.log('[owner-asset-smoke] negative-cases');

  // 6a. GET a non-existent asset → 404
  const notFoundResp = await app.request(
    'http://rev01.test/api/me/assets/up-does-not-exist',
    {
      method: 'GET',
      headers: {
        'x-smoke-customer-id': customerId,
      },
    },
    smokeEnv,
  );
  assert(
    notFoundResp.status === 404,
    `expected GET /api/me/assets/up-does-not-exist to return 404, got ${notFoundResp.status}`,
  );

  // 6b. POST with invalid body → 400
  const badBodyResp = await app.request(
    'http://rev01.test/api/me/assets',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-smoke-customer-id': customerId,
      },
      body: JSON.stringify({ dataUrl: 'not-a-data-url', alt: '' }),
    },
    smokeEnv,
  );
  assert(
    badBodyResp.status === 400,
    `expected POST /api/me/assets with invalid dataUrl to return 400, got ${badBodyResp.status}`,
  );

  // 6c. POST with no x-smoke-customer-id header → 401
  const noHeaderResp = await app.request(
    'http://rev01.test/api/me/assets',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // deliberately omit x-smoke-customer-id
      },
      body: JSON.stringify({ dataUrl: TRANSPARENT_PNG_DATA_URL, alt: 'no-header' }),
    },
    smokeEnv,
  );
  assert(
    noHeaderResp.status === 401,
    `expected POST /api/me/assets without x-smoke-customer-id to return 401, got ${noHeaderResp.status}`,
  );

  console.log('[owner-asset-smoke] negative-cases ok');
} finally {
  // ── Cleanup ───────────────────────────────────────────────────────────────
  // Delete site first; slot_history rows cascade via FK.
  if (smokeSiteId) {
    await smokeDb.delete(site).where(eq(site.id, smokeSiteId));
  }
  if (customerId) {
    await smokeDb.delete(ownerAsset).where(eq(ownerAsset.customerId, customerId));
    await smokeDb.delete(customer).where(eq(customer.id, customerId));
  }
}

// ── Step 8: Done ──────────────────────────────────────────────────────────────
console.log('[owner-asset-smoke] OK');
