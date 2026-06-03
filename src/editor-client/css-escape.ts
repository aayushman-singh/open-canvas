// src/editor-client/css-escape.ts
//
// ADR 0015 Phase 2d — CSS-ident escape for selector building. Uses the
// browser's native `CSS.escape` when available, falls back to a regex
// that escapes anything outside `[a-zA-Z0-9_-]`. canvas-client.ts:3805
// carries the inline copy. Pure, no IIFE-local deps.
//
// The browser `CSS` global is reachable directly because the per-tree
// `src/editor-client/tsconfig.json` adds the DOM lib for this subtree
// without leaking DOM types into the Worker typecheck.

export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
