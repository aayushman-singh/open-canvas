import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadReplicaPackage } from './load.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[replica-package-load:smoke] ${message}`);
}

const tiny = await loadReplicaPackage('src/templates/replicas/tiny-replica');
assert(tiny.metadata.id === 'tiny-replica', 'loader must read replica metadata id');
assert(tiny.pages.length === 1 && tiny.pages[0]?.slug === 'home', 'loader must read pages by pageOrder');
assert(tiny.sections.length === 1, 'loader must read one section');
assert(tiny.sections[0]?.baseSlug === 'tiny-replica-hero', 'loader must preserve section baseSlug');
assert(tiny.metadata.assets[0]?.id === 'seed-tiny-replica-mark', 'loader must read asset declarations');
assert(tiny.fidelityLedger.some((item) => item.status === 'native'), 'loader must read native fidelity row');
assert(tiny.unsupported[0]?.id === 'custom-cursor', 'loader must read unsupported findings');

const badRoot = await mkdtemp(join(tmpdir(), 'replica-bad-'));
await mkdir(join(badRoot, 'pages'), { recursive: true });
await mkdir(join(badRoot, 'sections'), { recursive: true });
await mkdir(join(badRoot, 'assets'), { recursive: true });
await writeFile(
  join(badRoot, 'replica.json'),
  JSON.stringify({
    id: 'Bad Id',
    name: 'Bad',
    tagline: 'Bad package',
    source: { kind: 'url', url: 'https://example.test' },
    targets: ['seed'],
    styleKit: 'charcoal',
    pageOrder: ['home'],
    requiredCopy: [],
    requiredAssetIds: [],
    forbiddenRuntimeTokens: [],
    assets: []
  }),
  'utf8',
);
await writeFile(
  join(badRoot, 'pages', 'home.json'),
  JSON.stringify({ id: 'page-bad-home', slug: 'home', title: 'Bad', width: 1440, sections: ['missing-section'] }),
  'utf8',
);
await writeFile(join(badRoot, 'fidelity-ledger.json'), '[]', 'utf8');
await writeFile(join(badRoot, 'unsupported.json'), '[]', 'utf8');

let badFailed = false;
try {
  await loadReplicaPackage(badRoot);
} catch (error) {
  badFailed = error instanceof Error && error.message.includes('metadata.id');
}
assert(badFailed, 'loader must fail loudly on invalid replica id');

console.log('[replica-package-load:smoke] OK');
