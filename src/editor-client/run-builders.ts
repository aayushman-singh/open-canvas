// src/editor-client/run-builders.ts
//
// ADR 0058 Phase 2q.d — InlineRun → DOM builder. Extracted from
// canvas-client.ts:2720-2818. The inline IIFE twin remains the production
// source-of-truth until ADR 0015 Phase 3 atomic cutover.
//
// Mark nesting order is derived directly from CANONICAL_MARK_ORDER (and
// the server renderer in src/canvas/render.ts) so the editor preview and
// the published HTML agree visually:
//   <a> outermost (only when link mark present)
//   <strong>, <em>, <u>, <s>, <mark>, <code> innermost
// wrap() pushes a new outer wrapper around the current inner, so the loop
// walks CANONICAL_MARK_ORDER in reverse: innermost (code) first, then
// link is appended last via its dedicated branch. No parallel mark-order
// list lives in this function — the single source is CANONICAL_MARK_ORDER.
//
// Note on newline handling: the inline IIFE source contains "\\n" (literal
// backslash-n) inside the surrounding template literal so the editor
// template cooks it to a one-char LF runtime string. In real TypeScript
// the literal is plain '\n'. Behaviour: a single LF inside an InlineRun's
// text becomes a <br>, the surrounding text becomes adjacent text nodes,
// preserving block-level breaks from a multi-paragraph paste across a
// save/reload round-trip via the schema's literal-U+000A contract.

import type { InlineRun, InlineMarkType } from '../canvas/schema.js';

import { CANONICAL_MARK_ORDER } from './editor-constants.js';
import type { EditorContext } from './editor-context.js';
import { findColorMark, findFontSizeMark, findLinkMark, hasMark } from './mark-queries.js';

declare global {
  interface Window {
    katex?: {
      render(
        tex: string,
        target: HTMLElement,
        opts: { throwOnError: boolean; output: string; displayMode: boolean },
      ): void;
    };
  }
}

// Maps CANONICAL_MARK_ORDER mark types to their DOM tags. "link" is omitted
// because the <a> wrap needs href/target attributes and is built inline below.
// "fontSize" is omitted because it stamps a style attribute on the outer span
// rather than wrapping a tag.
const MARK_TYPE_TO_TAG: Partial<Record<InlineMarkType, string>> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  highlight: 'mark',
  code: 'code',
};

export function buildRunNodeImpl(ctx: EditorContext, run: InlineRun): HTMLElement {
  let inner: Node;
  if (run && run.math && typeof run.math.tex === 'string') {
    // Math runs render via KaTeX (lazy-loaded in the editor head). When
    // window.katex hasn't finished loading yet we fall back to raw TeX so
    // the user sees something rather than a blank span; renderMathInScope
    // re-renders all .opencanvas-math nodes as soon as KaTeX resolves.
    // contenteditable=false makes the equation atomic: the caret can't
    // land inside KaTeX's generated DOM, so backspace/delete remove the
    // whole equation instead of corrupting one of its inner tags.
    const mathSpan = document.createElement('span');
    mathSpan.className = 'opencanvas-math';
    mathSpan.setAttribute('data-math-tex', run.math.tex);
    mathSpan.setAttribute('aria-label', run.text || run.math.tex);
    mathSpan.setAttribute('contenteditable', 'false');
    if (typeof window !== 'undefined' && window.katex && typeof window.katex.render === 'function') {
      try {
        window.katex.render(run.math.tex, mathSpan, {
          throwOnError: false,
          output: 'html',
          displayMode: false,
        });
      } catch (_e) {
        mathSpan.textContent = run.math.tex;
      }
    } else {
      mathSpan.textContent = run.math.tex;
    }
    inner = mathSpan;
  } else {
    // Innermost carries the raw run.text. Embedded "\n" chars become <br>
    // elements so block-level breaks from a multi-paragraph paste survive a
    // save/reload round-trip via the schema's literal-U+000A contract.
    const rawText = typeof run.text === 'string' ? run.text : '';
    if (rawText.indexOf('\n') < 0) {
      inner = document.createTextNode(rawText);
    } else {
      const frag = document.createDocumentFragment();
      const parts = rawText.split('\n');
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        if (part !== undefined && part.length > 0) frag.appendChild(document.createTextNode(part));
        if (p < parts.length - 1) frag.appendChild(document.createElement('br'));
      }
      inner = frag;
    }
  }
  function wrap(tag: string): HTMLElement {
    const el = document.createElement(tag);
    el.appendChild(inner);
    inner = el;
    return el;
  }
  // Walk CANONICAL_MARK_ORDER innermost-first (reverse) so wrap()'s
  // outward-growth produces the exact nesting CANONICAL_MARK_ORDER prescribes.
  // The "link" entry is handled separately below because <a> needs attributes.
  for (let mi = CANONICAL_MARK_ORDER.length - 1; mi >= 0; mi--) {
    const markType = CANONICAL_MARK_ORDER[mi] as InlineMarkType;
    const tag = MARK_TYPE_TO_TAG[markType];
    if (tag && hasMark(run, markType)) wrap(tag);
  }
  const link = findLinkMark(run);
  if (link) {
    const a = document.createElement('a');
    a.className = 'opencanvas-inline-link';
    a.setAttribute('href', link.href);
    if (link.target === '_blank') {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
    // Owner click semantics for inline link marks:
    //  - In edit mode, beginTextEdit's mousedown interceptor pins the link
    //    popover and preventDefault()s the caret jump; we just defuse the
    //    native navigation here too.
    //  - Out of edit mode, a click on the link used to navigate the canvas
    //    (or open a new tab) inline with the click handler. Owners read
    //    that as the editor "yanking them somewhere" the moment they try
    //    to inspect a link-marked word, so it now only pins the link
    //    popover — the popover's Go button is the explicit "actually
    //    navigate now" affordance. Alt-click still falls through so the
    //    parent text element gets selected by the canvas click handler.
    a.addEventListener('click', function (ev: MouseEvent) {
      ev.preventDefault();
      if (ev.altKey) return;
      ctx.showLinkPopover(a, { pinned: true });
    });
    a.appendChild(inner);
    inner = a;
  }
  const span = document.createElement('span');
  span.appendChild(inner);
  const fontSize = findFontSizeMark(run);
  if (fontSize) span.style.fontSize = String(fontSize.px) + 'px';
  const colorMark = findColorMark(run);
  if (colorMark) span.style.color = colorMark.color;
  return span;
}
