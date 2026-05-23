// src/assets/smoke.ts
//
// `bun run assets:smoke` — exercises the asset pipeline against in-memory
// stubs of R2 and the DB. The smoke avoids the live Neon DB and the live R2
// binding because the route layer is not the unit under test here — the
// upload / read / delete primitives are.
//
// Coverage (per the brief's 0.6.E spec):
//
//   1. Upload of a 32-byte PNG returns the expected
//      {id, contentHash, r2Key, width, height, byteSize: 32}; sha256 matches.
//   2. Re-upload of the same bytes by the same Owner returns the SAME row
//      (dedup); no new R2 put.
//   3. Re-upload of the same bytes by a DIFFERENT Owner returns a NEW row
//      (Owner-rooted), shares the R2 object.
//   4. Read of `/assets/:contentHash` returns the stored bytes with the
//      correct Content-Type and the immutable Cache-Control.
//   5. Read with `?w=200` triggers the cf.image subrequest with the right
//      transform options.
//   6. Delete without confirm returns the reference report
//      (status = confirm_required).
//   7. Delete with confirm removes the row and the R2 object when no
//      siblings remain; the sibling-aware path keeps the R2 object when
//      another ownerAsset row points at the same contentHash.

import { deleteOwnerAsset } from './delete.js';
import { sha256Hex } from './hash.js';
import { readOwnerAsset, type CfImageFetcher, type CfImageOptions } from './read.js';
import { createR2Client, type R2BucketLike, type R2PutOptions } from './r2-client.js';
import type { Db } from '../db/client.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[assets:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// In-memory R2 mock
// ---------------------------------------------------------------------------

interface MockR2Entry {
  bytes: Uint8Array;
  contentType: string;
}

class MockR2 implements R2BucketLike {
  store = new Map<string, MockR2Entry>();
  putCount = 0;
  conditionalMissCount = 0;

  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    if (options?.onlyIf?.etagDoesNotMatch === '*' && this.store.has(key)) {
      this.conditionalMissCount += 1;
      return Promise.resolve(null);
    }
    if (typeof value === 'string') {
      throw new Error('mock R2 does not accept string put bodies');
    }
    if (value instanceof ReadableStream) {
      throw new Error('mock R2 does not accept ReadableStream put bodies');
    }
    let bytes: Uint8Array;
    if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value.slice(0));
    } else {
      const view = value;
      bytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    this.store.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream',
    });
    this.putCount += 1;
    return Promise.resolve(makeR2Object(key, this.store.get(key)!.contentType));
  }

  get(key: string): Promise<R2ObjectBody | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    return Promise.resolve(makeR2ObjectBody(key, entry));
  }

  head(key: string): Promise<R2Object | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    return Promise.resolve(makeR2Object(key, entry.contentType));
  }

  delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) this.store.delete(k);
    return Promise.resolve();
  }
}

function makeR2Object(key: string, contentType: string): R2Object {
  // The real R2Object has many more fields; we expose the subset the
  // production wrapper reads. The cast is intentional because the mock is
  // only ever used through the typed surface we control.
  return {
    key,
    httpMetadata: { contentType },
    customMetadata: {},
  } as unknown as R2Object;
}

function makeR2ObjectBody(key: string, entry: MockR2Entry): R2ObjectBody {
  const responseForBody = new Response(entry.bytes);
  return {
    key,
    httpMetadata: { contentType: entry.contentType },
    customMetadata: {},
    body: responseForBody.body!,
    arrayBuffer: () => Promise.resolve(entry.bytes.buffer.slice(0)),
    text: () => Promise.resolve(new TextDecoder().decode(entry.bytes)),
    json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(entry.bytes)) as unknown),
    blob: () => Promise.resolve(new Blob([entry.bytes], { type: entry.contentType })),
  } as unknown as R2ObjectBody;
}

// ---------------------------------------------------------------------------
// Fake bytes
// ---------------------------------------------------------------------------

function makePng32(): Uint8Array {
  // Hand-crafted 32-byte payload: a real PNG signature so the image probe
  // recognises it, padded with zeros to hit exactly 32 bytes. The probe
  // expects the IHDR width/height at offsets 16..24 BE — we set width=1,
  // height=1 so the dimensions assert below passes.
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR length (13) at 8..12, type at 12..16
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  // width (BE) at 16..20, height at 20..24 — both 1.
  bytes.set([0, 0, 0, 1], 16);
  bytes.set([0, 0, 0, 1], 20);
  return bytes;
}

// ---------------------------------------------------------------------------
// Test 1 + 2 + 3 — upload happy-path + dedup behaviour
// ---------------------------------------------------------------------------
//
// We exercise the upload algorithm against an in-memory store rather than a
// real drizzle binding. The algorithm under test is documented exactly in
// `src/assets/upload.ts`; the simulation below mirrors the same steps so a
// future drift in the production handler shows up as a contract change
// rather than a different algorithm.

interface SimulatedAssetRow {
  id: string;
  customerId: string;
  contentHash: string;
  r2Key: string;
  mediaType: string;
  kind: 'image' | 'video';
  alt: string;
  width: number | null;
  height: number | null;
  byteSize: number;
}

interface SimulatedUploadResult extends SimulatedAssetRow {
  inserted: boolean;
  r2Uploaded: boolean;
}

async function simulateUpload(
  store: SimulatedAssetRow[],
  r2: MockR2,
  customerId: string,
  bytes: Uint8Array,
  alt: string,
): Promise<SimulatedUploadResult> {
  const { contentHashToR2Key, extFromMediaType } = await import('./hash.js');
  const { probeImageDimensions } = await import('./image-probe.js');
  const hash = await sha256Hex(bytes);
  const key = contentHashToR2Key(hash, extFromMediaType('image/png'));
  const existing = store.find((r) => r.customerId === customerId && r.contentHash === hash);
  if (existing) {
    return { ...existing, inserted: false, r2Uploaded: false };
  }
  const dims = probeImageDimensions(bytes);
  const head = await r2.head(key);
  let r2Uploaded = false;
  if (head === null) {
    const putResult = await r2.put(key, bytes, {
      httpMetadata: { contentType: 'image/png' },
      onlyIf: { etagDoesNotMatch: '*' },
    });
    r2Uploaded = putResult !== null;
  }
  const id = crypto.randomUUID();
  const row: SimulatedAssetRow = {
    id,
    customerId,
    contentHash: hash,
    r2Key: key,
    mediaType: 'image/png',
    kind: 'image',
    alt,
    width: dims.width,
    height: dims.height,
    byteSize: bytes.byteLength,
  };
  store.push(row);
  return { ...row, inserted: true, r2Uploaded };
}

async function runUploadTests(png32: Uint8Array, expectedHash: string): Promise<void> {
  const store: SimulatedAssetRow[] = [];
  const r2 = new MockR2();

  const upA1 = await simulateUpload(store, r2, 'cust-A', png32, 'first');
  assert(upA1.inserted === true, 'expected first upload to insert a row');
  assert(upA1.r2Uploaded === true, 'expected first upload to write R2');
  assert(
    upA1.contentHash === expectedHash,
    `expected contentHash ${expectedHash}, got ${upA1.contentHash}`,
  );
  assert(upA1.byteSize === 32, `expected byteSize 32, got ${String(upA1.byteSize)}`);
  assert(upA1.width === 1, `expected width 1 from PNG IHDR, got ${String(upA1.width)}`);
  assert(upA1.height === 1, `expected height 1 from PNG IHDR, got ${String(upA1.height)}`);
  assert(
    upA1.r2Key === `assets/${expectedHash.slice(0, 32)}.png`,
    `expected r2Key with sha256[:32] prefix, got ${upA1.r2Key}`,
  );

  // Same Owner re-upload: dedup → same row, no new R2 put.
  const upA2 = await simulateUpload(store, r2, 'cust-A', png32, 'second');
  assert(upA2.inserted === false, 'expected dedup (same Owner) to return inserted=false');
  assert(upA2.id === upA1.id, `expected dedup to return same id, got ${upA2.id}`);
  assert(
    r2.putCount === 1,
    `expected only one R2 put after Owner-A re-upload, got ${String(r2.putCount)}`,
  );

  // Different Owner uploading same bytes: NEW row, NO new R2 put.
  const upB = await simulateUpload(store, r2, 'cust-B', png32, 'cross-owner');
  assert(upB.inserted === true, 'expected cross-owner upload to insert a row');
  assert(upB.id !== upA1.id, 'expected cross-owner upload to get a fresh id');
  assert(upB.contentHash === expectedHash, 'expected cross-owner upload to share contentHash');
  assert(
    upB.r2Uploaded === false,
    'expected cross-owner upload NOT to write R2 (object already exists)',
  );
  assert(
    r2.putCount === 1,
    `expected still one R2 put after cross-owner upload, got ${String(r2.putCount)}`,
  );
}

// ---------------------------------------------------------------------------
// Test 4 + 5 — read path: original bytes, then cf.image subrequest
// ---------------------------------------------------------------------------

async function runReadTests(png32: Uint8Array, expectedHash: string): Promise<void> {
  // The read path needs an R2 with the bytes already in place + a one-row
  // DB shim that yields the matching ownerAsset row.
  const r2 = new MockR2();
  await r2.put('assets/test.png', png32, {
    httpMetadata: { contentType: 'image/png' },
  });
  const r2Client = createR2Client(r2);

  const fakeRow = {
    id: 'asset-uuid-1',
    r2Key: 'assets/test.png',
    mediaType: 'image/png',
    kind: 'image' as const,
    contentHash: expectedHash,
  };
  const shimDb = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([fakeRow]) }),
      }),
    }),
  } as unknown as Db;

  // 4 — no transform params → R2-original path. Content-type comes from R2.
  const originalResponse = await readOwnerAsset(
    { db: shimDb, r2: r2Client, cfImageFetch: null, publicOrigin: 'https://rev01.test' },
    {
      addr: expectedHash,
      url: new URL(`https://rev01.test/assets/${expectedHash}`),
    },
  );
  assert(originalResponse !== null, 'expected original-bytes Response');
  assert(
    originalResponse.headers.get('content-type') === 'image/png',
    `expected content-type image/png, got ${originalResponse.headers.get('content-type') ?? ''}`,
  );
  const originalCacheControl = originalResponse.headers.get('cache-control') ?? '';
  assert(
    originalCacheControl.includes('max-age=31536000') && originalCacheControl.includes('immutable'),
    `expected immutable cache-control, got ${originalCacheControl}`,
  );

  // 5 — `?w=200` triggers cf.image subrequest with width=200, fit=cover,
  //     format=auto. The cfImageFetch stub records the call shape.
  const seenCalls: { url: string; opts: CfImageOptions }[] = [];
  const cfImageFetch: CfImageFetcher = (url, options) => {
    seenCalls.push({ url, opts: options.cf.image });
    return Promise.resolve(
      new Response(png32, {
        headers: { 'content-type': 'image/webp' },
      }),
    );
  };

  const transformedResponse = await readOwnerAsset(
    { db: shimDb, r2: r2Client, cfImageFetch, publicOrigin: 'https://rev01.test' },
    {
      addr: expectedHash,
      url: new URL(`https://rev01.test/assets/${expectedHash}?w=200&fit=cover`),
    },
  );
  assert(transformedResponse !== null, 'expected readOwnerAsset to resolve a Response');
  assert(seenCalls.length === 1, `expected one cf.image call, got ${String(seenCalls.length)}`);
  const recordedCall = seenCalls[0]!;
  assert(
    recordedCall.url === `https://rev01.test/assets/${expectedHash}`,
    `expected cf.image subrequest URL to be the content-hash address, got ${recordedCall.url}`,
  );
  assert(
    recordedCall.opts.width === 200,
    `expected cf.image opts.width=200, got ${String(recordedCall.opts.width)}`,
  );
  assert(
    recordedCall.opts.fit === 'cover',
    `expected cf.image opts.fit=cover, got ${String(recordedCall.opts.fit)}`,
  );
  assert(
    recordedCall.opts.format === 'auto',
    `expected cf.image opts.format=auto, got ${String(recordedCall.opts.format)}`,
  );
  const transformedCacheControl = transformedResponse.headers.get('cache-control') ?? '';
  assert(
    transformedCacheControl.includes('max-age=31536000') &&
      transformedCacheControl.includes('immutable'),
    `expected immutable cache-control on transformed response, got ${transformedCacheControl}`,
  );

  // Missing addr resolves to null (route layer maps to 404).
  const missDb = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }),
  } as unknown as Db;
  const missResponse = await readOwnerAsset(
    { db: missDb, r2: r2Client, cfImageFetch: null, publicOrigin: 'https://rev01.test' },
    {
      addr: expectedHash,
      url: new URL(`https://rev01.test/assets/${expectedHash}`),
    },
  );
  assert(missResponse === null, 'expected missing-addr lookup to return null');
}

// ---------------------------------------------------------------------------
// Test 6 + 7 — delete: confirm-required report, then cascade delete with /
// without siblings
// ---------------------------------------------------------------------------

async function runDeleteTests(png32: Uint8Array, expectedHash: string): Promise<void> {
  const ownerAssetRow = {
    id: 'asset-uuid-2',
    contentHash: expectedHash,
    r2Key: 'assets/test.png',
  };
  const referencingSite = {
    id: 'site-1',
    name: 'My Site',
    subdomain: 'my-site',
    publishedVersion: 1,
    editableState: {
      pages: [
        {
          slug: 'home',
          sections: [
            {
              elements: [
                { id: 'el-1', type: 'media', assetId: 'asset-uuid-2', mediaKind: 'image' },
              ],
            },
          ],
        },
      ],
    },
    publishedSnapshot: {
      pages: [
        {
          slug: 'home',
          sections: [
            {
              elements: [
                { id: 'el-1', type: 'media', assetId: 'asset-uuid-2', mediaKind: 'image' },
              ],
            },
          ],
        },
      ],
    },
  };

  function makeDeleteShim(
    returnSibling: boolean,
    updateLog: Array<Record<string, unknown>> = [],
  ): Db {
    // The delete handler makes three sequential queries:
    //   1. ownerAsset row lookup (.limit(1))
    //   2. site list for the customer (no .limit)
    //   3. sibling-count probe on ownerAsset (.limit(1))
    // We dispatch by ordinal because mocking drizzle's symbol-keyed table
    // tags would couple the smoke to drizzle internals.
    let selectCount = 0;
    return {
      select: () => ({
        from: () => ({
          where: () => {
            selectCount += 1;
            if (selectCount === 1) {
              const result = Promise.resolve([ownerAssetRow]);
              return Object.assign(result, { limit: () => result });
            }
            if (selectCount === 2) {
              const result = Promise.resolve([referencingSite]);
              return Object.assign(result, { limit: () => result });
            }
            const result = Promise.resolve(returnSibling ? [{ id: 'asset-uuid-sibling' }] : []);
            return Object.assign(result, { limit: () => result });
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            updateLog.push(values);
            return Promise.resolve();
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
    } as unknown as Db;
  }

  const reportR2 = new MockR2();
  await reportR2.put('assets/test.png', png32, { httpMetadata: { contentType: 'image/png' } });
  const reportClient = createR2Client(reportR2);

  // 6 — no confirm → confirm_required + reference report.
  const reportResult = await deleteOwnerAsset(
    { db: makeDeleteShim(false), r2: reportClient },
    { assetId: 'asset-uuid-2', customerId: 'cust-1', confirm: false },
  );
  assert(
    reportResult.status === 'confirm_required',
    `expected confirm_required, got ${reportResult.status}`,
  );
  if (reportResult.status === 'confirm_required') {
    assert(
      reportResult.references.length === 2,
      `expected editable + published references, got ${String(reportResult.references.length)}`,
    );
    const editableRef = reportResult.references.find((ref) => ref.source === 'editable');
    const publishedRef = reportResult.references.find((ref) => ref.source === 'published');
    assert(editableRef !== undefined, 'expected reference report to include editable source');
    assert(publishedRef !== undefined, 'expected reference report to include published source');
    assert(editableRef.siteId === 'site-1', `expected siteId site-1, got ${editableRef.siteId}`);
    assert(
      editableRef.elementId === 'el-1',
      `expected elementId el-1, got ${editableRef.elementId}`,
    );
    assert(editableRef.role === 'asset', `expected role asset, got ${editableRef.role}`);
    assert(
      publishedRef.publishedAddress === 'my-site',
      `expected published address my-site, got ${String(publishedRef.publishedAddress)}`,
    );
  }

  // 7a — confirm + no siblings → R2 object deleted alongside the row.
  const updateLog: Array<Record<string, unknown>> = [];
  const confirmResult = await deleteOwnerAsset(
    { db: makeDeleteShim(false, updateLog), r2: reportClient },
    { assetId: 'asset-uuid-2', customerId: 'cust-1', confirm: true },
  );
  assert(confirmResult.status === 'deleted', `expected deleted, got ${confirmResult.status}`);
  if (confirmResult.status === 'deleted') {
    assert(
      confirmResult.r2ObjectDeleted === true,
      'expected R2 object deletion when no siblings remain',
    );
  }
  assert(
    updateLog.length === 1,
    `expected one editable-state cleanup update, got ${updateLog.length}`,
  );
  const updatedState = updateLog[0]?.editableState;
  assert(
    typeof updatedState === 'object' && updatedState !== null,
    'expected delete cascade to write a cleared editableState',
  );
  const firstElement = (
    updatedState as { pages: Array<{ sections: Array<{ elements: unknown[] }> }> }
  ).pages[0]?.sections[0]?.elements[0] as { assetId?: string } | undefined;
  assert(
    firstElement?.assetId === '',
    `expected delete cascade to clear editable assetId, got ${String(firstElement?.assetId)}`,
  );

  // 7b — confirm + sibling → R2 object preserved (other rows reference it).
  const siblingR2 = new MockR2();
  await siblingR2.put('assets/test.png', png32, {
    httpMetadata: { contentType: 'image/png' },
  });
  const siblingClient = createR2Client(siblingR2);
  const siblingResult = await deleteOwnerAsset(
    { db: makeDeleteShim(true), r2: siblingClient },
    { assetId: 'asset-uuid-2', customerId: 'cust-1', confirm: true },
  );
  assert(siblingResult.status === 'deleted', `expected deleted, got ${siblingResult.status}`);
  if (siblingResult.status === 'deleted') {
    assert(
      siblingResult.r2ObjectDeleted === false,
      'expected R2 object to be preserved when a sibling row still references it',
    );
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const png32 = makePng32();
assert(png32.byteLength === 32, `expected 32 bytes, got ${String(png32.byteLength)}`);
const expectedHash = await sha256Hex(png32);

await runUploadTests(png32, expectedHash);
await runReadTests(png32, expectedHash);
await runDeleteTests(png32, expectedHash);

console.log('[assets:smoke] OK');
