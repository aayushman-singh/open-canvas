// scripts/backfill-template-manifests.ts
//
// One-off data repair: recompute `asset_manifest` for every global seeded
// `custom_template` row.
//
// Root cause (fixed in src/templates/custom-template-assets.ts): the original
// `collectAssetIds` only walked `media`-type elements in page sections, so the
// manifest written by `buildAssetManifest` during the seed bootstrap dropped
// every asset referenced elsewhere — backgroundImage, nav logo, carousel
// slides, tabs/collection nested media, section background video, header /
// footer, ogImage, favicon. Templates like velocity-athlete reference study
// images inside a collection's `customTemplate`/`entries`, so their stored
// manifest was incomplete and site creation rejected them with
// "custom template references asset ids missing from its manifest".
//
// The code fix makes future seeds correct. This script repairs the rows
// already seeded into the DB by recomputing the manifest with the fixed
// builder (the underlying owner_asset rows were always materialised in full,
// only the manifest projection was lossy) and UPDATEing rows whose manifest
// grew. Idempotent — re-running once the data is correct is a no-op.
//
// Usage:
//   bun run scripts/backfill-template-manifests.ts            # dry-run report
//   bun run scripts/backfill-template-manifests.ts --apply    # write changes
//
// Requires DATABASE_URL + TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID in the env
// (.dev.vars works; the DATABASE_URL there tunnels to the production DB).

import { and, eq } from 'drizzle-orm';

import { db } from '../src/db/client.js';
import { customTemplate } from '../src/db/schema.js';
import { buildAssetManifest } from '../src/templates/custom-template-assets.js';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required in the environment.');
  }
  const custodianId = process.env['TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID'];
  if (!custodianId || custodianId.length === 0) {
    throw new Error('TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID is required in the environment.');
  }
  const apply = process.argv.includes('--apply');

  const database = db({ DATABASE_URL: databaseUrl });

  const rows = await database
    .select({
      id: customTemplate.id,
      name: customTemplate.name,
      sourceTemplateId: customTemplate.sourceTemplateId,
      siteState: customTemplate.siteState,
      assetManifest: customTemplate.assetManifest,
    })
    .from(customTemplate)
    .where(eq(customTemplate.visibility, 'global'));

  console.log(
    `[backfill-manifests] scanning ${String(rows.length)} global template${rows.length === 1 ? '' : 's'}${apply ? '' : ' (dry-run)'}`,
  );

  let touched = 0;
  for (const row of rows) {
    const before = row.assetManifest;
    const after = await buildAssetManifest(database, custodianId, row.siteState);

    const beforeIds = new Set(before.map((e) => e.assetId));
    const afterIds = new Set(after.map((e) => e.assetId));
    const added = [...afterIds].filter((id) => !beforeIds.has(id)).sort();
    const removed = [...beforeIds].filter((id) => !afterIds.has(id)).sort();

    if (added.length === 0 && removed.length === 0) continue;

    touched += 1;
    console.log(
      `  ${row.sourceTemplateId ?? '(no-source)'} "${row.name}" — manifest ${String(before.length)} -> ${String(after.length)} entries`,
    );
    if (added.length > 0) console.log(`      + ${added.join(', ')}`);
    if (removed.length > 0) console.log(`      - ${removed.join(', ')}`);

    if (!apply) continue;

    await database
      .update(customTemplate)
      .set({ assetManifest: after, updatedAt: new Date() })
      .where(and(eq(customTemplate.id, row.id), eq(customTemplate.visibility, 'global')));
  }

  console.log('');
  console.log(
    `[backfill-manifests] ${apply ? 'UPDATED' : 'WOULD UPDATE'} ${String(touched)} template${touched === 1 ? '' : 's'}`,
  );
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
