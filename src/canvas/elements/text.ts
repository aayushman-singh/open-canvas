// src/canvas/elements/text.ts
//
// `TextElement` interface + renderer + inspector spec (ADR 0011 Step 1).
// Single owner of the text element type, including the constraints on
// fontSize / fontWeight / align that the editor inspector enforces.

import type { JsonSchema } from '../../agent/llm.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, renderInlineRun, styleFromEntries } from './render-utils.js';
import {
  INLINE_MARK_TYPES,
  TEXT_ROLES,
  type BaseElement,
  type InlineMark,
  type InlineRun,
  type TextRole,
} from '../schema.js';
import { isAllowedHref } from '../validate.js';

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

export const textSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'text',
      sidebarLabel: 'Text',
      sidebarTip: 'Add text',
      toolbarLabel: '+T',
      toolbarTip: 'Add text',
      factoryName: 'text',
    },
  ],
};

// ---------------------------------------------------------------------------
// Agent tool spec — text element (ADR 0011 Step 2)
// ---------------------------------------------------------------------------
//
// Text owns inline-run parsing: parseTextInlineRuns + the underlying
// parseInlineMark helper live here because InlineRun[] is text's data
// shape. `src/agent/tool-parsers.ts` keeps its own copy during migration;
// the cutover (PR 4) deletes that duplicate and routes through this spec.

function isRecordLocal(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInlineMark(value: unknown, runIdx: number, markIdx: number): InlineMark | string {
  if (!isRecordLocal(value)) {
    return `mark[${String(runIdx)}][${String(markIdx)}] must be an object`;
  }
  if (!(INLINE_MARK_TYPES as readonly string[]).includes(value.type as string)) {
    return `mark[${String(runIdx)}][${String(markIdx)}].type must be one of [${INLINE_MARK_TYPES.join(', ')}] (got ${JSON.stringify(value.type)})`;
  }
  if (value.type === 'link') {
    if (typeof value.href !== 'string' || value.href.length === 0) {
      return `mark[${String(runIdx)}][${String(markIdx)}] is a link mark but href is missing or empty`;
    }
    if (!isAllowedHref(value.href)) {
      return `mark[${String(runIdx)}][${String(markIdx)}] link href ${JSON.stringify(value.href)} is not allowed`;
    }
    return { type: 'link', href: value.href };
  }
  return { type: value.type as InlineMark['type'] } as InlineMark;
}

export function parseTextInlineRuns(
  value: unknown,
): { ok: true; runs: InlineRun[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'content must be an array of InlineRun objects (not a string)' };
  }
  if (value.length === 0) {
    return { ok: false, error: 'content must be a non-empty array' };
  }
  const runs: InlineRun[] = [];
  const items: unknown[] = value;
  for (let i = 0; i < items.length; i++) {
    const raw: unknown = items[i];
    if (!isRecordLocal(raw)) {
      return { ok: false, error: `content[${String(i)}] must be an object` };
    }
    if (typeof raw.text !== 'string') {
      return { ok: false, error: `content[${String(i)}].text must be a string` };
    }
    const run: InlineRun = { text: raw.text };
    if (raw.marks !== undefined) {
      if (!Array.isArray(raw.marks)) {
        return { ok: false, error: `content[${String(i)}].marks must be an array when present` };
      }
      const marks: InlineMark[] = [];
      const markItems: unknown[] = raw.marks;
      for (let m = 0; m < markItems.length; m++) {
        const parsed = parseInlineMark(markItems[m], i, m);
        if (typeof parsed === 'string') return { ok: false, error: parsed };
        marks.push(parsed);
      }
      run.marks = marks;
    }
    runs.push(run);
  }
  return { ok: true, runs };
}

const inlineMarkSchema: JsonSchema = {
  type: 'object',
  description:
    'One inline mark applied to a run of text. Valid shapes:\n' +
    '  { "type": "bold" } | { "type": "italic" } | { "type": "underline" } |\n' +
    '  { "type": "strike" } | { "type": "code" } | { "type": "highlight" } |\n' +
    '  { "type": "link", "href": "https://example.com" }\n' +
    'For link marks, `href` MUST be http:, https:, mailto:, tel:, /relative, or #anchor — javascript: and data: are rejected.',
  properties: {
    type: {
      type: 'string',
      enum: [...INLINE_MARK_TYPES],
      description: 'Mark kind. Required.',
    },
    href: {
      type: 'string',
      description:
        'Required ONLY when type=="link". http:/https:/mailto:/tel: schemes, plus /relative and #anchor, are allowed.',
    },
  },
  required: ['type'],
};

const inlineRunSchema: JsonSchema = {
  type: 'object',
  description:
    'One inline run of text. `text` is the raw run text (no HTML). `marks` carries 0..N InlineMark objects.',
  properties: {
    text: {
      type: 'string',
      description:
        'Raw text for this run. Empty string is allowed only when the run carries marks.',
    },
    marks: {
      type: 'array',
      items: inlineMarkSchema,
      description:
        'Optional. 0..N marks applied to this run. A run cannot carry two marks of the same `type`.',
    },
  },
  required: ['text'],
};

export const textAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    fontSize: {
      type: 'number',
      description: `Font size in px (${String(TEXT_FONT_SIZE_MIN)}-${String(TEXT_FONT_SIZE_MAX)}). Text elements only.`,
    },
    fontWeight: {
      type: 'number',
      description: 'Font weight (400, 500, 600, 700). Text elements only.',
    },
    align: {
      type: 'string',
      enum: [...TEXT_ALIGNS],
      description: 'Text alignment. Text elements only.',
    },
    role: {
      type: 'string',
      enum: [...TEXT_ROLES],
      description: 'Semantic role. Text elements only.',
    },
    content: {
      type: 'array',
      items: inlineRunSchema,
      description:
        'Replacement inline content as InlineRun[]. Text elements only. Prefer the `rewriteText` standalone tool.',
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.fontSize !== undefined) {
      if (typeof args.fontSize !== 'number' || !Number.isFinite(args.fontSize)) {
        throw new Error('fontSize must be a number');
      }
      patch.fontSize = args.fontSize;
    }
    if (args.fontWeight !== undefined) {
      if (typeof args.fontWeight !== 'number' || !Number.isFinite(args.fontWeight)) {
        throw new Error('fontWeight must be a number');
      }
      patch.fontWeight = args.fontWeight;
    }
    if (args.align !== undefined) {
      if (typeof args.align !== 'string') throw new Error('align must be a string');
      patch.align = args.align;
    }
    if (args.role !== undefined) {
      if (typeof args.role !== 'string') throw new Error('role must be a string');
      patch.role = args.role;
    }
    if (args.content !== undefined) {
      const parsed = parseTextInlineRuns(args.content);
      if (!parsed.ok) throw new Error(parsed.error);
      patch.content = parsed.runs;
    }
    return patch;
  },
  standaloneTool: {
    tool: {
      name: 'rewriteText',
      description:
        'Replace the inline runs of an existing text element. The replacement MUST be an InlineRun[] ' +
        '(array of { text, marks? } objects) — never a plain string. The concatenated plain text must not be empty.',
      parameters: {
        type: 'object',
        properties: {
          elementId: {
            type: 'string',
            description:
              'The id of the existing text element to rewrite. Must be present on the page.',
          },
          content: {
            type: 'array',
            items: inlineRunSchema,
            description:
              'The replacement content. MUST be an array of InlineRun objects — NEVER a plain string. ' +
              'Example: [{ "text": "Ship a site that feels " }, { "text": "lived-in", "marks": [{ "type": "bold" }] }, { "text": "." }]. ' +
              'The concatenated plain text must not be empty.',
          },
        },
        required: ['elementId', 'content'],
      },
    },
    parse: (args) => {
      if (!isRecordLocal(args)) {
        return { ok: false, error: 'rewriteText arguments must be an object' };
      }
      if (typeof args.elementId !== 'string' || args.elementId.length === 0) {
        return { ok: false, error: 'rewriteText.elementId must be a non-empty string' };
      }
      const parsed = parseTextInlineRuns(args.content);
      if (!parsed.ok) return { ok: false, error: `rewriteText.${parsed.error}` };
      return {
        ok: true,
        op: { kind: 'rewriteText', elementId: args.elementId, content: parsed.runs },
      };
    },
  },
};
