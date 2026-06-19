import { renderCanvasSnapshot } from './render.js';
import type { EditableSite, PublishedSnapshot } from './schema.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[marquee:smoke] ' + message);
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
            id: 'hero',
            recipeId: 'custom',
            name: 'Hero',
            height: 640,
            elements: [
              {
                id: 'headline',
                type: 'text',
                box: { x: 120, y: 160, w: 760, h: 96, z: 1 },
                content: [{ text: 'Fast laps all weekend' }],
                role: 'heading',
                fontSize: 64,
                fontWeight: 700,
                align: 'left',
                marquee: {
                  enabled: true,
                  direction: 'left',
                  speedPxPerSecond: 96,
                  pauseOnHover: true,
                  reducedMotion: 'static',
                },
              },
              {
                id: 'ticker-source',
                type: 'collection',
                box: { x: 120, y: 300, w: 720, h: 220, z: 1 },
                collectionSlug: 'race-notes',
                sort: 'date-desc',
                display: 'custom',
                entries: [
                  [
                    {
                      id: 'ticker-source-entry-1-title',
                      type: 'text',
                      box: { x: 0, y: 0, w: 240, h: 40, z: 1 },
                      content: [{ text: 'Monaco' }],
                      role: 'heading',
                      fontSize: 24,
                      fontWeight: 700,
                      align: 'left',
                    },
                  ],
                  [
                    {
                      id: 'ticker-source-entry-2-title',
                      type: 'text',
                      box: { x: 0, y: 0, w: 240, h: 40, z: 1 },
                      content: [{ text: 'Silverstone' }],
                      role: 'heading',
                      fontSize: 24,
                      fontWeight: 700,
                      align: 'left',
                    },
                  ],
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

const site = makeSite();
site.pages[0]!.sections[0]!.elements[0]!.marquee!.edgeFade = true;
site.pages[0]!.sections[0]!.elements[0]!.marquee!.pauseOnHover = false;
site.pages[0]!.sections[0]!.elements[0]!.marquee!.hoverReverse = true;
site.pages[0]!.sections[0]!.elements[0]!.marquee!.rows = 3;
site.pages[0]!.sections[0]!.elements[0]!.marquee!.rowGapPx = 8;
site.pages[0]!.sections[0]!.elements[0]!.marquee!.rowOffsetPercent = 33;
site.pages[0]!.sections[0]!.elements[0]!.marquee!.source = {
  type: 'collection-element',
  elementId: 'ticker-source',
  field: 'title',
  separator: ' / ',
};
const validation = validateEditableSite(site);
assert(validation.valid, validation.valid ? 'valid marquee site should pass' : validation.errors.join('\n'));

const decoded = decodeYDoc(encodeYDoc(site));
assert(
  decoded.pages[0]?.sections[0]?.elements[0]?.marquee?.speedPxPerSecond === 96,
  'Yjs projection must preserve marquee config',
);
assert(
  decoded.pages[0]?.sections[0]?.elements[0]?.marquee?.edgeFade === true,
  'Yjs projection must preserve marquee edge fade config',
);
assert(
  decoded.pages[0]?.sections[0]?.elements[0]?.marquee?.hoverReverse === true,
  'Yjs projection must preserve marquee hover reverse config',
);
assert(
  decoded.pages[0]?.sections[0]?.elements[0]?.marquee?.rows === 3 &&
    decoded.pages[0]?.sections[0]?.elements[0]?.marquee?.rowGapPx === 8 &&
    decoded.pages[0]?.sections[0]?.elements[0]?.marquee?.rowOffsetPercent === 33,
  'Yjs projection must preserve marquee multi-row config',
);
assert(
  decoded.pages[0]?.sections[0]?.elements[0]?.marquee?.source?.type === 'collection-element' &&
    decoded.pages[0]?.sections[0]?.elements[0]?.marquee?.source?.elementId === 'ticker-source',
  'Yjs projection must preserve marquee collection source config',
);

const snapshot: PublishedSnapshot = {
  ...site,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-marquee', {
  turnstileSiteKey: 'test-turnstile-key',
});
assert(html.includes('data-opencanvas-marquee="true"'), 'renderer must emit marquee marker');
assert(
  html.includes('data-opencanvas-marquee-direction="left"'),
  'renderer must emit marquee direction',
);
assert(
  html.includes('data-opencanvas-marquee-speed="96"'),
  'renderer must emit marquee speed',
);
assert(
  html.includes('data-opencanvas-marquee-reduced-motion="static"'),
  'renderer must emit explicit reduced-motion mode',
);
assert(
  html.includes('data-opencanvas-marquee-edge-fade="true"'),
  'renderer must emit marquee edge fade metadata',
);
assert(
  html.includes('data-opencanvas-marquee-hover-reverse="true"'),
  'renderer must emit marquee hover reverse metadata',
);
assert(html.includes('data-opencanvas-marquee-rows="3"'), 'renderer must emit marquee row count');
assert(html.includes('data-opencanvas-marquee-row-gap="8"'), 'renderer must emit marquee row gap');
assert(
  html.includes('data-opencanvas-marquee-row-offset="33"'),
  'renderer must emit marquee row offset',
);
assert(html.includes('Monaco / Silverstone'), 'renderer must materialize collection-sourced marquee text');

const invalidDirection = makeSite() as unknown as Record<string, unknown>;
(
  (
    ((invalidDirection.pages as unknown[])[0] as Record<string, unknown>).sections as unknown[]
  )[0] as Record<string, unknown>
).elements = [
  {
    id: 'bad',
    type: 'text',
    box: { x: 0, y: 0, w: 100, h: 40, z: 1 },
    content: [{ text: 'Bad' }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
    marquee: {
      enabled: true,
      direction: 'diagonal',
      speedPxPerSecond: 0,
      edgeFade: 'yes',
      hoverReverse: 'yes',
      rows: 0,
      rowGapPx: -1,
      rowOffsetPercent: 200,
      reducedMotion: 'maybe',
    },
  },
];
const invalid = validateEditableSite(invalidDirection);
assert(!invalid.valid, 'invalid marquee config must fail validation');
assert(
  invalid.errors.some((error) => error.includes('.marquee.direction')),
  'invalid direction must be named',
);
assert(
  invalid.errors.some((error) => error.includes('.marquee.speedPxPerSecond')),
  'invalid speed must be named',
);
assert(
  invalid.errors.some((error) => error.includes('.marquee.reducedMotion')),
  'invalid reduced-motion mode must be named',
);
assert(
  invalid.errors.some((error) => error.includes('.marquee.edgeFade')),
  'invalid edge fade flag must be named',
);
assert(
  invalid.errors.some((error) => error.includes('.marquee.hoverReverse')),
  'invalid hover reverse flag must be named',
);
assert(
  invalid.errors.some((error) => error.includes('.marquee.rows')),
  'invalid row count must be named',
);
assert(
  invalid.errors.some((error) => error.includes('.marquee.rowGapPx')),
  'invalid row gap must be named',
);
assert(
  invalid.errors.some((error) => error.includes('.marquee.rowOffsetPercent')),
  'invalid row offset must be named',
);

const invalidSource = makeSite();
invalidSource.pages[0]!.sections[0]!.elements[0]!.marquee!.source = {
  type: 'collection-element',
  elementId: 'missing-source',
  field: 'title',
};
const invalidSourceResult = validateEditableSite(invalidSource);
assert(!invalidSourceResult.valid, 'missing marquee collection source must fail validation');
assert(
  invalidSourceResult.errors.some((error) => error.includes('.marquee.source.elementId')),
  'missing collection source failure must name elementId',
);

const conflicting = makeSite() as unknown as Record<string, unknown>;
const conflictingMarquee = (
  (
    (((conflicting.pages as unknown[])[0] as Record<string, unknown>).sections as unknown[])[0] as Record<
      string,
      unknown
    >
  ).elements as Record<string, unknown>[]
)[0]!.marquee as Record<string, unknown>;
conflictingMarquee.pauseOnHover = true;
conflictingMarquee.hoverReverse = true;
const conflict = validateEditableSite(conflicting);
assert(!conflict.valid, 'pause-on-hover plus hover-reverse marquee must fail validation');
assert(
  conflict.errors.some((error) => error.includes('.marquee.hoverReverse')),
  'hover reverse conflict must be named',
);

console.log('[marquee:smoke] OK');
