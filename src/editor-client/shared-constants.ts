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
//   - SCROLL_TRIGGER_MODES: schema is ['on-scroll', 'on-load'];
//     canvas-client.ts:450 is ['on-load', 'on-scroll']. Same members,
//     reversed order. Whether order is load-bearing depends on UI
//     iteration; resolves on Phase 3.
//
// Neither is fixed in canvas-client.ts as part of this commit because
// this file is not on the runtime path yet — Phase 3 is the atomic
// cutover that retires the inline mirrors.

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
