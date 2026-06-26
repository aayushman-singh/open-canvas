// src/templates/seed-bootstrap.ts
//
// Option B — DB is the source of truth for templates. The code-defined
// Template Seeds in `registry.ts` are imported ONCE into `custom_template`
// (visibility='global', publicationStatus='published') the first time the
// app needs them. From then on the picker and site creation read only from
// the DB; the seed code is just the bootstrap source.
//
// Idempotency: each imported row carries `source_template_id = seed.id`.
// A seed that already has a row (including one a curator has since edited)
// is skipped, so re-running this never clobbers DB edits or double-imports.
//
// `source_template_id` is also kept for a second reason: page-bound
// collection content (e.g. the portfolio-showcase blog) lives in
// `TEMPLATE_SEED_ENTRIES`, not in the EditableSite. Site creation re-injects
// those rows by looking up the seed id (see routes/api/sites.ts).

import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { customTemplate, ownerAsset } from '../db/schema.js';
import { allTemplateSeeds, instantiateTemplate } from './registry.js';
import { prepareSeedAssetsForCustomer } from './seed-asset-materialization.js';
import { buildAssetManifest } from './custom-template-assets.js';

let bootstrapPromise: Promise<void> | null = null;

/**
 * Ensure every code-defined Template Seed has a published global
 * `custom_template` row. Guarded so concurrent requests share one run;
 * a thrown error clears the guard so the next request retries.
 */
export async function ensureBuiltInTemplatesSeeded(
  database: Db,
  custodianId: string,
): Promise<void> {
  if (bootstrapPromise === null) {
    bootstrapPromise = seedBuiltInTemplates(database, custodianId).catch((err) => {
      bootstrapPromise = null;
      throw err;
    });
  }
  await bootstrapPromise;
}

async function seedBuiltInTemplates(database: Db, custodianId: string): Promise<void> {
  const existingRows = await database
    .select({ sourceTemplateId: customTemplate.sourceTemplateId })
    .from(customTemplate);
  const alreadySeeded = new Set(
    existingRows
      .map((r) => r.sourceTemplateId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  for (const seed of allTemplateSeeds) {
    if (alreadySeeded.has(seed.id)) continue;

    const existingAssets = await database
      .select({ id: ownerAsset.id, contentHash: ownerAsset.contentHash })
      .from(ownerAsset)
      .where(eq(ownerAsset.customerId, custodianId));
    const existingByHash = new Map(existingAssets.map((r) => [r.contentHash, r.id]));

    const state = instantiateTemplate(seed.id);
    const prepared = prepareSeedAssetsForCustomer(custodianId, state, existingByHash);
    if (!prepared.ok) {
      throw new Error(
        `seed-bootstrap: asset prep failed for '${seed.id}': ${JSON.stringify({
          unknownSeedIds: prepared.unknownSeedIds,
          assetKindErrors: prepared.assetKindErrors,
        })}`,
      );
    }

    if (prepared.seedRows.length > 0) {
      await database.insert(ownerAsset).values(prepared.seedRows).onConflictDoNothing();
    }

    const manifest = await buildAssetManifest(database, custodianId, prepared.editableState);

    await database
      .insert(customTemplate)
      .values({
        customerId: null,
        visibility: 'global',
        publicationStatus: 'published',
        sourceTemplateId: seed.id,
        name: seed.name,
        tagline: seed.tagline,
        styleKit: prepared.editableState.styleKit,
        siteState: prepared.editableState,
        assetManifest: manifest,
      })
      .onConflictDoNothing();
  }
}
