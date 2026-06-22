import { compileReplicaSeedAssets, renderGeneratedSeedAssetRegistry } from './assets.js';
import { loadReplicaPackage } from './load.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[replica-package-assets:smoke] ${message}`);
}

const pkg = await loadReplicaPackage('src/templates/replicas/tiny-replica');
const assets = await compileReplicaSeedAssets(pkg);
assert(assets.length === 1, 'tiny package must compile exactly one asset');
const asset = assets[0]!;
assert(asset.seedId === 'seed-tiny-replica-mark', 'compiled asset must preserve seed id');
assert(asset.registry.sourcePath === 'tiny-replica-mark.svg.b64', 'compiled asset sourcePath must be deterministic');
assert(asset.registry.mediaType === 'image/svg+xml', 'compiled asset must preserve mediaType');
assert(asset.registry.byteSize > 100, 'compiled asset must record byte size');
assert(asset.base64.length > asset.registry.byteSize, 'compiled asset must carry base64 bytes');
assert(asset.registry.r2Key.endsWith('.svg'), 'compiled asset r2Key must use media extension');

const registrySource = renderGeneratedSeedAssetRegistry(assets);
assert(
  registrySource.includes('GENERATED_SEED_ASSET_REGISTRY') &&
    registrySource.includes('seed-tiny-replica-mark') &&
    registrySource.includes(asset.registry.contentHash),
  'generated registry source must include registry object and asset hash',
);

const missing = structuredClone(pkg);
missing.metadata.assets[0] = { ...missing.metadata.assets[0]!, sourcePath: 'missing.svg' };
let missingFailed = false;
try {
  await compileReplicaSeedAssets(missing);
} catch (error) {
  missingFailed = error instanceof Error && error.message.includes('missing.svg');
}
assert(missingFailed, 'asset compiler must fail loudly when source bytes are missing');

console.log('[replica-package-assets:smoke] OK');
