// src/canvas/text-overflow-hidden.smoke.ts
//
// Bug fix smoke for "text boxes let content overflow the declared width/height
// with no visual consequence". The user typed a long single line into a small
// text box and the text extended past the wrapper rectangle, breaking the
// layout illusion.
//
// The fix is a stylesheet rule on the text element wrapper:
//   .opencanvas-element[data-element-type="text"]:not([data-editing="true"]) {
//     overflow: hidden;
//   }
// shipped in BOTH `src/canvas/public-styles.ts` (visitor pages) and
// `src/editor-client/styles-build.ts` (editor preview). The inspector's
// Overflow control can still override this by emitting an inline
// `overflow:visible` on the wrapper — inline declarations outrank stylesheet
// rules, so the override wins automatically.
//
// This file asserts:
//   1. The CSS rule is present in both stylesheets, scoped with the
//      `:not([data-editing="true"])` carveout so the editor's inline-edit
//      caret never gets clipped.
//   2. The default HTML the renderer emits for a small text box carries NO
//      inline `overflow:` declaration — the stylesheet default is what
//      clips it. (Belt-and-braces: if a future change started emitting an
//      inline default, the cascade would still clip, but we want the
//      inspector override to remain the ONE place that injects inline
//      overflow.)
//   3. When `elementStyle.overflow = 'visible'` is set via the inspector,
//      the renderer emits inline `overflow:visible` on the wrapper so the
//      cascade resolves to visible despite the stylesheet default.
//   4. The `:not([data-editing="true"])` carveout matches the attribute
//      `text-edit.ts:beginTextEditImpl` adds to the wrapper at edit start
//      (and removes in finish()), so typing into a small text box during
//      inline edit doesn't clip the caret.
//
// Run with `bun.cmd run text-overflow-hidden:smoke`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

import type { EditableSite, PublishedSnapshot, TextElement } from './schema.js';
import { renderCanvasSnapshot } from './render.js';
import { canvasPublishedStyles } from './public-styles.js';

const TURNSTILE = 'turnstile-test-key';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Extract the style attribute of the text element wrapper. Throws loudly
 *  if the wrapper or its style attribute can't be found — the smoke must
 *  fail visibly, not pass on a captured-undefined regex group. */
function styleAttrOfTextWrapper(html: string): string {
  const match = /<div class="opencanvas-element"[^>]*data-element-type="text"[^>]*style="([^"]*)"/.exec(html);
  if (match === null) {
    throw new Error(`expected text wrapper in HTML; got ${html.slice(0, 400)}`);
  }
  const styleAttr = match[1];
  if (styleAttr === undefined) {
    throw new Error(`text wrapper regex matched but capture group 1 was undefined; got ${html.slice(0, 400)}`);
  }
  return styleAttr;
}

function baseText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'el-text',
    type: 'text',
    // Small box, deliberately too narrow to hold the long content below.
    box: { x: 0, y: 0, w: 100, h: 40, z: 1 },
    content: [
      // ~1000px wide naturally — every char is roughly 8-12px in a default
      // font at 16px. 120 chars exceeds any reasonable 100px box.
      { text: 'this is a very long single line of text that would naturally extend far beyond a 100px wide box if not clipped' },
    ],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
    ...overrides,
  };
}

function siteWith(text: TextElement): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'index',
        title: 'Text overflow smoke',
        width: 1440,
        sections: [
          {
            id: 'section-smoke',
            recipeId: 'feature-grid',
            name: 'Smoke',
            height: 800,
            elements: [text],
          },
        ],
      },
    ],
  };
}

function renderHtml(state: EditableSite): string {
  const snapshot: PublishedSnapshot = {
    version: 1,
    publishedAt: '2026-06-04T00:00:00.000Z',
    ...state,
  };
  return renderCanvasSnapshot(snapshot, '/assets', 'smoke-site', {
    turnstileSiteKey: TURNSTILE,
  });
}

// 1. Visitor stylesheet carries the default-clip rule with the data-editing
//    carveout. Visitor pages never set data-editing — the carveout exists so
//    the same rule can live in the editor preview without clipping the
//    inline-edit caret.
{
  assert(
    canvasPublishedStyles.includes(
      '.opencanvas-element[data-element-type="text"]:not([data-editing="true"])',
    ),
    'public-styles.ts must clip text wrapper overflow by default (with data-editing carveout)',
  );
  // Belt-and-braces: the rule must actually declare overflow:hidden, not
  // just match the selector. A future refactor that accidentally drops the
  // declaration would slip past a selector-only check.
  const idx = canvasPublishedStyles.indexOf(
    '.opencanvas-element[data-element-type="text"]:not([data-editing="true"])',
  );
  const rule = canvasPublishedStyles.slice(idx, idx + 200);
  assert(
    /overflow:\s*hidden/.test(rule),
    `public-styles.ts text wrapper rule must declare overflow:hidden; saw ${rule}`,
  );
}

// 2. Editor preview stylesheet ships the same rule. Editor + visitor must
//    not drift — both render the canvas through the same wrapper markup,
//    so both need the same clip default. styles-build.ts is the source of
//    truth (styles.css is build-time generated), so we read the build-time
//    source directly to avoid a stale-css false pass.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const stylesBuildPath = pathResolve(here, '..', 'editor-client', 'styles-build.ts');
  const stylesBuildSrc = readFileSync(stylesBuildPath, 'utf8');
  assert(
    stylesBuildSrc.includes(
      '.opencanvas-element[data-element-type="text"]:not([data-editing="true"])',
    ),
    'editor-client/styles-build.ts must clip text wrapper overflow by default (with data-editing carveout)',
  );
  const idx = stylesBuildSrc.indexOf(
    '.opencanvas-element[data-element-type="text"]:not([data-editing="true"])',
  );
  const rule = stylesBuildSrc.slice(idx, idx + 200);
  assert(
    /overflow:\s*hidden/.test(rule),
    `styles-build.ts text wrapper rule must declare overflow:hidden; saw ${rule}`,
  );
}

// 3. The renderer does NOT inject an inline overflow on the wrapper by
//    default. The stylesheet default does the work; keeping the inline
//    slot clean preserves the inspector's "inline-wins-over-stylesheet"
//    contract: only Overflow inspector overrides should ever emit inline
//    overflow, so an Owner who later sets overflow:visible gets exactly
//    what they expect.
{
  const html = renderHtml(siteWith(baseText()));
  const styleAttr = styleAttrOfTextWrapper(html);
  assert(
    !/overflow\s*:/.test(styleAttr),
    `default text wrapper must NOT carry inline overflow; saw style="${styleAttr}"`,
  );
}

// 4. Inspector override path: elementStyle.overflow='visible' emits inline
//    `overflow:visible` on the wrapper so the cascade beats the stylesheet
//    default. This is what the existing Overflow inspector control sets
//    when the Owner picks "visible" — without this, the field would be a
//    no-op for text elements once the default clip lands.
{
  const html = renderHtml(
    siteWith(baseText({ elementStyle: { overflow: 'visible' } })),
  );
  const styleAttr = styleAttrOfTextWrapper(html);
  assert(
    /overflow\s*:\s*visible/.test(styleAttr),
    `overflow:visible elementStyle must reach inline wrapper style; saw style="${styleAttr}"`,
  );
}

// 5. Inspector override path: elementStyle.overflow='hidden' also reaches
//    the wrapper. The default already clips, so this is functionally a
//    no-op in the cascade, but the inspector still emits it for round-trip
//    fidelity — an Owner who explicitly picked "hidden" expects that
//    decision to persist into the saved elementStyle.
{
  const html = renderHtml(
    siteWith(baseText({ elementStyle: { overflow: 'hidden' } })),
  );
  const styleAttr = styleAttrOfTextWrapper(html);
  assert(
    /overflow\s*:\s*hidden/.test(styleAttr),
    `overflow:hidden elementStyle must reach inline wrapper style; saw style="${styleAttr}"`,
  );
}

// 6. The data-editing="true" attribute that text-edit.ts adds on the
//    wrapper at edit start (and removes in finish) matches the carveout
//    selector. If the attribute name ever drifts, the carveout stops
//    matching and inline edit starts clipping the caret again — the
//    original bug we're guarding against. This grep is a load-bearing
//    cross-file contract check, not a duplicate of test 1/2.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const textEditPath = pathResolve(here, '..', 'editor-client', 'text-edit.ts');
  const textEditSrc = readFileSync(textEditPath, 'utf8');
  assert(
    textEditSrc.includes("setAttribute('data-editing', 'true')"),
    'text-edit.ts beginTextEditImpl must set data-editing="true" on the wrapper at edit start',
  );
  assert(
    textEditSrc.includes("removeAttribute('data-editing')"),
    'text-edit.ts finish() must remove data-editing from the wrapper at edit end',
  );
}

console.log('text-overflow-hidden.smoke OK');
