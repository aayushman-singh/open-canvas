// src/canvas/elements/render-utils.ts
//
// Shared HTML/CSS escaping + small string helpers used by per-element render
// fns and the renderer dispatcher (src/canvas/render.ts). Element files stay
// tiny by routing every escape through this surface.
//
// All user-controlled strings are escaped at the boundary. Functions are
// pure — no DOM access, no I/O.

import katex from 'katex';

import type { InlineMark, InlineRun } from '../schema.js';

// The HTML escapes are a strict subset of ATTR_ESCAPES with identical values
// for the three shared keys, so both escapers share one table.
const ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => ATTR_ESCAPES[ch] ?? ch);
}

export function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ATTR_ESCAPES[ch] ?? ch);
}

// Defense-in-depth for pinnedStyle values. Validator already rejects dangerous
// payloads, but the renderer refuses to emit anything that could break out of
// the current CSS declaration. Returns '' when the value contains any
// structural CSS character or control character — the caller treats '' as a
// signal to drop the property entirely.
export function escapeCssValue(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20) return '';
    const ch = value[i];
    if (ch === ';' || ch === '{' || ch === '}' || ch === '\\' || ch === '/') return '';
  }
  return escapeAttr(value);
}

// CSS property names are restricted to ASCII letters and hyphen. Anything
// outside that set is stripped; if nothing remains, the caller drops the
// entry.
export function sanitiseCssKey(key: string): string {
  return key.replace(/[^a-zA-Z-]/g, '');
}

export function styleFromEntries(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries.map(([k, v]) => `${k}:${v}`).join(';');
}

/**
 * Escape an id for safe embedding inside a CSS attribute-selector string
 * of the shape `[data-opencanvas-element="<id>"]`. Backslash-escapes `\` and `"`
 * so a stray quote cannot break out of the selector. The schema validator
 * already constrains ids to a slug-like shape; this is defence-in-depth.
 */
export function escapeCssAttrId(value: string): string {
  return value.replace(/[\\"]/g, '\\$&');
}

/** Find the link mark in a run (zero or one allowed by the validator). */
export function findLinkMark(run: InlineRun): Extract<InlineMark, { type: 'link' }> | null {
  if (!run.marks) return null;
  for (const mark of run.marks) {
    if (mark.type === 'link') return mark;
  }
  return null;
}

/** Find the fontSize mark in a run (zero or one). */
export function findFontSizeMark(
  run: InlineRun,
): Extract<InlineMark, { type: 'fontSize' }> | null {
  if (!run.marks) return null;
  for (const mark of run.marks) {
    if (mark.type === 'fontSize') return mark;
  }
  return null;
}

/** Find the color mark in a run (zero or one). */
export function findColorMark(
  run: InlineRun,
): Extract<InlineMark, { type: 'color' }> | null {
  if (!run.marks) return null;
  for (const mark of run.marks) {
    if (mark.type === 'color') return mark;
  }
  return null;
}

export function hasMark(run: InlineRun, type: InlineMark['type']): boolean {
  if (!run.marks) return false;
  for (const mark of run.marks) {
    if (mark.type === type) return true;
  }
  return false;
}

/**
 * Render one inline run into HTML with a fixed mark-nesting order:
 *
 *   <a> outermost (only when a link mark is present)
 *   <strong>, <em>, <u>, <s>, <mark>, <code> (innermost wraps the text node)
 *
 * The order is deliberately stable so identical content arrays always
 * produce byte-identical HTML — required for diff stability, snapshot
 * rendering, and the editor's round-trip serializer.
 *
 * The bare <span> wrapper is kept even for no-mark runs because it gives
 * the editor a stable DOM addressing target per run.
 */
export function renderInlineRun(run: InlineRun): string {
  // Math runs render via server-side KaTeX. `run.text` is the plain-text
  // fallback (search / aria-label) and never appears in the visible HTML
  // when math is present. throwOnError=false makes KaTeX emit an error span
  // for malformed TeX instead of crashing the page render.
  if (run.math !== undefined) {
    const fallback = escapeAttr(run.text || run.math.tex);
    let rendered: string;
    try {
      rendered = katex.renderToString(run.math.tex, {
        throwOnError: false,
        output: 'html',
        displayMode: false,
      });
    } catch {
      rendered = `<span class="opencanvas-math-error">${escapeHtml(run.math.tex)}</span>`;
    }
    let mathInner = `<span class="opencanvas-math" aria-label="${fallback}" data-math-tex="${escapeAttr(run.math.tex)}">${rendered}</span>`;
    const link = findLinkMark(run);
    if (link) {
      const targetAttr =
        link.target === '_blank' ? ' target="_blank" rel="noopener noreferrer"' : '';
      mathInner = `<a class="opencanvas-inline-link" href="${escapeAttr(link.href)}"${targetAttr}>${mathInner}</a>`;
    }
    const fontSize = findFontSizeMark(run);
    const color = findColorMark(run);
    const mathStyle = outerSpanStyle(fontSize?.px ?? null, color?.color ?? null);
    if (mathStyle.length > 0) {
      return `<span style="${mathStyle}">${mathInner}</span>`;
    }
    return `<span>${mathInner}</span>`;
  }
  // Per schema, run.text may carry literal U+000A. Convert to <br> after
  // escapeHtml so block-level breaks in pasted multi-paragraph source survive
  // a save/reload round-trip. escapeHtml has already neutralised any HTML
  // metacharacters in the source so this <br> insertion is on a string we
  // generated, not user content.
  let inner = escapeHtml(run.text).replace(/\n/g, '<br>');
  if (hasMark(run, 'code')) inner = `<code>${inner}</code>`;
  if (hasMark(run, 'highlight')) inner = `<mark>${inner}</mark>`;
  if (hasMark(run, 'strike')) inner = `<s>${inner}</s>`;
  if (hasMark(run, 'underline')) inner = `<u>${inner}</u>`;
  if (hasMark(run, 'italic')) inner = `<em>${inner}</em>`;
  if (hasMark(run, 'bold')) inner = `<strong>${inner}</strong>`;
  const link = findLinkMark(run);
  if (link) {
    const targetAttr =
      link.target === '_blank' ? ' target="_blank" rel="noopener noreferrer"' : '';
    inner = `<a class="opencanvas-inline-link" href="${escapeAttr(link.href)}"${targetAttr}>${inner}</a>`;
  }
  const fontSize = findFontSizeMark(run);
  const color = findColorMark(run);
  const outerStyle = outerSpanStyle(fontSize?.px ?? null, color?.color ?? null);
  if (outerStyle.length > 0) {
    return `<span style="${outerStyle}">${inner}</span>`;
  }
  return `<span>${inner}</span>`;
}

/**
 * Build the inline `style="…"` payload for an InlineRun's outer span when
 * a fontSize and/or color mark is present. Both marks live on the run's
 * outermost wrapper because they stamp CSS properties rather than wrap
 * tags. The color value passes through `escapeCssValue` — the validator
 * has already constrained it to `INLINE_COLOR_HEX_RE`, but defence in
 * depth keeps a malformed payload from breaking out of the declaration.
 */
function outerSpanStyle(fontSizePx: number | null, color: string | null): string {
  const parts: string[] = [];
  if (fontSizePx !== null) {
    parts.push(`font-size:${String(fontSizePx)}px`);
  }
  if (color !== null) {
    const safe = escapeCssValue(color);
    if (safe.length > 0) parts.push(`color:${safe}`);
  }
  return parts.join(';');
}
