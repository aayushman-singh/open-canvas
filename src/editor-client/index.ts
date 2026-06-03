// src/editor-client/index.ts
//
// ADR 0015 editor-client module tree — Phase 2a entry point.
//
// As the migration proceeds (Phase 2b+), the contents of
// src/editor/canvas-client.ts move into this tree as normal TS modules
// with normal imports. This entry point exercises the import paths so
// the bundle output isn't trivially empty and Bun.build's tree-shaker
// has something real to keep across rebuilds.
//
// The editor route does not load this bundle yet. Phase 3 is the
// atomic cutover where editor/route.tsx stops inlining canvas-client
// and starts serving the asset.

import './styles.css';

import {
  STYLE_KITS,
  MOTION_PRESETS,
  INLINE_MARK_TYPES,
  ALLOWED_HREF_SCHEMES,
} from './shared-constants.js';
import {
  MIN_ELEMENT_SIZE_PX,
  DEFAULT_PAGE_WIDTH_PX,
  COEDIT_RECONNECT_MAX_ATTEMPTS,
  CANONICAL_MARK_ORDER,
} from './editor-constants.js';

console.log('[editor-client] Phase 2a stub ready', {
  styleKits: STYLE_KITS.length,
  motionPresets: MOTION_PRESETS.length,
  inlineMarkTypes: INLINE_MARK_TYPES.length,
  allowedHrefSchemes: ALLOWED_HREF_SCHEMES.length,
  canonicalMarkOrder: CANONICAL_MARK_ORDER.length,
  minElementSizePx: MIN_ELEMENT_SIZE_PX,
  defaultPageWidthPx: DEFAULT_PAGE_WIDTH_PX,
  coeditReconnectMaxAttempts: COEDIT_RECONNECT_MAX_ATTEMPTS,
});
