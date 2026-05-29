// src/canvas/elements/code.ts
//
// CodeElement interface (frozen at Phase 0) + the render function that
// hands the source to Shiki for tokenisation and wraps the result with
// kit-themed chrome.
//
// The Shiki bundle (11 languages + 1 light theme + the JavaScript regex
// engine) lives in `src/code/highlight.ts`. This file's only job is:
//   1. Decide between the Shiki path (supported language) and the plain
//      pre/code path (unsupported language).
//   2. Emit the outer wrapper that carries the kit's `panel` background
//      and the kit's `fontFamilyMono` typeface.

import type { BaseElement } from '../schema.js';
import type { StyleKitPreset } from '../schema.js';
import { getStyleKitPreset } from '../style-kits.js';

import {
  highlightCode,
  isSupportedLanguage,
  renderPlainCodeSnippet,
} from '../../code/highlight.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, escapeCssValue } from './render-utils.js';

export const CODE_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
  'json',
  'bash',
  'sql',
  'html',
  'css',
  'markdown',
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export interface CodeElement extends BaseElement {
  type: 'code';
  language: CodeLanguage;
  source: string;
  showLineNumbers: boolean;
}

export interface CodeRenderCtx {
  styleKit: string;
  customPreset?: StyleKitPreset | null;
}

/**
 * Render a Code element. Returns a single `<div class="rev01-code-snippet">`
 * wrapper containing either the Shiki-highlighted `<pre>` or, for an
 * unsupported language, plain escaped pre/code output.
 *
 * Surface chrome:
 *   - Background colour is the Style Kit's `panel` token.
 *   - Code typeface is the Style Kit's `fontFamilyMono`.
 *   - Border radius matches the kit's `radius`.
 * Inline styles are used so the published snapshot is self-contained —
 * the kit CSS layer is still required for token *colours* (light theme),
 * but the wrapper chrome works even when no extra CSS loads.
 */
export function renderCode(el: CodeElement, ctx: CodeRenderCtx): string {
  // Custom kits are resolved once per render and passed through context. Keep
  // the resolved preset request-scoped so concurrent renders cannot share style
  // data through module globals.
  let panel: string;
  let fontMono: string;
  let radius: string;
  if (ctx.styleKit === 'custom') {
    if (!ctx.customPreset) {
      throw new Error(
        'renderCode: styleKit is "custom" but no resolved custom preset was provided.',
      );
    }
    panel = ctx.customPreset.panel;
    fontMono = ctx.customPreset.fontFamilyMono;
    radius = ctx.customPreset.radius;
  } else {
    const preset = getStyleKitPreset(ctx.styleKit);
    panel = preset.panel;
    fontMono = preset.fontFamilyMono;
    radius = preset.radius;
  }

  // Branch: curated language -> Shiki, anything else -> plain pre/code.
  // The language field on the interface is statically narrowed to
  // CodeLanguage; the `isSupportedLanguage` guard exists for defence in
  // depth (a hand-edited / migration-corrupted state could carry an
  // out-of-set string at runtime).
  const inner = isSupportedLanguage(el.language)
    ? highlightCode(el.source, el.language, {
        styleKit: ctx.styleKit,
        showLineNumbers: el.showLineNumbers,
      })
    : renderPlainCodeSnippet(el.source, el.language, {
        styleKit: ctx.styleKit,
        showLineNumbers: el.showLineNumbers,
      });

  // Sanitise kit-derived CSS values defensively — even though the preset
  // table is a frozen literal, every CSS injection point in the renderer
  // goes through `escapeCssValue` for consistency. `escapeCssValue`
  // returns '' on hostile input, in which case we drop the inline style.
  const safePanel = escapeCssValue(panel);
  const safeFontMono = escapeCssValue(fontMono);
  const safeRadius = escapeCssValue(radius);

  const styleParts: string[] = [];
  if (safePanel !== '') styleParts.push(`background:${safePanel}`);
  if (safeFontMono !== '') styleParts.push(`font-family:${safeFontMono}`);
  if (safeRadius !== '') styleParts.push(`border-radius:${safeRadius}`);
  styleParts.push('padding:16px');
  styleParts.push('overflow:auto');
  styleParts.push('width:100%');
  styleParts.push('height:100%');
  styleParts.push('box-sizing:border-box');
  const style = styleParts.join(';');

  const dataAttrs = [
    `data-language="${escapeAttr(el.language)}"`,
    `data-line-numbers="${el.showLineNumbers ? 'true' : 'false'}"`,
  ].join(' ');

  return `<div class="rev01-code-snippet" ${dataAttrs} style="${style}">${inner}</div>`;
}

export const CODE_RECIPE_ID = 'code-card' as const;

export const codeInspectorSpec: InspectorSpec = {
  fields: [
    {
      kind: 'select',
      label: 'Language',
      path: 'language',
      options: CODE_LANGUAGES,
      defaultValue: 'typescript',
    },
    {
      kind: 'textarea',
      label: 'Source',
      path: 'source',
      rows: 8,
      cssText:
        'width:100%;font-family:monospace;font-size:12px;resize:vertical;box-sizing:border-box;',
    },
    { kind: 'checkbox', label: 'Line numbers', path: 'showLineNumbers' },
  ],
};

export const codeSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'code',
      sidebarLabel: 'Code',
      sidebarTip: 'Add a code snippet',
      factoryName: 'code',
    },
  ],
};

export const codeAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    language: {
      type: 'string',
      enum: [...CODE_LANGUAGES],
      description: 'Programming language. Code elements only.',
    },
    source: {
      type: 'string',
      description: 'Source code content. Code elements only.',
    },
    showLineNumbers: {
      type: 'boolean',
      description: 'Show line numbers. Code elements only.',
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.language !== undefined) {
      if (typeof args.language !== 'string') throw new Error('language must be a string');
      patch.language = args.language;
    }
    if (args.source !== undefined) {
      if (typeof args.source !== 'string') throw new Error('source must be a string');
      patch.source = args.source;
    }
    if (args.showLineNumbers !== undefined) {
      if (typeof args.showLineNumbers !== 'boolean') {
        throw new Error('showLineNumbers must be a boolean');
      }
      patch.showLineNumbers = args.showLineNumbers;
    }
    return patch;
  },
};
