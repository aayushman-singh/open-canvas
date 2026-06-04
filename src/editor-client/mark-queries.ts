// src/editor-client/mark-queries.ts
//
// ADR 0015 Phase 2d — InlineMark query helpers. Pure predicates over
// the `marks` array on an InlineRun. canvas-client.ts:2689-2709 carries
// inline copies; the editor uses these constantly inside the text-edit
// path to read mark state without committing to a serializer pass.

import type { InlineRun, InlineMark, InlineMarkType } from '../canvas/schema.js';

type LinkMark = Extract<InlineMark, { type: 'link' }>;
type FontSizeMark = Extract<InlineMark, { type: 'fontSize' }>;
type ColorMark = Extract<InlineMark, { type: 'color' }>;

export function hasMark(run: InlineRun, type: InlineMarkType): boolean {
  if (!run.marks || !Array.isArray(run.marks)) return false;
  return run.marks.some((mark: InlineMark) => mark.type === type);
}

export function findLinkMark(run: InlineRun): LinkMark | null {
  if (!run.marks || !Array.isArray(run.marks)) return null;
  for (const mark of run.marks) {
    if (mark.type === 'link') return mark;
  }
  return null;
}

export function findFontSizeMark(run: InlineRun): FontSizeMark | null {
  if (!run.marks || !Array.isArray(run.marks)) return null;
  for (const mark of run.marks) {
    if (mark.type === 'fontSize') return mark;
  }
  return null;
}

export function findColorMark(run: InlineRun): ColorMark | null {
  if (!run.marks || !Array.isArray(run.marks)) return null;
  for (const mark of run.marks) {
    if (mark.type === 'color') return mark;
  }
  return null;
}
