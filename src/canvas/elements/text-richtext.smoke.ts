// src/canvas/elements/text-richtext.smoke.ts
//
// ADR 0060 F1 — pins the contract for the `isRichText` flag on TextElement:
// validator accepts the boolean, yjs round-trips it, renderer treats
// `content[0].text` as CommonMark Markdown (HTML-escaped raw input), and the
// materializer's `{{body}}` substitution flows entry Markdown source through
// to render time untouched.
//
// Run with `bun run text-richtext:smoke`.

import type {
  CanvasPage,
  CanvasSection,
  EditableSite,
  TextElement,
} from '../schema.js';
import { renderText } from './text.js';
import { validateEditableSite } from '../validate.js';
import { encodeYDoc, decodeYDoc } from '../yjs-projection.js';
import { materializeCollections, type MaterializerEntry } from './collection-materializer.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[text-richtext:smoke] ${message}`);
}

function baseText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'el-text',
    type: 'text',
    box: { x: 0, y: 0, w: 600, h: 200, z: 1 },
    content: [{ text: 'hello' }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
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
        title: 'Rich text smoke',
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

// ---------------------------------------------------------------------------
// (1) Validator accepts isRichText:true/false; rejects non-boolean
// ---------------------------------------------------------------------------

{
  const okTrue = validateEditableSite(siteWithText(baseText({ isRichText: true })));
  assert(okTrue.valid, '(1) isRichText:true must validate');
  const okFalse = validateEditableSite(siteWithText(baseText({ isRichText: false })));
  assert(okFalse.valid, '(1) isRichText:false must validate');
  const okAbsent = validateEditableSite(siteWithText(baseText()));
  assert(okAbsent.valid, '(1) isRichText absent must validate');

  const bad = validateEditableSite(
    siteWithText(baseText({ isRichText: 'yes' as unknown as boolean })),
  );
  assert(!bad.valid, '(1) isRichText:"yes" must fail validation');
  if (!bad.valid) {
    assert(
      bad.errors.some((e) => e.includes('isRichText')),
      `(1) error message must reference isRichText (got ${JSON.stringify(bad.errors)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// (2) Yjs encode/decode round-trips the flag (both true and absent)
// ---------------------------------------------------------------------------

{
  const site = siteWithText(baseText({ isRichText: true }));
  const doc = encodeYDoc(site);
  const decoded = decodeYDoc(doc);
  const text = decoded.pages[0]!.sections[0]!.elements[0] as TextElement;
  assert(text.isRichText === true, '(2) yjs round-trip preserves isRichText:true');
}

{
  const site = siteWithText(baseText());
  const doc = encodeYDoc(site);
  const decoded = decodeYDoc(doc);
  const text = decoded.pages[0]!.sections[0]!.elements[0] as TextElement;
  assert(
    !('isRichText' in text) || text.isRichText === undefined,
    '(2) absent isRichText stays absent after round-trip (deep-equal contract)',
  );
}

// ---------------------------------------------------------------------------
// (3) Renderer emits <div class="opencanvas-text opencanvas-richtext"> for
//     flagged elements; non-flagged elements keep the role-driven tag.
// ---------------------------------------------------------------------------

{
  const flagged = renderText(baseText({ isRichText: true, content: [{ text: 'plain' }] }));
  assert(
    flagged.startsWith('<div class="opencanvas-text opencanvas-richtext"'),
    `(3) flagged element wraps in <div>, got prefix ${flagged.slice(0, 60)}`,
  );
  assert(!flagged.includes('<p '), '(3) flagged element must NOT use <p> wrapper');
  assert(!flagged.includes('<h1 '), '(3) flagged element must NOT use <h1> wrapper');
}

{
  const bodyEl = renderText(baseText({ role: 'body', content: [{ text: 'plain' }] }));
  assert(bodyEl.includes('<p '), '(3) unflagged body element keeps <p> wrapper (regression)');
}

{
  const headingEl = renderText(
    baseText({ role: 'heading', content: [{ text: 'plain' }], fontSize: 32, fontWeight: 700 }),
  );
  assert(
    headingEl.includes('<h1 '),
    '(3) unflagged heading element keeps <h1> wrapper (regression)',
  );
}

// ---------------------------------------------------------------------------
// (4) Markdown source renders to expected HTML
// ---------------------------------------------------------------------------

{
  const heading = renderText(baseText({ isRichText: true, content: [{ text: '# Heading' }] }));
  assert(heading.includes('<h1>Heading</h1>'), `(4) # → <h1>, got ${heading}`);
}

{
  const multi = renderText(
    baseText({ isRichText: true, content: [{ text: 'Para 1\n\nPara 2' }] }),
  );
  assert(multi.includes('<p>Para 1</p>'), `(4) first paragraph rendered, got ${multi}`);
  assert(multi.includes('<p>Para 2</p>'), `(4) second paragraph rendered, got ${multi}`);
}

{
  const list = renderText(baseText({ isRichText: true, content: [{ text: '- a\n- b' }] }));
  assert(list.includes('<ul>'), `(4) unordered list rendered, got ${list}`);
  assert(list.includes('<li>a</li>'), `(4) list item a rendered, got ${list}`);
  assert(list.includes('<li>b</li>'), `(4) list item b rendered, got ${list}`);
}

{
  const inline = renderText(
    baseText({ isRichText: true, content: [{ text: '**bold** and *italic*' }] }),
  );
  assert(inline.includes('<strong>bold</strong>'), `(4) **bold** → <strong>, got ${inline}`);
  assert(inline.includes('<em>italic</em>'), `(4) *italic* → <em>, got ${inline}`);
}

// ---------------------------------------------------------------------------
// (5) Raw HTML in source is escaped, not passed through (html: false)
// ---------------------------------------------------------------------------

{
  const xss = renderText(
    baseText({
      isRichText: true,
      content: [{ text: '<script>alert(1)</script>\n\nbody' }],
    }),
  );
  assert(
    !xss.includes('<script>'),
    `(5) raw <script> must NOT appear in output (got ${xss})`,
  );
  assert(
    xss.includes('&lt;script&gt;') || xss.includes('&lt;script') || xss.includes('script&gt;'),
    `(5) raw <script> must be escaped (got ${xss})`,
  );
}

{
  const iframe = renderText(
    baseText({
      isRichText: true,
      content: [{ text: '<iframe src="evil"></iframe>' }],
    }),
  );
  assert(!iframe.includes('<iframe'), `(5) raw <iframe> must NOT appear (got ${iframe})`);
}

// ---------------------------------------------------------------------------
// (6) Materializer flows entry Markdown source into a flagged TextElement
//     unchanged. The renderer then converts to HTML at publish.
// ---------------------------------------------------------------------------

{
  const templateBody = baseText({
    id: 'hero-body',
    isRichText: true,
    content: [{ text: '{{body}}' }],
  });
  const templatePage: CanvasPage = {
    id: 'page-blog-template',
    slug: 'blog-template',
    title: '{{title}}',
    width: 1200,
    sections: [
      {
        id: 'sec-hero',
        recipeId: 'custom',
        name: 'Hero',
        height: 800,
        elements: [templateBody],
      } satisfies CanvasSection,
    ],
    pageKind: 'collection-item-template',
    collectionSlug: 'blog',
  };
  const site: EditableSite = { styleKit: 'charcoal', pages: [templatePage] };
  const entry: MaterializerEntry = {
    collectionSlug: 'blog',
    slug: 'launch',
    title: 'Launch announcement',
    excerpt: 'We shipped.',
    body: '# Welcome\n\nFirst paragraph.\n\n- bullet a\n- bullet b',
    publishedDate: '2026-06-04T00:00:00.000Z',
    author: 'Alice',
    category: 'blog',
    tags: ['launch'],
    ogImageAssetId: null,
  };
  const out = materializeCollections(site, [entry]);
  assert(out.pages.length === 1, '(6) template expanded to one concrete page');
  const clone = out.pages[0]!;
  const bodyEl = clone.sections[0]!.elements[0] as TextElement;
  assert(bodyEl.isRichText === true, '(6) materializer preserves isRichText flag');
  assert(
    bodyEl.content[0]!.text === '# Welcome\n\nFirst paragraph.\n\n- bullet a\n- bullet b',
    `(6) materializer substitutes {{body}} as raw markdown source (got ${JSON.stringify(bodyEl.content[0]!.text)})`,
  );

  const rendered = renderText(bodyEl);
  assert(rendered.includes('<h1>Welcome</h1>'), `(6) renderer turns # into <h1> (got ${rendered})`);
  assert(
    rendered.includes('<p>First paragraph.</p>'),
    `(6) renderer turns paragraph into <p> (got ${rendered})`,
  );
  assert(rendered.includes('<ul>'), `(6) renderer turns list into <ul> (got ${rendered})`);
}

// ---------------------------------------------------------------------------
// (7) The materializer-produced clone validates end-to-end (no schema break)
// ---------------------------------------------------------------------------

{
  const templateBody = baseText({
    id: 'hero-body',
    isRichText: true,
    content: [{ text: '{{body}}' }],
  });
  const templatePage: CanvasPage = {
    id: 'page-blog-template',
    slug: 'blog-template',
    title: '{{title}}',
    width: 1200,
    sections: [
      {
        id: 'sec-hero',
        recipeId: 'custom',
        name: 'Hero',
        height: 800,
        elements: [templateBody],
      },
    ],
    pageKind: 'collection-item-template',
    collectionSlug: 'blog',
  };
  const site: EditableSite = { styleKit: 'charcoal', pages: [templatePage] };
  const entry: MaterializerEntry = {
    collectionSlug: 'blog',
    slug: 'launch',
    title: 'Launch',
    excerpt: 'Short.',
    body: '# Hi',
    publishedDate: '2026-06-04T00:00:00.000Z',
    author: 'A',
    category: 'blog',
    tags: [],
    ogImageAssetId: null,
  };
  const out = materializeCollections(site, [entry]);
  const result = validateEditableSite(out);
  assert(
    result.valid,
    `(7) materialized site must validate (errors: ${result.valid ? '' : result.errors.join('; ')})`,
  );
}

console.log('[text-richtext:smoke] OK');
