import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canvasPublishedStyles } from '../canvas/public-styles.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { SEED_ASSET_REGISTRY } from '../canvas/seed-assets.js';
import { validateEditableSite, validatePublishedSnapshot } from '../canvas/validate.js';
import { injectInteractiveRuntime } from '../interactive/inject.js';
import { instantiateTemplate } from './registry.js';

const BASE_URL = 'http://opencanvas-visual.test/';
const OUTPUT_DIR = path.join(process.cwd(), '.cache', 'velocity-athlete-visual');
const FORBIDDEN_TOKENS = ['lando', 'norris', 'mclaren', 'quadrant', 'gsap', 'ScrollTrigger'];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[velocity-athlete:visual-render] ${message}`);
}

const state = instantiateTemplate('velocity-athlete');
const editValidation = validateEditableSite(state);
assert(editValidation.valid, editValidation.valid ? '' : editValidation.errors.join('\n'));

const snapshot: PublishedSnapshot = {
  ...state,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
const publishValidation = validatePublishedSnapshot(snapshot);
assert(publishValidation.valid, publishValidation.valid ? '' : publishValidation.errors.join('\n'));

const bodyHtml = injectInteractiveRuntime(
  renderCanvasSnapshot(snapshot, '/assets', 'site_velocity_visual_e2e', {
    turnstileSiteKey: '1x00000000000000000000AA',
  }),
  snapshot,
);

for (const token of FORBIDDEN_TOKENS) {
  assert(!bodyHtml.toLowerCase().includes(token.toLowerCase()), `rendered template leaks forbidden token ${token}`);
}

const documentHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="${BASE_URL}">
  <title>Velocity Athlete visual E2E</title>
  <style>${canvasPublishedStyles}</style>
  <style>html,body{margin:0;background:#080806;}body{min-height:100vh;}</style>
</head>
<body>${bodyHtml}</body>
</html>`;

const assetManifest = Object.fromEntries(
  Object.entries(SEED_ASSET_REGISTRY).map(([id, asset]) => [
    id,
    {
      mediaType: asset.mediaType,
      sourcePath: asset.sourcePath,
    },
  ]),
);

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(path.join(OUTPUT_DIR, 'preview.html'), documentHtml);
writeFileSync(path.join(OUTPUT_DIR, 'seed-assets.json'), `${JSON.stringify(assetManifest, null, 2)}\n`);

console.log(`[velocity-athlete:visual-render] OK output=${OUTPUT_DIR}`);