// src/editor-client/css-escape.ts
//
// ADR 0015 Phase 2d — CSS-ident escape for selector building. Uses the
// browser's native `CSS.escape` when available, falls back to a regex
// that escapes anything outside `[a-zA-Z0-9_-]`. canvas-client.ts:3805
// carries the inline copy. Pure, no IIFE-local deps.
//
// The `CSS` browser global is reached via a module-scoped `globalThis`
// cast rather than a `/// <reference lib="DOM" />` directive — the
// triple-slash form pulls DOM types into the project-wide typecheck
// and breaks Worker code that depends on Uint8Array shapes only the
// Worker types declare. The cast is local; types stay isolated to this
// file. When a per-tree editor-client tsconfig lands later, the cast
// can fold into a proper DOM lib reference.

type CSSEscapeGlobal = { escape?(value: string): string } | undefined;

export function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: CSSEscapeGlobal }).CSS;
  if (css && typeof css.escape === 'function') {
    return css.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
