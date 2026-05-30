// src/canvas/elements/render-utils.smoke.ts
//
// Smoke test for the shared inline-run renderer (renderInlineRun) and the
// HTML tag contract for inline marks.
//
// Why this exists: the rich-text editor's strikethrough mark used to emit
// <strike>, an HTML4 element that's been deprecated since 1999 and removed
// from the HTML5 element list. Modern browsers still render it, but it's a
// real validation + accessibility regression. The Pass-7 finding asks for
// the rendered HTML to use <s> instead. This smoke pins the contract so a
// future refactor cannot silently regress to <strike>.
//
// Run with `bun.cmd run render-utils:smoke`.

import type { InlineMark, InlineRun } from '../schema.js';
import { renderInlineRun } from './render-utils.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function runWith(marks: InlineMark[], text = 'hello'): InlineRun {
  return { text, marks };
}

// --- strike mark must render as <s>, never <strike> ---

const strikeOnly = renderInlineRun(runWith([{ type: 'strike' }]));
assert(strikeOnly.includes('<s>'), 'strike mark must emit <s> open tag');
assert(strikeOnly.includes('</s>'), 'strike mark must emit </s> close tag');
assert(!strikeOnly.includes('<strike'), 'strike mark must NOT emit <strike> (HTML4, deprecated)');
assert(!strikeOnly.includes('strike>'), 'strike mark must NOT emit </strike>');
assert(
  strikeOnly === '<span><s>hello</s></span>',
  `expected exact byte equality; got ${strikeOnly}`,
);

// Combined with bold, italic, underline — ordering test from the comment
// in render-utils.ts. The strike tag must sit under <u> and over <code>.
const allMarks = renderInlineRun(
  runWith([
    { type: 'bold' },
    { type: 'italic' },
    { type: 'underline' },
    { type: 'strike' },
    { type: 'code' },
    { type: 'highlight' },
  ]),
);
assert(allMarks.includes('<s>'), 'combined mark stack must include <s>');
assert(!allMarks.includes('<strike'), 'combined mark stack must NOT include <strike>');

// --- other mark tags are stable and known-good ---

assert(
  renderInlineRun(runWith([{ type: 'bold' }])) === '<span><strong>hello</strong></span>',
  'bold must emit <strong>',
);
assert(
  renderInlineRun(runWith([{ type: 'italic' }])) === '<span><em>hello</em></span>',
  'italic must emit <em>',
);
assert(
  renderInlineRun(runWith([{ type: 'underline' }])) === '<span><u>hello</u></span>',
  'underline must emit <u>',
);
assert(
  renderInlineRun(runWith([{ type: 'code' }])) === '<span><code>hello</code></span>',
  'code must emit <code>',
);
assert(
  renderInlineRun(runWith([{ type: 'highlight' }])) === '<span><mark>hello</mark></span>',
  'highlight must emit <mark>',
);

// --- no marks renders the bare-span shape used by the editor ---

assert(
  renderInlineRun(runWith([], 'plain')) === '<span>plain</span>',
  'no-mark run still wraps in <span> for stable editor DOM addressing',
);

console.log('✓ render-utils smoke passed');
