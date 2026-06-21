import {
  renderBuiltInTemplatePreviewAssetResponse,
  renderBuiltInTemplatePreviewBodyHtml,
} from './templates.js';
import { getSeedAsset } from '../../canvas/seed-assets.js';
import { allTemplateSeeds } from '../../templates/registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[template-preview:smoke] ${message}`);
}

const html = renderBuiltInTemplatePreviewBodyHtml('velocity-athlete', {
  turnstileSiteKey: '1x00000000000000000000AA',
});

for (const marker of [
  'data-opencanvas-load-experience',
  'data-opencanvas-behaviour-payload',
  'data-opencanvas-interactive-runtime',
  'data-opencanvas-rich-motion',
]) {
  assert(html.includes(marker), `dashboard template preview must include ${marker}`);
}

assert(
  allTemplateSeeds.some((template) => template.id === 'raydotsh-portfolio'),
  'Raydotsh Portfolio must be available in the global community template list',
);

const raydotshHtml = renderBuiltInTemplatePreviewBodyHtml('raydotsh-portfolio', {
  turnstileSiteKey: '1x00000000000000000000AA',
});
for (const marker of [
  'hi, ',
  'rehana',
  'seed-raydotsh-yoru',
  'seed-raydotsh-pycaster',
  'seed-raydotsh-book-a-little-life',
  '@font-face',
  'font-family: "NTR"',
  'data-opencanvas-rich-motion="raydotsh-ascii-portrait"',
  'data-opencanvas-playable-widget="raydotsh-game-mode"',
]) {
  assert(
    raydotshHtml.includes(marker),
    `dashboard Raydotsh template preview must include ${marker}`,
  );
}

const pycasterSeed = getSeedAsset('seed-raydotsh-pycaster');
assert(pycasterSeed !== null, 'Raydotsh pycaster source image must be registered');
let requestedPreviewAssetKey = '';
const previewAssetResponse = await renderBuiltInTemplatePreviewAssetResponse(
  'seed-raydotsh-pycaster',
  {
    get(key: string) {
      requestedPreviewAssetKey = key;
      return Promise.resolve({
        body: new Uint8Array([1, 2, 3]),
        httpMetadata: { contentType: pycasterSeed.mediaType },
      } as unknown as R2Object);
    },
  } as unknown as R2Bucket,
);
assert(previewAssetResponse !== null, 'Raydotsh preview asset response should exist');
assert(
  requestedPreviewAssetKey === pycasterSeed.r2Key,
  'Raydotsh preview asset route should read the seed r2Key',
);
assert(
  previewAssetResponse.headers.get('content-type') === pycasterSeed.mediaType,
  'Raydotsh preview asset response should carry the seed media type',
);

const forbidden = ['lando', 'norris', 'mclaren', 'quadrant', 'gsap', 'ScrollTrigger'];
for (const token of forbidden) {
  assert(
    !html.toLowerCase().includes(token.toLowerCase()),
    `preview HTML must not leak forbidden token ${token}`,
  );
}

console.log('[template-preview:smoke] OK');
