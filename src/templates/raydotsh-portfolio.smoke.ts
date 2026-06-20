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

type FidelityStatus = 'native' | 'approximate' | 'missing' | 'omitted';

interface FidelityItem {
  id: string;
  sourceBehaviour: string;
  status: FidelityStatus;
  requiredPrimitive?: string;
}

const RAYDOTSH_FIDELITY_LEDGER: FidelityItem[] = [
  {
    id: 'ascii-particle-portrait',
    sourceBehaviour:
      'Canvas ASCII particles assemble into a portrait and repel from pointer/touch input',
    status: 'missing',
    requiredPrimitive: 'Particle Field Rich Motion',
  },
  {
    id: 'typewriter-greeting',
    sourceBehaviour: 'Hero name reveals as an ordered typewriter sequence with a cursor',
    status: 'missing',
    requiredPrimitive: 'Typewriter Text Effect',
  },
  {
    id: 'robot-game-overlay',
    sourceBehaviour: 'Game mode toggles a keyboard-controlled collectible platformer overlay',
    status: 'omitted',
    requiredPrimitive: 'Playable Widget ADR',
  },
  {
    id: 'sidebar-anchor-rail',
    sourceBehaviour: 'Desktop slash-styled side rail links to same-page anchors',
    status: 'missing',
    requiredPrimitive: 'Anchor Rail Navigation',
  },
  {
    id: 'scroll-reveal-sequence',
    sourceBehaviour: 'Repeated sections and list items reveal with child-index delays',
    status: 'approximate',
    requiredPrimitive: 'Reveal Sequence',
  },
  {
    id: 'responsive-project-variants',
    sourceBehaviour: 'Projects use desktop spotlight structure and separate mobile card structure',
    status: 'approximate',
    requiredPrimitive: 'Responsive Layout Variant',
  },
  {
    id: 'cover-grid',
    sourceBehaviour: 'Books render as responsive masonry cover grids with hover lift',
    status: 'approximate',
    requiredPrimitive: 'Cover Grid Recipe',
  },
];

const knownLedgerIds = new Set<string>();
for (const item of RAYDOTSH_FIDELITY_LEDGER) {
  assert(item.id.length > 0, 'fidelity item id must be non-empty');
  assert(!knownLedgerIds.has(item.id), `duplicate fidelity item id ${item.id}`);
  knownLedgerIds.add(item.id);
  assert(item.sourceBehaviour.length > 20, `${item.id} must describe the source behaviour`);
  if (item.status === 'missing' || item.status === 'approximate') {
    assert(
      typeof item.requiredPrimitive === 'string' && item.requiredPrimitive.length > 0,
      `${item.id} must name the primitive that closes the gap`,
    );
  }
}

const missingOrApproximate = RAYDOTSH_FIDELITY_LEDGER.filter(
  (item) => item.status === 'missing' || item.status === 'approximate',
);
assert(missingOrApproximate.length > 0, 'current template must not be reported as faithful yet');

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
