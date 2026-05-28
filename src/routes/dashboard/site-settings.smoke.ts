function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[site-settings:smoke] ${message}`);
}

const response = await fetch(new URL('./site-settings.tsx', import.meta.url));
const source = await response.text();

assert(
  source.includes('let configPatchChain = Promise.resolve();'),
  'expected settings script to define a shared config PATCH chain',
);
assert(
  source.includes('function queueConfigPatch'),
  'expected settings script to expose a shared config PATCH queue helper',
);
assert(
  source.includes('queueConfigPatch({ faviconAssetId: assetIdOrNull }'),
  'expected favicon saves to use the shared config PATCH queue',
);
assert(
  source.includes('queueConfigPatch({ [key]: apiValue }'),
  'expected config toggles to use the shared config PATCH queue',
);

console.log('[site-settings:smoke] OK');
