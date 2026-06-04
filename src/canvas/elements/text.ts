// src/canvas/elements/text.ts
//
// `TextElement` interface + renderer + inspector spec (ADR 0011 Step 1).
// Single owner of the text element type, including the constraints on
// fontSize / fontWeight / align that the editor inspector enforces.

import MarkdownIt from 'markdown-it';

import type { JsonSchema } from '../../agent/llm.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, escapeCssValue, renderInlineRun, styleFromEntries } from './render-utils.js';
import {
  INLINE_COLOR_HEX_RE,
  INLINE_FONT_SIZE_PX_MAX,
  INLINE_FONT_SIZE_PX_MIN,
  INLINE_MARK_TYPES,
  INLINE_MATH_TEX_MAX_LEN,
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

/**
 * Optional `textWrap`. `'pretty'` avoids body-text orphans;
 * `'balance'` distributes heading lines evenly (best on ≤6 lines).
 * Absence leaves wrap behaviour at the browser default.
 */
export const TEXT_WRAPS = ['pretty', 'balance'] as const;
export type TextWrap = (typeof TEXT_WRAPS)[number];

/**
 * Optional `textTransform`. Absence = no transform — the enum intentionally
 * omits `'none'` because field-present-but-none is indistinguishable from
 * field-absent for the renderer.
 */
export const TEXT_TRANSFORMS = ['uppercase', 'lowercase', 'capitalize'] as const;
export type TextTransform = (typeof TEXT_TRANSFORMS)[number];

/** Bounds on `lineHeight`. Anything outside collapses lines (low) or
 * blows them apart past usable rhythm (high). */
export const TEXT_LINE_HEIGHT_MIN = 0.5;
export const TEXT_LINE_HEIGHT_MAX = 3.0;

/** Bounds on `fluidSize.vw`. Below 1vw the slope is invisible (clamp acts
 * as static); above 30vw heading text grows faster than the viewport on
 * ultra-wide displays and breaks layout. ADR 0050 dec 1. */
export const TEXT_FLUID_VW_MIN = 1;
export const TEXT_FLUID_VW_MAX = 30;

/**
 * Opt-in fluid font sizing via CSS `clamp()`. When set, the renderer emits
 * `font-size: clamp(<min>px, <vw>vw, <max>px)` and ignores the static
 * `fontSize`. `fontSize` remains required as the structured-fallback contract
 * (inspector px input, agent default, validator bound). ADR 0050 dec 1.
 */
export interface FluidSize {
  /** Minimum px size — the lower clamp() rail. */
  min: number;
  /** Maximum px size — the upper clamp() rail. */
  max: number;
  /** Viewport-width factor in vw units. Bounded by TEXT_FLUID_VW_MIN/MAX. */
  vw: number;
}

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
  /** CSS `letter-spacing` value — '-0.02em', '0.18em', 'normal'. Escape-validated. */
  letterSpacing?: string;
  /** CSS `text-wrap` — 'pretty' for body, 'balance' for headings. */
  textWrap?: TextWrap;
  /** Unitless `line-height` multiplier, bounded [0.5, 3.0]. */
  lineHeight?: number;
  /** CSS `text-transform`. Absence = no transform. */
  textTransform?: TextTransform;
  /**
   * Opt-in fluid font sizing via CSS `clamp()`. ADR 0050 dec 1. When present,
   * the renderer emits `clamp(min px, vw vw, max px)` and `fontSize` becomes
   * the structured fallback only.
   */
  fluidSize?: FluidSize;
  /**
   * ADR 0060 F1. When true, the renderer treats `content[0].text` as
   * CommonMark Markdown and emits it as HTML inside a `<div>` wrapper.
   * Inline runs beyond the first, marks, math, and the `role`-driven
   * `<h1>`/`<p>`/`<span>` tag selection are all ignored on flagged
   * elements — the rendered HTML may contain its own block-level structure
   * (`<h1>..<h6>`, `<p>`, `<ul>`, `<blockquote>`, `<pre>`, `<code>`) which
   * cannot legally nest inside `<p>` or `<h1>`. Raw HTML in the source is
   * escaped, not passed through, so a malicious paste cannot inject markup.
   * Intended for CMS entry bodies surfaced via `{{body}}` placeholders that
   * the materializer substitutes pre-publish — but any text element can opt
   * in via the inspector.
   */
  isRichText?: boolean;
}

// Single shared MarkdownIt instance — pure CommonMark + line-break-as-<br>,
// no raw HTML, no autolink. The set of emitted tags is fixed by the
// CommonMark grammar (no plugins enabled) and is HTML-safe by construction:
// `<h1>`-`<h6>`, `<p>`, `<ul>`, `<ol>`, `<li>`, `<blockquote>`, `<pre>`,
// `<code>`, `<em>`, `<strong>`, `<a>` (href escaped), `<hr>`, `<br>`. No
// `<script>`, `<style>`, `<iframe>` paths exist with `html: false`.
const RICH_TEXT_MD = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
  typographer: false,
});

function renderRichText(element: TextElement): string {
  const source = element.content[0]?.text ?? '';
  const entries: [string, string][] = [
    ['font-size', `${String(element.fontSize)}px`],
    ['font-weight', String(element.fontWeight)],
    ['text-align', element.align],
    ['margin', '0'],
  ];
  if (element.letterSpacing !== undefined) {
    entries.push(['letter-spacing', escapeCssValue(element.letterSpacing)]);
  }
  if (element.lineHeight !== undefined) {
    entries.push(['line-height', String(element.lineHeight)]);
  }
  if (element.textTransform !== undefined) {
    entries.push(['text-transform', element.textTransform]);
  }
  const innerStyle = styleFromEntries(entries);
  const html = RICH_TEXT_MD.render(source);
  return `<div class="opencanvas-text opencanvas-richtext" data-role="${escapeAttr(element.role)}" style="${innerStyle}">${html}</div>`;
}

export function renderText(element: TextElement): string {
  if (element.isRichText === true) {
    return renderRichText(element);
  }
  const tag = element.role === 'heading' ? 'h1' : element.role === 'body' ? 'p' : 'span';
  // ADR 0050 dec 1 — fluid font sizing takes precedence over the static
  // fontSize when present. fontSize remains the structured-fallback contract
  // for consumers that don't see the fluidSize triple.
  const fontSizeValue =
    element.fluidSize !== undefined
      ? `clamp(${String(element.fluidSize.min)}px,${String(element.fluidSize.vw)}vw,${String(element.fluidSize.max)}px)`
      : `${String(element.fontSize)}px`;
  const entries: [string, string][] = [
    ['font-size', fontSizeValue],
    ['font-weight', String(element.fontWeight)],
    ['text-align', element.align],
    ['margin', '0'],
  ];
  if (element.letterSpacing !== undefined) {
    entries.push(['letter-spacing', escapeCssValue(element.letterSpacing)]);
  }
  if (element.textWrap !== undefined) {
    entries.push(['text-wrap', element.textWrap]);
  }
  if (element.lineHeight !== undefined) {
    entries.push(['line-height', String(element.lineHeight)]);
  }
  if (element.textTransform !== undefined) {
    entries.push(['text-transform', element.textTransform]);
  }
  const innerStyle = styleFromEntries(entries);
  const runsHtml = element.content.map(renderInlineRun).join('');
  return `<${tag} class="opencanvas-text" data-role="${escapeAttr(element.role)}" style="${innerStyle}">${runsHtml}</${tag}>`;
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
    // Font family picker — custom-mount because the option list is dynamic
    // (built from FONT_PRESETS + ctx.customFonts at render time) and can't
    // be expressed with the static select / select-mapped specs. Lives at
    // the top of the typography group so the surface reads top-down:
    // family → size → weight → align. Writes into
    // pinnedStyle["font-family"] (NOT a structured ElementStyle field) —
    // BaseElement.pinnedStyle's docblock explicitly names font-family as
    // a typography-ornament key that lives there.
    { kind: 'custom-mount', name: 'text-font-family' },
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
    {
      kind: 'text',
      label: 'Letter spacing',
      path: 'letterSpacing',
      placeholder: '-0.02em',
      emptyOmits: true,
    },
    {
      kind: 'text',
      label: 'Text wrap',
      path: 'textWrap',
      placeholder: 'pretty | balance',
      emptyOmits: true,
    },
    {
      kind: 'number',
      label: 'Line height',
      path: 'lineHeight',
      min: TEXT_LINE_HEIGHT_MIN,
      max: TEXT_LINE_HEIGHT_MAX,
    },
    {
      kind: 'text',
      label: 'Transform',
      path: 'textTransform',
      placeholder: 'uppercase | lowercase | capitalize',
      emptyOmits: true,
    },
    { kind: 'checkbox', label: 'Markdown body', path: 'isRichText' },
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
  if (value.type === 'fontSize') {
    if (typeof value.px !== 'number' || !Number.isFinite(value.px)) {
      return `mark[${String(runIdx)}][${String(markIdx)}] fontSize mark requires numeric px`;
    }
    if (value.px < INLINE_FONT_SIZE_PX_MIN || value.px > INLINE_FONT_SIZE_PX_MAX) {
      return `mark[${String(runIdx)}][${String(markIdx)}] fontSize px ${String(value.px)} out of range [${String(INLINE_FONT_SIZE_PX_MIN)}, ${String(INLINE_FONT_SIZE_PX_MAX)}]`;
    }
    return { type: 'fontSize', px: value.px };
  }
  if (value.type === 'color') {
    if (typeof value.color !== 'string' || value.color.length === 0) {
      return `mark[${String(runIdx)}][${String(markIdx)}] color mark requires a non-empty color string`;
    }
    if (!INLINE_COLOR_HEX_RE.test(value.color)) {
      return `mark[${String(runIdx)}][${String(markIdx)}] color ${JSON.stringify(value.color)} must be a hex colour (#RGB, #RRGGBB, or #RRGGBBAA)`;
    }
    return { type: 'color', color: value.color };
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
    if (raw.math !== undefined) {
      if (!isRecordLocal(raw.math)) {
        return { ok: false, error: `content[${String(i)}].math must be an object` };
      }
      if (typeof raw.math.tex !== 'string' || raw.math.tex.length === 0) {
        return { ok: false, error: `content[${String(i)}].math.tex must be a non-empty string` };
      }
      if (raw.math.tex.length > INLINE_MATH_TEX_MAX_LEN) {
        return {
          ok: false,
          error: `content[${String(i)}].math.tex exceeds ${String(INLINE_MATH_TEX_MAX_LEN)} chars`,
        };
      }
      run.math = { tex: raw.math.tex };
    }
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

function parseFluidSize(value: unknown): FluidSize | undefined {
  if (value === null || value === '') return undefined;
  if (!isRecordLocal(value)) {
    throw new Error('fluidSize must be an object with numeric min, max, vw');
  }
  const { min, max, vw } = value;
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    typeof vw !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    !Number.isFinite(vw)
  ) {
    throw new Error('fluidSize.min, fluidSize.max, and fluidSize.vw must be finite numbers');
  }
  if (min <= 0) throw new Error('fluidSize.min must be > 0');
  if (max <= min) throw new Error('fluidSize.max must be > min');
  if (vw < TEXT_FLUID_VW_MIN || vw > TEXT_FLUID_VW_MAX) {
    throw new Error(
      `fluidSize.vw must be between ${String(TEXT_FLUID_VW_MIN)} and ${String(TEXT_FLUID_VW_MAX)}`,
    );
  }
  return { min, max, vw };
}

const inlineMarkSchema: JsonSchema = {
  type: 'object',
  description:
    'One inline mark applied to a run of text. Valid shapes:\n' +
    '  { "type": "bold" } | { "type": "italic" } | { "type": "underline" } |\n' +
    '  { "type": "strike" } | { "type": "code" } | { "type": "highlight" } |\n' +
    '  { "type": "link", "href": "https://example.com" } |\n' +
    '  { "type": "fontSize", "px": 24 } |\n' +
    '  { "type": "color", "color": "#ff6600" }\n' +
    'For link marks, `href` MUST be http:, https:, mailto:, tel:, /relative, or #anchor — javascript: and data: are rejected. ' +
    `For fontSize marks, \`px\` is required and bounded [${String(INLINE_FONT_SIZE_PX_MIN)}, ${String(INLINE_FONT_SIZE_PX_MAX)}]. ` +
    'For color marks, `color` is required and must be a hex colour (#RGB, #RRGGBB, or #RRGGBBAA).',
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
    px: {
      type: 'number',
      description: `Required ONLY when type=="fontSize". Pixel size, ${String(INLINE_FONT_SIZE_PX_MIN)}-${String(INLINE_FONT_SIZE_PX_MAX)}.`,
    },
    color: {
      type: 'string',
      description:
        'Required ONLY when type=="color". Hex colour (#RGB, #RRGGBB, or #RRGGBBAA).',
    },
  },
  required: ['type'],
};

export const inlineRunSchema: JsonSchema = {
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
    letterSpacing: {
      type: 'string',
      description:
        "CSS `letter-spacing` value — '-0.02em', '0.18em', 'normal'. Text elements only.",
    },
    textWrap: {
      type: 'string',
      enum: [...TEXT_WRAPS],
      description: "CSS `text-wrap` — 'pretty' (body) or 'balance' (headings). Text elements only.",
    },
    lineHeight: {
      type: 'number',
      description: `Unitless line-height multiplier, ${String(TEXT_LINE_HEIGHT_MIN)}-${String(TEXT_LINE_HEIGHT_MAX)}. Text elements only.`,
    },
    textTransform: {
      type: 'string',
      enum: [...TEXT_TRANSFORMS],
      description:
        "CSS `text-transform` — 'uppercase', 'lowercase', or 'capitalize'. Text elements only.",
    },
    fluidSize: {
      type: 'object',
      description:
        'Optional fluid font sizing as { min, max, vw }. min/max are px rails, vw is the viewport-width factor. Pass null or empty to clear. Text elements only.',
      properties: {
        min: {
          type: 'number',
          minimum: TEXT_FONT_SIZE_MIN,
          description: 'Minimum clamp rail in px.',
        },
        max: {
          type: 'number',
          maximum: TEXT_FONT_SIZE_MAX,
          description: 'Maximum clamp rail in px.',
        },
        vw: {
          type: 'number',
          minimum: TEXT_FLUID_VW_MIN,
          maximum: TEXT_FLUID_VW_MAX,
          description: 'Viewport-width factor in vw units.',
        },
      },
      required: ['min', 'max', 'vw'],
    },
    isRichText: {
      type: 'boolean',
      description:
        'When true, the renderer treats content[0].text as CommonMark Markdown and emits HTML. Text elements only. ADR 0060 F1 — used for CMS entry bodies surfaced via {{body}}.',
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
    if (args.letterSpacing !== undefined) {
      if (typeof args.letterSpacing !== 'string') {
        throw new Error('letterSpacing must be a string');
      }
      patch.letterSpacing = args.letterSpacing;
    }
    if (args.textWrap !== undefined) {
      if (typeof args.textWrap !== 'string') throw new Error('textWrap must be a string');
      patch.textWrap = args.textWrap;
    }
    if (args.lineHeight !== undefined) {
      if (typeof args.lineHeight !== 'number' || !Number.isFinite(args.lineHeight)) {
        throw new Error('lineHeight must be a number');
      }
      if (args.lineHeight < TEXT_LINE_HEIGHT_MIN || args.lineHeight > TEXT_LINE_HEIGHT_MAX) {
        throw new Error(
          `lineHeight must be between ${String(TEXT_LINE_HEIGHT_MIN)} and ${String(TEXT_LINE_HEIGHT_MAX)}`,
        );
      }
      patch.lineHeight = args.lineHeight;
    }
    if (args.textTransform !== undefined) {
      if (typeof args.textTransform !== 'string') throw new Error('textTransform must be a string');
      patch.textTransform = args.textTransform;
    }
    if (args.fluidSize !== undefined) {
      patch.fluidSize = parseFluidSize(args.fluidSize);
    }
    if (args.isRichText !== undefined) {
      if (typeof args.isRichText !== 'boolean') {
        throw new Error('isRichText must be a boolean');
      }
      patch.isRichText = args.isRichText;
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
