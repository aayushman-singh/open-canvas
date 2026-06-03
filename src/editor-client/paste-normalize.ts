// src/editor-client/paste-normalize.ts
//
// ADR 0058 Phase 2q.b — paste path: KaTeX rendering + plain-text →
// fragment HTML + arbitrary HTML normalization.
//
// canvas-client.ts:12261-12500 carries the inline twin (renderMathInScope,
// plainTextToFragmentHtml, normalizePastedHtml). All three are pure DOM
// walkers — they read/produce HTML strings or operate on parsed DOM
// fragments. No closure state, no IIFE locals — the inline twin pulls
// escapeHtml/escapeAttr from a small inline IIFE-local copy at
// canvas-client.ts:12241-12254; this module imports them from
// ./html-escape.ts (the canonical re-export of the 5-char encoder).
//
// Three functions live here:
//
//   - renderMathInScope(scope) — run KaTeX over every .opencanvas-math
//     span under `scope` whose visible body is still the raw TeX
//     fallback (data-katex-rendered missing). Called immediately after
//     a paste that contains math and on the katex-loaded event so
//     spans that landed before the bundle was ready get the rendered
//     HTML once it shows up. No-op when KaTeX isn't loaded; on KaTeX
//     render error the plain-tex fallback stays so the user still sees
//     something — the all-or-nothing rule kicks in for the editor's
//     OWN bugs, not third-party rendering hiccups.
//
//   - plainTextToFragmentHtml(plain) — escape, restore line breaks, and
//     recognise the four standard LaTeX delimiter pairs ($$...$$,
//     $...$, \[...\], \(...\)) so a "raw markdown" paste with inline
//     math comes through as real equations rather than a stream of $
//     characters. Returns the fragment HTML string the paste handler
//     inserts into the contenteditable.
//
//   - normalizePastedHtml(html) — convert arbitrary pasted HTML (Google
//     Docs, Notion, web pages, …) into a minimal markup string that
//     uses only the canonical mark tags serializeContentToRuns
//     recognises (B / I / U / S / MARK / CODE / A) + inline font-size
//     spans for headings. KaTeX-rendered sources (Notion, Obsidian,
//     web pages) and MathML (MathJax, Wikipedia) carry a verbatim TeX
//     source string inside <annotation encoding="application/x-tex">;
//     we detect either wrapper, lift the TeX, and emit an atomic
//     opencanvas-math span rather than picking the presentation HTML
//     up as plain text and losing the formula structure.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import { escapeAttr, escapeHtml } from './html-escape.js';
import {
  INLINE_FONT_SIZE_PX_MAX,
  INLINE_FONT_SIZE_PX_MIN,
} from './shared-constants.js';

interface KatexRenderOptions {
  throwOnError?: boolean;
  output?: string;
  displayMode?: boolean;
}

interface KatexRuntime {
  render(tex: string, target: Element, options?: KatexRenderOptions): void;
}

interface WindowWithKatex {
  katex?: KatexRuntime;
}

/** Run KaTeX over every .opencanvas-math span under `scope` whose
 *  visible body is still the raw TeX fallback (data-katex-rendered
 *  missing). No-op when KaTeX isn't loaded — the katex-loaded event
 *  re-fires this once the bundle arrives. Per-span render errors leave
 *  the plain-tex fallback in place; the all-or-nothing rule applies to
 *  the editor's own bugs, not to third-party TeX-parser hiccups. */
export function renderMathInScope(scope: Element | null | undefined): void {
  if (!scope) return;
  if (typeof window === 'undefined') return;
  const win = window as WindowWithKatex;
  if (!win.katex || typeof win.katex.render !== 'function') return;
  const katex = win.katex;
  const nodes = scope.querySelectorAll(
    '.opencanvas-math:not([data-katex-rendered])',
  );
  for (let i = 0; i < nodes.length; i++) {
    const span = nodes[i];
    if (!span) continue;
    const tex = span.getAttribute('data-math-tex') || '';
    if (!tex) continue;
    try {
      katex.render(tex, span, {
        throwOnError: false,
        output: 'html',
        displayMode: false,
      });
      span.setAttribute('data-katex-rendered', 'true');
    } catch {
      // Leave the plain-tex fallback in place; user still sees something.
    }
  }
}

interface PlainTextToken {
  kind: 'text' | 'math';
  value?: string;
  tex?: string;
}

/** Plain-text paste path: escape, restore line breaks, and recognise
 *  the four standard LaTeX delimiter pairs ($$...$$, $...$, \[...\],
 *  \(...\)) so a "raw markdown" paste with inline math comes through
 *  as real equations rather than a stream of $ characters. */
export function plainTextToFragmentHtml(plain: string): string {
  const src = String(plain || '');
  const tokens: PlainTextToken[] = [];
  let i = 0;
  function pushText(s: string): void {
    if (s) tokens.push({ kind: 'text', value: s });
  }
  function pushMath(t: string): void {
    const tex = (t || '').trim();
    if (tex) tokens.push({ kind: 'math', tex });
  }
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === '$' && src.charAt(i + 1) === '$') {
      const close = src.indexOf('$$', i + 2);
      if (close > i + 2) {
        pushMath(src.slice(i + 2, close));
        i = close + 2;
        continue;
      }
    }
    if (ch === '$') {
      const close1 = src.indexOf('$', i + 1);
      // Reject empty / multi-line $..$ to avoid false positives ($5 + $3).
      const afterClose = src.charAt(close1 + 1);
      if (
        close1 > i + 1 &&
        src.slice(i + 1, close1).indexOf('\n') < 0 &&
        !(afterClose >= '0' && afterClose <= '9')
      ) {
        pushMath(src.slice(i + 1, close1));
        i = close1 + 1;
        continue;
      }
    }
    if (ch === '\\' && src.charAt(i + 1) === '[') {
      const closeB = src.indexOf('\\]', i + 2);
      if (closeB > i + 2) {
        pushMath(src.slice(i + 2, closeB));
        i = closeB + 2;
        continue;
      }
    }
    if (ch === '\\' && src.charAt(i + 1) === '(') {
      const closeP = src.indexOf('\\)', i + 2);
      if (closeP > i + 2) {
        pushMath(src.slice(i + 2, closeP));
        i = closeP + 2;
        continue;
      }
    }
    // Accumulate plain run up to the next delimiter candidate.
    let next = i + 1;
    while (next < src.length) {
      const nc = src.charAt(next);
      if (nc === '$') break;
      if (nc === '\\' && (src.charAt(next + 1) === '[' || src.charAt(next + 1) === '(')) {
        break;
      }
      next++;
    }
    pushText(src.slice(i, next));
    i = next;
  }
  const parts: string[] = [];
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    if (!tok) continue;
    if (tok.kind === 'text') {
      parts.push(escapeHtml(tok.value || '').replace(/\n/g, '<br>'));
    } else {
      const tex = tok.tex || '';
      parts.push(
        '<span class="opencanvas-math" contenteditable="false" data-math-tex="' +
          escapeAttr(tex) +
          '">' +
          escapeHtml(tex) +
          '</span>',
      );
    }
  }
  return parts.join('');
}

/** Convert arbitrary pasted HTML (Google Docs, Notion, web pages, …)
 *  into a minimal markup string that uses only the canonical mark tags
 *  serializeContentToRuns recognises (B / I / U / S / MARK / CODE / A).
 *  The serializer walks the live DOM after paste; if we let raw pasted
 *  HTML through, span[style="font-weight:700"]-style formatting silently
 *  disappears on the next save because those spans aren't in MARK_TAGS. */
export function normalizePastedHtml(html: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  } catch {
    return '';
  }
  function styleOf(el: Element | null | undefined): string {
    return (el && el.getAttribute && el.getAttribute('style')) || '';
  }
  function isBold(el: Element | null): boolean {
    if (!el || el.nodeType !== 1) return false;
    const t = el.tagName;
    if (t === 'B' || t === 'STRONG') return true;
    return /font-weight\s*:\s*(bold|bolder|[6-9]\d\d)/i.test(styleOf(el));
  }
  function isItalic(el: Element | null): boolean {
    if (!el || el.nodeType !== 1) return false;
    const t = el.tagName;
    if (t === 'I' || t === 'EM') return true;
    return /font-style\s*:\s*italic/i.test(styleOf(el));
  }
  function isUnderline(el: Element | null): boolean {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'U') return true;
    return /text-decoration[^;]*underline/i.test(styleOf(el));
  }
  function isStrike(el: Element | null): boolean {
    if (!el || el.nodeType !== 1) return false;
    const t = el.tagName;
    if (t === 'S' || t === 'STRIKE' || t === 'DEL') return true;
    return /text-decoration[^;]*line-through/i.test(styleOf(el));
  }
  function isCode(el: Element | null): boolean {
    return (
      !!el &&
      el.nodeType === 1 &&
      (el.tagName === 'CODE' || el.tagName === 'KBD' || el.tagName === 'SAMP')
    );
  }
  function isHighlight(el: Element | null): boolean {
    return !!el && el.nodeType === 1 && el.tagName === 'MARK';
  }
  // Default px sizes for H1-H6 when the source omits an explicit font-size.
  // Inline style font-size on the heading (or any ancestor span) wins over
  // these — see the walker below.
  const HEADING_DEFAULT_PX: Record<string, number> = {
    H1: 32,
    H2: 24,
    H3: 20,
    H4: 18,
    H5: 16,
    H6: 14,
  };
  function readInlineFontSizePx(el: Element): number | null {
    const style = styleOf(el);
    if (!style) return null;
    const match = /font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*(px|pt|em|rem)?/i.exec(
      style,
    );
    if (!match || match[1] === undefined) return null;
    let n = parseFloat(match[1]);
    if (!Number.isFinite(n)) return null;
    const unit = (match[2] || 'px').toLowerCase();
    // pt -> px at 96dpi, em/rem assume 16px root.
    if (unit === 'pt') n = n * (96 / 72);
    else if (unit === 'em' || unit === 'rem') n = n * 16;
    if (n < INLINE_FONT_SIZE_PX_MIN || n > INLINE_FONT_SIZE_PX_MAX) return null;
    return Math.round(n);
  }
  const BLOCK_TAGS: Record<string, number> = {
    P: 1,
    DIV: 1,
    H1: 1,
    H2: 1,
    H3: 1,
    H4: 1,
    H5: 1,
    H6: 1,
    LI: 1,
    BLOCKQUOTE: 1,
    TR: 1,
    PRE: 1,
  };
  const out: string[] = [];
  function walk(node: Node): void {
    if (node.nodeType === 3) {
      const text = node.nodeValue || '';
      if (text.length === 0) return;
      let bold = false;
      let italic = false;
      let underline = false;
      let strike = false;
      let code = false;
      let mark = false;
      let linkHref: string | null = null;
      let fontSizePx: number | null = null;
      let cur: Node | null = node.parentNode;
      while (cur && cur.nodeType === 1 && cur !== doc.body) {
        const el = cur as Element;
        if (!linkHref && el.tagName === 'A') {
          const href = el.getAttribute('href');
          if (typeof href === 'string' && href.length > 0) linkHref = href;
        }
        if (isBold(el)) bold = true;
        if (isItalic(el)) italic = true;
        if (isUnderline(el)) underline = true;
        if (isStrike(el)) strike = true;
        if (isCode(el)) code = true;
        if (isHighlight(el)) mark = true;
        if (fontSizePx === null) {
          // Inline style first (innermost ancestor with explicit size wins),
          // then fall back to a heading-default mapping. Plain P/DIV/SPAN
          // without an explicit size contribute nothing and the run inherits
          // the TextElement's own fontSize.
          const inline = readInlineFontSizePx(el);
          if (inline !== null) {
            fontSizePx = inline;
          } else if (HEADING_DEFAULT_PX[el.tagName] !== undefined) {
            fontSizePx = HEADING_DEFAULT_PX[el.tagName] ?? null;
          }
        }
        cur = cur.parentNode;
      }
      let content = escapeHtml(text);
      if (linkHref) content = '<a href="' + escapeAttr(linkHref) + '">' + content + '</a>';
      if (code) content = '<code>' + content + '</code>';
      if (mark) content = '<mark>' + content + '</mark>';
      if (strike) content = '<s>' + content + '</s>';
      if (underline) content = '<u>' + content + '</u>';
      if (italic) content = '<em>' + content + '</em>';
      if (bold) content = '<strong>' + content + '</strong>';
      if (fontSizePx !== null) {
        content =
          '<span style="font-size:' + String(fontSizePx) + 'px">' + content + '</span>';
      }
      out.push(content);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName;
    if (tag === 'BR') {
      out.push('<br>');
      return;
    }
    if (
      tag === 'SCRIPT' ||
      tag === 'STYLE' ||
      tag === 'META' ||
      tag === 'LINK' ||
      tag === 'HEAD'
    ) {
      return;
    }
    // Equation pastes: KaTeX-rendered sources (Notion, Obsidian, web pages)
    // and MathML (MathJax, Wikipedia) carry a verbatim TeX source string
    // inside <annotation encoding="application/x-tex">. Detect either
    // wrapper, lift the tex, emit an atomic opencanvas-math span, and stop
    // recursing — the children are presentation HTML we'd otherwise pick up
    // as plain text and lose the formula structure.
    if (el.classList && el.classList.contains('katex')) {
      const katexAnno = el.querySelector('annotation[encoding="application/x-tex"]');
      const katexTex =
        katexAnno && katexAnno.textContent ? katexAnno.textContent.trim() : '';
      if (katexTex.length > 0) {
        out.push(
          '<span class="opencanvas-math" contenteditable="false" data-math-tex="' +
            escapeAttr(katexTex) +
            '">' +
            escapeHtml(katexTex) +
            '</span>',
        );
        return;
      }
    }
    if (tag === 'MATH') {
      const mathAnno = el.querySelector('annotation[encoding="application/x-tex"]');
      const mathTex =
        mathAnno && mathAnno.textContent ? mathAnno.textContent.trim() : '';
      if (mathTex.length > 0) {
        out.push(
          '<span class="opencanvas-math" contenteditable="false" data-math-tex="' +
            escapeAttr(mathTex) +
            '">' +
            escapeHtml(mathTex) +
            '</span>',
        );
        return;
      }
      // MathML without a TeX annotation — fall back to its plain-text projection
      // rather than dumping raw <mi>/<mn> tags into the editor.
      const mathPlain = el.textContent ? el.textContent.trim() : '';
      if (mathPlain.length > 0) out.push(escapeHtml(mathPlain));
      return;
    }
    // Preserve a visual paragraph break for block-level containers — many
    // sources (Docs, Notion) wrap each line in its own <p>/<div>.
    const leadingBreak =
      !!BLOCK_TAGS[tag] && out.length > 0 && out[out.length - 1] !== '<br>';
    if (leadingBreak) out.push('<br>');
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child) walk(child);
    }
  }
  const bodyChildren = doc.body ? doc.body.childNodes : ([] as unknown as NodeListOf<ChildNode>);
  for (let i = 0; i < bodyChildren.length; i++) {
    const child = bodyChildren[i];
    if (child) walk(child);
  }
  return out.join('');
}
