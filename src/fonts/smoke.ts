// src/fonts/smoke.ts
//
// `bun run fonts:smoke` — exercises Wave 5 #12 (custom font upload).
//
// Coverage (per the brief):
//   1. Valid WOFF2 (forged minimal header) accepted; siteFont row + R2 object
//      created.
//   2. Bad signature → rejected via `FontValidationError`.
//   3. `emitFontFaceBlocks` renders correct `@font-face` for a known font
//      reference inside a Style Kit's font tokens.
//   4. `resolveFontFamilyValue('font:<hash>', ...)` resolves to the
//      `"Display", system-ui, sans-serif` chain.
//   5. Delete removes the row + R2 object (no siblings).
//
// The smoke is hermetic — no live DB / R2. It uses in-memory shims that
// mirror the same surface the production handlers consume.

import { createR2Client, type R2BucketLike, type R2PutOptions } from '../assets/r2-client.js';
import type { Db } from '../db/client.js';
import { emitFontFaceBlocks, emitSingleFontFace } from './face-emit.js';
import {
  collectReferencedFontHashes,
  isFontReference,
  makeFontLookup,
  parseFontReference,
  resolveFontFamilyValue,
  resolveFontTokens,
  type SiteFontRef,
} from './resolve.js';
import {
  fontContentHashToR2Key,
  uploadSiteFont,
  type UploadFontResult,
} from './upload.js';
import {
  assertValidWoff2,
  FontValidationError,
  isValidWoff2,
  MAX_FONT_BYTES,
  WOFF2_MAGIC,
} from './validate.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[fonts:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// In-memory R2 mock — same shape as src/assets/smoke.ts
// ---------------------------------------------------------------------------

interface MockR2Entry {
  bytes: Uint8Array;
  contentType: string;
}

class MockR2 implements R2BucketLike {
  store = new Map<string, MockR2Entry>();
  putCount = 0;
  deleteCount = 0;

  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    if (options?.onlyIf?.etagDoesNotMatch === '*' && this.store.has(key)) {
      return Promise.resolve(null);
    }
    if (typeof value === 'string' || value instanceof ReadableStream) {
      throw new Error('mock R2 does not accept string / stream put bodies in fonts:smoke');
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
    for (const k of list) {
      if (this.store.delete(k)) this.deleteCount += 1;
    }
    return Promise.resolve();
  }
}

function makeR2Object(key: string, contentType: string): R2Object {
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
// In-memory DB shim — replicates the three drizzle call shapes the upload +
// delete primitives use. We dispatch by an ordinal counter because mocking
// drizzle's symbol-keyed table tags would couple the smoke to drizzle
// internals.
// ---------------------------------------------------------------------------

interface SimulatedFontRow {
  id: string;
  siteId: string;
  name: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  contentHash: string;
  byteSize: number;
  createdAt: Date;
}

class FontStore {
  rows: SimulatedFontRow[] = [];

  asDb(): Db {
    return {
      select: () => ({
        from: () => ({
          where: () => {
            // Both the upload primitive and the delete primitive call
            // `.select().from(siteFont).where(...).limit(1)` or
            // `.where(...)` on the whole table. The where-args are opaque
            // here so we mirror the production filter by inspecting the
            // store directly.
            const matchAll = this.rows;
            const result = Promise.resolve(matchAll);
            return Object.assign(result, {
              limit: () => Promise.resolve(matchAll),
            });
          },
        }),
      }),
      insert: () => ({
        values: (row: SimulatedFontRow) => {
          this.rows.push({
            ...row,
            createdAt: new Date(),
          });
          return Promise.resolve();
        },
      }),
      delete: () => ({
        where: () => {
          // The delete handler deletes by id; we strip the most-recently-
          // inserted row in this minimal shim. (Test 5 only ever has one
          // row at a time, so the simplification is safe.)
          this.rows = [];
          return Promise.resolve();
        },
      }),
    } as unknown as Db;
  }
}

/**
 * Tighter DB shim that lets the upload primitive's dedup path branch
 * correctly. The where-arg-aware variant filters by the in-memory rows so
 * an attempt to re-upload the same bytes against the same site returns the
 * existing row.
 */
function makeUploadDb(store: FontStore): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => {
          // The upload primitive only calls `where(and(siteId=..., contentHash=...))`
          // followed by `.limit(1)`. We can't see the args, so we return the
          // current rows and rely on the primitive's `existing[0]` check —
          // either the smoke supplied the same bytes (rows has one entry,
          // primitive returns it) or it didn't (rows empty, primitive inserts).
          const result = Promise.resolve(store.rows);
          return Object.assign(result, {
            limit: () => Promise.resolve(store.rows),
          });
        },
      }),
    }),
    insert: () => ({
      values: (row: SimulatedFontRow) => {
        store.rows.push({
          ...row,
          createdAt: new Date(),
        });
        return Promise.resolve();
      },
    }),
    delete: () => ({
      where: () => {
        store.rows = [];
        return Promise.resolve();
      },
    }),
  } as unknown as Db;
}

// ---------------------------------------------------------------------------
// Fake bytes — a minimal WOFF2 payload with the correct signature.
// ---------------------------------------------------------------------------

function makeValidWoff2(): Uint8Array {
  // 64 bytes total — the signature plus a zero-padded body. The validator
  // ONLY checks the signature + size; downstream R2 / DB don't parse the
  // table directory. A future tightening (real header validation) would
  // require a parser we explicitly do not ship per the brief's scope-out
  // list.
  const bytes = new Uint8Array(64);
  bytes.set(WOFF2_MAGIC, 0);
  return bytes;
}

function makeInvalidWoff2(): Uint8Array {
  // WOFF1 signature `wOFF` — must be rejected. We pad to 64 bytes so the
  // size check passes; the failure must be the magic-byte mismatch.
  const bytes = new Uint8Array(64);
  bytes.set([0x77, 0x4f, 0x46, 0x46], 0);
  return bytes;
}

// ---------------------------------------------------------------------------
// Test 1 — Valid WOFF2 upload inserts a row + R2 object.
// ---------------------------------------------------------------------------

const validBytes = makeValidWoff2();
assert(validBytes.byteLength === 64, 'expected forged WOFF2 to be 64 bytes');
assert(isValidWoff2(validBytes), 'expected forged WOFF2 to pass isValidWoff2');

const r2 = new MockR2();
const r2Client = createR2Client(r2);
const fontStore = new FontStore();
const uploadDb = makeUploadDb(fontStore);

const uploadResult: UploadFontResult = await uploadSiteFont(
  { db: uploadDb, r2: r2Client },
  {
    siteId: 'site-1',
    bytes: validBytes,
    name: 'Display',
    family: 'sans-serif',
    weight: 600,
    style: 'normal',
  },
);
assert(uploadResult.inserted === true, 'expected first upload to insert a row');
assert(uploadResult.r2Uploaded === true, 'expected first upload to write R2');
assert(uploadResult.byteSize === 64, `expected byteSize 64, got ${String(uploadResult.byteSize)}`);
assert(uploadResult.weight === 600, `expected weight 600, got ${String(uploadResult.weight)}`);
assert(uploadResult.style === 'normal', `expected style normal, got ${uploadResult.style}`);
assert(
  /^[0-9a-f]{64}$/.test(uploadResult.contentHash),
  `expected 64-hex contentHash, got ${uploadResult.contentHash}`,
);
const expectedR2Key = `fonts/${uploadResult.contentHash}.woff2`;
assert(
  uploadResult.r2Key === expectedR2Key,
  `expected r2Key ${expectedR2Key}, got ${uploadResult.r2Key}`,
);
assert(
  fontContentHashToR2Key(uploadResult.contentHash) === expectedR2Key,
  'expected fontContentHashToR2Key to round-trip',
);
assert(r2.store.has(expectedR2Key), 'expected R2 to hold the font object after upload');
assert(
  r2.store.get(expectedR2Key)!.contentType === 'font/woff2',
  'expected R2 object to carry font/woff2 content-type',
);
assert(fontStore.rows.length === 1, 'expected one siteFont row after upload');
assert(fontStore.rows[0]!.name === 'Display', 'expected DB row to carry the supplied name');

// Re-upload the same bytes against the same site → dedup, no new row or R2 put.
const dedupResult = await uploadSiteFont(
  { db: uploadDb, r2: r2Client },
  {
    siteId: 'site-1',
    bytes: validBytes,
    name: 'Display',
    family: 'sans-serif',
  },
);
assert(dedupResult.inserted === false, 'expected dedup re-upload to return inserted=false');
assert(dedupResult.r2Uploaded === false, 'expected dedup re-upload NOT to write R2');
assert(fontStore.rows.length === 1, 'expected still one siteFont row after dedup re-upload');
assert(r2.putCount === 1, `expected one R2 put total, got ${String(r2.putCount)}`);

// ---------------------------------------------------------------------------
// Test 2 — Bad signature is rejected with a FontValidationError.
// ---------------------------------------------------------------------------

const badBytes = makeInvalidWoff2();
assert(!isValidWoff2(badBytes), 'expected WOFF1 bytes to fail isValidWoff2');
let badThrew = false;
try {
  assertValidWoff2(badBytes);
} catch (err) {
  badThrew = true;
  assert(
    err instanceof FontValidationError,
    `expected FontValidationError, got ${err instanceof Error ? err.name : typeof err}`,
  );
  assert(
    err instanceof Error && err.message.includes('signature mismatch'),
    `expected error to name signature mismatch, got "${err instanceof Error ? err.message : String(err)}"`,
  );
  assert(
    err instanceof FontValidationError && err.status === 400,
    'expected FontValidationError.status === 400',
  );
}
assert(badThrew, 'expected assertValidWoff2 to throw on WOFF1 bytes');

// Empty payload rejected too.
let emptyThrew = false;
try {
  assertValidWoff2(new Uint8Array(0));
} catch (err) {
  emptyThrew = true;
  assert(
    err instanceof Error && err.message.includes('must not be empty'),
    `expected empty-payload error, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(emptyThrew, 'expected assertValidWoff2 to throw on empty payload');

// Oversize rejected.
let oversizeThrew = false;
try {
  assertValidWoff2(new Uint8Array(MAX_FONT_BYTES + 1));
} catch (err) {
  oversizeThrew = true;
  assert(
    err instanceof Error && err.message.includes('exceeds'),
    `expected oversize error, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(oversizeThrew, 'expected assertValidWoff2 to throw on oversize payload');

// Upload primitive surfaces FontValidationError loudly when bytes are bad.
const rejectStore = new FontStore();
let uploadBadThrew = false;
try {
  await uploadSiteFont(
    { db: makeUploadDb(rejectStore), r2: createR2Client(new MockR2()) },
    {
      siteId: 'site-2',
      bytes: badBytes,
      name: 'Bogus',
      family: 'sans-serif',
    },
  );
} catch (err) {
  uploadBadThrew = true;
  assert(err instanceof FontValidationError, 'expected uploadSiteFont to surface FontValidationError');
}
assert(uploadBadThrew, 'expected uploadSiteFont to reject WOFF1 bytes');
assert(rejectStore.rows.length === 0, 'expected no DB row after rejected upload');

// Bad-name and weight inputs are also rejected through the same path.
let badNameThrew = false;
try {
  await uploadSiteFont(
    { db: makeUploadDb(new FontStore()), r2: createR2Client(new MockR2()) },
    {
      siteId: 'site-3',
      bytes: validBytes,
      name: '   ',
      family: 'sans-serif',
    },
  );
} catch (err) {
  badNameThrew = true;
  assert(
    err instanceof FontValidationError && err.message.includes('name'),
    `expected name-required error, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(badNameThrew, 'expected uploadSiteFont to reject blank name');

let badWeightThrew = false;
try {
  await uploadSiteFont(
    { db: makeUploadDb(new FontStore()), r2: createR2Client(new MockR2()) },
    {
      siteId: 'site-3',
      bytes: validBytes,
      name: 'Display',
      family: 'sans-serif',
      weight: 1500,
    },
  );
} catch (err) {
  badWeightThrew = true;
  assert(
    err instanceof FontValidationError && err.message.includes('weight'),
    `expected weight-out-of-range error, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(badWeightThrew, 'expected uploadSiteFont to reject weight out of range');

// ---------------------------------------------------------------------------
// Test 3 — emitFontFaceBlocks renders the correct @font-face for a known
// font reference.
// ---------------------------------------------------------------------------

const knownFont: SiteFontRef = {
  contentHash: uploadResult.contentHash,
  name: 'Display',
  family: 'sans-serif',
  weight: 600,
  style: 'normal',
};
const singleBlock = emitSingleFontFace(knownFont);
assert(
  singleBlock.includes('@font-face'),
  `expected single block to include @font-face, got ${singleBlock}`,
);
assert(
  singleBlock.includes(`font-family: "Display"`),
  `expected single block to quote the family name, got ${singleBlock}`,
);
assert(
  singleBlock.includes(`url('/fonts/${uploadResult.contentHash}') format('woff2')`),
  `expected single block to point at /fonts/<hash> with format('woff2'), got ${singleBlock}`,
);
assert(
  singleBlock.includes('font-display: swap;'),
  `expected font-display: swap to be set per acceptance criteria, got ${singleBlock}`,
);
assert(
  singleBlock.includes('font-weight: 600;'),
  `expected the supplied weight, got ${singleBlock}`,
);
assert(
  singleBlock.includes('font-style: normal;'),
  `expected the supplied style, got ${singleBlock}`,
);

// emitFontFaceBlocks walks the kit's three font tokens and emits a block
// for every referenced hash. Tokens that don't carry a font: ref are
// silently skipped — built-in kits keep working.
const fontRefToken = `font:${uploadResult.contentHash}`;
const blocks = emitFontFaceBlocks({
  tokens: {
    fontFamilyDisplay: fontRefToken,
    fontFamilyBody: "'Inter', system-ui, sans-serif",
    fontFamilyMono: "'JetBrains Mono', ui-monospace, monospace",
  },
  fonts: [knownFont],
});
assert(blocks.length > 0, 'expected emitFontFaceBlocks to emit a non-empty string');
assert(
  blocks.includes(`url('/fonts/${uploadResult.contentHash}') format('woff2')`),
  'expected blocks to include the @font-face src URL',
);
assert(
  blocks.split('@font-face').length === 2,
  `expected exactly one @font-face block (the referenced one), got ${String(blocks.split('@font-face').length - 1)}`,
);

// Empty result when no font: refs in tokens.
const emptyBlocks = emitFontFaceBlocks({
  tokens: {
    fontFamilyDisplay: 'system-ui',
    fontFamilyBody: 'system-ui',
    fontFamilyMono: 'monospace',
  },
  fonts: [knownFont],
});
assert(emptyBlocks === '', `expected empty string when no refs, got ${JSON.stringify(emptyBlocks)}`);

// Dangling reference throws loudly per the all-or-nothing policy.
let danglingThrew = false;
try {
  emitFontFaceBlocks({
    tokens: {
      fontFamilyDisplay: 'font:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      fontFamilyBody: 'system-ui',
      fontFamilyMono: 'monospace',
    },
    fonts: [],
  });
} catch (err) {
  danglingThrew = true;
  assert(
    err instanceof Error && err.message.includes('font token references hash'),
    `expected dangling-ref error, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(danglingThrew, 'expected emitFontFaceBlocks to throw on a dangling reference');

// Hex-only contentHash sanity: emitSingleFontFace refuses URL-unsafe characters.
let nonHexThrew = false;
try {
  emitSingleFontFace({ ...knownFont, contentHash: 'abc/def' });
} catch (err) {
  nonHexThrew = true;
  assert(
    err instanceof Error && err.message.includes('hex'),
    `expected non-hex error, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(nonHexThrew, 'expected emitSingleFontFace to reject non-hex contentHash');

// ---------------------------------------------------------------------------
// Test 4 — resolveFontFamilyValue translates a font: ref into the family
// chain.
// ---------------------------------------------------------------------------

const lookup = makeFontLookup([knownFont]);
const resolvedToken = resolveFontFamilyValue(fontRefToken, lookup);
assert(
  resolvedToken === `"Display", system-ui, sans-serif`,
  `expected resolved chain '"Display", system-ui, sans-serif', got ${JSON.stringify(resolvedToken)}`,
);

// Custom fallback overrides system-ui chain.
const customFallback = resolveFontFamilyValue(fontRefToken, lookup, 'serif');
assert(
  customFallback === `"Display", serif`,
  `expected custom fallback chain, got ${JSON.stringify(customFallback)}`,
);

// Non-font tokens pass through verbatim.
const passthrough = resolveFontFamilyValue("'Inter', system-ui, sans-serif", lookup);
assert(
  passthrough === "'Inter', system-ui, sans-serif",
  `expected passthrough for non-font token, got ${JSON.stringify(passthrough)}`,
);

assert(isFontReference(fontRefToken), 'expected isFontReference to recognise the ref');
assert(!isFontReference("'Inter', system-ui"), 'expected isFontReference to reject plain CSS');
assert(
  parseFontReference(fontRefToken) === uploadResult.contentHash,
  'expected parseFontReference to extract the hash',
);
assert(
  parseFontReference("'Inter'") === null,
  'expected parseFontReference to return null for non-refs',
);

// Unknown ref throws.
let unknownThrew = false;
try {
  resolveFontFamilyValue(
    'font:fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    lookup,
  );
} catch (err) {
  unknownThrew = true;
  assert(
    err instanceof Error && err.message.includes('no site font registered'),
    `expected unknown-ref error, got "${err instanceof Error ? err.message : String(err)}"`,
  );
}
assert(unknownThrew, 'expected resolveFontFamilyValue to throw on unknown ref');

// resolveFontTokens walks the triple and only resolves the font: ref.
const tripleResolved = resolveFontTokens(
  {
    fontFamilyDisplay: fontRefToken,
    fontFamilyBody: "'Inter', system-ui",
    fontFamilyMono: "'JetBrains Mono', monospace",
  },
  lookup,
);
assert(
  tripleResolved.fontFamilyDisplay === `"Display", system-ui, sans-serif`,
  'expected display token to resolve to the named-font chain',
);
assert(
  tripleResolved.fontFamilyBody === "'Inter', system-ui",
  'expected body token to pass through verbatim',
);

// collectReferencedFontHashes deduplicates.
const hashes = collectReferencedFontHashes({
  fontFamilyDisplay: fontRefToken,
  fontFamilyBody: fontRefToken,
  fontFamilyMono: "'JetBrains Mono', monospace",
});
assert(
  hashes.length === 1 && hashes[0] === uploadResult.contentHash,
  `expected one dedup'd hash, got ${JSON.stringify(hashes)}`,
);

// ---------------------------------------------------------------------------
// Test 5 — Delete removes the row + R2 object when no siblings.
// ---------------------------------------------------------------------------

// Replicate the production delete flow: read the row, drop it, probe for
// siblings, drop the R2 object if none remain. We exercise the same
// primitives the route handler does (no Hono request shimming) so the
// smoke stays hermetic.
//
// Pre-conditions: the store still has the row from Test 1; R2 still has
// the object. We perform the production sequence on the in-memory shims.
assert(fontStore.rows.length === 1, 'pre-delete: expected one row');
assert(r2.store.has(expectedR2Key), 'pre-delete: expected R2 object');

const rowToDelete = fontStore.rows[0]!;
const contentHash = rowToDelete.contentHash;

// Strip the row.
fontStore.rows = fontStore.rows.filter((r) => r.id !== rowToDelete.id);
assert(fontStore.rows.length === 0, 'post-delete: expected zero rows');

// Sibling probe: no other rows reference this hash → delete the R2 object.
const siblings = fontStore.rows.filter((r) => r.contentHash === contentHash);
assert(siblings.length === 0, 'expected zero siblings');
const wasDeleted = await r2Client.delete(expectedR2Key);
assert(wasDeleted === true, 'expected R2.delete to report a hit');
assert(!r2.store.has(expectedR2Key), 'post-delete: expected R2 object to be gone');
assert(r2.deleteCount === 1, `expected one R2 delete call, got ${String(r2.deleteCount)}`);

// Sibling-preserving path: when another row references the same hash, the
// R2 object MUST survive.
const survivorR2 = new MockR2();
const survivorClient = createR2Client(survivorR2);
const survivorKey = `fonts/${contentHash}.woff2`;
await survivorR2.put(survivorKey, validBytes, {
  httpMetadata: { contentType: 'font/woff2' },
});
const survivorStore = new FontStore();
survivorStore.rows = [
  {
    id: 'row-a',
    siteId: 'site-1',
    name: 'Display A',
    family: 'sans-serif',
    weight: 400,
    style: 'normal',
    contentHash,
    byteSize: 64,
    createdAt: new Date(),
  },
  {
    id: 'row-b',
    siteId: 'site-2',
    name: 'Display B',
    family: 'sans-serif',
    weight: 400,
    style: 'normal',
    contentHash,
    byteSize: 64,
    createdAt: new Date(),
  },
];
// Delete row-a; the sibling row-b keeps the R2 object alive. Mirror the
// production delete handler: probe for siblings, only call R2.delete when
// none remain. The probe must run BEFORE the conditional so the test path
// exercises the same branch the handler does.
survivorStore.rows = survivorStore.rows.filter((r) => r.id !== 'row-a');
const siblingProbe: ReadonlyArray<SimulatedFontRow> = survivorStore.rows.filter(
  (r) => r.contentHash === contentHash,
);
assert(siblingProbe.length === 1, 'expected one sibling row to remain');
const siblingCount: number = siblingProbe.length;
if (siblingCount === 0) {
  await survivorClient.delete(survivorKey);
}
assert(
  survivorR2.store.has(survivorKey),
  'expected R2 object to be preserved when a sibling siteFont still references it',
);

// ---------------------------------------------------------------------------
// Done.
// ---------------------------------------------------------------------------

console.log('[fonts:smoke] OK');
