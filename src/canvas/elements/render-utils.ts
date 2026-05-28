// src/canvas/elements/render-utils.ts
//
// Shared HTML/CSS escaping + small string helpers used by per-element render
// fns and the renderer dispatcher (src/canvas/render.ts). Element files stay
// tiny by routing every escape through this surface.
//
// All user-controlled strings are escaped at the boundary. Functions are
// pure — no DOM access, no I/O.

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
 * of the shape `[data-rev01-element="<id>"]`. Backslash-escapes `\` and `"`
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
  let inner = escapeHtml(run.text);
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
    inner = `<a class="rev01-inline-link" href="${escapeAttr(link.href)}"${targetAttr}>${inner}</a>`;
  }
  return `<span>${inner}</span>`;
}
