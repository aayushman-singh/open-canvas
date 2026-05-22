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

  // ── Step 7: Gallery ───────────────────────────────────────────────────────
  console.log('[owner-asset-smoke] gallery');

  // 7a. GET /api/me/assets — assert 200 and entries contains at least the uploaded assetId.
  const galleryResp = await app.request(
    'http://rev01.test/api/me/assets',
    {
      method: 'GET',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    galleryResp.status === 200,
    `expected GET /api/me/assets to return 200, got ${galleryResp.status}`,
  );
  const galleryBody = (await galleryResp.json()) as { entries: Array<{ assetId: string; kind: string }> };
  assert(
    Array.isArray(galleryBody.entries),
    'expected GET /api/me/assets to return an object with an entries array',
  );
  assert(
    galleryBody.entries.some((e) => e.assetId === assetId),
    `expected gallery entries to contain uploaded assetId ${assetId}`,
  );

  // 7b. GET /api/me/assets?kind=image — all returned entries must be images.
  const galleryImageResp = await app.request(
    'http://rev01.test/api/me/assets?kind=image',
    {
      method: 'GET',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    galleryImageResp.status === 200,
    `expected GET /api/me/assets?kind=image to return 200, got ${galleryImageResp.status}`,
  );
  const galleryImageBody = (await galleryImageResp.json()) as { entries: Array<{ kind: string }> };
  assert(
    galleryImageBody.entries.every((e) => e.kind === 'image'),
    'expected all entries from ?kind=image to have kind === "image"',
  );

  // 7c. GET /api/me/assets?kind=video — must not leak image entries.
  const galleryVideoResp = await app.request(
    'http://rev01.test/api/me/assets?kind=video',
    {
      method: 'GET',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    galleryVideoResp.status === 200,
    `expected GET /api/me/assets?kind=video to return 200, got ${galleryVideoResp.status}`,
  );
  const galleryVideoBody = (await galleryVideoResp.json()) as { entries: Array<{ kind: string }> };
  assert(
    galleryVideoBody.entries.every((e) => e.kind === 'video'),
    'expected all entries from ?kind=video to have kind === "video" (no image leak)',
  );

  // 7d. GET /api/me/assets/:assetId/usage — skipping editable-state injection.
  // The slot-history smoke step PUTs history records but does NOT write a media
  // element into the site's editableState, so collectReferencedAssets would find
  // zero references. Injecting a media element would require significant setup
  // (building a valid CanvasSection/CanvasPage/MediaElement) for marginal value
  // when the core path (DB query + JSON walk) is already tested by the helper's
  // unit behaviour. We verify the endpoint is reachable and returns the correct
  // shape instead.
  const usageResp = await app.request(
    `http://rev01.test/api/me/assets/${assetId}/usage`,
    {
      method: 'GET',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    usageResp.status === 200,
    `expected GET /api/me/assets/${assetId}/usage to return 200, got ${usageResp.status}`,
  );
  const usageBody = (await usageResp.json()) as { usage: unknown[] };
  assert(
    Array.isArray(usageBody.usage),
    'expected GET /api/me/assets/:assetId/usage to return an object with a usage array',
  );

  console.log('[owner-asset-smoke] gallery ok');

  // ── Step 8: Delete-cascade ────────────────────────────────────────────────
  console.log('[owner-asset-smoke] delete-cascade');

  // 8a. Upload a fresh asset to use as the delete target.
  const deleteUploadResp = await app.request(
    'http://rev01.test/api/me/assets',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-smoke-customer-id': customerId,
      },
      body: JSON.stringify({ dataUrl: TRANSPARENT_PNG_DATA_URL, alt: 'delete-cascade target' }),
    },
    smokeEnv,
  );
  assert(
    deleteUploadResp.status === 200,
    `expected POST /api/me/assets (delete target) to return 200, got ${deleteUploadResp.status}`,
  );
  const deleteUploadJson = (await deleteUploadResp.json()) as Record<string, unknown>;
  const deleteAssetId = deleteUploadJson.assetId as string;
  assert(
    typeof deleteAssetId === 'string' && deleteAssetId.startsWith('up-'),
    `expected deleteAssetId to start with "up-", got ${JSON.stringify(deleteAssetId)}`,
  );

  // 8b. Inject the new assetId into the test site's editableState by reading
  //     the current state, adding a media element that references deleteAssetId,
  //     and writing it back directly via the DB.
  assert(
    typeof smokeSiteId === 'string',
    'expected smokeSiteId to be set from step 6',
  );
  const stateRows = await smokeDb
    .select({ editableState: site.editableState })
    .from(site)
    .where(eq(site.id, smokeSiteId))
    .limit(1);
  const stateRow = stateRows[0];
  assert(stateRow !== undefined, 'expected smoke site row to exist for editableState injection');

  // Clone state and inject a media element containing deleteAssetId. Build a
  // complete MediaElement so clearAssetReferences can find and clear it.
  const injectedElementId = 'smoke-media-' + crypto.randomUUID().slice(0, 8);
  const currentState = stateRow.editableState;
  const injectedMediaElement = {
    id: injectedElementId,
    type: 'media' as const,
    box: { x: 0, y: 0, w: 100, h: 100, z: 0 },
    mediaKind: 'image' as const,
    assetId: deleteAssetId,
    alt: 'cascade test image',
    fit: 'cover' as const,
  };
  let injectedState;
  if (currentState.pages.length > 0 && currentState.pages[0] !== undefined) {
    // Inject into the first section of the first page if one exists.
    const firstPage = currentState.pages[0];
    if (firstPage.sections.length > 0 && firstPage.sections[0] !== undefined) {
      injectedState = {
        ...currentState,
        pages: [
          {
            ...firstPage,
            sections: [
              {
                ...firstPage.sections[0],
                elements: [...firstPage.sections[0].elements, injectedMediaElement],
              },
              ...firstPage.sections.slice(1),
            ],
          },
          ...currentState.pages.slice(1),
        ],
      };
    } else {
      // First page has no sections — add a section with the media element.
      injectedState = {
        ...currentState,
        pages: [
          {
            ...firstPage,
            sections: [
              {
                id: 'smoke-section-' + crypto.randomUUID().slice(0, 8),
                recipeId: 'hero-split' as const,
                name: 'Smoke Section',
                height: 400,
                elements: [injectedMediaElement],
              },
            ],
          },
          ...currentState.pages.slice(1),
        ],
      };
    }
  } else {
    // No pages yet — add a full page with a section containing the media element.
    injectedState = {
      ...currentState,
      pages: [
        {
          id: 'smoke-page-' + crypto.randomUUID().slice(0, 8),
          slug: 'home',
          title: 'Home',
          width: 1200,
          sections: [
            {
              id: 'smoke-section-' + crypto.randomUUID().slice(0, 8),
              recipeId: 'hero-split' as const,
              name: 'Smoke Section',
              height: 400,
              elements: [injectedMediaElement],
            },
          ],
        },
      ],
    };
  }
  await smokeDb
    .update(site)
    .set({ editableState: injectedState })
    .where(eq(site.id, smokeSiteId));

  // 8c. GET /api/me/assets/:assetId/usage — assert exactly one entry with source 'editable'.
  const usageBeforeResp = await app.request(
    `http://rev01.test/api/me/assets/${deleteAssetId}/usage`,
    {
      method: 'GET',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    usageBeforeResp.status === 200,
    `expected GET /api/me/assets/${deleteAssetId}/usage to return 200, got ${usageBeforeResp.status}`,
  );
  const usageBeforeBody = (await usageBeforeResp.json()) as { usage: Array<{ source: string; siteId: string }> };
  assert(
    usageBeforeBody.usage.length === 1,
    `expected exactly 1 usage entry before delete, got ${usageBeforeBody.usage.length}`,
  );
  assert(
    usageBeforeBody.usage[0]?.source === 'editable',
    `expected usage source to be "editable", got ${JSON.stringify(usageBeforeBody.usage[0]?.source)}`,
  );

  // 8d. DELETE without ?confirm=cascade → 400 with cascade confirmation required.
  const deleteNoConfirmResp = await app.request(
    `http://rev01.test/api/me/assets/${deleteAssetId}`,
    {
      method: 'DELETE',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    deleteNoConfirmResp.status === 400,
    `expected DELETE without confirm to return 400, got ${deleteNoConfirmResp.status}`,
  );
  const deleteNoConfirmBody = (await deleteNoConfirmResp.json()) as Record<string, unknown>;
  assert(
    typeof deleteNoConfirmBody.error === 'string' &&
      deleteNoConfirmBody.error.includes('cascade confirmation required'),
    `expected error "cascade confirmation required", got ${JSON.stringify(deleteNoConfirmBody.error)}`,
  );

  // 8e. DELETE with ?confirm=cascade → 200 { ok: true }.
  const deleteCascadeResp = await app.request(
    `http://rev01.test/api/me/assets/${deleteAssetId}?confirm=cascade`,
    {
      method: 'DELETE',
      headers: { 'x-smoke-customer-id': customerId },
    },
    smokeEnv,
  );
  assert(
    deleteCascadeResp.status === 200,
    `expected DELETE ?confirm=cascade to return 200, got ${deleteCascadeResp.status}`,
  );
  const deleteCascadeBody = (await deleteCascadeResp.json()) as Record<string, unknown>;
  assert(
    deleteCascadeBody.ok === true,
    `expected DELETE response to be { ok: true }, got ${JSON.stringify(deleteCascadeBody)}`,
  );

  // 8f. Re-query owner_asset — assert 0 rows for deleteAssetId.
  const assetAfterDelete = await smokeDb
    .select({ id: ownerAsset.id })
    .from(ownerAsset)
    .where(eq(ownerAsset.id, deleteAssetId));
  assert(
    assetAfterDelete.length === 0,
    `expected owner_asset row for ${deleteAssetId} to be gone after DELETE, got ${assetAfterDelete.length} rows`,
  );

  // 8g. Re-query site editableState — assert the injected element's assetId is now ''.
  const stateAfterRows = await smokeDb
    .select({ editableState: site.editableState })
    .from(site)
    .where(eq(site.id, smokeSiteId))
    .limit(1);
  const stateAfterRow = stateAfterRows[0];
  assert(stateAfterRow !== undefined, 'expected smoke site row to exist after delete');
  const afterState = stateAfterRow.editableState;
  let foundElement: { type: string; assetId?: string } | undefined;
  for (const page of afterState.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.id === injectedElementId) {
          foundElement = element as { type: string; assetId?: string };
        }
      }
    }
  }
  assert(
    foundElement !== undefined,
    `expected injected media element ${injectedElementId} to still be present in editableState after cascade`,
  );
  assert(
    (foundElement as Record<string, unknown>).assetId === '',
    `expected injected element assetId to be cleared to "", got ${JSON.stringify((foundElement as Record<string, unknown>).assetId)}`,
  );

  console.log('[owner-asset-smoke] delete-cascade ok');

  // ── Step 9: Negative cases ────────────────────────────────────────────────
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

// ── Step 10: Done ─────────────────────────────────────────────────────────────
console.log('[owner-asset-smoke] OK');
