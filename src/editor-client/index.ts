// src/editor-client/index.ts
//
// ADR 0058 Phase 2q.m + ADR 0015 Phase 3 — editor-client entrypoint.
//
// `createEditor(boot)` moves from a stub that threw on call to a real
// orchestrator that:
//   1. builds the EditorContext skeleton from the boot payload (siteId,
//      apiBase, wsToken, displayName, userId) plus the constants /
//      collections / DOM-ref slots every sibling module expects;
//   2. caches DOM refs onto ctx (root, inspector, status line, sidebar,
//      save/publish/version-badge buttons, chat refs, etc.) the same way
//      the inline IIFE does at canvas-client.ts:605-660;
//   3. binds every sibling-module `Ximpl` onto the matching `ctx.X`
//      method so the modules can read each other through ctx;
//   4. runs the boot async block mirroring the IIFE's initial-load IIFE
//      at canvas-client.ts:13913-14405 — authFetch → shape guard →
//      migrateState → mountViewport → renderAll → attach* → attachCoEdit
//      → setStatus("Ready", "ok") → session keepalive → setupChatSession.
//
// The editor route now serves this bundle. The context skeleton is
// immediately patched by installRuntimeHelpers(ctx) so any remaining
// unbound guard is a boot-ordering bug and fails loudly.

import './styles.css';

import type { CanvasElement, CanvasPage, CanvasSection, EditableSite, InlineMark, InlineRun, InlineMarkType, PositionedBox } from '../canvas/schema.js';
import type { MediaElement } from '../canvas/elements/media.js';
import { INSPECTOR_DISPATCH } from '../canvas/elements/index.js';
import { ICON_NAMES, renderIconSvg } from '../canvas/icons.js';
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
import { findFontSizeMark, findLinkMark, hasMark } from './mark-queries.js';
import { bringToFront, nextZInArray, nudgeZ, renormalizeZ, sendToBack } from './z-order.js';
import { cssEscape } from './css-escape.js';
import { previewPaletteFromAccent } from './palette.js';
import { SIDEBAR_FACTORIES } from './sidebar-factories.js';
import { field, selectInput } from './dom-builders.js';
import {
  openAiMediaModalImpl,
  openAlertModalImpl,
  openConfirmModalImpl,
  openNewPageModalImpl,
  openSelectModalImpl,
  openTextModalImpl,
} from './modals.js';
import {
  applyElementStyleImpl,
  applyPinnedStyleImpl,
  setBoxStyleImpl,
} from './style-apply.js';
import { buildRunNodeImpl } from './run-builders.js';
import {
  buildActionBodyImpl,
  buildContainerBodyImpl,
  buildMediaBodyImpl,
  buildShapeBodyImpl,
  buildTextBodyImpl,
} from './body-builders-basic.js';
import { buildElementBodyImpl } from './body-builders-data.js';
import {
  buildElementMenuImpl,
  buildElementNodeImpl,
  closeElementMenuImpl,
  rebuildElementImpl,
  toggleElementMenuImpl,
} from './element-menu.js';
import { renderInspector as renderInspectorImpl } from './element-inspector.js';
import { selectElement as selectElementImpl, selectSection as selectSectionImpl } from './selection.js';
import { serializeContentToRuns, marksEqual, plainTextOf } from './mark-serialize.js';
import {
  captureForUndo as captureForUndoImpl,
  scheduleSave as scheduleSaveImpl,
  disableUndoPersistence as disableUndoPersistenceImpl,
  initUndo,
} from './persist.js';
import { authFetchImpl } from './session-lifecycle.js';
import { toggleChatPanel as toggleChatPanelImpl, updateChatSelectionChipImpl } from './chat-panel.js';
import { appendChatMessageImpl, hideChatWelcomeImpl, setupChatSession } from './chat-session.js';
import {
  applyAgentOpsImpl,
  describeOp,
  findCanvasNodeForOpImpl,
  focusCanvasOnNodeImpl,
  refreshAcceptAllButtonImpl,
  revertAgentEntryImpl,
  setAiBusyImpl,
  showAcceptAllSummaryImpl,
} from './ai-integration.js';
import {
  aiCreateSectionImpl,
  aiReplaceMediaImpl,
  aiRewriteTextImpl,
  closeAiPanelImpl,
  runAiPreviewImpl,
} from './ai-preview-panel.js';
import {
  attachCoEditImpl,
  coEditSyncImpl,
  loadPresenceIdentity,
  repaintRemoteCursorsImpl,
} from './co-edit.js';
import {
  attachPointerHandlersImpl,
  clearTemporaryPanStateImpl,
  endTemporaryPanImpl,
  exitPlacementModeImpl,
  setInteractionModeImpl,
} from './drag-resize.js';
import {
  ensureSectionsPanelLoaded,
  enterPlacementModeImpl,
  importPendingSectionAt,
  renderPlacementSlotsImpl,
  renderSectionsPanelImpl,
} from './sections-picker.js';
import {
  applySidebarStyleKit,
  attachSidebarActions,
  attachSidebarTabs,
  buildKitSummary,
  syncSidebarStyleKitButtonsImpl,
} from './sidebar.js';
import {
  attachPublishButtonImpl,
  publishSiteImpl,
  updateVersionBadgeImpl,
} from './publish.js';
import {
  attachVersionBadgeImpl,
  closeVersionPillImpl,
  openVersionPillImpl,
} from './version-pill.js';
import { attachSaveButtonImpl } from './save-wiring.js';
import {
  activateSidebarTabImpl,
  ensureVersionsTabMountedImpl,
  renderVersionsPanelImpl,
} from './versions-panel.js';
import { attachRootEventsImpl } from './canvas-root-events.js';
import { deleteElement } from './inspector-actions.js';
import {
  removeLinkPopoverImpl,
  showLinkPopoverImpl,
  onCanvasLinkHover as onCanvasLinkHoverImpl,
  onCanvasLinkHoverLeave as onCanvasLinkHoverLeaveImpl,
} from './link-popover.js';
import {
  applyMarkImpl,
  buildMarkToolbarImpl,
  onMarkToolbarReflowImpl,
  refreshMarkToolbarFontSizeStateImpl,
} from './mark-toolbar.js';
import {
  attachPageCrumbImpl,
  createPageImpl,
  deletePageImpl,
  findPageByHref as findPageByHrefImpl,
  goToHrefOnCanvasImpl,
  refreshPageCrumbImpl,
  renamePageImpl,
  setActivePageImpl,
  updatePageSidebarImpl,
} from './page-crud.js';
import { mountReel, openReelImpl, closeReelImpl, renderReelImpl, moveSectionToIndex as moveSectionToIndexImpl } from './reel.js';
import { renderAllImpl, fitToPage as fitToPageImpl, fitAllPages as fitAllPagesImpl } from './render.js';
import { attachGripHandlersImpl, beginSectionDragImpl } from './section-drag.js';
import {
  addBlankSectionFromSidebarImpl,
  addComponentFromSidebarImpl,
  addElementToSectionImpl,
  componentActionForSidebar as componentActionForSidebarImpl,
  defaultBoxImpl,
  handleSectionActionImpl,
  panToElementImpl,
  saveSiteAsTemplateImpl,
  saveToLibraryImpl,
  targetSectionForSidebarImpl,
} from './section-toolbar.js';
import { beginTextEditImpl } from './text-edit.js';
import type { EditorBoot, EditorContext, RemoteCursorEntry } from './editor-context.js';
import {
  attachChromeToggles,
  installRuntimeHelpers,
  mountViewportImpl,
  wireCoEditPresenceListeners,
  wireMarkToolbarReflowListeners,
} from './runtime-helpers.js';

// Re-export side-effecting / utility imports so the bundle's tree-shaker
// keeps them. These were void-referenced in the Phase 2a stub; with
// createEditor as a real entry point the wiring path keeps them alive
// directly, but the explicit re-exports document intent for the bundle.
void field;
void selectInput;
void findFontSizeMark;
void findLinkMark;
void hasMark;
void bringToFront;
void nudgeZ;
void renormalizeZ;
void sendToBack;
void openTextModalImpl;
void openSelectModalImpl;
void openConfirmModalImpl;
void openAlertModalImpl;
void openAiMediaModalImpl;
void openNewPageModalImpl;
// body-builder dispatch targets are kept void-referenced — the per-type
// builders are consumed only inside buildElementBodyImpl, so the tree-shaker
// needs an explicit liveness mark from the entry module.
void buildTextBodyImpl;
void buildMediaBodyImpl;
void buildActionBodyImpl;
void buildShapeBodyImpl;
void buildContainerBodyImpl;
void nextZInArray;
void STYLE_KITS;
void MOTION_PRESETS;
void INLINE_MARK_TYPES;
void ALLOWED_HREF_SCHEMES;
void DEFAULT_PAGE_WIDTH_PX;
void COEDIT_RECONNECT_MAX_ATTEMPTS;
void CANONICAL_MARK_ORDER;
void isAllowedHref;
void isSafeCssValue;
void isValidActionHref;
void MARK_TAGS;
void newElementId;
void newPageId;
void newSectionId;
void escapeAttr;
void escapeHtml;
void cssEscape;
void previewPaletteFromAccent;
void SIDEBAR_FACTORIES;

export type { EditorBoot, EditorContext, RemoteCursorEntry };

// Build the icon → SVG-markup map once at module load. The inline IIFE
// JSON-injected this from the route handler; the bundle owns the lookup
// directly so the editor route is free of icon-registry knowledge.
const ICON_SVG_MAP_VALUE: Record<string, string> = Object.fromEntries(
  ICON_NAMES.map((name) => [name, renderIconSvg(name, { inline: false })]),
);

/**
 * Round-trip an unknown error through a stable string for status-line
 * surfacing. The inline IIFE reads `err.message` directly; ts-strict +
 * exactOptionalPropertyTypes forbid that on `unknown`, so the helper
 * mirrors the inline twin's contract while satisfying narrow types.
 */
function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown';
}

/**
 * Build a partially-populated EditorContext from the boot payload.
 *
 * Primitives (siteId/apiBase/wsToken/presenceDisplayName/presenceUserId)
 * come from boot directly. Collections (undoStack/redoStack/pagePositions/
 * remoteCursors/pendingAiSuggestions) initialise empty. DOM refs are null
 * until `createEditor` caches them. Forward-declared ctx methods whose
 * helpers that used to live in the IIFE closure are patched onto ctx by
 * installRuntimeHelpers(ctx) before boot starts. The skeleton keeps loud
 * runtime-helper-not-installed guards only for impossible boot-order bugs.
 *
 * After the skeleton lands, `createEditor` rebinds every ctx method whose
 * impl IS already extracted into a sibling module — the stub is the
 * fallback for methods that still live inline in canvas-client.ts.
 */
function createEditorContextSkeleton(boot: EditorBoot): EditorContext {
  const runtimeHelperNotInstalled = (label: string): (() => never) =>
    () => {
      throw new Error(
        `${label}: runtime helper was not installed before createEditor boot`,
      );
    };
  const siteBase = boot.apiBase + '/canvas/sites/' + boot.siteId;
  // The Partial cast remains because optional fields (repaintRemoteCursors
  // / onMarkToolbarReflow) are intentionally left undefined until their
  // late-binding paths fire.
  const ctxPartial: Partial<EditorContext> = {
    // ---- Foundational state ------------------------------------------
    state: null,
    mainEl: null,
    selectedElementId: null,
    findElement: runtimeHelperNotInstalled('findElement'),
    renderAll: () => renderAllImpl(ctx),
    renderInspector: () => renderInspectorImpl(ctx),
    selectElement: (elementId) => selectElementImpl(ctx, elementId),
    captureForUndo: () => captureForUndoImpl(ctx),
    scheduleSave: () => scheduleSaveImpl(ctx),
    closeElementMenu: () => closeElementMenuImpl(ctx),

    // ---- Media inspector mounts --------------------------------------
    aiBusy: false,
    INSPECTOR_ACTION_HANDLERS: {},

    // ---- Form inspector mounts ---------------------------------------
    rebuildElement: (elementId) => rebuildElementImpl(ctx, elementId),

    // ---- Content inspector mounts ------------------------------------
    serializeContentToRuns: (rootNode) => serializeContentToRuns(rootNode),
    buildPickerThumb: runtimeHelperNotInstalled('buildPickerThumb'),
    postAssetUpload: runtimeHelperNotInstalled('postAssetUpload'),
    statusEl: null,
    statusTimer: null,
    setStatus: runtimeHelperNotInstalled('setStatus'),

    // ---- Nav links + media picker mounts ------------------------------
    authFetch: (input, init) =>
      init === undefined ? authFetchImpl(ctx, input) : authFetchImpl(ctx, input, init),
    apiBase: boot.apiBase,
    siteId: boot.siteId,
    applyAssetIdToElement: runtimeHelperNotInstalled('applyAssetIdToElement'),
    runDeleteAsset: runtimeHelperNotInstalled('runDeleteAsset'),
    uploadMediaForElement: runtimeHelperNotInstalled('uploadMediaForElement'),

    // ---- Section inspector --------------------------------------------
    inspector: null,
    selectedSectionId: null,
    inspectorRenderSubject: null,
    findSection: runtimeHelperNotInstalled('findSection'),
    preserveInspectorScrollFor: runtimeHelperNotInstalled('preserveInspectorScrollFor'),
    revokePendingPreviews: runtimeHelperNotInstalled('revokePendingPreviews'),
    selectableSectionRoles: runtimeHelperNotInstalled('selectableSectionRoles'),
    aiCreateSection: (afterSectionId) => {
      void aiCreateSectionImpl(ctx, afterSectionId);
    },

    // ---- Page inspector -----------------------------------------------
    root: null,
    activePageId: null,
    currentPage: runtimeHelperNotInstalled('currentPage'),
    updatePageSidebar: () => updatePageSidebarImpl(ctx),
    applyPageMotionAttributes: runtimeHelperNotInstalled('applyPageMotionAttributes'),
    applyPageStyleProperties: runtimeHelperNotInstalled('applyPageStyleProperties'),
    pageRenderWidth: runtimeHelperNotInstalled('pageRenderWidth'),

    // ---- Element inspector orchestrator -------------------------------
    isReelOpen: false,
    INSPECTOR_DISPATCH,
    renderInspectorSpec: runtimeHelperNotInstalled('renderInspectorSpec'),
    siteBase,

    // ---- Persist + undo/redo ------------------------------------------
    undoStack: [],
    redoStack: [],
    undoTimer: null,
    undoRedoing: false,
    undoPersistenceFailed: false,
    saveTimer: null,
    saveQueue: Promise.resolve(true),
    coEditConnection: null,
    coEditSync: () => coEditSyncImpl(ctx),
    saveStateNow: runtimeHelperNotInstalled('saveStateNow'),
    disableUndoPersistence: (reason, error) => disableUndoPersistenceImpl(ctx, reason, error),

    // ---- Selection state-machine --------------------------------------
    chatSelectionDropped: false,
    linkPopoverPinned: false,
    removeLinkPopover: () => removeLinkPopoverImpl(ctx),
    closeReel: () => closeReelImpl(ctx),
    showLinkPopover: (anchorEl, opts) =>
      opts === undefined ? showLinkPopoverImpl(ctx, anchorEl) : showLinkPopoverImpl(ctx, anchorEl, opts),
    updateChatSelectionChip: () => updateChatSelectionChipImpl(ctx),
    renderReel: () => renderReelImpl(ctx),
    selectSection: (sectionId) => selectSectionImpl(ctx, sectionId),

    // ---- Camera + render orchestrator ---------------------------------
    viewport: null,
    zoomToolbar: null,
    zoomReadout: null,
    camera: { x: 0, y: 0, zoom: 1 },
    pagePositions: [],
    pendingImport: null,
    buildSectionNode: runtimeHelperNotInstalled('buildSectionNode'),
    syncSidebarStyleKitButtons: (buttons) => syncSidebarStyleKitButtonsImpl(ctx, buttons),
    renderPlacementSlots: () => renderPlacementSlotsImpl(ctx),
    setBoxStyle: (wrapper, box) => setBoxStyleImpl(ctx, wrapper, box),

    // ---- Chat panel toggle + selection chip --------------------------
    chatToggleBtn: null,
    chatPanelEl: null,
    chatCloseBtn: null,
    chatSelectionEl: null,
    chatSelectionTextEl: null,
    chatSelectionClearBtn: null,
    toggleChatPanel: () => toggleChatPanelImpl(ctx),

    // ---- Chat session form + SSE streaming ----------------------------
    chatForm: null,
    chatInput: null,
    chatMessages: null,
    chatWelcome: null,
    chatSessionId: null,
    chatBusy: false,
    appendChatMessage: (role, text) => appendChatMessageImpl(ctx, role, text),
    hideChatWelcome: () => hideChatWelcomeImpl(ctx),

    // ---- AI integration -----------------------------------------------
    chatAcceptAllBtn: null,
    showAcceptAllSummary: () => showAcceptAllSummaryImpl(ctx),
    pendingAiSuggestions: [],
    applyAgentOps: (ops, suggestions) =>
      // The impl typing keeps the inverse-capture signature internal — the
      // ctx-level surface narrows back to `unknown[]` per the IIFE twin.
      applyAgentOpsImpl(ctx, ops, suggestions as Parameters<typeof applyAgentOpsImpl>[2]),
    refreshAcceptAllButton: () => refreshAcceptAllButtonImpl(ctx),
    findCanvasNodeForOp: (op) =>
      findCanvasNodeForOpImpl(ctx, op as Parameters<typeof findCanvasNodeForOpImpl>[1]),
    focusCanvasOnNode: (node) => focusCanvasOnNodeImpl(ctx, node),
    describeOp: (op) => describeOp(op as Parameters<typeof describeOp>[0]),
    revertAgentEntry: (entry) => {
      void revertAgentEntryImpl(ctx, entry as Parameters<typeof revertAgentEntryImpl>[1]);
    },
    setAiBusy: (busy) => setAiBusyImpl(ctx, busy),

    // ---- Persist + immediate-save bridge ------------------------------
    flushPendingSave: runtimeHelperNotInstalled('flushPendingSave'),

    // ---- Keyboard handlers --------------------------------------------
    editingElementId: null,

    // ---- Drag/resize cluster + pointer state machine -----------------
    MIN_ELEMENT_SIZE_PX,
    interactionMode: 'select',
    spaceHeldForPan: false,
    temporaryPanPreviousMode: null,
    setInteractionMode: (mode) => setInteractionModeImpl(ctx, mode),
    clearTemporaryPanState: () => clearTemporaryPanStateImpl(ctx),
    endTemporaryPan: () => endTemporaryPanImpl(ctx),
    exitPlacementMode: () => exitPlacementModeImpl(ctx),
    pointerToCanvas: runtimeHelperNotInstalled('pointerToCanvas'),
    resolveElementWrapperAtPoint: runtimeHelperNotInstalled('resolveElementWrapperAtPoint'),
    onCanvasLinkHover: (ev) => onCanvasLinkHoverImpl(ctx, ev),
    onCanvasLinkHoverLeave: (ev) => onCanvasLinkHoverLeaveImpl(ctx, ev),
    renderSectionsPanel: () => renderSectionsPanelImpl(ctx),

    // ---- Section toolbar + section orchestration ---------------------
    defaultBox: (section, w, h) => defaultBoxImpl(ctx, section, w, h),
    addElementToSection: (section, element) => addElementToSectionImpl(ctx, section, element),
    targetSectionForSidebar: () => targetSectionForSidebarImpl(ctx),
    panToElement: (elementId) => panToElementImpl(ctx, elementId),
    addBlankSectionFromSidebar: () => addBlankSectionFromSidebarImpl(ctx),
    componentActionForSidebar: (component) => componentActionForSidebarImpl(ctx, component),
    addComponentFromSidebar: (component) => addComponentFromSidebarImpl(ctx, component),
    handleSectionAction: (action, sectionId) => handleSectionActionImpl(ctx, action, sectionId),
    saveToLibrary: (section) => saveToLibraryImpl(ctx, section),
    saveSiteAsTemplate: () => saveSiteAsTemplateImpl(ctx),

    // ---- Sidebar dispatch bridge -------------------------------------
    SIDEBAR_COMMANDS: {},
    insertElementForSidebarCommand: runtimeHelperNotInstalled('insertElementForSidebarCommand'),
    getPagePosition: runtimeHelperNotInstalled('getPagePosition'),
    sectionsCatalog: null,

    // ---- Session-expired / access-revoked lifecycle -------------------
    sessionExpired: false,
    accessRevoked: false,
    saveBusy: false,
    saveButton: null,
    publishButton: null,

    // ---- Co-edit / presence integration --------------------------------
    coEditSocketOpen: false,
    localPresence: null,
    presenceLayer: null,
    remoteCursors: new Map<number, RemoteCursorEntry>(),
    remotePeerCount: 0,
    lastWorldPoint: null,
    pointerPublishPending: false,
    pointerPublishTimerId: null,
    pointerPublishLastAtMs: 0,
    presencePublishPending: false,
    presencePublishLastAtMs: 0,
    attachCoEdit: () => attachCoEditImpl(ctx),
    wsToken: boot.wsToken,
    presenceDisplayName: boot.displayName,
    presenceUserId: boot.userId,
    editingSnapshot: null,

    // ---- Modal cluster -------------------------------------------------
    modalOpen: false,
    openTextModal: (opts) => openTextModalImpl(ctx, opts),
    openSelectModal: (opts) => openSelectModalImpl(ctx, opts),
    openConfirmModal: (opts) => openConfirmModalImpl(ctx, opts),
    openAlertModal: (opts) => openAlertModalImpl(ctx, opts),
    openAiMediaModal: (opts) => openAiMediaModalImpl(ctx, opts),
    openNewPageModal: (opts) => openNewPageModalImpl(ctx, opts),

    // ---- Asset reel + section drag -------------------------------------
    reelViewMode: 'tile',
    openReel: () => openReelImpl(ctx),
    moveSectionToIndex: (fromIdx, toIdx) => moveSectionToIndexImpl(ctx, fromIdx, toIdx),
    beginSectionDrag: (sectionId, startEv) => beginSectionDragImpl(ctx, sectionId, startEv),

    // ---- Page CRUD + page-crumb popover -------------------------------
    pageCrumbMenu: null,
    pageCrumbOutsideHandler: null,
    pageCrumbKeyHandler: null,
    setActivePage: (pageId) => setActivePageImpl(ctx, pageId),
    refreshPageCrumb: () => refreshPageCrumbImpl(ctx),
    findPageByHref: (href) => findPageByHrefImpl(ctx, href),
    goToHrefOnCanvas: (href) => goToHrefOnCanvasImpl(ctx, href),
    createPage: () => createPageImpl(ctx),
    renamePage: (pageId) => renamePageImpl(ctx, pageId),
    deletePage: (pageId) => deletePageImpl(ctx, pageId),
    fitToPage: (pageId) => fitToPageImpl(ctx, pageId),
    fitAllPages: () => fitAllPagesImpl(ctx),

    // ---- AI preview panel (single-shot) -------------------------------
    aiPanel: null,
    closeAiPanel: () => closeAiPanelImpl(ctx),
    runAiPreview: (prompt) => runAiPreviewImpl(ctx, prompt),
    aiRewriteText: (elementId) => aiRewriteTextImpl(ctx, elementId),
    aiReplaceMedia: (elementId) => aiReplaceMediaImpl(ctx, elementId),
    migrateState: (s) => migrateState(s) as EditableSite,
    uploadGeneratedBlobToElement: runtimeHelperNotInstalled('uploadGeneratedBlobToElement'),

    // ---- Link popover + mark toolbar + text editing -------------------
    markToolbar: null,
    markToolbarAnchor: null,
    linkPopover: null,
    linkPopoverAnchor: null,
    linkPopoverShowTimer: null,
    linkPopoverHideTimer: null,
    refreshMarkToolbarFontSizeState: () => refreshMarkToolbarFontSizeStateImpl(ctx),
    buildMarkToolbar: (anchor) => buildMarkToolbarImpl(ctx, anchor),
    applyMark: (type: InlineMarkType) => applyMarkImpl(ctx, type),
    beginTextEdit: (elementId) => beginTextEditImpl(ctx, elementId),

    // ---- Link popover + paste normalization bridge -------------------
    forceOpenInspector: runtimeHelperNotInstalled('forceOpenInspector'),
    buildRunNode: (run) => buildRunNodeImpl(ctx, run),
    marksEqual: (a: InlineMark[], b: InlineMark[]) => marksEqual(a, b),
    plainTextOf: (content: InlineRun[]) => plainTextOf(content),
    renderMathInScope: runtimeHelperNotInstalled('renderMathInScope'),
    normalizePastedHtml: runtimeHelperNotInstalled('normalizePastedHtml'),
    plainTextToFragmentHtml: runtimeHelperNotInstalled('plainTextToFragmentHtml'),
    beginDrag: runtimeHelperNotInstalled('beginDrag'),
    openLinkModal: runtimeHelperNotInstalled('openLinkModal'),

    // ---- Phase 2q.d: run + body builders + element menu --------------
    // ICON_SVG_MAP is imported directly from the icon registry now that
    // the editor ships as a bundle (Phase 3 cutover). The inline IIFE
    // used to JSON-inject this map from the route handler; the bundle
    // owns the build-time lookup, eliminating the route's knowledge of
    // the icon registry shape.
    ICON_SVG_MAP: ICON_SVG_MAP_VALUE,
    openMenuElementId: null,
    applyElementStyle: (wrapper, element) => applyElementStyleImpl(ctx, wrapper, element),
    applyPinnedStyle: (wrapper, element) => applyPinnedStyleImpl(ctx, wrapper, element),
    buildElementBody: (element) => buildElementBodyImpl(ctx, element),
    buildElementNode: (element) => buildElementNodeImpl(ctx, element),
    buildElementMenu: (element, section, wrapper) =>
      buildElementMenuImpl(ctx, element, section, wrapper),
    toggleElementMenu: (elementId, wrapper) => toggleElementMenuImpl(ctx, elementId, wrapper),

    // ---- AI image generator ------------------------------------------
    generateImageForElement: runtimeHelperNotInstalled('generateImageForElement'),

    // ---- Phase 2q.i: sections picker + sidebar wiring ----------------
    sidebar: null,
    activeTemplateFilter: 'all',
    activeSearchQuery: '',
    enterPlacementMode: (target) => enterPlacementModeImpl(ctx, target),
    importPendingSectionAt: (insertAt) => importPendingSectionAt(ctx, insertAt),
    attachSidebarTabs: () => attachSidebarTabs(ctx),
    attachSidebarActions: () => attachSidebarActions(ctx),
    applySidebarStyleKit: (kit, buttons) => applySidebarStyleKit(ctx, kit, buttons),
    buildKitSummary: () => buildKitSummary(ctx),
    ensureSectionsPanelLoaded: () => ensureSectionsPanelLoaded(ctx),

    // ---- Phase 2q.j: publish + version pill + save + versions panel --
    versionBadge: null,
    versionPill: null,
    versionPillOutsideHandler: null,
    versionPillKeyHandler: null,
    saveTemplateButton: null,
    versionsLoaded: false,
    versionsList: [],
    // isEditableShortcutTarget is installed by runtime-helpers before
    // attachSaveButton wires global shortcuts.
    isEditableShortcutTarget: runtimeHelperNotInstalled('isEditableShortcutTarget'),
    deleteElement: (section, element) => deleteElement(ctx, section, element),
    updateVersionBadge: (version) => updateVersionBadgeImpl(ctx, version),
    publishSite: () => publishSiteImpl(ctx),
    attachPublishButton: () => attachPublishButtonImpl(ctx),
    closeVersionPill: () => closeVersionPillImpl(ctx),
    openVersionPill: () => openVersionPillImpl(ctx),
    attachVersionBadge: () => attachVersionBadgeImpl(ctx),
    attachSaveButton: () => attachSaveButtonImpl(ctx),
    activateSidebarTab: (tabName) => activateSidebarTabImpl(ctx, tabName),
    ensureVersionsTabMounted: () => ensureVersionsTabMountedImpl(ctx),
    renderVersionsPanel: () => renderVersionsPanelImpl(ctx),

    // ---- Phase 2q.k: canvas root events ------------------------------
    attachRootEvents: () => attachRootEventsImpl(ctx),

    // ---- Camera-reflow opt-in callbacks (kept undefined at boot) -----
    // repaintRemoteCursors + onMarkToolbarReflow are typeof-gated by the
    // camera helpers so they stay undefined until co-edit attaches /
    // mark-toolbar mounts. Phase 2p.b's attachCoEdit sets
    // ctx.repaintRemoteCursors when the connection opens; the mark
    // toolbar's mount path sets ctx.onMarkToolbarReflow. Both are optional
    // fields on EditorContext — leaving them off here is correct.
  };
  const ctx = ctxPartial as unknown as EditorContext;
  // Side-effect: silence the "imported but unused at runtime" lint for the
  // repaint helper export so the bundle keeps it for Phase 2p.b's
  // attachCoEdit to rebind. attachCoEditImpl assigns ctx.repaintRemoteCursors
  // = () => repaintRemoteCursorsImpl(ctx) when the WS opens.
  void repaintRemoteCursorsImpl;
  return ctx;
}

/**
 * ADR 0058 — Editor entry point.
 *
 * Builds the EditorContext skeleton from `boot`, caches DOM refs, then
 * runs the boot async block mirroring the inline IIFE in canvas-client.ts
 * at lines 13913-14405. Order matters: `mountViewport` precedes
 * `renderAll`; `attachCoEdit` runs AFTER `attachSaveButton` so the WS
 * factory can disable the save button on socket failure; `setStatus
 * ("Ready", "ok")` is the last call before the session-keepalive
 * interval + `setupChatSession`.
 *
 * Today this function is NEVER called — the editor route still serves
 * `canvasClientScript()` and the resulting IIFE owns the closure. Phase
 * 3 cutover (ADR 0015) is the commit-set that swaps the route over.
 * Until then this code typechecks and lints but is dead.
 */
export function createEditor(boot: EditorBoot): void {
  const ctx = createEditorContextSkeleton(boot);
  installRuntimeHelpers(ctx);

  // ---- DOM ref caching (mirror canvas-client.ts:605-660) -------------
  ctx.root = document.getElementById('canvas-root');
  ctx.inspector = document.getElementById('canvas-inspector');
  ctx.statusEl = document.getElementById('canvas-status');
  ctx.mainEl = document.querySelector('main.opencanvas-editor');
  ctx.sidebar = document.getElementById('canvas-sidebar');
  ctx.saveButton = document.getElementById('canvas-save');
  ctx.publishButton = document.getElementById('canvas-publish') as HTMLButtonElement | null;
  ctx.versionBadge = document.getElementById('canvas-version');
  ctx.saveTemplateButton = document.getElementById('canvas-save-template');
  // The chat panel + selection chip refs are cached early — the toggle
  // wiring runs before the site-load promise resolves so an Owner can
  // open the chat panel during the boot wait.
  ctx.chatToggleBtn = document.getElementById('canvas-chat-toggle');
  ctx.chatPanelEl = document.getElementById('canvas-chat-panel');
  ctx.chatCloseBtn = document.getElementById('canvas-chat-close');
  ctx.chatSelectionEl = document.getElementById('canvas-chat-selection');
  ctx.chatSelectionTextEl = document.getElementById('canvas-chat-selection-text');
  ctx.chatSelectionClearBtn = document.getElementById('canvas-chat-selection-clear');

  // Early chat-toggle wiring so the Owner can open the panel during the
  // site-load wait. Mirrors canvas-client.ts:631-632.
  if (ctx.chatToggleBtn) ctx.chatToggleBtn.addEventListener('click', () => ctx.toggleChatPanel());
  if (ctx.chatCloseBtn) ctx.chatCloseBtn.addEventListener('click', () => ctx.toggleChatPanel());
  if (ctx.chatSelectionClearBtn) {
    ctx.chatSelectionClearBtn.addEventListener('click', () => {
      ctx.chatSelectionDropped = true;
      ctx.updateChatSelectionChip();
    });
  }

  // ---- Boot async block (mirror canvas-client.ts:13913-14405) -------
  void (async () => {
    try {
      const response = await ctx.authFetch(ctx.siteBase);
      if (!response.ok) {
        ctx.setStatus('Failed to load site (' + response.status + ')', 'error');
        return;
      }
      const body = (await response.json()) as {
        editableState?: EditableSite;
        publishedVersion?: number;
      };
      // Minimal shape guard against server-response drift. The full schema
      // lives server-side in src/canvas/schema.ts; here we only assert the
      // bare bones the editor needs to boot.
      if (
        !body ||
        typeof body !== 'object' ||
        !body.editableState ||
        typeof body.editableState !== 'object' ||
        !Array.isArray(body.editableState.pages)
      ) {
        throw new Error(
          'GET site returned an unexpected body shape (missing editableState.pages array)',
        );
      }
      ctx.state = body.editableState;
      if (ctx.state) ctx.state = ctx.migrateState(ctx.state);
      if (ctx.state && ctx.state.pages && ctx.state.pages.length > 0) {
        ctx.activePageId = ctx.state.pages[0]!.id;
      }
      // Version badge + initUndo + style-kit attribute (mirror IIFE).
      ctx.updateVersionBadge(
        typeof body.publishedVersion === 'number' ? body.publishedVersion : 0,
      );
      ctx.attachVersionBadge();
      initUndo(ctx);
      if (ctx.mainEl && ctx.state && ctx.state.styleKit) {
        ctx.mainEl.setAttribute('data-style-kit', ctx.state.styleKit);
      }
      ctx.onMarkToolbarReflow = () => onMarkToolbarReflowImpl(ctx);
      wireMarkToolbarReflowListeners(ctx);
      // mountViewport MUST precede renderAll so #canvas-root is in its
      // final DOM position when sections render in.
      mountViewportImpl(ctx);
      ctx.renderAll();
      // Math rendering: re-run once KaTeX resolves so deferred equations
      // catch up.
      window.addEventListener('opencanvas-katex-ready', function () {
        if (ctx.root) ctx.renderMathInScope(ctx.root);
      });
      if (window.katex && ctx.root) ctx.renderMathInScope(ctx.root);
      ctx.attachRootEvents();
      attachPointerHandlersImpl(ctx);
      mountReel(ctx);
      attachGripHandlersImpl(ctx);
      ctx.attachSidebarTabs();
      attachPageCrumbImpl(ctx);
      attachChromeToggles(ctx);

      ctx.ensureVersionsTabMounted();
      ctx.attachSidebarActions();
      ctx.updatePageSidebar();

      // Page CRUD button wiring — the page-add button + page-list click
      // delegate live here; createPage / renamePage / deletePage are
      // extracted.
      const addPageBtn = document.getElementById('canvas-add-page');
      if (addPageBtn) {
        addPageBtn.addEventListener('click', () => {
          void ctx.createPage();
        });
      }
      const pageListEl = document.getElementById('canvas-page-list');
      if (pageListEl) {
        pageListEl.addEventListener('click', function (ev) {
          const actionBtn =
            ev.target instanceof Element ? ev.target.closest('[data-page-action]') : null;
          if (actionBtn) {
            const action = actionBtn.getAttribute('data-page-action');
            const pid = actionBtn.getAttribute('data-page-id');
            if (action === 'rename' && pid) void ctx.renamePage(pid);
            else if (action === 'delete' && pid) void ctx.deletePage(pid);
            return;
          }
          const pageItem =
            ev.target instanceof Element ? ev.target.closest('.opencanvas-page-item') : null;
          if (pageItem) {
            const pid2 = pageItem.getAttribute('data-page-id');
            if (pid2 && pid2 !== ctx.activePageId) {
              ctx.setActivePage(pid2);
              ctx.fitToPage(pid2);
            }
          }
        });
      }

      // attachCoEdit runs AFTER the save-button wiring so the WS factory
      // can disable the save button on socket failure (the order matters
      // — the save button must exist before the WS open/close callbacks
      // can flip its disabled state).
      ctx.attachSaveButton();
      ctx.attachPublishButton();
      ctx.localPresence = loadPresenceIdentity(ctx.presenceDisplayName);
      ctx.attachCoEdit();
      wireCoEditPresenceListeners(ctx);
      ctx.setStatus('Ready', 'ok');

      // Session keepalive — Owner sessions get an hourly HEAD; published-
      // site editors get a token refresh ~15 min before expiry.
      if (ctx.apiBase === '/api') {
        setInterval(function () {
          void fetch(ctx.siteBase, { method: 'HEAD' }).catch(function () {
            // silent — failures surface on the next real API call
          });
        }, 60 * 60 * 1000);
      } else if (ctx.apiBase === '/__api') {
        const REFRESH_BUFFER = 900; // seconds before expiry to refresh
        const scheduleTokenRefresh = (ttl: number): void => {
          const delay = Math.max((ttl - REFRESH_BUFFER) * 1000, 60000);
          setTimeout(function () {
            void fetch(ctx.apiBase + '/edit-token/refresh', { method: 'POST' })
              .then(function (r) {
                return r.json();
              })
              .then(function (d) {
                const data = d as { ok?: boolean; ttl?: number };
                if (data && data.ok && typeof data.ttl === 'number') {
                  scheduleTokenRefresh(data.ttl);
                }
              })
              .catch(function () {
                // Refresh failed; the next authFetch will catch it.
              });
          }, delay);
        };
        // Kick off the first refresh cycle: call the endpoint immediately
        // to learn the current TTL (and get a fresh token).
        void fetch(ctx.apiBase + '/edit-token/refresh', { method: 'POST' })
          .then(function (r) {
            return r.json();
          })
          .then(function (d) {
            const data = d as { ok?: boolean; ttl?: number };
            if (data && data.ok && typeof data.ttl === 'number') {
              scheduleTokenRefresh(data.ttl);
            }
          })
          .catch(function () {});
      }

      // ---- Chat panel SSE handler -------------------------------------
      setupChatSession(ctx);
    } catch (err: unknown) {
      ctx.setStatus('Failed to load site: ' + errorToString(err), 'error');
    }
  })();
}

// Touch unused references so the bundle keeps them and the linter sees
// every import as used. CanvasElement / CanvasPage / CanvasSection /
// PositionedBox / MediaElement are imported as types only for ctx-method
// signature consistency; the type-only imports erase at build time but
// document the surface for Phase 3 readers.
type _BundleKeepalive = CanvasElement | CanvasPage | CanvasSection | PositionedBox | MediaElement;
const _unused: _BundleKeepalive | null = null;
void _unused;

// ADR 0015 Phase 3 — bundle bootstrap. The editor route's HTML shell
// inlines `<script>window.__opencanvasEditorBoot = {...}</script>`
// before loading this bundle's `<script type="module" src="...">`, so
// the global is set by the time this top-level executes. Missing boot
// global means the route forgot to inject it — fail loudly via
// console.error rather than silently no-oping, in line with the
// project's no-fallback rule.
//
// The `typeof window` guard is for Bun/Node import paths (smokes,
// typecheck, tooling) where `window` is undefined. In the browser this
// is always-true, so the runtime cost is one identifier check.
declare global {
  interface Window {
    __opencanvasEditorBoot?: EditorBoot;
  }
}

if (typeof window !== 'undefined') {
  const opencanvasBoot = window.__opencanvasEditorBoot;
  if (opencanvasBoot) {
    createEditor(opencanvasBoot);
  } else {
    console.error(
      'opencanvas: window.__opencanvasEditorBoot missing — editor will not boot. ' +
        'The HTML shell must inline the boot JSON before loading this bundle.',
    );
  }
}
