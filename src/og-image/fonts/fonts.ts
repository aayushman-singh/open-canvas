// src/og-image/fonts/fonts.ts
//
// Font byte loader for the Satori OG card. Both files are committed under
// `src/og-image/fonts/*.ttf` and pulled into the bundle via Bun's filesystem
// import (`import font from './Inter-Regular.ttf' with { type: 'file' }`-style)
// — however because the Cloudflare Workers build path goes through wrangler /
// esbuild, we read the bytes via Node's `fs` API on the dev path and rely on
// the bundler's static-asset inlining for the worker bundle.
//
// For the smoke test (Bun runtime) the simple approach below works: we read
// from disk via `node:fs`. The worker production path needs the same files;
// wrangler embeds anything `import`ed by relative path. We keep the production
// path's import shape behind `loadOgFonts()` so the wave-1 main thread can
// swap in a bundler-static loader if needed without touching the call sites.
//
// Font: Inter v4.1, Regular + Bold, TTF (sfnt) — Satori requires OTF/TTF
// bytes since `@shuding/opentype.js` does not decompress WOFF/WOFF2.
// License: SIL Open Font License v1.1 — see `./LICENSE.txt`. Copyright (c)
// 2016 The Inter Project Authors (https://github.com/rsms/inter).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let cached: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

export interface OgFontBytes {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}

/**
 * Returns the bundled Inter Regular + Bold TTF bytes. Cached for the
 * lifetime of the isolate. Throws loudly if either file is missing — there
 * is no font fallback; the OG renderer cannot proceed without a font.
 */
export async function loadOgFonts(): Promise<OgFontBytes> {
  if (cached !== null) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const [regularBuf, boldBuf] = await Promise.all([
    readFile(join(here, 'Inter-Regular.ttf')),
    readFile(join(here, 'Inter-Bold.ttf')),
  ]);
  // `readFile` returns a Node Buffer; the slice copy normalises to a clean
  // ArrayBuffer the Satori font loader accepts without DataView surprises.
  const regular = regularBuf.buffer.slice(
    regularBuf.byteOffset,
    regularBuf.byteOffset + regularBuf.byteLength,
  );
  const bold = boldBuf.buffer.slice(boldBuf.byteOffset, boldBuf.byteOffset + boldBuf.byteLength);
  cached = { regular, bold };
  return cached;
}
