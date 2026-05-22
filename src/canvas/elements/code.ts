// src/canvas/elements/code.ts
//
// Phase 0 stub. `CodeElement` interface + render stub. Wave 4 owner: see
// docs/superpowers/plans/2026-05-23-19-code-block.md.

import type { BaseElement } from '../schema.js';

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
}

export function renderCode(el: CodeElement, ctx: CodeRenderCtx): string {
  void el;
  void ctx;
  throw new Error(
    'TODO: implement in Wave 4 — see docs/superpowers/plans/2026-05-23-19-code-block.md',
  );
}

export const CODE_RECIPE_ID = 'code-card' as const;
