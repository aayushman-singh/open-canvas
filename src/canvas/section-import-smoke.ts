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
import type { CanvasSection, MediaElement } from './schema.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const targetSiteId = 'test-target-site-id';
const existingAssetIds = new Set<string>();

for (const seed of allTemplateSeeds) {
  const sourceSection = seed.state.pages[0]?.sections[0];
  assert(sourceSection !== undefined, `${seed.id} missing page[0].sections[0]`);

  const result = importSectionIntoSite({
    targetSiteId,
    sourceSection: sourceSection as CanvasSection,
    existingAssetIds,
  });
  assert(result.ok, `import failed for ${seed.id}: ${result.ok ? '' : result.errors.join('; ')}`);
  if (!result.ok) continue;

  assert(
    result.section.id !== sourceSection.id,
    `${seed.id}: section.id was not regenerated`,
  );
  for (const element of result.section.elements) {
    if (element.type !== 'media') continue;
    const media = element as MediaElement;
    const expectedPrefix = `seed-${targetSiteId}-`;
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
    assert(row.siteId === targetSiteId, `${seed.id}: asset row siteId mismatch`);
    assert(row.id.startsWith(`seed-${targetSiteId}-`), `${seed.id}: asset row id shape wrong`);
    const rawSeedId = row.id.slice(`seed-${targetSiteId}-`.length);
    const registryEntry = SEED_ASSET_REGISTRY[rawSeedId];
    assert(registryEntry !== undefined, `${seed.id}: row references unknown raw seed ${rawSeedId}`);
    if (registryEntry !== undefined) {
      assert(row.kind === registryEntry.kind, `${seed.id}: row kind mismatch`);
      assert(
        row.bytesBase64 === registryEntry.bytesBase64,
        `${seed.id}: row bytes mismatch`,
      );
    }
  }
}

// Dedup check: same registry asset referenced from a fresh import after
// existingAssetIds is primed should not produce a duplicate row.
const seed = allTemplateSeeds[0]!;
const firstSection = seed.state.pages[0]!.sections[0] as CanvasSection;
const firstImport = importSectionIntoSite({
  targetSiteId,
  sourceSection: firstSection,
  existingAssetIds: new Set<string>(),
});
assert(firstImport.ok, 'first import must succeed');
if (firstImport.ok) {
  const seenSet = new Set(firstImport.newAssetRows.map((r) => r.id));
  const secondImport = importSectionIntoSite({
    targetSiteId,
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

console.log('section-import smoke OK');
