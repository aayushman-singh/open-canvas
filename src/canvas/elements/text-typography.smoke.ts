// src/canvas/elements/text-typography.smoke.ts
//
// Smoke test for the typography surface added in Bundle A: letterSpacing,
// textWrap, lineHeight, textTransform. Pins the renderer CSS contract and
// the validation bounds so a future refactor cannot silently drop one of
// the four typed fields back into pinnedStyle territory.
//
// Run with `bun.cmd run text-typography:smoke`.

import type { EditableSite, TextElement } from '../schema.js';
import { renderText } from './text.js';
import { validateEditableSite } from '../validate.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function baseText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'el-text',
    type: 'text',
    box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
    content: [{ text: 'hello' }],
    role: 'heading',
    fontSize: 32,
    fontWeight: 700,
    align: 'left',
    ...overrides,
  };
}

function siteWithText(text: TextElement): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'index',
        title: 'Typography smoke',
        width: 1440,
        sections: [
          {
            id: 'section-smoke',
            recipeId: 'feature-grid',
            name: 'Smoke',
            height: 240,
            elements: [text],
          },
        ],
      },
    ],
  };
}

// --- renderer emits each typed field as the right CSS property ---

const allFields = renderText(
  baseText({
    letterSpacing: '-0.02em',
    textWrap: 'balance',
    lineHeight: 1.6,
    textTransform: 'uppercase',
  }),
);
assert(allFields.includes('letter-spacing:-0.02em'), 'letterSpacing must emit letter-spacing CSS');
assert(allFields.includes('text-wrap:balance'), 'textWrap must emit text-wrap CSS');
assert(allFields.includes('line-height:1.6'), 'lineHeight must emit line-height CSS');
assert(
  allFields.includes('text-transform:uppercase'),
  'textTransform must emit text-transform CSS',
);

// --- renderer emits NOTHING for omitted fields (no defaults leak) ---

const minimal = renderText(baseText());
assert(!minimal.includes('letter-spacing'), 'omitted letterSpacing must not emit CSS');
assert(!minimal.includes('text-wrap'), 'omitted textWrap must not emit CSS');
assert(!minimal.includes('line-height'), 'omitted lineHeight must not emit CSS');
assert(!minimal.includes('text-transform'), 'omitted textTransform must not emit CSS');

// --- validation accepts well-formed values ---

const validOk = validateEditableSite(
  siteWithText(
    baseText({
      letterSpacing: '0.18em',
      textWrap: 'pretty',
      lineHeight: 1.0,
      textTransform: 'lowercase',
    }),
  ),
);
assert(validOk.valid, validOk.valid ? '' : `expected valid: ${validOk.errors.join('; ')}`);

// --- validation rejects out-of-bounds lineHeight ---

const lhLow = validateEditableSite(siteWithText(baseText({ lineHeight: 0.4 })));
assert(
  !lhLow.valid && lhLow.errors.some((e) => e.includes('lineHeight must be between 0.5 and 3.0')),
  `expected lineHeight too-low error; got ${JSON.stringify(lhLow)}`,
);

const lhHigh = validateEditableSite(siteWithText(baseText({ lineHeight: 3.5 })));
assert(
  !lhHigh.valid && lhHigh.errors.some((e) => e.includes('lineHeight must be between 0.5 and 3.0')),
  `expected lineHeight too-high error; got ${JSON.stringify(lhHigh)}`,
);

// --- validation rejects unknown textWrap value ---

const wrapBad = validateEditableSite(
  siteWithText(baseText({ textWrap: 'nowrap' as unknown as 'pretty' })),
);
assert(
  !wrapBad.valid && wrapBad.errors.some((e) => e.includes('textWrap')),
  `expected textWrap enum error; got ${JSON.stringify(wrapBad)}`,
);

// --- validation rejects unknown textTransform value ---

const transformBad = validateEditableSite(
  siteWithText(baseText({ textTransform: 'small-caps' as unknown as 'uppercase' })),
);
assert(
  !transformBad.valid && transformBad.errors.some((e) => e.includes('textTransform')),
  `expected textTransform enum error; got ${JSON.stringify(transformBad)}`,
);

// --- validation rejects empty / non-string letterSpacing ---

const lsEmpty = validateEditableSite(siteWithText(baseText({ letterSpacing: '' })));
assert(
  !lsEmpty.valid && lsEmpty.errors.some((e) => e.includes('letterSpacing')),
  `expected empty letterSpacing error; got ${JSON.stringify(lsEmpty)}`,
);

console.log('[text-typography:smoke] OK');
