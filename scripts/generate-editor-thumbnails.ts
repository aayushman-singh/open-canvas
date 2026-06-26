// scripts/generate-editor-thumbnails.ts
//
// One-shot generator for Add-panel button thumbnails. Each icon is authored
// as inner SVG geometry (24×24 viewBox, stroke-only) and rasterised to a
// 128×128 PNG via @resvg/resvg-wasm so the set stays visually uniform.
//
// Run: bun run scripts/generate-editor-thumbnails.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rasteriseSvgToPng } from '../src/og-image/rasterise.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'src/editor/assets/thumbnails');

const STROKE = '#2b2b2b';

/** Inner geometry only — wrapper added by wrapIcon(). */
const ICON_PATHS: Record<string, string> = {
  text: '<path d="M4 6h16M12 6v14M7 20h10"/>',
  image:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5.5-5.5a2 2 0 0 0-2.8 0L5 19"/>',
  video:
    '<rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2z"/>',
  'rich-motion':
    '<path d="M4 12c2-4 4-6 8-6s6 2 8 6"/><path d="M4 12c2 4 4 6 8 6s6-2 8-6"/><circle cx="12" cy="12" r="2"/>',
  action: '<rect x="4" y="8" width="16" height="10" rx="3"/><path d="M9 13h6"/>',
  shape: '<rect x="5" y="5" width="14" height="14" rx="2" transform="rotate(45 12 12)"/>',
  freeform: '<path d="M4 18c3-8 6-10 10-10s6 2 8 8"/>',
  container: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>',
  chart: '<path d="M5 19V9M10 19V5M15 19v-6M20 19V11"/>',
  form:
    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  embed:
    '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 10h8M8 14h5"/><path d="M18 4l3 2v12l-3 2"/>',
  code: '<path d="M8 8L4 12l4 4M16 8l4 4-4 4M14 6l-4 12"/>',
  accordion:
    '<rect x="4" y="5" width="16" height="5" rx="1"/><rect x="4" y="11" width="16" height="5" rx="1"/><path d="M8 7.5h8M8 13.5h8"/><path d="M18 7.5l-2 2 2 2M18 13.5l-2 2 2 2"/>',
  carousel:
    '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h10"/><path d="M5 12l-2-2v4zM19 12l2-2v4z"/>',
  table:
    '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M4 14h16M10 5v14"/>',
  nav: '<path d="M4 7h16M4 12h10M4 17h14"/>',
  tabs:
    '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 12h6v-4h6v4h6"/><path d="M8 16h8"/>',
  'flow-container':
    '<rect x="3" y="5" width="8" height="6" rx="1"/><rect x="13" y="5" width="8" height="6" rx="1"/><rect x="3" y="13" width="8" height="6" rx="1"/><rect x="13" y="13" width="8" height="6" rx="1"/>',
  'blank-section': '<rect x="4" y="6" width="16" height="12" rx="2" stroke-dasharray="3 2"/>',
  collection:
    '<rect x="4" y="6" width="12" height="9" rx="1"/><rect x="8" y="9" width="12" height="9" rx="1"/><path d="M10 10h6M10 13h4"/>',
};

function wrapIcon(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="${STROKE}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const keys = Object.keys(ICON_PATHS);
  for (const key of keys) {
    const svg = wrapIcon(ICON_PATHS[key]!);
    const { bytes } = await rasteriseSvgToPng(svg);
    const outPath = resolve(OUT_DIR, `${key}.png`);
    writeFileSync(outPath, bytes);
    console.log(`[generate-editor-thumbnails] wrote ${outPath}`);
  }
  console.log(`[generate-editor-thumbnails] done — ${String(keys.length)} thumbnails`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
