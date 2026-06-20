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

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  InlineMark,
  InlineRun,
  InlineMarkType,
  PremiumLoadExperience,
  Overlay,
  PositionedBox,
  RouteTransition,
} from '../canvas/schema.js';
import { isPremiumLoadExperience } from '../canvas/schema.js';
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
  installOpencanvasModalGlobalImpl,
  openAiMediaModalImpl,
  openAlertModalImpl,
  openConfirmModalImpl,
  openNewPageModalImpl,
  openSaveFormModalImpl,
  openSelectModalImpl,
  openTextModalImpl,
  type OpencanvasModalGlobal,
} from './modals.js';
import { applyElementStyleImpl, applyPinnedStyleImpl, setBoxStyleImpl } from './style-apply.js';
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
  buildHostedElementNodeImpl,
  buildElementNodeImpl,
  closeElementMenuImpl,
  rebuildElementImpl,
  toggleElementMenuImpl,
} from './element-menu.js';
import { renderInspector as renderInspectorImpl } from './element-inspector.js';
import {
  selectElement as selectElementImpl,
  selectSection as selectSectionImpl,
} from './selection.js';
import { serializeContentToRuns, marksEqual, plainTextOf } from './mark-serialize.js';
import {
  captureForUndo as captureForUndoImpl,
  scheduleSave as scheduleSaveImpl,
  disableUndoPersistence as disableUndoPersistenceImpl,
  initUndo,
} from './persist.js';
import { authFetchImpl } from './session-lifecycle.js';
import {
  toggleChatPanel as toggleChatPanelImpl,
  updateChatSelectionChipImpl,
} from './chat-panel.js';
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
  prefetchSectionsCatalog,
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
import { renderInteractionsPanel } from './interactions-panel.js';
import {
  previewLoadExperienceInEditor,
  previewOverlayInEditor,
  previewRouteTransitionInEditor,
} from './hydrate-interactives.js';
import { attachPublishButtonImpl, publishSiteImpl, updateVersionBadgeImpl } from './publish.js';
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
  enterCollectionTemplateEditImpl,
  exitCollectionTemplateEditImpl,
} from './collection-template-edit.js';
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
  attachHomeCrumbImpl,
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
import { attachCollectionScaffoldButtonImpl } from './collection-scaffold.js';
import { migrateLegacyCollectionIndexPagesImpl } from './site-load-migration.js';
import {
  mountReel,
  openReelImpl,
  closeReelImpl,
  renderReelImpl,
  moveSectionToIndex as moveSectionToIndexImpl,
} from './reel.js';
import {
  renderAllImpl,
  fitToPage as fitToPageImpl,
  fitAllPages as fitAllPagesImpl,
  panToPage as panToPageImpl,
} from './render.js';
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
import { wireFontLoadRemeasureImpl } from './fontload-remeasure.js';
import type { EditorBoot, EditorContext, RemoteCursorEntry } from './editor-context.js';
import {
  attachChromeToggles,
  installRuntimeHelpers,
  mountViewportImpl,
  wireCoEditPresenceListeners,
  wireMarkToolbarReflowListeners,
} from './runtime-helpers.js';
import { applyCustomKitCss } from './custom-kit-css.js';

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
void openSaveFormModalImpl;
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

function ensureEditorPreviewLayer(): HTMLElement {
  const existing = document.querySelector('[data-opencanvas-editor-preview-layer]');
  if (existing instanceof HTMLElement) return existing;
  const layer = document.createElement('div');
  layer.setAttribute('data-opencanvas-editor-preview-layer', 'true');
  document.body.appendChild(layer);
  return layer;
}

function ensureEditorOverlayPreviewShell(ctx: EditorContext, overlay: Overlay): boolean {
  const existingOverlays = document.querySelectorAll('[data-opencanvas-overlay]');
  for (let i = 0; i < existingOverlays.length; i++) {
    const existing = existingOverlays[i];
    if (
      existing instanceof HTMLElement &&
      existing.getAttribute('data-opencanvas-overlay') === overlay.id
    ) {
      return true;
    }
  }
  if (!ctx.state) return false;
  const page = ctx.currentPage() || ctx.state.pages[0] || null;
  if (!page) return false;
  const layer = ensureEditorPreviewLayer();
  const overlaysRoot =
    layer.querySelector('[data-opencanvas-overlays-root]') ?? document.createElement('div');
  if (!(overlaysRoot instanceof HTMLElement)) return false;
  overlaysRoot.setAttribute('data-opencanvas-overlays-root', '');
  if (!overlaysRoot.parentNode) layer.appendChild(overlaysRoot);
  const oldShells = overlaysRoot.querySelectorAll('[data-opencanvas-editor-preview-temp="true"]');
  for (let i = 0; i < oldShells.length; i++) oldShells[i]!.remove();
  const presentation = overlay.presentation?.mode ?? 'modal';
  const chrome = overlay.presentation?.chrome ?? 'standard';
  const backdropStyle = overlay.presentation?.backdrop ?? 'dim';
  const closePlacement = overlay.presentation?.closePlacement ?? 'top-right';
  const layout = overlay.presentation?.layout ?? 'centered';
  const choreography = overlay.presentation?.choreography ?? 'none';
  const reducedMotion = overlay.presentation?.reducedMotion ?? 'instant';
  const shell = document.createElement('div');
  shell.className =
    presentation === 'fullscreen-menu'
      ? 'opencanvas-overlay opencanvas-overlay--fullscreen-menu opencanvas-overlay--chrome-' +
        chrome +
        ' opencanvas-overlay--layout-' +
        layout +
        ' opencanvas-overlay--choreography-' +
        choreography
      : 'opencanvas-overlay opencanvas-overlay--chrome-' +
        chrome +
        ' opencanvas-overlay--layout-' +
        layout +
        ' opencanvas-overlay--choreography-' +
        choreography;
  shell.setAttribute('data-opencanvas-overlay', overlay.id);
  shell.setAttribute('data-opencanvas-overlay-presentation', presentation);
  shell.setAttribute('data-opencanvas-overlay-chrome', chrome);
  shell.setAttribute('data-opencanvas-overlay-backdrop-style', backdropStyle);
  shell.setAttribute('data-opencanvas-overlay-close-placement', closePlacement);
  shell.setAttribute('data-opencanvas-overlay-layout', layout);
  shell.setAttribute('data-opencanvas-overlay-choreography', choreography);
  shell.setAttribute('data-opencanvas-overlay-reduced-motion', reducedMotion);
  shell.setAttribute('data-opencanvas-overlay-trigger-type', overlay.trigger.type);
  shell.setAttribute('data-opencanvas-editor-preview-temp', 'true');
  shell.setAttribute('hidden', '');
  const backdrop = document.createElement('div');
  backdrop.className = 'opencanvas-overlay-backdrop';
  backdrop.setAttribute('data-opencanvas-overlay-backdrop', '');
  const surface = document.createElement('div');
  surface.className = 'opencanvas-overlay-surface';
  surface.setAttribute('data-opencanvas-overlay-surface', '');
  surface.setAttribute('role', 'dialog');
  surface.setAttribute('aria-modal', 'true');
  surface.setAttribute('aria-label', overlay.name);
  surface.appendChild(ctx.buildSectionNode(overlay.content, ctx.pageRenderWidth(page)));
  shell.appendChild(backdrop);
  shell.appendChild(surface);
  overlaysRoot.appendChild(shell);
  return true;
}

function ensureEditorLoadExperienceShell(load: PremiumLoadExperience, title: string): void {
  const layer = ensureEditorPreviewLayer();
  const oldShell = layer.querySelector('[data-opencanvas-load-experience]');
  if (oldShell) oldShell.remove();
  const shell = document.createElement('div');
  shell.className = 'opencanvas-load-experience';
  shell.setAttribute('data-opencanvas-load-experience', load.id);
  shell.setAttribute('data-opencanvas-load-preset', load.preset);
  shell.setAttribute('data-opencanvas-load-run-policy', load.runPolicy);
  shell.setAttribute('data-opencanvas-load-gates', load.gates.join(' '));
  shell.setAttribute('data-opencanvas-load-timeout-ms', String(load.timeoutMs));
  shell.setAttribute('data-opencanvas-editor-preview-temp', 'true');
  const brand = document.createElement('div');
  brand.className = 'opencanvas-load-brand';
  brand.setAttribute('data-opencanvas-load-part', 'brand');
  brand.textContent = title || 'Loading';
  const progress = document.createElement('div');
  progress.className = 'opencanvas-load-progress';
  progress.setAttribute('data-opencanvas-load-part', 'progress');
  progress.appendChild(document.createElement('span'));
  shell.appendChild(brand);
  shell.appendChild(progress);
  layer.appendChild(shell);
}

function applyEditorRoutePreviewAttrs(root: HTMLElement, route: RouteTransition): void {
  root.setAttribute('data-opencanvas-route-container', '');
  root.setAttribute('data-opencanvas-route-transition', route.id);
  root.setAttribute('data-opencanvas-route-mode', route.mode);
  root.setAttribute('data-opencanvas-route-duration-ms', String(route.durationMs));
  root.setAttribute('data-opencanvas-route-easing', route.easing);
}

function rerenderAfterInteractionMutation(context: EditorContext): void {
  context.renderAll();
  context.renderInteractionsPanel();
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
  const runtimeHelperNotInstalled =
    (label: string): (() => never) =>
    () => {
      throw new Error(`${label}: runtime helper was not installed before createEditor boot`);
    };
  const siteBase = boot.apiBase + '/canvas/sites/' + boot.siteId;
  // The Partial cast remains because optional fields (repaintRemoteCursors
  // / onMarkToolbarReflow) are intentionally left undefined until their
  // late-binding paths fire.
  const ctxPartial: Partial<EditorContext> = {
    // ---- Foundational state ------------------------------------------
    state: null,
    reducedMotionPreview: 'no-preference',
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
    undoAiSidecarStack: [],
    redoStack: [],
    redoAiSidecarStack: [],
    undoTimer: null,
    undoRedoing: false,
    undoPersistenceFailed: false,
    fontLoadRemeasureWired: false,
    saveTimer: null,
    saveQueue: Promise.resolve(true),
    coEditConnection: null,
    coEditSync: () => coEditSyncImpl(ctx),
    saveStateNow: runtimeHelperNotInstalled('saveStateNow'),
    disableUndoPersistence: (reason, error) => disableUndoPersistenceImpl(ctx, reason, error),

    // ---- ADR 0065 D6: Collection template edit-mode -------------------
    // Phase 1 initialises null; Phase 2C wires enter/exit verbs from the
    // inspector and Phase 2D's selection branch reads it.
    editingCollectionTemplate: null,
    // ADR 0065 F1-multi-collab-presence — boot-time the map is empty;
    // every onRemotePresence callback rebuilds it from the active
    // awareness snapshot, so a fresh editor session that joins a room
    // with peers already in template-edit mode picks them up on the
    // first remote-presence fan-out.
    collectionTemplateEditors: new Map<string, string[]>(),
    enterCollectionTemplateEdit: (collectionId) =>
      enterCollectionTemplateEditImpl(ctx, collectionId),
    exitCollectionTemplateEdit: () => exitCollectionTemplateEditImpl(ctx),

    // ---- Selection state-machine --------------------------------------
    chatSelectionDropped: false,
    linkPopoverPinned: false,
    removeLinkPopover: () => removeLinkPopoverImpl(ctx),
    closeReel: () => closeReelImpl(ctx),
    showLinkPopover: (anchorEl, opts) =>
      opts === undefined
        ? showLinkPopoverImpl(ctx, anchorEl)
        : showLinkPopoverImpl(ctx, anchorEl, opts),
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
    ghostSections: [],
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
    activeEditFinish: null,

    // ---- Modal cluster -------------------------------------------------
    modalOpen: false,
    openTextModal: (opts) => openTextModalImpl(ctx, opts),
    openSelectModal: (opts) => openSelectModalImpl(ctx, opts),
    openConfirmModal: (opts) => openConfirmModalImpl(ctx, opts),
    openAlertModal: (opts) => openAlertModalImpl(ctx, opts),
    openAiMediaModal: (opts) => openAiMediaModalImpl(ctx, opts),
    openNewPageModal: (opts) => openNewPageModalImpl(ctx, opts),
    openSaveFormModal: (opts) => openSaveFormModalImpl(ctx, opts),

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
    panToPage: (pageId) => panToPageImpl(ctx, pageId),

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
    beginTextEdit: (elementId, clickedWrapper) => beginTextEditImpl(ctx, elementId, clickedWrapper),

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
    buildHostedElementNode: (element) => buildHostedElementNodeImpl(ctx, element),
    buildElementMenu: (element, section, wrapper) =>
      buildElementMenuImpl(ctx, element, section, wrapper),
    toggleElementMenu: (elementId, wrapper) => toggleElementMenuImpl(ctx, elementId, wrapper),

    // ---- AI image generator ------------------------------------------
    generateImageForElement: runtimeHelperNotInstalled('generateImageForElement'),

    // ---- Phase 2q.i: sections picker + sidebar wiring ----------------
    sidebar: null,
    activeCategoryFilter: 'all',
    activeSearchQuery: '',
    activeSortMode: 'a-z',
    enterPlacementMode: (target) => enterPlacementModeImpl(ctx, target),
    importPendingSectionAt: (insertAt) => importPendingSectionAt(ctx, insertAt),
    attachSidebarTabs: () => attachSidebarTabs(ctx),
    attachSidebarActions: () => attachSidebarActions(ctx),
    applySidebarStyleKit: (kit, buttons) => applySidebarStyleKit(ctx, kit, buttons),
    buildKitSummary: () => buildKitSummary(ctx),
    renderInteractionsPanel: () => renderInteractionsPanel(ctx),
    previewOverlay: (overlayId) => {
      if (!ctx.state) {
        ctx.setStatus('Load the site before previewing overlays', 'error');
        console.error('[previewOverlay] state is not loaded');
        return;
      }
      const overlay = (ctx.state.overlays ?? []).find((item) => item.id === overlayId);
      if (!overlay) {
        ctx.setStatus('Overlay preview failed: overlay not found', 'error');
        console.error('[previewOverlay] missing overlay id=' + overlayId);
        return;
      }
      if (!ensureEditorOverlayPreviewShell(ctx, overlay)) {
        ctx.setStatus('Overlay preview failed: preview shell could not be created', 'error');
        console.error('[previewOverlay] failed to create shell for overlay id=' + overlayId);
        return;
      }
      previewOverlayInEditor(document, overlayId);
      ctx.setStatus('Overlay preview opened', 'ok');
    },
    previewLoadExperience: () => {
      if (!ctx.state || !isPremiumLoadExperience(ctx.state.loadExperience)) {
        ctx.setStatus('Enable or configure a load experience before previewing', 'error');
        console.error('[previewLoadExperience] loadExperience is missing');
        return;
      }
      const page = ctx.currentPage() || ctx.state.pages[0] || null;
      ensureEditorLoadExperienceShell(ctx.state.loadExperience, page?.title || 'Loading');
      previewLoadExperienceInEditor(document);
      ctx.setStatus('Load experience preview started', 'ok');
    },
    previewRouteTransition: () => {
      if (!ctx.state?.routeTransition) {
        ctx.setStatus('Enable or configure a route transition before previewing', 'error');
        console.error('[previewRouteTransition] routeTransition is missing');
        return;
      }
      if (!ctx.root) {
        ctx.setStatus('Route preview failed: canvas root missing', 'error');
        console.error('[previewRouteTransition] ctx.root is missing');
        return;
      }
      applyEditorRoutePreviewAttrs(ctx.root, ctx.state.routeTransition);
      previewRouteTransitionInEditor(ctx.root);
      ctx.setStatus('Route transition preview started', 'ok');
    },
    useSelectedElementAsOverlayTrigger: (overlayId) => {
      if (!ctx.state) {
        ctx.setStatus('Load the site before connecting overlay triggers', 'error');
        console.error('[useSelectedElementAsOverlayTrigger] state is not loaded');
        return;
      }
      if (!ctx.selectedElementId || !ctx.findElement(ctx.selectedElementId)) {
        ctx.setStatus('Select an element before connecting an overlay trigger', 'error');
        console.error('[useSelectedElementAsOverlayTrigger] selected element is missing');
        return;
      }
      const overlay = (ctx.state.overlays ?? []).find((item) => item.id === overlayId);
      if (!overlay) {
        ctx.setStatus('Overlay trigger failed: overlay not found', 'error');
        console.error('[useSelectedElementAsOverlayTrigger] missing overlay id=' + overlayId);
        return;
      }
      ctx.captureForUndo();
      overlay.trigger = { type: 'element-click', targetElementId: ctx.selectedElementId };
      rerenderAfterInteractionMutation(ctx);
      ctx.scheduleSave();
      ctx.setStatus('Overlay trigger connected', 'ok');
    },
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

    // ---- Text-inspector font-family picker ---------------------------
    // Empty at boot; populated by ctx.refreshCustomFonts() after the
    // initial site fetch resolves. The font-family picker reads
    // ctx.customFonts on each inspector render so an empty catalog at
    // boot just shows the preset options; the picker re-renders when the
    // fetch lands and the inspector re-mounts.
    customFonts: [],
    refreshCustomFonts: runtimeHelperNotInstalled('refreshCustomFonts'),

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
 * ADR 0015 Phase 3 cutover shipped; the editor route at
 * `src/editor/route.tsx` serves `EDITOR_CLIENT_MANIFEST.canvasClientUrl`
 * and this function is the live entry point. `canvasClientScript()` and
 * `src/editor/canvas-client.ts` are gone.
 */
export function createEditor(boot: EditorBoot): void {
  const ctx = createEditorContextSkeleton(boot);
  installRuntimeHelpers(ctx);
  if (!window.__opencanvasModal) {
    installOpencanvasModalGlobalImpl(ctx);
  }

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

  // ---- Sections-picker prefetch -------------------------------------
  // The Owner's first Sections-tab open used to fire GET /library/sections
  // synchronously, which spent ~5s server-side populating the 88-entry
  // catalog from `library_section`. Most Owners click Sections within
  // the first few seconds of the editor mounting, so we kick the catalog
  // request in parallel with the site-load fetch below; by the time the
  // Owner switches tabs the response has already landed and the picker
  // renders microtask-fast off the cached array. Fire-and-forget — the
  // module-level singleton inside prefetchSectionsCatalog converts
  // rejections to a `{kind:'failure'}` outcome (no unhandled rejection)
  // and resets the singleton so a later tab-open retries; the visible
  // "Failed to load sections." error renders on the awaiter path
  // (ensureSectionsPanelLoaded), never silently here.
  prefetchSectionsCatalog(ctx);

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
      // ADR 0063 dec 2 — one-shot migration of legacy
      // pageKind === 'collection-index' pages. ADR 0063 retires the
      // index-page binding model in favour of element-level
      // collectionSlug. Pages with exactly one Collection auto-migrate
      // (copy slug onto element, clear pageKind + collectionSlug);
      // pages with zero or multiple Collections retain the fields and
      // surface a banner asking the Owner to set the slug on each
      // Collection manually. Persistence rides the normal
      // ctx.scheduleSave() autosave so the migration is durable. Runs
      // before renderAll() so the post-migration shape drives the
      // first render. Subsequent loads see no collection-index pages
      // and become no-ops (the "have we migrated" signal is the
      // absence of legacy pageKind, not a separate flag).
      if (ctx.state) migrateLegacyCollectionIndexPagesImpl(ctx);
      // Deep-link focus from the dashboard a11y report: `?focusPage=<slug>&
      // focusElement=<id>` opens the editor on the page that hosts the
      // offending element. Stash the element id for the post-render
      // selection call below.
      const focusParams = new URLSearchParams(window.location.search);
      const focusPageSlug = focusParams.get('focusPage');
      const focusElementId = focusParams.get('focusElement');
      if (ctx.state && ctx.state.pages && ctx.state.pages.length > 0) {
        let initialActiveId = ctx.state.pages[0]!.id;
        if (focusPageSlug !== null) {
          for (const page of ctx.state.pages) {
            if (page.slug === focusPageSlug) {
              initialActiveId = page.id;
              break;
            }
          }
        }
        ctx.activePageId = initialActiveId;
      }
      // Version badge + initUndo + style-kit attribute (mirror IIFE).
      ctx.updateVersionBadge(typeof body.publishedVersion === 'number' ? body.publishedVersion : 0);
      ctx.attachVersionBadge();
      initUndo(ctx);
      if (ctx.mainEl && ctx.state && ctx.state.styleKit) {
        ctx.mainEl.setAttribute('data-style-kit', ctx.state.styleKit);
      }
      applyCustomKitCss(ctx.state);
      ctx.onMarkToolbarReflow = () => onMarkToolbarReflowImpl(ctx);
      wireMarkToolbarReflowListeners(ctx);
      // mountViewport MUST precede renderAll so #canvas-root is in its
      // final DOM position when sections render in.
      mountViewportImpl(ctx);
      ctx.renderAll();
      // Webfont swap remeasure: the initial paint uses the fallback face
      // because `@font-face` declarations carry `font-display: swap`
      // (see src/fonts/face-emit.ts). Once the authored face lands the
      // text re-flows — a heading authored at `box.h = 120` under the
      // loaded font may now overflow the wrapper because the fallback
      // and loaded faces have different vertical metrics. Combined with
      // the text-wrapper `overflow: hidden` default (text-overflow-hidden
      // smoke), the bottom line clips until the user clicks the element
      // (which triggers `beginTextEdit`'s scrollHeight pass). Wire a
      // one-shot listener on `document.fonts.ready` so the grow pass
      // runs after every webfont in the initial set has loaded.
      wireFontLoadRemeasureImpl(ctx);
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
      attachHomeCrumbImpl(ctx);
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
      // ADR 0063 dec 9 / dec 11 — Collection scaffold entry points live
      // on the Add tab (standalone "+ New Collection" button in the
      // dedicated Collections group above the Components grid) and inside
      // the new-page modal's kind selector. The duplicate Components-grid
      // "Collection" tile was dropped (chore/editor-remove-duplicate-
      // collection-tile) and the Pages-tab "+ New Collection" was removed
      // — creating a Collection goes through "+ New Page" → "Collection"
      // there (see page-crud.ts createPageImpl). attachCollectionScaffold
      // ButtonImpl wires every remaining [data-canvas-add-collection]
      // element to the same wizard; element-level insertion without the
      // scaffold leaves a half-built collection (no index page, no
      // entries) showing the placeholder banner with nowhere to escape to.
      attachCollectionScaffoldButtonImpl(ctx);
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
              // Explicit user navigation from the page sidebar — pan the
              // camera so the target lands in the viewport. setActivePage
              // is camera-pure now (element clicks on inactive artboards
              // shouldn't move the camera); explicit nav opts in.
              ctx.setActivePage(pid2);
              ctx.panToPage(pid2);
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
      const coEditAttached = ctx.attachCoEdit();
      if (coEditAttached) wireCoEditPresenceListeners(ctx);

      // Text-inspector font-family picker — pull the site's custom font
      // catalog so the picker can offer uploaded faces and the editor
      // canvas's @font-face <style> block renders them. Fires in the
      // background; the picker degrades to the preset list until the
      // catalog lands.
      ctx.refreshCustomFonts().catch(function (err: unknown) {
        console.error('[refreshCustomFonts] boot-time font catalog refresh failed', err);
        ctx.setStatus('Could not load custom fonts — try reloading', 'error');
      });

      if (coEditAttached) ctx.setStatus('Ready', 'ok');

      // Session keepalive — Owner sessions get an hourly HEAD; published-
      // site editors get a token refresh ~15 min before expiry.
      if (ctx.apiBase === '/api') {
        setInterval(
          function () {
            void fetch(ctx.siteBase, { method: 'HEAD' }).catch(function () {
              // silent — failures surface on the next real API call
            });
          },
          60 * 60 * 1000,
        );
      } else if (ctx.apiBase === '/__api') {
        const REFRESH_BUFFER = 900; // seconds before expiry to refresh
        const scheduleTokenRefresh = (ttl: number): void => {
          const delay = Math.max((ttl - REFRESH_BUFFER) * 1000, 60000);
          setTimeout(function () {
            void fetch(ctx.apiBase + '/edit-token/refresh', { method: 'POST' })
              .then(function (r) {
                if (!r.ok) {
                  return r.text().then(function (text) {
                    throw new Error(
                      'refresh returned ' + String(r.status) + ' ' + r.statusText + ': ' + text,
                    );
                  });
                }
                return r.json();
              })
              .then(function (d) {
                const data = d as { ok?: boolean; ttl?: number };
                if (data && data.ok && typeof data.ttl === 'number') {
                  scheduleTokenRefresh(data.ttl);
                  return;
                }
                throw new Error(
                  'refresh succeeded but body had no ok/ttl: ' + JSON.stringify(data),
                );
              })
              .catch(function (err: unknown) {
                console.error(
                  '[edit-token-refresh] refresh failed; the next authFetch will surface the 401',
                  err,
                );
                ctx.setStatus(
                  'Edit-token refresh failed — your session may expire; save now and reload',
                  'error',
                );
              });
          }, delay);
        };
        // Kick off the first refresh cycle: call the endpoint immediately
        // to learn the current TTL (and get a fresh token).
        void fetch(ctx.apiBase + '/edit-token/refresh', { method: 'POST' })
          .then(function (r) {
            if (!r.ok) {
              return r.text().then(function (text) {
                throw new Error(
                  'refresh returned ' + String(r.status) + ' ' + r.statusText + ': ' + text,
                );
              });
            }
            return r.json();
          })
          .then(function (d) {
            const data = d as { ok?: boolean; ttl?: number };
            if (data && data.ok && typeof data.ttl === 'number') {
              scheduleTokenRefresh(data.ttl);
              return;
            }
            throw new Error('refresh succeeded but body had no ok/ttl: ' + JSON.stringify(data));
          })
          .catch(function (err: unknown) {
            console.error(
              '[edit-token-refresh] refresh failed; the next authFetch will surface the 401',
              err,
            );
            ctx.setStatus(
              'Edit-token refresh failed — your session may expire; save now and reload',
              'error',
            );
          });
      }

      // ---- Chat panel SSE handler -------------------------------------
      setupChatSession(ctx);

      // ---- Deep-link focus: pan + select the dashboard-report target --
      // Runs after every mount/attach finishes so the section DOM the
      // selection walker reads is in its final position. Element id may
      // point at something that no longer exists (Owner edited / deleted
      // it between the audit run and the click) — both calls are no-ops
      // when the element is missing, so the editor still boots normally.
      if (focusElementId !== null && focusElementId.length > 0) {
        ctx.panToElement(focusElementId);
        ctx.selectElement(focusElementId);
      }
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
    __opencanvasModal?: OpencanvasModalGlobal;
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
