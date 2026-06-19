import { renderCanvasSnapshot } from '../../canvas/render.js';
import type { PublishedSnapshot } from '../../canvas/schema.js';
import { validateEditableSite } from '../../canvas/validate.js';
import { decodeYDoc, encodeYDoc } from '../../canvas/yjs-projection.js';
import { buildEditableSite, type ScraperResponse } from './import.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[import-animation-inventory:smoke] ${message}`);
}

const scraped: ScraperResponse = {
  sections: [
    {
      name: 'hero',
      top: 0,
      height: 360,
      elements: [
        {
          type: 'text',
          box: { x: 64, y: 48, w: 720, h: 120, z: 1 },
          data: {
            role: 'h1',
            runs: [{ text: 'Velocity manifesto' }],
            fontSize: 72,
            textAlign: 'left',
          },
          motion: {
            preset: 'fade-up',
            delayMs: 120,
            source: {
              name: 'hero-enter',
              properties: ['opacity', 'transform'],
              durationMs: 900,
              delayMs: 120,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              trigger: 'load',
              transform: 'translateY(40px)',
              transition: 'opacity 900ms cubic-bezier(0.22, 1, 0.36, 1)',
            },
          },
        },
        {
          type: 'text',
          box: { x: 64, y: 200, w: 720, h: 80, z: 2 },
          data: {
            role: 'body',
            runs: [{ text: 'Unsupported scrub source must not disappear.' }],
            fontSize: 28,
            textAlign: 'left',
          },
          motion: {
            preset: 'gsap-horizontal-scrub',
            source: {
              name: 'scrubbed-story-track',
              properties: ['transform'],
              durationMs: 1800,
              easing: 'power3.out',
              trigger: 'scroll',
              transform: 'translateX(-100vw)',
              animation: 'horizontal scroll scrub',
            },
            unsupportedReason: 'No exact Open Canvas primitive for scrubbed horizontal timeline',
          },
        },
      ],
    },
  ],
  colors: { seed: '#ff5a1f', bg: '#080806', text: '#fff8ea', muted: '#9c9485' },
  fonts: { display: 'Impact, sans-serif', body: 'Arial, sans-serif', mono: 'monospace' },
  assets: [],
  warnings: [],
  sourceUrl: 'https://benchmark.example.test/story',
  scrapedAt: '2026-06-19T00:00:00.000Z',
};

const state = buildEditableSite(scraped, new Map());
const validation = validateEditableSite(state);
assert(validation.valid, validation.valid ? '' : validation.errors.join('; '));

const section = state.pages[0]?.sections[0];
assert(section !== undefined, 'expected imported body section');
const mappedElement = section.elements[0];
const unsupportedElement = section.elements[1];
assert(mappedElement?.type === 'text', 'expected first imported element to be text');
assert(unsupportedElement?.type === 'text', 'expected second imported element to be text');
assert(mappedElement.motion?.preset === 'fade-up', 'valid imported preset must still map to element motion');
assert(
  unsupportedElement.motion === undefined,
  'unsupported imported motion must not be emitted as executable element motion',
);

const inventory = state.importAnimationInventory;
assert(inventory !== undefined, 'import animation inventory must be preserved on the site');
assert(inventory.sourceUrl === scraped.sourceUrl, 'inventory must preserve source URL');
assert(inventory.capturedAt === scraped.scrapedAt, 'inventory must preserve scrape timestamp');
assert(inventory.items.length === 2, `expected two inventory items, got ${String(inventory.items.length)}`);

const mapped = inventory.items.find((item) => item.status === 'mapped');
assert(mapped !== undefined, 'expected a mapped inventory item');
assert(mapped.elementId === mappedElement.id, 'mapped inventory item must reference imported element id');
assert(mapped.source.name === 'hero-enter', 'mapped inventory item must preserve source animation name');
assert(
  mapped.source.properties.includes('transform') && mapped.source.properties.includes('opacity'),
  'mapped inventory item must preserve source animated properties',
);
assert(mapped.mappedPrimitive?.kind === 'motion-preset', 'mapped inventory item must name primitive kind');
assert(mapped.mappedPrimitive.preset === 'fade-up', 'mapped inventory item must name exact preset');

const unsupported = inventory.items.find((item) => item.status === 'unsupported');
assert(unsupported !== undefined, 'expected an unsupported inventory item');
assert(
  unsupported.elementId === unsupportedElement.id,
  'unsupported inventory item must reference imported element id',
);
assert(
  unsupported.unsupportedReason?.includes('scrubbed horizontal timeline'),
  'unsupported inventory item must preserve explicit failure reason',
);
assert(
  unsupported.source.trigger === 'scroll' && unsupported.source.transform === 'translateX(-100vw)',
  'unsupported inventory item must preserve source trigger and transform facts',
);

const decoded = decodeYDoc(encodeYDoc(state));
const decodedInventory = decoded.importAnimationInventory;
assert(decodedInventory !== undefined, 'Yjs projection must preserve import animation inventory');
assert(decodedInventory.sourceUrl === inventory.sourceUrl, 'Yjs projection must preserve source URL');
assert(decodedInventory.capturedAt === inventory.capturedAt, 'Yjs projection must preserve capturedAt');
assert(
  decodedInventory.items.length === inventory.items.length,
  'Yjs projection must preserve inventory item count',
);
const decodedMapped = decodedInventory.items.find((item) => item.status === 'mapped');
const decodedUnsupported = decodedInventory.items.find((item) => item.status === 'unsupported');
assert(
  decodedMapped?.mappedPrimitive?.preset === 'fade-up' && decodedMapped.source.name === 'hero-enter',
  'Yjs projection must preserve mapped primitive and source name',
);
assert(
  decodedUnsupported !== undefined &&
    decodedUnsupported.unsupportedReason === unsupported.unsupportedReason &&
    decodedUnsupported.source.trigger === 'scroll',
  'Yjs projection must preserve unsupported reason and trigger',
);

const snapshot: PublishedSnapshot = {
  ...state,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-import-inventory', {
  turnstileSiteKey: 'test-key',
});
assert(
  html.includes('data-opencanvas-import-animation-inventory'),
  'renderer must emit explicit import animation inventory metadata',
);
assert(html.includes('scrubbed-story-track'), 'render metadata must include unsupported source name');
assert(
  html.includes('No exact Open Canvas primitive'),
  'render metadata must include unsupported reason',
);

const invalid = {
  ...state,
  importAnimationInventory: {
    items: [
      {
        id: 'bad-item',
        status: 'mapped',
        source: { properties: ['opacity'] },
      },
    ],
  },
};
const invalidValidation = validateEditableSite(invalid);
assert(!invalidValidation.valid, 'mapped inventory item without mappedPrimitive must fail validation');
assert(
  !invalidValidation.valid &&
    invalidValidation.errors.some((error) => error.includes('mappedPrimitive')),
  'validation error must identify missing mappedPrimitive',
);

console.log('[import-animation-inventory:smoke] OK');
