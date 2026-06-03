// src/editor-client/mark-tags.ts
//
// ADR 0015 Phase 2b — tag-name → InlineMark lookup used by the editor's
// DOM-to-runs serializer. The serializer walks selected DOM nodes during
// inline text editing and maps known tag names back into the InlineMark
// union the schema defines. Editor-only — the server renderer goes the
// other way (runs → DOM tags) and has no need for the reverse map.

import type { InlineMark } from '../canvas/schema.js';

export const MARK_TAGS: Readonly<Record<string, () => InlineMark>> = {
  STRONG: () => ({ type: 'bold' }),
  B: () => ({ type: 'bold' }),
  EM: () => ({ type: 'italic' }),
  I: () => ({ type: 'italic' }),
  U: () => ({ type: 'underline' }),
  S: () => ({ type: 'strike' }),
  STRIKE: () => ({ type: 'strike' }),
  MARK: () => ({ type: 'highlight' }),
  CODE: () => ({ type: 'code' }),
};

/** Inverse of MARK_TAGS — given an InlineMark type, the DOM tag the
 *  editor's run renderer wraps the inner node with. `link` and
 *  `fontSize` are intentionally absent: link needs href/target attrs
 *  built inline by the renderer; fontSize stamps a style attribute
 *  rather than wrapping a tag. */
export const MARK_TYPE_TO_TAG: Readonly<Record<string, string>> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  highlight: 'mark',
  code: 'code',
};
