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
import { isAllowedHref, isSafeCssValue, isValidActionHref } from './href-utils.js';
import { migrateState } from './state-migration.js';
import { MARK_TAGS } from './mark-tags.js';
import { newElementId, newPageId, newSectionId } from './ids.js';
import { escapeAttr, escapeHtml } from './html-escape.js';
import {
  clampInsertIndex,
  hasFooterSection,
  hasHeaderSection,
  isPinnedSection,
  pinnedSectionLabel,
  sectionDisplayName,
} from './section-roles.js';
import { findFontSizeMark, findLinkMark, hasMark } from './mark-queries.js';
import { bringToFront, nextZInArray, nudgeZ, renormalizeZ, sendToBack } from './z-order.js';
import { cssEscape } from './css-escape.js';
import { previewPaletteFromAccent } from './palette.js';
import { SIDEBAR_FACTORIES } from './sidebar-factories.js';
import { field, selectInput } from './dom-builders.js';
import type { EditorBoot, EditorContext } from './editor-context.js';

void field;
void selectInput;

void clampInsertIndex;
void hasFooterSection;
void hasHeaderSection;
void isPinnedSection;
void pinnedSectionLabel;
void sectionDisplayName;
void findFontSizeMark;
void findLinkMark;
void hasMark;
void bringToFront;
void nudgeZ;
void renormalizeZ;
void sendToBack;

console.log('[editor-client] Phase 2d stub ready', {
  styleKits: STYLE_KITS.length,
  motionPresets: MOTION_PRESETS.length,
  inlineMarkTypes: INLINE_MARK_TYPES.length,
  allowedHrefSchemes: ALLOWED_HREF_SCHEMES.length,
  canonicalMarkOrder: CANONICAL_MARK_ORDER.length,
  minElementSizePx: MIN_ELEMENT_SIZE_PX,
  defaultPageWidthPx: DEFAULT_PAGE_WIDTH_PX,
  coeditReconnectMaxAttempts: COEDIT_RECONNECT_MAX_ATTEMPTS,
  markTagNames: Object.keys(MARK_TAGS).length,
  isAllowedHrefOk: isAllowedHref('https://example.com'),
  isSafeCssValueOk: isSafeCssValue('1rem'),
  isValidActionHrefOk: isValidActionHref({ type: 'external', url: 'https://example.com' }),
  migrateStateNullPassthrough: migrateState(null) === null,
  idPrefixes: [newElementId(), newSectionId(), newPageId()].every(
    (id) => id.startsWith('el-') || id.startsWith('sec-') || id.startsWith('page-'),
  ),
  escapeHtmlSample: escapeHtml('<&>"\''),
  escapeAttrSample: escapeAttr('<&>"\''),
  cssEscapeOk: cssEscape('opencanvas-element__id-1234').length > 0,
  paletteLen: previewPaletteFromAccent('#3366cc').length,
  nextZ: nextZInArray([]),
  sidebarFactoryCount: Object.keys(SIDEBAR_FACTORIES).length,
});

export type { EditorBoot, EditorContext };

/**
 * ADR 0058 — Editor entry point. Today's IIFE body lifts into this
 * function as Phase 2h+ extractions land. The gating commit ships
 * the stub: the function declares its signature, throws if called
 * (the editor route still serves canvasClientScript() until Phase 3
 * cutover), and exists so extracted modules have a real entry point
 * to wire into.
 */
export function createEditor(_boot: EditorBoot): void {
  void _boot;
  throw new Error(
    'createEditor: stub — the editor route still serves canvasClientScript() ' +
      'until ADR 0015 Phase 3 cutover. Phase 2h+ extractions land here.',
  );
}
