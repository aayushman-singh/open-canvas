// src/canvas/smoke.ts
//
// Manual smoke: validate the canonical home fixture as an Editable Site and
// as a Published Snapshot, render it, and assert the rendered HTML contains
// the expected stable markers. Run with `bun.cmd run canvas:smoke`.

import fixture from './fixtures/home.json';
import { renderCanvasSnapshot } from './render.js';
import type { CanvasSiteState, PublishedSnapshot, TextElement } from './schema.js';
import { validateCanvasSiteState, validatePublishedSnapshot } from './validate.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const editable = fixture as CanvasSiteState;
const editableResult = validateCanvasSiteState(editable);
assert(editableResult.valid, editableResult.valid ? '' : editableResult.errors.join('; '));

const snapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-22T00:00:00.000Z',
  styleKit: editable.styleKit,
  pages: editable.pages,
};
const publishedResult = validatePublishedSnapshot(snapshot);
assert(publishedResult.valid, publishedResult.valid ? '' : publishedResult.errors.join('; '));

const html = renderCanvasSnapshot(snapshot, '/assets');
assert(html.includes('data-rev01-page="page-home"'), 'expected rendered home page marker');
assert(html.includes('data-rev01-section="section-hero"'), 'expected rendered hero section marker');
assert(html.includes('data-rev01-element="hero-heading"'), 'expected rendered heading marker');
assert(html.includes('data-rev01-media-kind="video"'), 'expected rendered video media marker');

// Rich text: the hero heading must contain a <strong> tag (the "lived-in" run
// in the fixture carries a `bold` mark). Anchor the search to the heading's
// element wrapper so we don't accept a stray <strong> elsewhere.
const headingMarker = 'data-rev01-element="hero-heading"';
const headingIdx = html.indexOf(headingMarker);
assert(headingIdx >= 0, 'expected hero-heading marker present in rendered HTML');
const headingEnd = html.indexOf('</h1>', headingIdx);
assert(headingEnd > headingIdx, 'expected hero-heading h1 to close after its marker');
const headingBlock = html.slice(headingIdx, headingEnd);
assert(
  headingBlock.includes('<strong>'),
  'expected <strong> inside the hero-heading block (bold mark must render)',
);

// Rich text: somewhere in the page a link mark must render as
// <a class="rev01-inline-link" href="https://...">. The fixture wires this
// onto the hero-body element pointing at rev01.aayushman.dev.
assert(
  /<a class="rev01-inline-link" href="https:\/\/[^"]+"/.test(html),
  'expected at least one rev01-inline-link with an https href in rendered HTML',
);

// Validator: a hand-built text element whose link mark uses a javascript:
// scheme must be rejected. The smoke wraps it in a minimum CanvasSiteState.
const javascriptLinkText: TextElement = {
  id: 'hero-heading-evil',
  type: 'text',
  box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
  content: [{ text: 'go', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }],
  role: 'body',
  fontSize: 16,
  fontWeight: 400,
  align: 'left',
};
const javascriptLinkState: CanvasSiteState = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-evil',
      slug: 'evil',
      title: 'Evil',
      width: 1440,
      sections: [
        {
          id: 'section-evil',
          recipeId: 'hero-split',
          name: 'Evil',
          height: 400,
          elements: [javascriptLinkText],
        },
      ],
    },
  ],
};
const javascriptLinkResult = validateCanvasSiteState(javascriptLinkState);
assert(
  !javascriptLinkResult.valid,
  'expected validator to reject a link mark with href "javascript:alert(1)"',
);
assert(
  !javascriptLinkResult.valid &&
    javascriptLinkResult.errors.some((m) => m.includes('javascript:alert(1)')),
  'expected javascript: link rejection to mention the offending href',
);

console.log('[canvas:smoke] OK');
