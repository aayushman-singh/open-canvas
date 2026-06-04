// src/canvas/elements/text-richtext-color.smoke.ts
//
// Pins the per-run `color` mark contract introduced to fix the bug where
// the mark-toolbar's colour picker recoloured the WHOLE TextElement
// instead of the selected range.
//
// Coverage:
//   1. Schema / validator: { type: 'color', color: '#RRGGBB' } is accepted;
//      non-hex values are rejected.
//   2. Server renderer: emits `style="color:<hex>"` on the run's outer span,
//      tinting only the run that carries the mark.
//   3. Yjs round-trip: encode → decode preserves the color mark's payload.
//
// The DOM-level selection-to-runs mapping (`setColorOnRuns`) is pinned by
// the sibling editor-client smoke `mark-toolbar-color.smoke.ts` — that
// file imports from `src/editor-client/` which the server tsconfig
// excludes, so the canvas smoke stays free of DOM-using imports.
//
// Run with `bun run text-richtext-color:smoke`.

import type {
  CanvasPage,
  EditableSite,
  TextElement,
} from '../schema.js';
import { renderText } from './text.js';
import { validateEditableSite } from '../validate.js';
import { decodeYDoc, encodeYDoc } from '../yjs-projection.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[text-richtext-color:smoke] ${message}`);
}

function baseText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'el-text',
    type: 'text',
    box: { x: 0, y: 0, w: 600, h: 200, z: 1 },
    content: [{ text: 'Hello world' }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
    ...overrides,
  };
}

function siteWith(text: TextElement): EditableSite {
  const page: CanvasPage = {
    id: 'page-color',
    slug: 'index',
    title: 'Color smoke',
    width: 1440,
    sections: [
      {
        id: 'section-color',
        recipeId: 'feature-grid',
        name: 'Smoke',
        height: 240,
        elements: [text],
      },
    ],
  };
  return { styleKit: 'charcoal', pages: [page] };
}

// ---------------------------------------------------------------------------
// (1) Validator accepts { type: 'color', color: '#RRGGBB' }; rejects malformed
// ---------------------------------------------------------------------------

{
  const okHex = validateEditableSite(
    siteWith(
      baseText({
        content: [
          { text: 'Hello ' },
          { text: 'world', marks: [{ type: 'color', color: '#ff6600' }] },
        ],
      }),
    ),
  );
  assert(
    okHex.valid,
    `(1) #ff6600 color mark must validate (errors: ${okHex.valid ? '' : okHex.errors.join('; ')})`,
  );

  const okShort = validateEditableSite(
    siteWith(
      baseText({
        content: [{ text: 'x', marks: [{ type: 'color', color: '#f60' }] }],
      }),
    ),
  );
  assert(okShort.valid, '(1) #f60 (3-digit hex) must validate');

  const okAlpha = validateEditableSite(
    siteWith(
      baseText({
        content: [{ text: 'x', marks: [{ type: 'color', color: '#ff660080' }] }],
      }),
    ),
  );
  assert(okAlpha.valid, '(1) #RRGGBBAA must validate');

  const badNamed = validateEditableSite(
    siteWith(
      baseText({
        content: [{ text: 'x', marks: [{ type: 'color', color: 'red' }] }],
      }),
    ),
  );
  assert(!badNamed.valid, '(1) named colour "red" must FAIL validation (hex-only payload)');

  const badEmpty = validateEditableSite(
    siteWith(
      baseText({
        content: [{ text: 'x', marks: [{ type: 'color', color: '' }] }],
      }),
    ),
  );
  assert(!badEmpty.valid, '(1) empty color string must FAIL validation');

  const badType = validateEditableSite(
    siteWith(
      baseText({
        content: [
          {
            text: 'x',
            marks: [
              {
                type: 'color',
                color: 123 as unknown as string,
              },
            ],
          },
        ],
      }),
    ),
  );
  assert(!badType.valid, '(1) non-string color payload must FAIL validation');
}

// ---------------------------------------------------------------------------
// (2) Renderer emits `style="color:<hex>"` on the run's outer span and
//     tints only the coloured run — the leading run stays uncoloured.
// ---------------------------------------------------------------------------

{
  const text = baseText({
    content: [
      { text: 'Hello ' },
      { text: 'world', marks: [{ type: 'color', color: '#ff6600' }] },
    ],
  });
  const html = renderText(text);
  // Coloured slice gets the inline color style stamped on its outer span.
  assert(
    html.includes('style="color:#ff6600"'),
    `(2) renderer must stamp \`style="color:#ff6600"\` on the coloured run (got ${html})`,
  );
  // The leading "Hello " slice must be a plain span — NO color declaration
  // on its wrapper. This is the heart of the bug: the old code wrote color
  // to the element wrapper which recoloured the whole field.
  assert(
    html.includes('<span>Hello </span>'),
    `(2) leading run must be a plain <span> with no inline color (got ${html})`,
  );
  // Reverse contract: the parent <p> must NOT carry a color CSS property
  // (it never did, but pin this against regression now that color marks
  // exist as a sibling code path).
  const styleMatch = /<p [^>]*style="([^"]*)"/.exec(html);
  assert(styleMatch !== null, `(2) renderer emits a parent <p> with inline style (got ${html})`);
  assert(
    !styleMatch[1]!.includes('color:'),
    `(2) parent <p> must NOT carry a color declaration (got style="${styleMatch[1]}")`,
  );
}

{
  // Combined fontSize + color marks share the outer span (both stamp
  // CSS properties rather than wrapping a tag).
  const text = baseText({
    content: [
      {
        text: 'big and red',
        marks: [
          { type: 'fontSize', px: 32 },
          { type: 'color', color: '#cc0000' },
        ],
      },
    ],
  });
  const html = renderText(text);
  assert(
    /style="[^"]*font-size:32px[^"]*color:#cc0000[^"]*"/.test(html) ||
      /style="[^"]*color:#cc0000[^"]*font-size:32px[^"]*"/.test(html),
    `(2) fontSize + color must share the outer span (got ${html})`,
  );
}

// ---------------------------------------------------------------------------
// (3) Yjs encode/decode round-trips the color mark payload
// ---------------------------------------------------------------------------

{
  const site = siteWith(
    baseText({
      content: [
        { text: 'Hello ' },
        { text: 'world', marks: [{ type: 'color', color: '#ff6600' }] },
      ],
    }),
  );
  const doc = encodeYDoc(site);
  const decoded = decodeYDoc(doc);
  const text = decoded.pages[0]!.sections[0]!.elements[0] as TextElement;
  const colored = text.content[1];
  assert(colored !== undefined, '(3) coloured run survives round-trip');
  assert(Array.isArray(colored.marks), '(3) coloured run.marks is an array post-decode');
  const colorMark = colored.marks.find((m) => m.type === 'color');
  assert(colorMark !== undefined, '(3) color mark survives yjs round-trip');
  assert(
    colorMark.type === 'color' && colorMark.color === '#ff6600',
    `(3) color payload preserved (got ${JSON.stringify(colorMark)})`,
  );
}

// ---------------------------------------------------------------------------
// (4) Mark with no color payload at all (plain run) must NOT trigger an
//     inline color style — regression for the "old behaviour leaked element
//     color onto every run" bug.
// ---------------------------------------------------------------------------

{
  const text = baseText({ content: [{ text: 'plain' }] });
  const html = renderText(text);
  assert(
    !html.includes('color:'),
    `(4) un-coloured text element must NOT emit any inline color (got ${html})`,
  );
}

console.log('[text-richtext-color:smoke] OK');
