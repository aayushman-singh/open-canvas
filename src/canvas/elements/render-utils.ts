// src/canvas/elements/render-utils.ts
//
// Shared HTML/CSS escaping + small string helpers used by per-element render
// fns and the renderer dispatcher (src/canvas/render.ts). Pulled out of
// render.ts as part of the Phase 0 element registry scaffold so individual
// element files can stay tiny.
//
// All user-controlled strings are escaped at the boundary. Functions are
// pure — no DOM access, no I/O.

import type { InlineMark, InlineRun } from '../schema.js';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

const ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
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
