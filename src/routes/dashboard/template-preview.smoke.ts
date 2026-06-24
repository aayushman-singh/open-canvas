import {
  renderBuiltInTemplatePreviewAssetResponse,
  renderBuiltInTemplatePreviewBodyHtml,
} from './templates.js';
import { canvasPublishedStyles } from '../../canvas/public-styles.js';
import { buildStyleKitCss } from '../../canvas/style-kits.js';
import { getTemplateSeed } from '../../templates/registry.js';
import { getSeedAsset } from '../../canvas/seed-assets.js';
import { allTemplateSeeds } from '../../templates/registry.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

const templatesRouteSource = readFileSync(
  path.join(process.cwd(), 'src/routes/dashboard/templates.tsx'),
  'utf8',
);
assert(
  !/html,\s*body\s*\{\s*margin:\s*0;\s*overflow:\s*hidden;/.test(templatesRouteSource),
  'standalone template preview route must not lock document scrolling',
);
assert(
  templatesRouteSource.includes('window.__opencanvasRuntimeOptions={reducedMotion:"no-preference"}'),
  'template preview route must force motion-on runtime options for fidelity previews',
);
assert(
  templatesRouteSource.includes('ENTRANCE_ANIMATION_CSS') &&
    templatesRouteSource.includes('ENTRANCE_OBSERVER_SCRIPT'),
  'template preview route must include entrance animation CSS and observer script',
);

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

// Test that `.opencanvas-site` has `min-height: 100vh` in published styles to fill the viewport on wide screens
assert(
  /\.opencanvas-site\s*\{[^}]*min-height:\s*100vh/.test(canvasPublishedStyles),
  'canvasPublishedStyles must include min-height: 100vh on .opencanvas-site',
);

// Test that the Raydotsh custom style kit defines the correct background color
const raydotshSeed = getTemplateSeed('raydotsh-portfolio');
assert(raydotshSeed !== null, 'raydotsh-portfolio must be registered');
assert(raydotshSeed.styleKit === 'custom', 'Raydotsh must use custom style kit');
assert(raydotshSeed.customStyleKit !== undefined, 'Raydotsh must define customStyleKit');

const raydotshCss = buildStyleKitCss('custom', raydotshSeed.customStyleKit);
assert(
  raydotshCss.includes('--opencanvas-kit-bg: #0a192f') || raydotshCss.includes('--opencanvas-kit-bg:#0a192f'),
  'Raydotsh custom style kit CSS must define --opencanvas-kit-bg: #0a192f',
);

console.log('[template-preview:smoke] OK');
