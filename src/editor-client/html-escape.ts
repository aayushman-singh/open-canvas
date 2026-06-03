// src/editor-client/html-escape.ts
//
// ADR 0015 Phase 2c — HTML attribute-safe escaper, re-exported from the
// canonical server source in canvas/elements/render-utils.ts.
//
// canvas-client.ts:12186-12199 carries inline copies named `escapeHtml`
// and `escapeAttr`. Both are aliases for the same 5-char encoder ('&',
// '<', '>', '"', "'") — the editor over-escapes by design (the comment
// at canvas-client.ts:12195 notes "HTML-encoding all 5 chars is
// over-escaping for attributes but correct"). The server's `escapeAttr`
// is exactly that 5-char encoder, so this module exports the editor's
// pair as a single binding pointing at the canonical server function.
//
// The server's separate 3-char `escapeHtml` (text-context only) is NOT
// re-exported here — the editor does not have a text-only escape site,
// and importing the wrong one would silently downgrade quote escaping.

import { escapeAttr } from '../canvas/elements/render-utils.js';

/** 5-char encoder (&, <, >, ", '). Editor over-escapes by design. */
export { escapeAttr };

/** Alias for escapeAttr — matches the editor's existing call sites
 *  where `escapeHtml(value)` was the 5-char encoder, not the server's
 *  text-only 3-char `escapeHtml`. */
export const escapeHtml = escapeAttr;
