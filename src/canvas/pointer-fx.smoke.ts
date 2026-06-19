import { renderCanvasSnapshot } from './render.js';
import type { EditableSite, PublishedSnapshot } from './schema.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[canvas-pointer-fx:smoke] ' + message);
}

function makeSite(): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'home',
        slug: 'home',
        title: 'Home',
        width: 1200,
        sections: [
          {
            id: 'cards',
            recipeId: 'custom',
            name: 'Cards',
            height: 520,
            elements: [
              {
                id: 'tilt-card',
                type: 'container',
                variant: 'glass',
                box: { x: 120, y: 100, w: 360, h: 240, z: 1 },
                pointerFx: {
                  enabled: true,
                  primitive: 'tilt',
                  reducedMotion: 'disabled',
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

const site = makeSite();
const validation = validateEditableSite(site);
assert(validation.valid, validation.valid ? 'valid pointer-fx site should pass' : validation.errors.join('\n'));

const decoded = decodeYDoc(encodeYDoc(site));
assert(
  decoded.pages[0]?.sections[0]?.elements[0]?.pointerFx?.primitive === 'tilt',
  'Yjs projection must preserve pointerFx config',
);

const snapshot: PublishedSnapshot = {
  ...site,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-pointer-fx', {
  turnstileSiteKey: 'test-turnstile-key',
});
assert(
  html.includes('data-opencanvas-pointer-fx="tilt"'),
  'renderer must emit pointer-fx primitive',
);
assert(
  html.includes('data-opencanvas-pointer-fx-reduced-motion="disabled"'),
  'renderer must emit pointer-fx reduced-motion mode',
);

const invalid = makeSite() as unknown as Record<string, unknown>;
const invalidElement = (
  (
    (((invalid.pages as unknown[])[0] as Record<string, unknown>).sections as unknown[])[0] as Record<
      string,
      unknown
    >
  ).elements as Record<string, unknown>[]
)[0]!;
invalidElement.pointerFx = {
  enabled: true,
  primitive: 'magnet',
  reducedMotion: 'maybe',
};
const invalidResult = validateEditableSite(invalid);
assert(!invalidResult.valid, 'invalid pointerFx config must fail validation');
assert(
  invalidResult.errors.some((error) => error.includes('.pointerFx.primitive')),
  'invalid primitive must be named',
);
assert(
  invalidResult.errors.some((error) => error.includes('.pointerFx.reducedMotion')),
  'invalid reduced-motion mode must be named',
);

console.log('[canvas-pointer-fx:smoke] OK');
