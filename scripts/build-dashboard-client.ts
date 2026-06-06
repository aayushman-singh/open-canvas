// scripts/build-dashboard-client.ts
//
// ADR 0021 — Bun.build of src/dashboard-client/index.ts into
// dist/_assets/dashboard-<hash>.js. Writes the resolved URL to the same
// src/_assets/manifest.generated.ts the editor-client build maintains,
// extending the manifest with `dashboardClientUrl`.
//
// Run:
//   bun run scripts/build-dashboard-client.ts            # production build
//   bun run scripts/build-dashboard-client.ts --dev      # dev build w/ inline
//                                                          sourcemaps + no minify
//
// Modelled on scripts/build-editor-client.ts. The dashboard side has no
// CSS counterpart because dashboard styling lives in per-route TSX
// blocks today (mechanically similar but out of scope per ADR 0021
// "Out of scope").
//
// The manifest re-write is "merge with existing" — read the previous
// manifest, parse the existing keys, write the updated record. This
// keeps the editor-client and dashboard-client builds independent
// (either can run alone) while both contributing to the same typed
// export the routes consume.

import { resolve } from 'node:path';
import { writeManifest } from './manifest-helpers.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'dist/_assets');
const MANIFEST_PATH = resolve(ROOT, 'src/_assets/manifest.generated.ts');
const ASSET_URL_PREFIX = '/_assets';

const isDev = process.argv.includes('--dev');

async function main(): Promise<void> {
  const result = await Bun.build({
    entrypoints: [resolve(ROOT, 'src/dashboard-client/index.ts')],
    outdir: OUT_DIR,
    target: 'browser',
    format: 'esm',
    minify: !isDev,
    naming: 'dashboard-[hash].[ext]',
    sourcemap: isDev ? 'inline' : 'none',
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error('Bun.build produced no successful output');
  }

  let dashboardClientUrl: string | undefined;
  for (const out of result.outputs) {
    const filename = out.path.split(/[\\/]/).pop();
    if (filename === undefined) continue;
    if (out.kind === 'entry-point') {
      dashboardClientUrl = `${ASSET_URL_PREFIX}/${filename}`;
    }
  }
  if (dashboardClientUrl === undefined) {
    throw new Error(
      'Bun.build emitted no dashboard entry-point JS artifact — check src/dashboard-client/index.ts',
    );
  }

  // Merge into the existing manifest (preserves the editor-client slots
  // the editor build wrote). Either build can run alone.
  writeManifest(MANIFEST_PATH, { dashboardClientUrl });
  const mode = isDev ? 'dev (inline sourcemaps, unminified)' : 'prod (minified, no sourcemaps)';
  console.log(`[build-dashboard-client] mode: ${mode}`);
  console.log(`[build-dashboard-client] wrote ${dashboardClientUrl}`);
  console.log(`[build-dashboard-client] manifest at ${MANIFEST_PATH}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
