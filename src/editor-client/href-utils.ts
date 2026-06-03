// src/editor-client/href-utils.ts
//
// ADR 0015 Phase 2b — URL + CSS safety helpers used by the editor's
// inspector, action editing, and pinned-style validation paths.
//
// isAllowedHref re-exports the canonical server source in
// src/canvas/action-href.ts. canvas-client.ts (the legacy editor
// source) carries an inline mirror at lines 491–503 with a comment
// flagging it as a mirror — the Phase 3 cutover retires the mirror in
// favour of this import.
//
// isValidActionHref and isSafeCssValue are editor-only runtime checks
// that have no canonical server export: validate.ts rejects malformed
// states at write time, but the editor needs runtime shape checks while
// the Owner is mid-edit (state may briefly be partial / pre-migration).

import type { ActionHref } from '../canvas/elements/action.js';

import { isAllowedHref } from '../canvas/action-href.js';

export { isAllowedHref };

/**
 * Runtime shape check for an ActionElement.href value. The editor uses
 * this during legacy-data migration and inspector edit-in-progress
 * validation, where the value may briefly be a legacy string, a
 * partial DU, or a freshly-built shape the type system already trusts.
 */
export function isValidActionHref(value: unknown): value is ActionHref {
  if (value === null || typeof value !== 'object') return false;
  const href = value as { type?: unknown; url?: unknown; pageId?: unknown };
  if (href.type === 'external') {
    return (
      typeof href.url === 'string' && href.url.length > 0 && isAllowedHref(href.url)
    );
  }
  if (href.type === 'page') {
    return typeof href.pageId === 'string' && href.pageId.length > 0;
  }
  return false;
}

/**
 * Safe CSS value check for inspector-typed Pinned Style values.
 * Rejects control chars, CSS delimiters that could break out of a
 * `style="…"` attribute, backslashes (CSS escape sequences), forward
 * slashes (comment opener), and embedded close-tag sequences that
 * could break an HTML context.
 */
export function isSafeCssValue(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const ch = value.charAt(i);
    if (
      code < 32 ||
      ch === ';' ||
      ch === '{' ||
      ch === '}' ||
      ch === '\\' ||
      ch === '/'
    ) {
      return false;
    }
  }
  return !value.toLowerCase().includes('</');
}
