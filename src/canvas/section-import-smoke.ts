// src/canvas/section-import-smoke.ts
//
// Manual smoke: clone a section from each template seed into a fresh target
// site, assert IDs are regenerated, assert every media element's assetId is
// remapped to the target site's materialised seed-<siteId>-<rawSeedId> form,
// and assert the new asset rows match the registry contents. Run with
// `bun.cmd run section-import:smoke`.

import { allTemplateSeeds } from '../templates/registry.js';
import { SEED_ASSET_REGISTRY } from './seed-assets.js';
import { importSectionIntoSite } from './section-import.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const targetCustomerId = 'test-target-customer-id';
const existingAssetIds = new Set<string>();

for (const seed of allTemplateSeeds) {
  const sourceSection = seed.state.pages[0]?.sections[0];
  assert(sourceSection !== undefined, `${seed.id} missing page[0].sections[0]`);

  const result = importSectionIntoSite({
    targetCustomerId,
    sourceSection: sourceSection,
    existingAssetIds,
  });
  assert(result.ok, `import failed for ${seed.id}: ${result.ok ? '' : result.errors.join('; ')}`);

  assert(result.section.id !== sourceSection.id, `${seed.id}: section.id was not regenerated`);
  for (const element of result.section.elements) {
    if (element.type !== 'media') continue;
    const media = element;
    const expectedPrefix = `seed-${targetCustomerId}-`;
    assert(
      media.assetId.startsWith(expectedPrefix),
      `${seed.id}: media.assetId "${media.assetId}" not remapped`,
    );
    if (media.posterAssetId !== undefined) {
      assert(
        media.posterAssetId.startsWith(expectedPrefix),
        `${seed.id}: media.posterAssetId "${media.posterAssetId}" not remapped`,
      );
    }
  }

  for (const row of result.newAssetRows) {
    assert(
      row.customerId === targetCustomerId,
      `${seed.id}: asset row customerId mismatch`,
    );
    assert(
      row.id.startsWith(`seed-${targetCustomerId}-`),
      `${seed.id}: asset row id shape wrong`,
    );
    const rawSeedId = row.id.slice(`seed-${targetCustomerId}-`.length);
    const registryEntry = SEED_ASSET_REGISTRY[rawSeedId];
    assert(registryEntry !== undefined, `${seed.id}: row references unknown raw seed ${rawSeedId}`);
    if (registryEntry !== undefined) {
      assert(row.kind === registryEntry.kind, `${seed.id}: row kind mismatch`);
      assert(
        row.contentHash === registryEntry.contentHash,
        `${seed.id}: row contentHash mismatch`,
      );
      assert(row.r2Key === registryEntry.r2Key, `${seed.id}: row r2Key mismatch`);
      assert(row.byteSize === registryEntry.byteSize, `${seed.id}: row byteSize mismatch`);
    }
  }
}

// Dedup check: same registry asset referenced from a fresh import after
// existingAssetIds is primed should not produce a duplicate row.
const seed = allTemplateSeeds[0];
const firstSection = seed.state.pages[0]!.sections[0]!;
const firstImport = importSectionIntoSite({
  targetCustomerId,
  sourceSection: firstSection,
  existingAssetIds: new Set<string>(),
});
assert(firstImport.ok, 'first import must succeed');
if (firstImport.ok) {
  const seenSet = new Set(firstImport.newAssetRows.map((r) => r.id));
  const secondImport = importSectionIntoSite({
    targetCustomerId,
    sourceSection: firstSection,
    existingAssetIds: seenSet,
  });
  assert(secondImport.ok, 'second import must succeed');
  if (secondImport.ok) {
    assert(
      secondImport.newAssetRows.length === 0,
      `dedup failed: produced ${secondImport.newAssetRows.length} rows when all should be skipped`,
    );
  }
}

// Verify rolePrefix preserves semantic names (regression guard for the
// previous /^[a-z0-9]{4,}$/i bug that stripped words like "heading" and
// "primary").
{
  const heroSeed = allTemplateSeeds[0];
  const heroSection = heroSeed.state.pages[0]!.sections[0]!;
  const out = importSectionIntoSite({
    targetCustomerId,
    sourceSection: heroSection,
    existingAssetIds: new Set<string>(),
  });
  assert(out.ok, 'hero import for regex regression test must succeed');
  if (out.ok) {
    const originalIds = heroSection.elements.map((e) => e.id);
    const newIds = out.section.elements.map((e) => e.id);
    for (let i = 0; i < originalIds.length; i += 1) {
      const original = originalIds[i]!;
      const fresh = newIds[i]!;
      assert(fresh !== original, `element id ${original} must be regenerated`);
      assert(
        fresh.startsWith(original + '-'),
        `element id ${original} must retain its full semantic prefix; got ${fresh}`,
      );
    }
  }
}

console.log('section-import smoke OK');
