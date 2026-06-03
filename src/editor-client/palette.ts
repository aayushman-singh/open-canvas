// src/editor-client/palette.ts
//
// ADR 0015 Phase 2d — chart palette derivation. Re-exports the canonical
// server source `buildPaletteFromAccent` from src/charts/colors.ts and
// aliases it as `previewPaletteFromAccent` for the editor's existing
// call name.
//
// canvas-client.ts carries five inline mirrors that exist solely because
// the IIFE template literal cannot import the server function:
//   - parseHexAccent (canvas-client.ts:2970)
//   - rgbToHslPreview (:2996)
//   - hslToHexPreview (:3013)
//   - clampPreview (:3037)
//   - previewPaletteFromAccent (:3039)
// All five retire on Phase 3 cutover. The "previews must produce the
// SAME 5 colours the server emits" contract at canvas-client.ts:2988
// becomes mechanically true rather than reliant on the author keeping
// both files in sync.

import { buildPaletteFromAccent } from '../charts/colors.js';

export { buildPaletteFromAccent };

/** Alias for buildPaletteFromAccent — matches the editor's existing
 *  call name. The 5 returned hex colours are byte-identical to what the
 *  server's chart renderer emits, removing the editor/server swatch
 *  drift surface the canvas-client.ts:2988 comment warned about. */
export const previewPaletteFromAccent = buildPaletteFromAccent;
