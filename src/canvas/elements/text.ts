// src/canvas/elements/text.ts
//
// `TextElement` interface + renderer + inspector spec (ADR 0011 Step 1).
// Single owner of the text element type, including the constraints on
// fontSize / fontWeight / align that the editor inspector enforces.

import type { InspectorSpec } from './inspector-spec.js';
import { escapeAttr, renderInlineRun, styleFromEntries } from './render-utils.js';
import { TEXT_ROLES, type BaseElement, type InlineRun, type TextRole } from '../schema.js';

/** Minimum free-form font-size inspector input accepts. Anything below
 * collapses headings into illegible micro-print on visitor pages. */
export const TEXT_FONT_SIZE_MIN = 12;
/** Maximum free-form font-size inspector input accepts. Anything above
 * blows hero text past the canvas's usable width on most viewports. */
export const TEXT_FONT_SIZE_MAX = 96;

/**
 * Curated weights — Regular (400), Medium (500), Semibold (600), Bold (700).
 * Lighter (100–300) and heavier (800–900) weights are intentionally
 * excluded: webfonts rarely ship every step and the owner UI keeps choice
 * minimal. The inspector renders this list verbatim as a select.
 */
export const TEXT_FONT_WEIGHTS = [400, 500, 600, 700] as const;
export type TextFontWeight = (typeof TEXT_FONT_WEIGHTS)[number];

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export interface TextElement extends BaseElement {
  type: 'text';
  // 1..N inline runs; the concatenation of run.text is the plain-text
  // projection. Replaces the prior `text: string` field — there is no
  // backwards-compat shim, the dev DB is empty.
  content: InlineRun[];
  role: TextRole;
  fontSize: number;
  fontWeight: TextFontWeight;
  align: TextAlign;
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

export const textInspectorSpec: InspectorSpec = {
  fields: [
    {
      kind: 'button-action',
      label: 'AI rewrite',
      action: 'rewrite-text',
      dataAttr: 'rewrite-text',
      busyFlag: 'aiBusy',
    },
    { kind: 'select', label: 'Role', path: 'role', options: TEXT_ROLES },
    {
      kind: 'number',
      label: 'Font size',
      path: 'fontSize',
      min: TEXT_FONT_SIZE_MIN,
      max: TEXT_FONT_SIZE_MAX,
    },
    {
      kind: 'select-mapped',
      label: 'Font weight',
      path: 'fontWeight',
      options: TEXT_FONT_WEIGHTS.map((w) => ({ label: String(w), value: w })),
      defaultValue: 400,
    },
    { kind: 'select', label: 'Align', path: 'align', options: TEXT_ALIGNS },
  ],
};
