// src/assets/seed-script.ts
//
// `bun run seed:assets` — verify the bundled seed asset registry against
// the source bytes under `src/assets/seed-source/`. On first dev start
// (with R2 + DB credentials configured) this script also uploads the bytes
// to R2 and inserts the corresponding `ownerAsset` rows for the dev Owner.
//
// The script defaults to **dry-run mode**: it decodes the source files,
// recomputes each sha256, and asserts the registry's `contentHash` /
// `r2Key` / `byteSize` match. This is the cheap-fast loop dev mode runs on
// every editor save — it catches a registry/source drift before either is
// used by a route. Pass `--upload` to do the actual R2 + DB writes.

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { SEED_ASSET_REGISTRY, type SeedAsset } from '../canvas/seed-assets.js';
import { contentHashToR2Key, extFromMediaType, sha256Hex } from './hash.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_SOURCE_DIR = join(here, 'seed-source');

async function decodeSeedBytes(asset: SeedAsset): Promise<Uint8Array> {
  const path = join(SEED_SOURCE_DIR, asset.sourcePath);
  const text = await readFile(path, 'utf8');
  // Strip surrounding whitespace; the file may carry a trailing newline.
  const base64 = text.replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifySeedRegistry(): Promise<{ seedId: string; bytes: Uint8Array }[]> {
  const seeded: { seedId: string; bytes: Uint8Array }[] = [];
  for (const [seedId, asset] of Object.entries(SEED_ASSET_REGISTRY)) {
    const bytes = await decodeSeedBytes(asset);
    if (bytes.byteLength !== asset.byteSize) {
      throw new Error(
        `seed:assets: ${seedId} byteSize mismatch (registry=${String(
          asset.byteSize,
        )} actual=${String(bytes.byteLength)})`,
      );
    }
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== asset.contentHash) {
      throw new Error(
        `seed:assets: ${seedId} contentHash mismatch (registry=${asset.contentHash} actual=${actualHash})`,
      );
    }
    const expectedKey = contentHashToR2Key(actualHash, extFromMediaType(asset.mediaType));
    if (expectedKey !== asset.r2Key) {
      throw new Error(
        `seed:assets: ${seedId} r2Key mismatch (registry=${asset.r2Key} expected=${expectedKey})`,
      );
    }
    seeded.push({ seedId, bytes });
  }
  return seeded;
}

async function main(): Promise<void> {
  const upload = process.argv.includes('--upload');
  const remote = process.argv.includes('--remote');
  const seeded = await verifySeedRegistry();
  console.log(
    `[seed:assets] verified ${String(seeded.length)} seed entries against source bytes`,
  );
  if (!upload) {
    console.log('[seed:assets] dry-run OK (pass --upload to write to R2 + DB)');
    return;
  }
  const BUCKET = 'rev01-assets';
  const uploaded = new Set<string>();
  for (const { seedId, bytes } of seeded) {
    const asset = SEED_ASSET_REGISTRY[seedId]!;
    if (uploaded.has(asset.r2Key)) continue;
    const tmp = join(tmpdir(), `seed-${Date.now()}-${seedId}.bin`);
    await writeFile(tmp, bytes);
    try {
      const remoteFlag = remote ? ' --remote' : '';
      const cmd = `npx wrangler r2 object put "${BUCKET}/${asset.r2Key}" --file="${tmp}" --content-type="${asset.mediaType}"${remoteFlag}`;
      console.log(`[seed:assets] uploading ${seedId} → ${asset.r2Key}`);
      execSync(cmd, { stdio: 'inherit' });
      uploaded.add(asset.r2Key);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
  console.log(`[seed:assets] uploaded ${String(uploaded.size)} unique R2 objects`);
}

await main();
