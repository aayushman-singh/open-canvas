import { injectInteractiveRuntime } from '../interactive/inject.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { getSeedAsset } from '../canvas/seed-assets.js';
import type { PublishedSnapshot } from '../canvas/schema.js';
import {
  validateEditableSite,
  validatePublishedSnapshot,
  validateSeedFixture,
} from '../canvas/validate.js';
import { getTemplateSeed, instantiateTemplate } from './registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[raydotsh-portfolio:smoke] ${message}`);
}

const seed = getTemplateSeed('raydotsh-portfolio');
assert(seed !== null, 'raydotsh-portfolio template seed must be registered');
assert(seed.name === 'Raydotsh Portfolio', 'template display name should be Raydotsh Portfolio');
assert(seed.pages.length === 2, 'template should include home and books pages');
assert(
  seed.pages.some((page) => page.slug === 'books'),
  'template should include a books gallery page',
);

const state = instantiateTemplate('raydotsh-portfolio');
const editValidation = validateEditableSite(state);
assert(editValidation.valid, editValidation.valid ? '' : editValidation.errors.join('\n'));

const seedValidation = validateSeedFixture(state);
assert(seedValidation.valid, seedValidation.valid ? '' : seedValidation.errors.join('\n'));

const snapshot: PublishedSnapshot = {
  ...state,
  version: 1,
  publishedAt: '2026-06-20T00:00:00.000Z',
};
const publishValidation = validatePublishedSnapshot(snapshot);
assert(publishValidation.valid, publishValidation.valid ? '' : publishValidation.errors.join('\n'));

const html = injectInteractiveRuntime(
  renderCanvasSnapshot(snapshot, '/assets', 'site_raydotsh_smoke', {
    turnstileSiteKey: '1x00000000000000000000AA',
  }),
  snapshot,
);

const sourceAssetIds = [
  'seed-raydotsh-yoru',
  'seed-raydotsh-pycaster',
  'seed-raydotsh-book-a-little-life',
  'seed-raydotsh-book-pride-and-prejudice',
  'seed-raydotsh-book-dracula',
  'seed-raydotsh-book-jane-eyre',
  'seed-raydotsh-book-harry-potter',
  'seed-raydotsh-book-goodnight-punpun',
  'seed-raydotsh-book-hunger-games',
  'seed-raydotsh-book-thousand-splendid-suns',
  'seed-raydotsh-book-man-called-ove',
  'seed-raydotsh-book-red-trainers',
];
for (const assetId of sourceAssetIds) {
  assert(getSeedAsset(assetId) !== null, `${assetId} should be registered as a seed asset`);
  assert(html.includes(`/assets/${assetId}`), `rendered template should reference ${assetId}`);
}

const requiredCopy = [
  'hi, ',
  'rehana',
  'Freelance content strategist',
  '/ software',
  'pycaster',
  'A Wolfenstein 3D style raycasting rendering engine',
  '/ books',
  'A Little Life',
  '/ reading list',
  'Built and designed by Rehana Rahman.',
];
for (const token of requiredCopy) {
  assert(html.includes(token), `rendered template should include ${JSON.stringify(token)}`);
}

const unsupportedRuntimeTokens = [
  'react-type-animation',
  'RobotGame',
  'game-toggle',
  'AsciiPortrait',
  'react-router-dom',
];
for (const token of unsupportedRuntimeTokens) {
  assert(!html.includes(token), `rendered template should not embed source runtime token ${token}`);
}

console.log('[raydotsh-portfolio:smoke] OK');
