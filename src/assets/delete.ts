// src/assets/delete.ts
//
// DELETE /api/owner/assets/:id — confirm-cascade delete per ADR 0004
// decision 3. The flow:
//
//   1. Find the ownerAsset row by (id, customerId). 404 if not found.
//   2. Compute the affected-sites + affected-pages report by scanning every
//      site the Owner owns and collecting every MediaElement whose
//      `assetId` or `posterAssetId` equals this id.
//   3. When the caller did not pass `?confirm=1`: return 412 with the
//      report. The editor displays "this asset is used in N slots across M
//      sites" and asks the Owner to re-submit with `confirm=1`.
//   4. When `confirm=1`: delete the row (cascade drops slot_history rows),
//      and delete the R2 object UNLESS another ownerAsset row references
//      the same contentHash (cross-Owner shared bytes).

import { and, eq, ne } from 'drizzle-orm';
import type { R2Client } from './r2-client.js';
import type { Db } from '../db/client.js';
import { ownerAsset, site } from '../db/schema.js';
import type { CanvasSiteState } from '../canvas/schema.js';

export interface DeleteAssetDeps {
  db: Db;
  r2: R2Client;
}

export interface DeleteAssetInput {
  assetId: string;
  customerId: string;
  /** When `false`, the route returns a 412 with the reference report. */
  confirm: boolean;
}

export interface AssetReference {
  siteId: string;
  siteName: string;
  pageSlug: string;
  elementId: string;
  role: 'asset' | 'poster';
}

export type DeleteAssetResult =
  | { status: 'not_found' }
  | {
      status: 'confirm_required';
      references: AssetReference[];
    }
  | {
      status: 'deleted';
      references: AssetReference[];
      r2ObjectDeleted: boolean;
    };

export async function deleteOwnerAsset(
  deps: DeleteAssetDeps,
  input: DeleteAssetInput,
): Promise<DeleteAssetResult> {
  const rows = await deps.db
    .select({
      id: ownerAsset.id,
      contentHash: ownerAsset.contentHash,
      r2Key: ownerAsset.r2Key,
    })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.id, input.assetId), eq(ownerAsset.customerId, input.customerId)))
    .limit(1);
  const row = rows[0];
  if (!row) return { status: 'not_found' };

  const references = await collectAssetReferences(deps.db, input.customerId, input.assetId);
  if (!input.confirm) {
    return { status: 'confirm_required', references };
  }

  // Cascade deletes drop slot_history rows automatically.
  await deps.db.delete(ownerAsset).where(eq(ownerAsset.id, input.assetId));

  // Only delete the R2 object when no other ownerAsset row anywhere
  // (any Owner) still references the same contentHash. A different Owner's
  // shared row keeps the bytes alive — orphan-cleanup is a future ADR.
  const siblings = await deps.db
    .select({ id: ownerAsset.id })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.contentHash, row.contentHash), ne(ownerAsset.id, input.assetId)))
    .limit(1);
  let r2ObjectDeleted = false;
  if (siblings.length === 0) {
    r2ObjectDeleted = await deps.r2.delete(row.r2Key);
  }
  return { status: 'deleted', references, r2ObjectDeleted };
}

async function collectAssetReferences(
  db: Db,
  customerId: string,
  assetId: string,
): Promise<AssetReference[]> {
  const ownerSites = await db
    .select({
      id: site.id,
      name: site.name,
      editableState: site.editableState,
      publishedSnapshot: site.publishedSnapshot,
    })
    .from(site)
    .where(eq(site.customerId, customerId));

  const out: AssetReference[] = [];
  for (const siteRow of ownerSites) {
    collectFromPages(out, siteRow.id, siteRow.name, siteRow.editableState, assetId);
    if (siteRow.publishedSnapshot) {
      collectFromPages(out, siteRow.id, siteRow.name, siteRow.publishedSnapshot, assetId);
    }
  }
  return out;
}

function collectFromPages(
  out: AssetReference[],
  siteId: string,
  siteName: string,
  state: CanvasSiteState | { pages: CanvasSiteState['pages'] },
  assetId: string,
): void {
  const seen = new Set<string>();
  for (const page of state.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.type !== 'media') continue;
        if (element.assetId === assetId) {
          const key = `${page.slug}|${element.id}|asset`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ siteId, siteName, pageSlug: page.slug, elementId: element.id, role: 'asset' });
          }
        }
        if (element.posterAssetId === assetId) {
          const key = `${page.slug}|${element.id}|poster`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ siteId, siteName, pageSlug: page.slug, elementId: element.id, role: 'poster' });
          }
        }
      }
    }
  }
}
