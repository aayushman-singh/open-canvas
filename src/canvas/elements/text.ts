// src/canvas/elements/text.ts
//
// Render fn for the existing `TextElement` element type. This file does not
// re-declare the `TextElement` interface — that still lives in
// `src/canvas/schema.ts` next to the other historical element interfaces.
// The Phase 0 element registry pulls this render function into
// RENDER_DISPATCH alongside the nine new element types.

import { escapeAttr, escapeHtml, findLinkMark, hasMark, styleFromEntries } from './render-utils.js';
import type { InlineRun, TextElement } from '../schema.js';

/**
 * Build the nested-mark HTML for one inline run. Mark order is fixed:
 *
 *   <a> outermost (only when a link mark is present)
 *   <strong>, <em>, <u>, <s>, <mark>, <code> (innermost wraps the text node)
 *
 * The order is deliberately stable so identical content arrays always
 * produce byte-identical HTML — needed for diff stability, snapshot
 * rendering, and the editor's round-trip serializer.
 */
function renderRun(run: InlineRun): string {
  const escapedText = escapeHtml(run.text);
  let inner = escapedText;
  if (hasMark(run, 'code')) inner = `<code>${inner}</code>`;
  if (hasMark(run, 'highlight')) inner = `<mark>${inner}</mark>`;
  if (hasMark(run, 'strike')) inner = `<s>${inner}</s>`;
  if (hasMark(run, 'underline')) inner = `<u>${inner}</u>`;
  if (hasMark(run, 'italic')) inner = `<em>${inner}</em>`;
  if (hasMark(run, 'bold')) inner = `<strong>${inner}</strong>`;
  const link = findLinkMark(run);
  if (link) {
    inner = `<a class="rev01-inline-link" href="${escapeAttr(link.href)}">${inner}</a>`;
  }
  // The bare <span> wrapper is kept even for no-mark runs because it gives the
  // editor a stable DOM addressing target per run.
  return `<span>${inner}</span>`;
}

export function renderText(element: TextElement): string {
  const tag = element.role === 'heading' ? 'h1' : element.role === 'body' ? 'p' : 'span';
  const innerStyle = styleFromEntries([
    ['font-size', `${String(element.fontSize)}px`],
    ['font-weight', String(element.fontWeight)],
    ['text-align', element.align],
    ['margin', '0'],
  ]);
  const runsHtml = element.content.map((run) => renderRun(run)).join('');
  return `<${tag} class="rev01-text" data-role="${escapeAttr(element.role)}" style="${innerStyle}">${runsHtml}</${tag}>`;
}
