// src/canvas/section-import-smoke.ts
//
// Manual smoke: clone a section from each template seed into a fresh target
// site, assert IDs are regenerated, assert every media element's assetId is
// remapped to the target site's materialised seed-<siteId>-<rawSeedId> form,
// and assert the new asset rows match the registry contents. Run with
// `bun.cmd run section-import:smoke`.

import { allTemplateSeeds } from '../templates/registry.js';
import { SEED_ASSET_REGISTRY } from './seed-assets.js';
import { importLibrarySectionIntoSite } from './library-section-import.js';
import { importSectionIntoSite } from './section-import.js';
import type { CanvasSection } from './schema.js';

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
    existingByHash: new Map(),
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
    if (media.mediaKind === 'video' && media.posterAssetId !== undefined) {
      assert(
        media.posterAssetId.startsWith(expectedPrefix),
        `${seed.id}: media.posterAssetId "${media.posterAssetId}" not remapped`,
      );
    }
  }

  for (const row of result.newAssetRows) {
    assert(row.customerId === targetCustomerId, `${seed.id}: asset row customerId mismatch`);
    assert(row.id.startsWith(`seed-${targetCustomerId}-`), `${seed.id}: asset row id shape wrong`);
    const rawSeedId = row.id.slice(`seed-${targetCustomerId}-`.length);
    const registryEntry = SEED_ASSET_REGISTRY[rawSeedId];
    assert(registryEntry !== undefined, `${seed.id}: row references unknown raw seed ${rawSeedId}`);
    if (registryEntry !== undefined) {
      assert(row.kind === registryEntry.kind, `${seed.id}: row kind mismatch`);
      assert(row.contentHash === registryEntry.contentHash, `${seed.id}: row contentHash mismatch`);
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
  existingByHash: new Map(),
});
assert(firstImport.ok, 'first import must succeed');
if (firstImport.ok) {
  const seenSet = new Set(firstImport.newAssetRows.map((r) => r.id));
  const seenByHash = new Map(firstImport.newAssetRows.map((r) => [r.contentHash, r.id]));
  const secondImport = importSectionIntoSite({
    targetCustomerId,
    sourceSection: firstSection,
    existingAssetIds: seenSet,
    existingByHash: seenByHash,
  });
  assert(secondImport.ok, 'second import must succeed');
  if (secondImport.ok) {
    assert(
      secondImport.newAssetRows.length === 0,
      `dedup failed: produced ${secondImport.newAssetRows.length} rows when all should be skipped`,
    );
  }
}

{
  const headerSection: CanvasSection = {
    id: 'section-reusable-header',
    recipeId: 'custom',
    name: 'Reusable Header',
    height: 80,
    role: 'header',
    elements: [],
  };
  const seedImport = importSectionIntoSite({
    targetCustomerId,
    sourceSection: headerSection,
    existingAssetIds: new Set<string>(),
    existingByHash: new Map(),
  });
  assert(seedImport.ok, 'seed import with header role must succeed');
  if (seedImport.ok) {
    assert(
      seedImport.section.role === undefined,
      'seed section import must strip header/footer role from cloned reusable content',
    );
  }

  const libraryImport = importLibrarySectionIntoSite({
    targetCustomerId,
    sourceSection: headerSection,
    assetManifest: [],
    existingAssetsByHash: new Map(),
  });
  assert(libraryImport.ok, 'library import with header role must succeed');
  if (libraryImport.ok) {
    assert(
      libraryImport.section.role === undefined,
      'library section import must strip header/footer role from cloned reusable content',
    );
  }
}

{
  const section: CanvasSection = {
    id: 'section-library-duplicate-hash',
    recipeId: 'feature-grid',
    name: 'Duplicate hash media',
    height: 480,
    elements: [
      {
        id: 'media-a',
        type: 'media',
        mediaKind: 'image',
        assetId: 'source-asset-a',
        alt: 'First',
        fit: 'cover',
        box: { x: 0, y: 0, w: 240, h: 180, z: 1 },
      },
      {
        id: 'media-b',
        type: 'media',
        mediaKind: 'image',
        assetId: 'source-asset-b',
        alt: 'Second',
        fit: 'cover',
        box: { x: 260, y: 0, w: 240, h: 180, z: 2 },
      },
    ],
  };
  const result = importLibrarySectionIntoSite({
    targetCustomerId,
    sourceSection: section,
    assetManifest: [
      {
        assetId: 'source-asset-a',
        contentHash: 'same-content-hash',
        r2Key: 'assets/same-content-hash.png',
        mediaType: 'image/png',
        kind: 'image',
        alt: 'First',
        width: 240,
        height: 180,
        byteSize: 1024,
      },
      {
        assetId: 'source-asset-b',
        contentHash: 'same-content-hash',
        r2Key: 'assets/same-content-hash.png',
        mediaType: 'image/png',
        kind: 'image',
        alt: 'Second',
        width: 240,
        height: 180,
        byteSize: 1024,
      },
    ],
    existingAssetsByHash: new Map(),
  });
  assert(result.ok, 'library duplicate-hash import must succeed');
  if (result.ok) {
    assert(
      result.newAssetRows.length === 1,
      `expected duplicate content hash to create one owner asset row, got ${result.newAssetRows.length}`,
    );
    const mediaElements = result.section.elements.filter((element) => element.type === 'media');
    assert(mediaElements.length === 2, 'expected two media elements after library import');
    const first = mediaElements[0]!;
    const second = mediaElements[1]!;
    assert(
      first.assetId === second.assetId,
      `expected duplicate content hash refs to map to one target asset id, got ${first.assetId} and ${second.assetId}`,
    );
    assert(
      first.assetId !== 'source-asset-a' && second.assetId !== 'source-asset-b',
      'expected library import not to preserve source owner asset ids',
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
    existingByHash: new Map(),
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
