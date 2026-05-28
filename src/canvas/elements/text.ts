// src/canvas/elements/text.ts
//
// `TextElement` interface + renderer. Single owner of the text element type.

import { escapeAttr, renderInlineRun, styleFromEntries } from './render-utils.js';
import type { BaseElement, InlineRun, TextRole } from '../schema.js';

export interface TextElement extends BaseElement {
  type: 'text';
  // 1..N inline runs; the concatenation of run.text is the plain-text
  // projection. Replaces the prior `text: string` field — there is no
  // backwards-compat shim, the dev DB is empty.
  content: InlineRun[];
  role: TextRole;
  fontSize: number;
  /**
   * Curated to four conceptual weights — Regular (400), Medium (500),
   * Semibold (600), Bold (700) — matching the inspector dropdown. Lighter
   * (100–300) and heavier (800–900) weights are intentionally excluded:
   * webfonts rarely ship every step and the owner UI keeps choice minimal.
   */
  fontWeight: 400 | 500 | 600 | 700;
  align: 'left' | 'center' | 'right';
}

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
