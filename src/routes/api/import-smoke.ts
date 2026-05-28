import { sha256Hex } from '../../assets/hash.js';
import { validateCanvasSiteState } from '../../canvas/validate.js';
import { buildCanvasSiteState, prepareImportedAssets, type ScraperResponse } from './import.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[import:smoke] ${message}`);
}

function mediaElement(
  src: string,
  x: number,
): {
  type: 'media';
  box: { x: number; y: number; w: number; h: number; z: number };
  data: { type: 'media'; src: string; alt: string; mediaType: 'image'; originalUrl: string };
} {
  return {
    type: 'media',
    box: { x, y: 0, w: 100, h: 80, z: 1 },
    data: { type: 'media', src, alt: '', mediaType: 'image', originalUrl: src },
  };
}

const sameBasenameA = 'https://cdn-a.example.test/logo.png';
const sameBasenameB = 'https://cdn-b.example.test/logo.png';
const data: ScraperResponse = {
  sections: [
    {
      name: 'hero',
      top: 0,
      height: 240,
      elements: [mediaElement(sameBasenameA, 0), mediaElement(sameBasenameB, 140)],
    },
  ],
  colors: { seed: '#3366ff', bg: '#ffffff', text: '#111111', muted: '#777777' },
  fonts: { display: "'Imported Display', system-ui, sans-serif", body: 'Inter', mono: 'monospace' },
  assets: [
    {
      kind: 'media',
      originalUrl: sameBasenameA,
      contentType: 'image/png',
      filename: 'logo.png',
      data: Buffer.from('asset-a').toString('base64'),
    },
    {
      kind: 'media',
      originalUrl: sameBasenameB,
      contentType: 'image/png',
      filename: 'logo.png',
      data: Buffer.from('asset-b').toString('base64'),
    },
    {
      kind: 'font',
      originalUrl: 'https://fonts.example.test/imported.woff2',
      contentType: 'font/woff2',
      filename: 'imported.woff2',
      data: Buffer.from('wOF2-imported').toString('base64'),
      fontFamily: 'Imported Display',
      fontWeight: 700,
      fontStyle: 'normal',
    },
  ],
  warnings: [],
  sourceUrl: 'https://example.com',
  scrapedAt: '2026-05-24T00:00:00.000Z',
};

const existingHash = await sha256Hex(new TextEncoder().encode('asset-a'));
const prepared = await prepareImportedAssets({
  scraperAssets: data.assets,
  customerId: 'customer-1',
  siteId: 'site-1',
  existingOwnerAssets: [{ id: 'existing-asset-a', contentHash: existingHash }],
});
assert(
  prepared.mediaAssetIdMap.get(sameBasenameA) === 'existing-asset-a',
  'existing owner asset must be reused by content hash',
);
assert(
  prepared.mediaAssetRows.length === 1,
  `expected only one new media asset row, got ${String(prepared.mediaAssetRows.length)}`,
);
assert(
  prepared.mediaAssetIdMap.get(sameBasenameA) !== prepared.mediaAssetIdMap.get(sameBasenameB),
  'same-basename media URLs must map to distinct asset ids',
);
assert(prepared.fontRows.length === 1, 'expected imported WOFF2 font row');
assert(
  prepared.fontFamilyTokenMap.get('Imported Display')?.startsWith('font:'),
  'imported font family must become a font:<hash> token',
);

const state = buildCanvasSiteState(data, prepared.mediaAssetIdMap, prepared.fontFamilyTokenMap);
const validation = validateCanvasSiteState(state);
assert(validation.valid, validation.valid ? '' : validation.errors.join('; '));
const elements = state.pages[0]?.sections[0]?.elements ?? [];
assert(elements.length === 2, `expected two media elements, got ${String(elements.length)}`);
assert(elements[0]?.type === 'media', 'first element must be media');
assert(elements[1]?.type === 'media', 'second element must be media');
if (elements[0]?.type === 'media' && elements[1]?.type === 'media') {
  assert(elements[0].assetId === 'existing-asset-a', 'first media must reuse existing asset');
  assert(
    elements[0].assetId !== elements[1].assetId,
    'media elements must not collide by filename',
  );
}
assert(
  state.customStyleKit?.fontFamilyDisplay.startsWith('font:'),
  'custom style kit display font must reference imported site font',
);

let missingAssetThrew = false;
try {
  buildCanvasSiteState(data, new Map(), prepared.fontFamilyTokenMap);
} catch (err) {
  missingAssetThrew =
    err instanceof Error && err.message.includes('missing imported media asset');
}
assert(missingAssetThrew, 'missing imported media asset must fail loudly');

let unknownElementThrew = false;
try {
  buildCanvasSiteState(
    {
      ...data,
      sections: [
        {
          ...data.sections[0]!,
          elements: [
            {
              type: 'marquee',
              box: { x: 0, y: 0, w: 100, h: 80, z: 1 },
              data: {},
            },
          ],
        },
      ],
    },
    prepared.mediaAssetIdMap,
    prepared.fontFamilyTokenMap,
  );
} catch (err) {
  unknownElementThrew =
    err instanceof Error && err.message.includes('unsupported scraped element type');
}
assert(unknownElementThrew, 'unknown scraped element type must fail loudly');

console.log('[import:smoke] OK');
