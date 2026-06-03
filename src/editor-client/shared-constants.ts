// src/editor-client/shared-constants.ts
//
// ADR 0015 Phase 2a — re-exports of constants the editor shares with
// the server. canvas-client.ts (the legacy editor source) carries an
// inline mirror copy of each entry here, marked with "mirrors schema.ts:X"
// comments the type system cannot enforce. Once Phase 3 cuts the editor
// route over to this src/editor-client/ tree, the inline mirrors delete
// and this module is the only path the editor takes to these values.
//
// Drift discovered 2026-06-03 between canvas-client.ts and schema.ts:
//   - SHAPE_VARIANTS: canvas-client.ts:429 is missing 'icon' which
//     schema.ts:78 declares. Real bug — a shape with variant:'icon'
//     passes server validation but the editor's inspector + render path
//     doesn't know the variant. Resolves on Phase 3 cutover.
//   - SCROLL_TRIGGER_MODES: order resolved by flipping schema.ts:102
//     to ['on-load', 'on-scroll'] (matching the editor's deliberate
//     default-first dropdown UX). Validation only uses membership; no
//     other consumer iterates the array.
//
// SHAPE_VARIANTS resolves on Phase 3 cutover when this file becomes
// the only path; the canvas-client.ts inline mirror is dead code and
// will not be patched.

export {
  STYLE_KITS,
  ACTION_VARIANTS,
  SURFACE_VARIANTS,
  SHAPE_VARIANTS,
  MOTION_PRESETS,
  SCROLL_TRIGGER_MODES,
  INLINE_MARK_TYPES,
  INLINE_FONT_SIZE_PX_MIN,
  INLINE_FONT_SIZE_PX_MAX,
} from '../canvas/schema.js';

export { ALLOWED_HREF_SCHEMES } from '../canvas/action-href.js';

export { CHART_KINDS } from '../canvas/elements/chart.js';
