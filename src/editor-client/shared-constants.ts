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
//   - SHAPE_VARIANTS: the inline SHAPE_VARIANTS at canvas-client.ts:429
//     was dead code (declared, never read). The inspector variant
//     dropdown is driven by shape.ts's InspectorSpec, which imports
//     schema's full 7-entry list — so the inspector already knew about
//     'icon'. The real divergence was buildShapeBody not rendering the
//     icon SVG when variant === 'icon'. Resolved by deleting the dead
//     inline mirror, JSON-injecting an ICON_SVG_MAP alongside
//     INSPECTOR_DISPATCH, and reading it in buildShapeBody.
//   - SCROLL_TRIGGER_MODES: order resolved by flipping schema.ts:102
//     to ['on-load', 'on-scroll'] (matching the editor's deliberate
//     default-first dropdown UX). Validation only uses membership; no
//     other consumer iterates the array.

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
