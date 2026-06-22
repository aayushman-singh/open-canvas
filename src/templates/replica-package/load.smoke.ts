import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadReplicaPackage } from './load.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[replica-package-load:smoke] ${message}`);
}

async function runNegativeTest(
  testNum: number,
  description: string,
  overrides: {
    replicaJson?: Record<string, unknown>;
    pages?: Record<string, unknown>;
    sections?: Record<string, unknown>;
    fidelityLedgerJson?: unknown[];
    unsupportedJson?: unknown[];
    skipFiles?: string[];
  },
  expectedError: string,
) {
  const badRoot = await mkdtemp(join(tmpdir(), `replica-test-${testNum}-`));

  if (!overrides.skipFiles?.includes('pages')) {
    await mkdir(join(badRoot, 'pages'), { recursive: true });
  }
  if (!overrides.skipFiles?.includes('sections')) {
    await mkdir(join(badRoot, 'sections'), { recursive: true });
  }
  await mkdir(join(badRoot, 'assets'), { recursive: true });

  const defaultReplica = {
    id: 'test-replica',
    name: 'Test Replica',
    tagline: 'A robust test package',
    source: { kind: 'url', url: 'https://example.test' },
    targets: ['seed'],
    styleKit: 'charcoal',
    pageOrder: ['home'],
    requiredCopy: [],
    requiredAssetIds: [],
    forbiddenRuntimeTokens: [],
    assets: [],
  };

  const defaultPage = {
    id: 'home-page',
    slug: 'home',
    title: 'Home Page',
    width: 1440,
    sections: ['test-section'],
  };

  const defaultSection = {
    baseSlug: 'test-section',
    category: 'hero',
    name: 'Test Section',
    description: 'A robust test section',
    recipeId: 'test-recipe',
    headingPreview: 'Hello Test',
    sectionData: {},
    assetManifest: [],
  };

  const replicaData = { ...defaultReplica, ...overrides.replicaJson };
  const pageData = { ...defaultPage, ...(overrides.pages?.['home'] as Record<string, unknown> || {}) };
  const sectionData = { ...defaultSection, ...(overrides.sections?.['test-section'] as Record<string, unknown> || {}) };

  if (!overrides.skipFiles?.includes('replica.json')) {
    await writeFile(join(badRoot, 'replica.json'), JSON.stringify(replicaData), 'utf8');
  }

  if (!overrides.skipFiles?.includes('pages') && overrides.pages !== null) {
    const pageName = 'home';
    await writeFile(join(badRoot, 'pages', `${pageName}.json`), JSON.stringify(pageData), 'utf8');
  }

  if (!overrides.skipFiles?.includes('sections') && overrides.sections !== null) {
    const sectionName = 'test-section';
    await writeFile(join(badRoot, 'sections', `${sectionName}.json`), JSON.stringify(sectionData), 'utf8');
  }

  if (!overrides.skipFiles?.includes('fidelity-ledger.json')) {
    await writeFile(join(badRoot, 'fidelity-ledger.json'), JSON.stringify(overrides.fidelityLedgerJson || []), 'utf8');
  }

  if (!overrides.skipFiles?.includes('unsupported.json')) {
    await writeFile(join(badRoot, 'unsupported.json'), JSON.stringify(overrides.unsupportedJson || []), 'utf8');
  }

  let failed = false;
  let errorMsg = '';
  try {
    await loadReplicaPackage(badRoot);
  } catch (error) {
    failed = true;
    if (error instanceof Error) {
      errorMsg = error.message;
    }
  }

  assert(failed, `Test ${testNum} (${description}): loader must fail but it succeeded.`);
  assert(
    errorMsg.includes(expectedError),
    `Test ${testNum} (${description}): expected error to contain "${expectedError}" but got "${errorMsg}"`,
  );
  console.log(`[replica-package-load:smoke] Test ${testNum} (${description}) passed!`);
}

console.log('Starting replica package loader smoke tests...');

// ==================== Positive Test ====================
// Test 1: Load tiny-replica (Positive case)
const tiny = await loadReplicaPackage('src/templates/replicas/tiny-replica');
assert(tiny.metadata.id === 'tiny-replica', 'loader must read replica metadata id');
assert(tiny.pages.length === 1 && tiny.pages[0]?.slug === 'home', 'loader must read pages by pageOrder');
assert(tiny.sections.length === 1, 'loader must read one section');
assert(tiny.sections[0]?.baseSlug === 'tiny-replica-hero', 'loader must preserve section baseSlug');
assert(tiny.metadata.assets[0]?.id === 'seed-tiny-replica-mark', 'loader must read asset declarations');
assert(tiny.fidelityLedger.some((item) => item.status === 'native'), 'loader must read native fidelity row');
assert(tiny.unsupported[0]?.id === 'custom-cursor', 'loader must read unsupported findings');
console.log('[replica-package-load:smoke] Test 1 (Positive Load) passed!');

// ==================== Finding 1: Asset sourcePath Validation Tests ====================
// Test 2: Declared asset sourcePath file is missing
await runNegativeTest(
  2,
  'missing asset file',
  {
    replicaJson: {
      assets: [{ id: 'seed-test-mark', sourcePath: 'missing-mark.png', mediaType: 'image/png', kind: 'image', width: 10, height: 10, alt: 'Missing mark' }]
    }
  },
  'asset file "missing-mark.png" does not exist',
);

// Test 3: Asset sourcePath escapes assets directory (relative traversal)
await runNegativeTest(
  3,
  'asset path escape via relative traversal',
  {
    replicaJson: {
      assets: [{ id: 'seed-test-mark', sourcePath: '../outside.png', mediaType: 'image/png', kind: 'image', width: 10, height: 10, alt: 'escape' }]
    }
  },
  'escapes assets directory',
);

// Test 4: Asset sourcePath is an absolute path
await runNegativeTest(
  4,
  'asset path escape via absolute path',
  {
    replicaJson: {
      assets: [{ id: 'seed-test-mark', sourcePath: '/etc/passwd', mediaType: 'image/png', kind: 'image', width: 10, height: 10, alt: 'absolute path' }]
    }
  },
  'is an absolute path or escape attempt',
);

// ==================== Finding 2: Duplicate ID protections ====================
// Test 5: Duplicate asset IDs
await runNegativeTest(
  5,
  'duplicate asset IDs',
  {
    replicaJson: {
      assets: [
        { id: 'seed-test-mark', sourcePath: 'mark.svg', mediaType: 'image/svg+xml', kind: 'image', width: 10, height: 10, alt: 'Mark 1' },
        { id: 'seed-test-mark', sourcePath: 'mark.svg', mediaType: 'image/svg+xml', kind: 'image', width: 10, height: 10, alt: 'Mark 2' }
      ]
    }
  },
  'replica-package: duplicate asset id "seed-test-mark"',
);

// Test 6: Duplicate pageOrder entries
await runNegativeTest(
  6,
  'duplicate pageOrder entries',
  {
    replicaJson: { pageOrder: ['home', 'home'] }
  },
  'replica-package: duplicate pageOrder entry "home"',
);

// Test 7: Duplicate page IDs
{
  const testRoot = await mkdtemp(join(tmpdir(), `replica-test-7-`));
  await mkdir(join(testRoot, 'pages'), { recursive: true });
  await mkdir(join(testRoot, 'sections'), { recursive: true });
  await mkdir(join(testRoot, 'assets'), { recursive: true });
  await writeFile(join(testRoot, 'replica.json'), JSON.stringify({
    id: 'test-replica',
    name: 'Test',
    tagline: 'tagline',
    source: { kind: 'url', url: 'https://example.test' },
    targets: ['seed'],
    styleKit: 'charcoal',
    pageOrder: ['home', 'about'],
    requiredCopy: [],
    requiredAssetIds: [],
    forbiddenRuntimeTokens: [],
    assets: [],
  }), 'utf8');
  await writeFile(join(testRoot, 'pages', 'home.json'), JSON.stringify({ id: 'dupe-id', slug: 'home', title: 'Home', width: 1440, sections: ['test-section'] }), 'utf8');
  await writeFile(join(testRoot, 'pages', 'about.json'), JSON.stringify({ id: 'dupe-id', slug: 'about', title: 'About', width: 1440, sections: ['test-section'] }), 'utf8');
  await writeFile(join(testRoot, 'sections', 'test-section.json'), JSON.stringify({ baseSlug: 'test-section', category: 'hero', name: 'TS', description: 'desc', recipeId: 'rec', headingPreview: 'prev', sectionData: {}, assetManifest: [] }), 'utf8');
  await writeFile(join(testRoot, 'fidelity-ledger.json'), '[]', 'utf8');
  await writeFile(join(testRoot, 'unsupported.json'), '[]', 'utf8');

  let failed = false;
  try {
    await loadReplicaPackage(testRoot);
  } catch (error) {
    if (error instanceof Error && error.message.includes('replica-package: duplicate page id "dupe-id"')) {
      failed = true;
    }
  }
  assert(failed, 'Test 7 (duplicate page IDs) failed to trigger expected error');
  console.log('[replica-package-load:smoke] Test 7 (duplicate page IDs) passed!');
}

// Test 8: Duplicate page slugs
{
  const testRoot = await mkdtemp(join(tmpdir(), `replica-test-8-`));
  await mkdir(join(testRoot, 'pages'), { recursive: true });
  await mkdir(join(testRoot, 'sections'), { recursive: true });
  await mkdir(join(testRoot, 'assets'), { recursive: true });
  await writeFile(join(testRoot, 'replica.json'), JSON.stringify({
    id: 'test-replica',
    name: 'Test',
    tagline: 'tagline',
    source: { kind: 'url', url: 'https://example.test' },
    targets: ['seed'],
    styleKit: 'charcoal',
    pageOrder: ['home', 'about'],
    requiredCopy: [],
    requiredAssetIds: [],
    forbiddenRuntimeTokens: [],
    assets: [],
  }), 'utf8');
  await writeFile(join(testRoot, 'pages', 'home.json'), JSON.stringify({ id: 'home', slug: 'same-slug', title: 'Home', width: 1440, sections: ['test-section'] }), 'utf8');
  await writeFile(join(testRoot, 'pages', 'about.json'), JSON.stringify({ id: 'about', slug: 'same-slug', title: 'About', width: 1440, sections: ['test-section'] }), 'utf8');
  await writeFile(join(testRoot, 'sections', 'test-section.json'), JSON.stringify({ baseSlug: 'test-section', category: 'hero', name: 'TS', description: 'desc', recipeId: 'rec', headingPreview: 'prev', sectionData: {}, assetManifest: [] }), 'utf8');
  await writeFile(join(testRoot, 'fidelity-ledger.json'), '[]', 'utf8');
  await writeFile(join(testRoot, 'unsupported.json'), '[]', 'utf8');

  let failed = false;
  try {
    await loadReplicaPackage(testRoot);
  } catch (error) {
    if (error instanceof Error && error.message.includes('replica-package: duplicate page slug "same-slug"')) {
      failed = true;
    }
  }
  assert(failed, 'Test 8 (duplicate page slugs) failed to trigger expected error');
  console.log('[replica-package-load:smoke] Test 8 (duplicate page slugs) passed!');
}

// Test 9: Duplicate section baseSlug values
{
  const testRoot = await mkdtemp(join(tmpdir(), `replica-test-9-`));
  await mkdir(join(testRoot, 'pages'), { recursive: true });
  await mkdir(join(testRoot, 'sections'), { recursive: true });
  await mkdir(join(testRoot, 'assets'), { recursive: true });
  await writeFile(join(testRoot, 'replica.json'), JSON.stringify({
    id: 'test-replica',
    name: 'Test',
    tagline: 'tagline',
    source: { kind: 'url', url: 'https://example.test' },
    targets: ['seed'],
    styleKit: 'charcoal',
    pageOrder: ['home'],
    requiredCopy: [],
    requiredAssetIds: [],
    forbiddenRuntimeTokens: [],
    assets: [],
  }), 'utf8');
  await writeFile(join(testRoot, 'pages', 'home.json'), JSON.stringify({ id: 'home', slug: 'home', title: 'Home', width: 1440, sections: ['test-section-1', 'test-section-2'] }), 'utf8');
  await writeFile(join(testRoot, 'sections', 's1.json'), JSON.stringify({ baseSlug: 'same-slug', category: 'hero', name: 'TS', description: 'desc', recipeId: 'rec', headingPreview: 'prev', sectionData: {}, assetManifest: [] }), 'utf8');
  await writeFile(join(testRoot, 'sections', 's2.json'), JSON.stringify({ baseSlug: 'same-slug', category: 'hero', name: 'TS', description: 'desc', recipeId: 'rec', headingPreview: 'prev', sectionData: {}, assetManifest: [] }), 'utf8');
  await writeFile(join(testRoot, 'fidelity-ledger.json'), '[]', 'utf8');
  await writeFile(join(testRoot, 'unsupported.json'), '[]', 'utf8');

  let failed = false;
  try {
    await loadReplicaPackage(testRoot);
  } catch (error) {
    if (error instanceof Error && error.message.includes('replica-package: duplicate section baseSlug "same-slug"')) {
      failed = true;
    }
  }
  assert(failed, 'Test 9 (duplicate section baseSlugs) failed to trigger expected error');
  console.log('[replica-package-load:smoke] Test 9 (duplicate section baseSlugs) passed!');
}

// Test 10: Duplicate section references per page
await runNegativeTest(
  10,
  'duplicate page section references',
  {
    pages: { home: { sections: ['test-section', 'test-section'] } }
  },
  'replica-package: page "home" has duplicate section reference "test-section"',
);

// Test 11: Duplicate derived instance IDs per page
{
  const testRoot = await mkdtemp(join(tmpdir(), `replica-test-11-`));
  await mkdir(join(testRoot, 'pages'), { recursive: true });
  await mkdir(join(testRoot, 'sections'), { recursive: true });
  await mkdir(join(testRoot, 'assets'), { recursive: true });
  await writeFile(join(testRoot, 'replica.json'), JSON.stringify({
    id: 'test-replica',
    name: 'Test',
    tagline: 'tagline',
    source: { kind: 'url', url: 'https://example.test' },
    targets: ['seed'],
    styleKit: 'charcoal',
    pageOrder: ['home'],
    requiredCopy: [],
    requiredAssetIds: [],
    forbiddenRuntimeTokens: [],
    assets: [],
  }), 'utf8');
  await writeFile(join(testRoot, 'pages', 'home.json'), JSON.stringify({ id: 'home', slug: 'home', title: 'Home', width: 1440, sections: ['test-section', 'testsection'] }), 'utf8');
  await writeFile(join(testRoot, 'sections', 's1.json'), JSON.stringify({ baseSlug: 'test-section', category: 'hero', name: 'TS', description: 'desc', recipeId: 'rec', headingPreview: 'prev', sectionData: {}, assetManifest: [] }), 'utf8');
  await writeFile(join(testRoot, 'sections', 's2.json'), JSON.stringify({ baseSlug: 'testsection', category: 'hero', name: 'TS', description: 'desc', recipeId: 'rec', headingPreview: 'prev', sectionData: {}, assetManifest: [] }), 'utf8');
  await writeFile(join(testRoot, 'fidelity-ledger.json'), '[]', 'utf8');
  await writeFile(join(testRoot, 'unsupported.json'), '[]', 'utf8');

  let failed = false;
  try {
    await loadReplicaPackage(testRoot);
  } catch (error) {
    if (error instanceof Error && error.message.includes('replica-package: page "home" has duplicate section instance ID "testsection" (from reference "testsection")')) {
      failed = true;
    }
  }
  assert(failed, 'Test 11 (duplicate section instance IDs) failed to trigger expected error');
  console.log('[replica-package-load:smoke] Test 11 (duplicate section instance IDs) passed!');
}

// ==================== Finding 3: Forbidden Runtime Token Tests ====================
// Test 12: Forbidden runtime token in a section file
await runNegativeTest(
  12,
  'forbidden runtime token in section file',
  {
    replicaJson: { forbiddenRuntimeTokens: ['React', 'gsap'] },
    sections: { 'test-section': { description: 'Uses React for rendering.' } },
  },
  'forbidden runtime token "React" found in "sections/test-section.json"',
);

// Test 13: Forbidden runtime token in a page file
await runNegativeTest(
  13,
  'forbidden runtime token in page file',
  {
    replicaJson: { forbiddenRuntimeTokens: ['React', 'gsap'] },
    pages: { home: { title: 'Uses gsap triggers' } },
  },
  'forbidden runtime token "gsap" found in "pages/home.json"',
);

// Test 14: Forbidden runtime token in replica tagline
await runNegativeTest(
  14,
  'forbidden runtime token in replica tagline',
  {
    replicaJson: { forbiddenRuntimeTokens: ['React'], tagline: 'A React template package' },
  },
  'forbidden runtime token "React" found in "replica.json"',
);

// Test 15: Forbidden runtime token in unsupported.json / fidelity-ledger.json (Does NOT fail!)
const successRoot = await mkdtemp(join(tmpdir(), 'replica-test-token-ok-'));
await mkdir(join(successRoot, 'pages'), { recursive: true });
await mkdir(join(successRoot, 'sections'), { recursive: true });
await mkdir(join(successRoot, 'assets'), { recursive: true });
await writeFile(
  join(successRoot, 'replica.json'),
  JSON.stringify({
    id: 'test-replica',
    name: 'Test Replica',
    tagline: 'Clean tagline',
    source: { kind: 'url', url: 'https://example.test' },
    targets: ['seed'],
    styleKit: 'charcoal',
    pageOrder: ['home'],
    requiredCopy: [],
    requiredAssetIds: ['seed-test-mark'],
    forbiddenRuntimeTokens: ['React'],
    assets: [
      {
        id: 'seed-test-mark',
        sourcePath: 'mark.svg',
        mediaType: 'image/svg+xml',
        kind: 'image',
        width: 10,
        height: 10,
        alt: 'Test Mark'
      }
    ]
  }),
  'utf8',
);
await writeFile(
  join(successRoot, 'pages', 'home.json'),
  JSON.stringify({ id: 'page-home', slug: 'home', title: 'Home', width: 1440, sections: ['test-hero'] }),
  'utf8',
);
await writeFile(
  join(successRoot, 'sections', 'test-hero.json'),
  JSON.stringify({
    baseSlug: 'test-hero',
    category: 'hero',
    name: 'Test Hero',
    description: 'Clean description',
    recipeId: 'hero-recipe',
    headingPreview: 'Preview',
    sectionData: {},
    assetManifest: []
  }),
  'utf8',
);
await writeFile(join(successRoot, 'assets', 'mark.svg'), '<svg></svg>', 'utf8');
await writeFile(
  join(successRoot, 'fidelity-ledger.json'),
  JSON.stringify([
    { id: 'f1', sourceBehaviour: 'Uses React inside behavior description', status: 'native', evidence: [] }
  ]),
  'utf8',
);
await writeFile(
  join(successRoot, 'unsupported.json'),
  JSON.stringify([
    { id: 'u1', sourceBehaviour: 'Unsupported finding referencing React', reason: 'Some reason', requiredPrimitive: 'React Component' }
  ]),
  'utf8',
);

await loadReplicaPackage(successRoot); // Should load successfully without throwing
console.log('[replica-package-load:smoke] Test 15 (Token in unsupported/ledger files ignored) passed!');

console.log('[replica-package-load:smoke] OK');
