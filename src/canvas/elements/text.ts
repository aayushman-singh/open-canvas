// src/canvas/elements/text.ts
//
// Render fn for `TextElement`. The interface still lives in
// `src/canvas/schema.ts` next to the other historical element interfaces;
// this file owns the renderer only.

import { escapeAttr, renderInlineRun, styleFromEntries } from './render-utils.js';
import type { TextElement } from '../schema.js';

export function renderText(element: TextElement): string {
  const tag = element.role === 'heading' ? 'h1' : element.role === 'body' ? 'p' : 'span';
  const innerStyle = styleFromEntries([
    ['font-size', `${String(element.fontSize)}px`],
    ['font-weight', String(element.fontWeight)],
    ['text-align', element.align],
    ['margin', '0'],
  ]);
  const runsHtml = element.content.map(renderInlineRun).join('');
  return `<${tag} class="rev01-text" data-role="${escapeAttr(element.role)}" style="${innerStyle}">${runsHtml}</${tag}>`;
}
