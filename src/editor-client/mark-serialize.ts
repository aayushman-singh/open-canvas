// src/editor-client/mark-serialize.ts
//
// ADR 0058 Phase 2q.b — contentEditable DOM → InlineRun[] serializer
// + supporting mark-set helpers.
//
// canvas-client.ts:8691-8839 carries the inline twin (activeMarksFor,
// marksEqual, serializeContentToRuns, plainTextOf). All four are pure
// DOM walkers — they read the contenteditable subtree, build an
// InlineRun[] in canonical mark order, validate link hrefs against
// isAllowedHref, and emit math runs for opencanvas-math spans.
// No closure state, no IIFE locals — the ctx parameter is unused.
//
// Four functions live here:
//
//   - activeMarksFor(node, stopAt) — walk up from `node` until `stopAt`
//     (exclusive), collect each mark-tagged ancestor (MARK_TAGS lookup
//     + the A → link / SPAN[style="font-size:…"] → fontSize special
//     cases) and return the deduped, canonical-order InlineMark[].
//
//   - marksEqual(a, b) — by-value compare of two InlineMark[] arrays.
//     Used by the adjacent-run merge inside serializeContentToRuns:
//     two runs with byte-identical mark sets merge into one. Compares
//     the link-specific href/target and the fontSize-specific px field
//     explicitly; the other mark types are identified by `type` alone.
//
//   - serializeContentToRuns(rootNode) — top-level walker. Manual DFS
//     (not TreeWalker) so opencanvas-math spans can be ACCEPTED as an
//     atomic math run AND prevent descent into their KaTeX subtree.
//     Merges adjacent identical-mark runs, drops empty/no-mark/no-math
//     runs, and validates every link mark against isAllowedHref —
//     throws loudly when the allowlist rejects (caller treats as
//     "do not commit"). PROMOTED from the forward-declared ctx field
//     declared in editor-context.ts; the inline twin stays the
//     production source-of-truth until Phase 3 cutover.
//
//   - plainTextOf(content) — concatenate `text` across an InlineRun[].
//     Used by the "concatenated plain text must not be empty" guard
//     before saving — so a doomed payload fails fast on the client
//     rather than round-tripping through the server validator.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { InlineMark, InlineRun } from '../canvas/schema.js';
import { CANONICAL_MARK_ORDER } from './editor-constants.js';
import { isAllowedHref } from './href-utils.js';
import { MARK_TAGS } from './mark-tags.js';
import {
  INLINE_FONT_SIZE_PX_MAX,
  INLINE_FONT_SIZE_PX_MIN,
} from './shared-constants.js';

/** Walk up from `node` until `stopAt` (exclusive), collect each
 *  mark-tagged ancestor (MARK_TAGS lookup + A → link / SPAN[style="font-size:…"]
 *  → fontSize special cases), dedupe by type, and return the InlineMark[]
 *  in CANONICAL_MARK_ORDER. The canonical ordering is load-bearing for
 *  serializeContentToRuns' adjacent-run dedupe-by-JSON. */
export function activeMarksFor(node: Node, stopAt: Node): InlineMark[] {
  const seen = new Set<string>();
  const marks: InlineMark[] = [];
  let cur: Node | null = node.parentNode;
  while (cur && cur !== stopAt) {
    if (cur.nodeType === 1) {
      const el = cur as Element;
      const tag = el.tagName;
      if (tag === 'A' && !seen.has('link')) {
        seen.add('link');
        const linkMark: InlineMark = {
          type: 'link',
          href: el.getAttribute('href') || '',
        };
        if (el.getAttribute('target') === '_blank') {
          linkMark.target = '_blank';
        }
        marks.push(linkMark);
      } else if (MARK_TAGS[tag]) {
        const builder = MARK_TAGS[tag];
        if (builder) {
          const built = builder();
          if (!seen.has(built.type)) {
            seen.add(built.type);
            marks.push(built);
          }
        }
      }
      if (!seen.has('fontSize') && tag === 'SPAN') {
        // Inline font-size carried by the run's outer span (renderInlineRun)
        // OR by a pasted-source size span (normalizePastedHtml emits these
        // for H1-H6 + inline style="font-size:..." nodes). Innermost wrap
        // wins, matching the natural CSS cascade an editor user would expect
        // when nesting one sized span inside another.
        const styleEl = el as HTMLElement;
        const rawFs = styleEl.style && styleEl.style.fontSize ? styleEl.style.fontSize : '';
        if (rawFs) {
          const px = parseFloat(rawFs);
          if (
            Number.isFinite(px) &&
            px >= INLINE_FONT_SIZE_PX_MIN &&
            px <= INLINE_FONT_SIZE_PX_MAX
          ) {
            seen.add('fontSize');
            marks.push({ type: 'fontSize', px });
          }
        }
      }
    }
    cur = cur.parentNode;
  }
  // Order the marks deterministically so adjacent-run dedupe by JSON
  // string is reliable. Derived from CANONICAL_MARK_ORDER so the single
  // source of truth at the top of this file controls every consumer.
  const order: Record<string, number> = {};
  for (let oi = 0; oi < CANONICAL_MARK_ORDER.length; oi++) {
    const name = CANONICAL_MARK_ORDER[oi];
    if (name !== undefined) order[name] = oi;
  }
  marks.sort((a, b) => (order[a.type] ?? 0) - (order[b.type] ?? 0));
  return marks;
}

/** By-value compare of two InlineMark[] arrays. Returns true when the
 *  two sets are byte-identical (same length, same types in the same
 *  order, same href/target for links, same px for fontSize). Used by
 *  the adjacent-run merge inside serializeContentToRuns. */
export function marksEqual(a: InlineMark[], b: InlineMark[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (!ai || !bi) return false;
    if (ai.type !== bi.type) return false;
    if (ai.type === 'link' && bi.type === 'link') {
      if (ai.href !== bi.href) return false;
      if ((ai.target || '') !== (bi.target || '')) return false;
    }
    if (ai.type === 'fontSize' && bi.type === 'fontSize' && ai.px !== bi.px) {
      return false;
    }
  }
  return true;
}

interface RawRun {
  text: string;
  marks: InlineMark[];
  math?: { tex: string };
}

/** Serialize the contenteditable subtree rooted at `rootNode` into an
 *  InlineRun[]. The result is deduped (adjacent identical-mark runs
 *  merge) and trimmed (empty marks-only placeholders dropped). Throws
 *  if any link mark href fails the allowlist — the caller treats that
 *  as "do not commit".
 *
 *  <br> elements emit a synthetic "\n" run carrying the ancestor marks
 *  so block-level breaks pasted from a multi-paragraph source survive
 *  the round-trip. The renderer turns "\n" back into <br> on the way
 *  out. */
export function serializeContentToRuns(rootNode: Node): InlineRun[] {
  const raw: RawRun[] = [];
  // Manual DFS instead of TreeWalker: we need to ACCEPT a math span (emit
  // a math run) AND then prevent descent into its KaTeX-generated DOM,
  // which TreeWalker's filter API can't express in one node (FILTER_REJECT
  // would skip the math span itself; FILTER_ACCEPT walks descendants).
  function visit(node: Node): void {
    if (node.nodeType === 3) {
      raw.push({
        text: node.nodeValue || '',
        marks: activeMarksFor(node, rootNode),
      });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.tagName === 'BR') {
      raw.push({ text: '\n', marks: activeMarksFor(node, rootNode) });
      return;
    }
    if (el.classList && el.classList.contains('opencanvas-math')) {
      const tex = el.getAttribute('data-math-tex') || '';
      const fallback = el.getAttribute('aria-label') || tex;
      if (tex.length > 0) {
        const marks = activeMarksFor(node, rootNode);
        raw.push({ text: fallback, marks, math: { tex } });
      }
      return;
    }
    const kids = node.childNodes;
    for (let k = 0; k < kids.length; k++) {
      const child = kids[k];
      if (child) visit(child);
    }
  }
  const kids = rootNode.childNodes;
  for (let k = 0; k < kids.length; k++) {
    const child = kids[k];
    if (child) visit(child);
  }
  // Merge adjacent runs whose mark sets are byte-identical. Math runs are
  // atomic (each equation is its own run) and never merge with neighbours.
  const merged: RawRun[] = [];
  for (let i = 0; i < raw.length; i++) {
    const run = raw[i];
    if (!run) continue;
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (prev && !prev.math && !run.math && marksEqual(prev.marks, run.marks)) {
      prev.text += run.text;
    } else {
      const next: RawRun = { text: run.text, marks: run.marks };
      if (run.math) next.math = run.math;
      merged.push(next);
    }
  }
  // Drop runs that are empty AND have no marks AND no math — they carry
  // no signal.
  const trimmed = merged.filter(
    (r) => r.text.length > 0 || r.marks.length > 0 || r.math,
  );
  // Validate link hrefs (fail loud — no silent rewrite).
  for (let i = 0; i < trimmed.length; i++) {
    const run = trimmed[i];
    if (!run) continue;
    for (let m = 0; m < run.marks.length; m++) {
      const mark = run.marks[m];
      if (mark && mark.type === 'link' && !isAllowedHref(mark.href)) {
        const reason =
          'href ' +
          JSON.stringify(mark.href) +
          ' is not allowed (must be http:, https:, mailto:, tel:, /relative, or #anchor)';
        throw new Error(reason);
      }
    }
  }
  // Final shape: drop empty marks arrays so the JSON is minimal and equal
  // to what hand-written fixtures look like.
  return trimmed.map((r) => {
    const out: InlineRun = { text: r.text };
    if (r.marks.length > 0) out.marks = r.marks;
    if (r.math) out.math = r.math;
    return out;
  });
}

/** Concatenate the plain text projection of an InlineRun[] — used to
 *  enforce the "concatenated plain text must not be empty" rule client-
 *  side before saving so the server doesn't see a doomed payload. */
export function plainTextOf(content: InlineRun[]): string {
  let out = '';
  for (let i = 0; i < content.length; i++) {
    const run = content[i];
    if (run) out += run.text;
  }
  return out;
}
