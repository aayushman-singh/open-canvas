// src/og-image/rasterise.ts
//
// SVG → PNG via @resvg/resvg-wasm. The wasm module needs `initWasm()` once
// per isolate; we memoise the init promise so concurrent renders never call
// init twice (the second call would throw `Already initialized` per the
// resvg-wasm contract).
//
// The wasm bytes are read from `node_modules/@resvg/resvg-wasm/index_bg.wasm`
// on Bun (smoke + dev) by reading the file. On the Cloudflare Workers build
// wrangler turns a `.wasm` import into a `WebAssembly.Module` static binding;
// the production wave uses that path via a wrangler-rewritten import. We
// expose a single `rasteriseSvgToPng(svg, env?)` entry point that accepts an
// optional pre-initialised wasm module so the worker path stays decoupled
// from filesystem reads. When `env.RESVG_WASM` is undefined (smoke runtime),
// the loader falls back to reading from disk via `node:fs`.
//
// Failure mode: any wasm load or rasterise error throws verbatim with full
// context. There is no degraded SVG-only fallback — the OG endpoint either
// returns a PNG or surfaces an error.

import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let initPromise: Promise<void> | null = null;

/**
 * Optional dependency-injection surface so a Worker build can pass a
 * compile-time `WebAssembly.Module` instead of paying a disk read. When
 * `wasmModule` is undefined the loader reads `index_bg.wasm` from
 * `node_modules`. When a pre-loaded module is provided, `initWasm` accepts
 * it directly.
 */
export interface RasteriseEnv {
  wasmModule?: WebAssembly.Module;
}

async function ensureWasm(env?: RasteriseEnv): Promise<void> {
  if (initPromise !== null) return initPromise;
  initPromise = (async () => {
    if (env?.wasmModule !== undefined) {
      await initWasm(env.wasmModule);
      return;
    }
    // Bun / Node path: locate the wasm via `node_modules`. We avoid an
    // `import.meta.resolve` because it's not yet stable across the runtimes
    // we care about; the relative-from-cwd path is deterministic for the
    // smoke harness.
    const wasmPath = join(
      process.cwd(),
      'node_modules',
      '@resvg',
      'resvg-wasm',
      'index_bg.wasm',
    );
    const bytes = await readFile(wasmPath);
    // `WebAssembly.compile` exists on every JS runtime that exposes the
    // WebAssembly object (Bun, Node, browsers). The Cloudflare Workers
    // type bundle elides it from `typeof WebAssembly` because Worker
    // bundles import wasm modules statically rather than compiling at
    // runtime — but the smoke / dev path on Bun does need it. Casting
    // through `unknown` is the cleanest way to acknowledge the type
    // surface without growing a triple-slash directive.
    const wasmGlobal = WebAssembly as unknown as {
      compile(bytes: BufferSource): Promise<WebAssembly.Module>;
    };
    const module = await wasmGlobal.compile(bytes);
    await initWasm(module);
  })();
  return initPromise;
}

export interface RasteriseResult {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Convert an SVG string to a PNG Uint8Array. `width` / `height` come from
 * the resvg-rendered surface, not the SVG itself — they're informational so
 * callers can assert dimensions in tests.
 */
export async function rasteriseSvgToPng(
  svg: string,
  env?: RasteriseEnv,
): Promise<RasteriseResult> {
  await ensureWasm(env);
  // No font config on the Resvg side — Satori has already embedded the font
  // glyphs as SVG paths via `embedFont: true`. Resvg only needs to draw the
  // SVG primitives. `fitTo: 'original'` keeps the surface at the SVG's
  // intrinsic 1200×630.
  const resvg = new Resvg(svg, { fitTo: { mode: 'original' } });
  const rendered = resvg.render();
  const bytes = rendered.asPng();
  const width = rendered.width;
  const height = rendered.height;
  rendered.free();
  resvg.free();
  return { bytes, width, height };
}

/**
 * Smoke helper — explicitly reset the init memo. The Cloudflare Workers
 * isolate is single-init for life; tests that exercise re-init paths call
 * this to start from a clean slate.
 */
export function __resetWasmForTests(): void {
  initPromise = null;
}
