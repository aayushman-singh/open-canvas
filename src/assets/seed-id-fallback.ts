// src/assets/seed-id-fallback.ts
//
// Shared seed-id content-hash fallback used by the canvas save validator,
// the publish guard, and the editable-state read endpoint.
//
// Pre-2026-06 sites carry raw seed ids in their `editable_state` (e.g.
// `seed-hero-poster-1`, `seed-project-thumb-neutral`) because they were
// created before `prepareSeedAssetsForCustomer` rewrote those references
// into the `seed-{customerId}-{seedId}` form. The materialised owner_asset
// row exists under the prefixed id (or under a deduped existing id keyed
// by the seed's content hash), but the editable state still asks for the
// bare seed id.
//
// Without the fallback:
//   - Save validator: 400 "cannot save: missing assets" — the live bug
//     this module exists to fix. Any autosave/PUT against a legacy state
//     wipes the Owner's ability to keep editing.
//   - Read endpoint: 404 on the bare seed-id URL. PR #18 patched this in
//     isolation; this module subsumes that fix into a shared helper so
//     both paths can't drift apart again.
//
// The helper is keyed by `customer_id + content_hash` (the same unique
// constraint that backs `prepareSeedAssetsForCustomer`'s dedup logic).
// When two seed ids share bytes, they share an owner_asset row, and the
// fallback resolves any of those seed ids onto that single row.

import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { ownerAsset } from '../db/schema.js';
import { getSeedAsset } from '../canvas/seed-assets.js';
import type { OwnerAssetKind } from './kinds.js';
import type { AssetKindRow } from './site-assets.js';

/**
 * The minimum owner_asset shape the read endpoint needs to stream bytes.
 * Kept narrow so callers don't pull the full row when they only need an
 * id resolution.
 */
export interface ResolvedAssetRow {
  id: string;
  r2Key: string;
  mediaType: string;
  kind: OwnerAssetKind;
  contentHash: string;
}

/**
 * Build the (seedContentHash -> requestedSeedId) lookup table for a set
 * of requested asset ids. Only ids that exist in the seed registry
 * participate; unknown ids fall through. Exported so the validator helper
 * can compute the same set the read path uses.
 */
function seedContentHashMap(requestedIds: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const requestedId of requestedIds) {
    const seed = getSeedAsset(requestedId);
    if (seed) map.set(seed.contentHash, requestedId);
  }
  return map;
}

/**
 * Pure post-fetch mapping: given the rows returned by the helper's SQL
 * query (`{id, kind, contentHash}` for the customer-scoped owner_asset
 * rows whose id matches a requestedId OR whose content_hash matches a
 * known seed's hash), produce the `AssetKindRow[]` that
 * `findAssetReferenceErrors` expects — keyed by REQUESTED id, not the
 * underlying owner_asset.id.
 *
 * Extracted so the smoke can exercise the mapping without stubbing the
 * drizzle query builder.
 *
 * Side effect: emits a `console.warn` for every fallback hit so the live
 * worker logs surface lingering legacy refs. The warning is part of the
 * contract — the smoke asserts its presence.
 */
export function mapRowsWithSeedFallback(
  rows: readonly { id: string; kind: OwnerAssetKind; contentHash: string }[],
  requestedIds: readonly string[],
  customerId: string,
): AssetKindRow[] {
  const byId = new Map<string, { kind: OwnerAssetKind; contentHash: string }>();
  const byContentHash = new Map<string, { kind: OwnerAssetKind; contentHash: string }>();
  for (const row of rows) {
    byId.set(row.id, { kind: row.kind, contentHash: row.contentHash });
    byContentHash.set(row.contentHash, { kind: row.kind, contentHash: row.contentHash });
  }
  const result: AssetKindRow[] = [];
  for (const requestedId of requestedIds) {
    const direct = byId.get(requestedId);
    if (direct) {
      result.push({ id: requestedId, kind: direct.kind });
      continue;
    }
    const seed = getSeedAsset(requestedId);
    if (!seed) continue;
    const fallback = byContentHash.get(seed.contentHash);
    if (!fallback) continue;
    // Log loudly so the live worker logs surface lingering legacy refs.
    // The hit is acceptable — saves stay open — but the editable state
    // still carries a stale id we'd like to retire on a future
    // canvas-state migration pass.
    console.warn('[seed-id-fallback] resolved bare seed reference via content_hash', {
      customerId,
      requestedId,
      contentHash: seed.contentHash,
    });
    result.push({ id: requestedId, kind: fallback.kind });
  }
  return result;
}

/**
 * Load `{id, kind}` rows for every requested asset id, applying the
 * seed-id content-hash fallback.
 *
 * For each requested id, the returned array contains AT MOST one row.
 * The `id` field on each returned row is the REQUESTED id (not the
 * underlying owner_asset.id), so the result can be fed straight into
 * `findAssetReferenceErrors` without further translation.
 *
 * Behaviour:
 *   - Direct hit on `owner_asset.id` → returned with the row's kind.
 *   - Seed-id miss but the seed's `content_hash` row exists for this
 *     customer → returned with the row's kind, keyed by the bare seed
 *     id so the upstream validator sees it as present.
 *   - Otherwise omitted (the validator's "missing" branch fires).
 *
 * The bare seed id is intentionally kept in the editable state; the
 * autosave/PUT path does not rewrite it. Subsequent reads continue to
 * hit `resolveAssetRowForCustomer` and resolve the same way.
 */
export async function loadAssetKindsWithSeedFallback(
  database: Db,
  customerId: string,
  requestedIds: readonly string[],
): Promise<AssetKindRow[]> {
  if (requestedIds.length === 0) return [];

  const seedHashes = seedContentHashMap(requestedIds);
  const seedHashList = [...seedHashes.keys()];

  // Single query covers both lookup branches. The customer_id predicate
  // pins both to the same Owner so the content-hash branch can't leak
  // another Owner's row.
  const rows = await database
    .select({
      id: ownerAsset.id,
      kind: ownerAsset.kind,
      contentHash: ownerAsset.contentHash,
    })
    .from(ownerAsset)
    .where(
      and(
        eq(ownerAsset.customerId, customerId),
        seedHashList.length > 0
          ? or(
              inArray(ownerAsset.id, [...requestedIds]),
              inArray(ownerAsset.contentHash, seedHashList),
            )
          : inArray(ownerAsset.id, [...requestedIds]),
      ),
    );

  return mapRowsWithSeedFallback(rows, requestedIds, customerId);
}

/**
 * Resolve the owner_asset row to stream for a GET `/sites/:siteId/assets/:assetId`
 * request, applying the seed-id content-hash fallback.
 *
 * The endpoint already accepts both `owner_asset.id` and
 * `owner_asset.content_hash` as the addressable form (per ADR 0006). The
 * fallback adds a third lookup: when the requested id is a known seed
 * id and neither id-form hits, the seed's `content_hash` is added to the
 * candidate set so the deduped row resolves cleanly.
 *
 * Returns null when none of the three lookups hit. The caller is
 * responsible for the 404 response shape; this helper stays close to the
 * SQL.
 */
export async function resolveAssetRowForCustomer(
  database: Db,
  customerId: string,
  requestedAssetId: string,
): Promise<ResolvedAssetRow | null> {
  const seed = getSeedAsset(requestedAssetId);
  const seedContentHash = seed?.contentHash;

  // One query covers all three branches: id match, content_hash match
  // against the requested id (per ADR 0006), and content_hash match
  // against the known seed's hash (the fallback PR #18 introduced).
  const rows = await database
    .select({
      id: ownerAsset.id,
      r2Key: ownerAsset.r2Key,
      mediaType: ownerAsset.mediaType,
      kind: ownerAsset.kind,
      contentHash: ownerAsset.contentHash,
    })
    .from(ownerAsset)
    .where(
      and(
        eq(ownerAsset.customerId, customerId),
        seedContentHash !== undefined
          ? or(
              eq(ownerAsset.id, requestedAssetId),
              eq(ownerAsset.contentHash, requestedAssetId),
              eq(ownerAsset.contentHash, seedContentHash),
            )
          : or(eq(ownerAsset.id, requestedAssetId), eq(ownerAsset.contentHash, requestedAssetId)),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (
    seedContentHash !== undefined &&
    row.id !== requestedAssetId &&
    row.contentHash === seedContentHash
  ) {
    console.warn('[seed-id-fallback] read path resolved bare seed reference via content_hash', {
      customerId,
      requestedAssetId,
      contentHash: seedContentHash,
    });
  }
  return row;
}
