// src/editor-client/inspector-actions.smoke.ts
//
// ADR 0058 Phase 2h.1.a — parity smoke for the inspector element-action
// cluster. Compares the extracted module's verb behaviour
// (duplicateElement, deleteElement, moveInReadingOrder, applyZOrderAction)
// against the spec the inline IIFE twin satisfies at
// canvas-client.ts:4139-4273.
//
// Run with `bun run src/editor-client/inspector-actions.smoke.ts`. Not
// wired into the ci:smoke chain — per-phase manual smoke (per ADR 0058
// Decision 4 / Task 2 protocol P.5).
//
// DOM builders live in a sibling module (./inspector-action-buttons.ts)
// precisely because bare Bun has no `document`. The inline IIFE twin's
// DOM-building behaviour is pinned by `src/editor/inspector-smoke.ts`
// on the production path. Behavioural assertions the existing inspector
// smoke must continue to satisfy:
//   - `parentArrayFor` throws loudly on missing parents
//   - `duplicateElement` uses `nextZInArray(arr)` for clone z
//   - The element context-menu duplicate inserts into the immediate
//     parent array, not always section.elements
// Those are already pinned at inspector-smoke.ts lines 142-166.

import type { CanvasElement, CanvasSection, TextElement } from '../canvas/schema.js';
import type { EditorContext } from './editor-context.js';
import type { FindElementResult } from './editor-context-types.js';
import {
  applyZOrderAction,
  deleteElement,
  duplicateElement,
  moveInReadingOrder,
} from './inspector-actions.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[inspector-actions:smoke] ${message}`);
}

// ----- Fixture helpers --------------------------------------------------

function makeText(id: string, x = 0, y = 0, z = 1): TextElement {
  return {
    id,
    type: 'text',
    box: { x, y, w: 320, h: 60, z },
    content: [{ text: id }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
  };
}

function makeSection(elements: CanvasElement[]): CanvasSection {
  return {
    id: 'section-smoke',
    recipeId: 'feature-grid',
    name: 'Smoke',
    height: 800,
    elements,
  };
}

interface MockCallLog {
  renderAll: number;
  renderInspector: number;
  scheduleSave: number;
  captureForUndo: number;
  closeElementMenu: number;
  selectElement: string[];
}

function makeCtx(section: CanvasSection): { ctx: EditorContext; log: MockCallLog } {
  const log: MockCallLog = {
    renderAll: 0,
    renderInspector: 0,
    scheduleSave: 0,
    captureForUndo: 0,
    closeElementMenu: 0,
    selectElement: [],
  };
  const ctx: EditorContext = {
    state: null,
    mainEl: null,
    selectedElementId: null,
    ghostSections: [],
    findElement(elementId: string): FindElementResult | null {
      for (const el of section.elements) {
        if (el.id === elementId) {
          return {
            section,
            element: el,
            parentArray: section.elements,
            parentKind: 'section',
            parentMeta: null,
          };
        }
      }
      return null;
    },
    renderAll: () => {
      log.renderAll += 1;
    },
    renderInspector: () => {
      log.renderInspector += 1;
    },
    selectElement: (elementId: string) => {
      log.selectElement.push(elementId);
    },
    captureForUndo: () => {
      log.captureForUndo += 1;
    },
    scheduleSave: () => {
      log.scheduleSave += 1;
    },
    closeElementMenu: () => {
      log.closeElementMenu += 1;
    },
    aiBusy: false,
    INSPECTOR_ACTION_HANDLERS: {},
    rebuildElement: () => {},
    serializeContentToRuns: () => [],
    buildPickerThumb: () => {
      throw new Error('buildPickerThumb stub: smoke does not exercise picker UI');
    },
    postAssetUpload: () => {
      throw new Error('postAssetUpload stub: smoke does not exercise uploads');
    },
    statusEl: null,
    statusTimer: null,
    setStatus: () => {},
    authFetch: () => {
      throw new Error('authFetch stub: smoke does not exercise picker fetches');
    },
    apiBase: '/api',
    siteId: 'site-smoke',
    applyAssetIdToElement: () => {
      throw new Error('applyAssetIdToElement stub: smoke does not exercise picker apply');
    },
    runDeleteAsset: () => {
      throw new Error('runDeleteAsset stub: smoke does not exercise asset delete');
    },
    uploadMediaForElement: () => {
      throw new Error('uploadMediaForElement stub: smoke does not exercise uploads');
    },
    generateImageForElement: () => {
      throw new Error('generateImageForElement stub: smoke does not exercise generation');
    },
    inspector: null,
    selectedSectionId: null,
    inspectorRenderSubject: null,
    findSection: () => null,
    preserveInspectorScrollFor: () => {},
    revokePendingPreviews: () => {},
    selectableSectionRoles: () => ['body'],
    aiCreateSection: () => {
      throw new Error('aiCreateSection stub: smoke does not exercise AI section creation');
    },
    root: null,
    activePageId: null,
    currentPage: () => null,
    updatePageSidebar: () => {},
    modalOpen: false,
    openTextModal: () => {
      throw new Error('openTextModal stub: smoke does not exercise modals');
    },
    openSelectModal: () => {
      throw new Error('openSelectModal stub: smoke does not exercise modals');
    },
    openConfirmModal: () => {
      throw new Error('openConfirmModal stub: smoke does not exercise modals');
    },
    openAlertModal: () => {
      throw new Error('openAlertModal stub: smoke does not exercise modals');
    },
    openAiMediaModal: () => {
      throw new Error('openAiMediaModal stub: smoke does not exercise modals');
    },
    openNewPageModal: () => {
      throw new Error('openNewPageModal stub: smoke does not exercise modals');
    },
    applyPageMotionAttributes: () => {},
    applyPageStyleProperties: () => {},
    pageRenderWidth: () => {
      throw new Error('pageRenderWidth stub: smoke does not exercise page width');
    },
    isReelOpen: false,
    INSPECTOR_DISPATCH: {} as EditorContext['INSPECTOR_DISPATCH'],
    renderInspectorSpec: () => {
      throw new Error('renderInspectorSpec stub: smoke does not exercise spec walking');
    },
    siteBase: '/api/canvas/sites/site-smoke',
    undoStack: [],
    redoStack: [],
    undoTimer: null,
    undoRedoing: false,
    undoPersistenceFailed: false,
    saveTimer: null,
    saveQueue: Promise.resolve(true),
    coEditConnection: null,
    coEditSync: () => false,
    saveStateNow: () => {
      throw new Error('saveStateNow stub: smoke does not exercise persistence');
    },
    disableUndoPersistence: () => {
      throw new Error('disableUndoPersistence stub: smoke does not exercise persistence failure');
    },
    chatSelectionDropped: false,
    linkPopoverPinned: false,
    removeLinkPopover: () => {},
    closeReel: () => {},
    showLinkPopover: () => {},
    updateChatSelectionChip: () => {},
    renderReel: () => {},
    selectSection: () => {},
    viewport: null,
    zoomToolbar: null,
    zoomReadout: null,
    camera: { x: 0, y: 0, zoom: 1 },
    pagePositions: [],
    pendingImport: null,
    buildSectionNode: () => {
      throw new Error('buildSectionNode stub: smoke does not exercise section rendering');
    },
    syncSidebarStyleKitButtons: () => {},
    renderPlacementSlots: () => {},
    setBoxStyle: () => {},
    chatToggleBtn: null,
    chatPanelEl: null,
    chatCloseBtn: null,
    chatSelectionEl: null,
    chatSelectionTextEl: null,
    chatSelectionClearBtn: null,
    toggleChatPanel: () => {},
    chatForm: null,
    chatInput: null,
    chatMessages: null,
    chatWelcome: null,
    chatSessionId: null,
    chatBusy: false,
    appendChatMessage: () => {},
    hideChatWelcome: () => {},
    chatAcceptAllBtn: null,
    showAcceptAllSummary: () => {},
    pendingAiSuggestions: [],
    applyAgentOps: () => {
      throw new Error('applyAgentOps stub: smoke does not exercise AI ops apply');
    },
    refreshAcceptAllButton: () => {},
    findCanvasNodeForOp: () => null,
    focusCanvasOnNode: () => {},
    describeOp: () => '',
    revertAgentEntry: () => {},
    setAiBusy: () => {},
    sessionExpired: false,
    accessRevoked: false,
    flushPendingSave: () => {
      throw new Error('flushPendingSave stub: smoke does not exercise persistence flush');
    },
    editingElementId: null,
    MIN_ELEMENT_SIZE_PX: 24,
    interactionMode: 'select',
    spaceHeldForPan: false,
    temporaryPanPreviousMode: null,
    setInteractionMode: () => {},
    clearTemporaryPanState: () => {},
    endTemporaryPan: () => {},
    exitPlacementMode: () => {},
    pointerToCanvas: () => {
      throw new Error('pointerToCanvas stub: smoke does not exercise drag/resize');
    },
    resolveElementWrapperAtPoint: () => {
      throw new Error('resolveElementWrapperAtPoint stub: smoke does not exercise drag/resize');
    },
    onCanvasLinkHover: () => {},
    onCanvasLinkHoverLeave: () => {},
    renderSectionsPanel: () => {},
    defaultBox: () => {
      throw new Error('defaultBox stub: smoke does not exercise section toolbar');
    },
    addElementToSection: () => {
      throw new Error('addElementToSection stub: smoke does not exercise section toolbar');
    },
    targetSectionForSidebar: () => null,
    panToElement: () => {},
    addBlankSectionFromSidebar: () => {
      throw new Error('addBlankSectionFromSidebar stub: smoke does not exercise section toolbar');
    },
    componentActionForSidebar: () => null,
    addComponentFromSidebar: () => {
      throw new Error('addComponentFromSidebar stub: smoke does not exercise section toolbar');
    },
    handleSectionAction: () => {},
    saveToLibrary: () => {
      throw new Error('saveToLibrary stub: smoke does not exercise section toolbar');
    },
    saveSiteAsTemplate: () => {
      throw new Error('saveSiteAsTemplate stub: smoke does not exercise section toolbar');
    },
    SIDEBAR_COMMANDS: {},
    insertElementForSidebarCommand: () => {
      throw new Error('insertElementForSidebarCommand stub: smoke does not exercise sidebar dispatch');
    },
    getPagePosition: () => null,
    sectionsCatalog: null,
    saveBusy: false,
    saveButton: null,
    publishButton: null,
    coEditSocketOpen: false,
    localPresence: null,
    presenceLayer: null,
    remoteCursors: new Map(),
    remotePeerCount: 0,
    lastWorldPoint: null,
    pointerPublishPending: false,
    pointerPublishTimerId: null,
    pointerPublishLastAtMs: 0,
    presencePublishPending: false,
    presencePublishLastAtMs: 0,
    attachCoEdit: () => {
      throw new Error('attachCoEdit stub: smoke does not exercise co-edit WS boot');
    },
    wsToken: '',
    presenceDisplayName: '',
    presenceUserId: '',
    editingSnapshot: null,
    activeEditFinish: null,
    reelViewMode: 'tile',
    openReel: () => {},
    moveSectionToIndex: () => {},
    beginSectionDrag: () => {},
    pageCrumbMenu: null,
    pageCrumbOutsideHandler: null,
    pageCrumbKeyHandler: null,
    setActivePage: () => {},
    refreshPageCrumb: () => {},
    findPageByHref: () => null,
    goToHrefOnCanvas: () => false,
    createPage: () => {
      throw new Error('createPage stub: smoke does not exercise page CRUD');
    },
    renamePage: () => {
      throw new Error('renamePage stub: smoke does not exercise page CRUD');
    },
    deletePage: () => {
      throw new Error('deletePage stub: smoke does not exercise page CRUD');
    },
    fitToPage: () => {},
    fitAllPages: () => {},
    aiPanel: null,
    closeAiPanel: () => {},
    runAiPreview: () => {
      throw new Error('runAiPreview stub: smoke does not exercise AI preview');
    },
    aiRewriteText: () => {
      throw new Error('aiRewriteText stub: smoke does not exercise AI rewrite');
    },
    aiReplaceMedia: () => {
      throw new Error('aiReplaceMedia stub: smoke does not exercise AI media');
    },
    migrateState: (s) => s,
    uploadGeneratedBlobToElement: () => {
      throw new Error(
        'uploadGeneratedBlobToElement stub: smoke does not exercise generated-blob upload',
      );
    },
    markToolbar: null,
    markToolbarAnchor: null,
    linkPopover: null,
    linkPopoverAnchor: null,
    linkPopoverShowTimer: null,
    linkPopoverHideTimer: null,
    refreshMarkToolbarFontSizeState: () => {},
    buildMarkToolbar: () => {
      throw new Error('buildMarkToolbar stub: smoke does not exercise mark toolbar UI');
    },
    applyMark: () => {
      throw new Error('applyMark stub: smoke does not exercise mark application');
    },
    beginTextEdit: () => {
      throw new Error('beginTextEdit stub: smoke does not exercise text editing');
    },
    forceOpenInspector: () => {},
    buildRunNode: () => {
      throw new Error('buildRunNode stub: smoke does not exercise run rendering');
    },
    marksEqual: () => false,
    plainTextOf: () => '',
    renderMathInScope: () => {},
    normalizePastedHtml: (html: string) => html,
    plainTextToFragmentHtml: (plain: string) => plain,
    beginDrag: () => {
      throw new Error('beginDrag stub: smoke does not exercise drag');
    },
    openLinkModal: () => {
      throw new Error('openLinkModal stub: smoke does not exercise modals');
    },
    activeCategoryFilter: 'all',
    activeSearchQuery: '',
    activeSortMode: 'a-z',
    enterPlacementMode: () => {},
    importPendingSectionAt: () => {
      throw new Error('importPendingSectionAt stub: smoke does not exercise section import');
    },
    sidebar: null,
    activateSidebarTab: () => {},
    attachSidebarTabs: () => {},
    attachSidebarActions: () => {},
    applySidebarStyleKit: () => {
      throw new Error('applySidebarStyleKit stub: smoke does not exercise style kit POST');
    },
    buildKitSummary: () => {
      throw new Error('buildKitSummary stub: smoke does not exercise kit summary build');
    },
    ICON_SVG_MAP: {},
    buildElementBody: () => {
      throw new Error('buildElementBody stub: smoke does not exercise body building');
    },
    buildElementNode: () => {
      throw new Error('buildElementNode stub: smoke does not exercise wrapper building');
    },
    applyElementStyle: () => {},
    applyPinnedStyle: () => {},
    buildElementMenu: () => {
      throw new Error('buildElementMenu stub: smoke does not exercise menu building');
    },
    toggleElementMenu: () => {},
    openMenuElementId: null,
    versionBadge: null,
    versionPill: null,
    versionPillOutsideHandler: null,
    versionPillKeyHandler: null,
    saveTemplateButton: null,
    versionsLoaded: false,
    versionsList: [],
    isEditableShortcutTarget: () => false,
    deleteElement: () => {},
    ensureSectionsPanelLoaded: () => {},
    updateVersionBadge: () => {},
    publishSite: () => {
      throw new Error('publishSite stub: smoke does not exercise publish flow');
    },
    attachPublishButton: () => {},
    closeVersionPill: () => {},
    openVersionPill: () => {},
    attachVersionBadge: () => {},
    attachSaveButton: () => {},
    ensureVersionsTabMounted: () => null,
    renderVersionsPanel: () => {},
    attachRootEvents: () => {
      throw new Error('attachRootEvents stub: smoke does not exercise canvas root events');
    },
    customFonts: [],
    refreshCustomFonts: () => {
      throw new Error('refreshCustomFonts stub: smoke does not exercise custom font catalog');
    },
  };
  return { ctx, log };
}

// ----- duplicateElement -------------------------------------------------

(function duplicateElementSpec() {
  const el = makeText('el-a', 100, 200, 3);
  const section = makeSection([el, makeText('el-b', 0, 0, 5)]);
  const { ctx, log } = makeCtx(section);

  duplicateElement(ctx, section, el);

  assert(section.elements.length === 3, 'duplicate must grow the parent array by 1');
  const clone = section.elements[1];
  assert(clone !== undefined, 'clone must exist at idx+1');
  assert(clone.id !== el.id, 'clone must have a fresh id');
  assert(clone.id.startsWith('el-'), 'clone id must use the el- prefix from newElementId()');
  assert(clone.box.x === 120, `clone box.x must be x+20 (got ${clone.box.x})`);
  assert(clone.box.y === 220, `clone box.y must be y+20 (got ${clone.box.y})`);
  assert(clone.box.z === 6, `clone box.z must be nextZInArray (max+1 = 6, got ${clone.box.z})`);
  assert(ctx.selectedElementId === clone.id, 'duplicate must select the clone');
  assert(log.captureForUndo === 1, 'duplicate must call captureForUndo exactly once');
  assert(log.renderAll === 1, 'duplicate must call renderAll exactly once');
  assert(log.renderInspector === 1, 'duplicate must call renderInspector exactly once');
  assert(log.scheduleSave === 1, 'duplicate must call scheduleSave exactly once');
  assert(log.selectElement.length === 0, 'duplicate must NOT call selectElement (writes id directly)');
})();

// ----- deleteElement ----------------------------------------------------

(function deleteElementSpec() {
  const el = makeText('el-a');
  const other = makeText('el-b');
  const section = makeSection([el, other]);
  const { ctx, log } = makeCtx(section);
  ctx.selectedElementId = 'el-a';

  deleteElement(ctx, section, el);

  assert(section.elements.length === 1, 'delete must shrink the parent array by 1');
  assert(section.elements[0] === other, 'survivor must be the un-deleted element');
  assert(ctx.selectedElementId === null, 'delete must clear selection when it matched the deleted id');
  assert(log.closeElementMenu === 1, 'delete must close the context menu');
  assert(log.captureForUndo === 1, 'delete must call captureForUndo exactly once');
  assert(log.renderAll === 1, 'delete must call renderAll exactly once');
  assert(log.renderInspector === 1, 'delete must call renderInspector exactly once');
  assert(log.scheduleSave === 1, 'delete must call scheduleSave exactly once');
})();

(function deleteElementSelectionUnchangedSpec() {
  const el = makeText('el-a');
  const other = makeText('el-b');
  const section = makeSection([el, other]);
  const { ctx } = makeCtx(section);
  ctx.selectedElementId = 'el-b';

  deleteElement(ctx, section, el);

  assert(
    ctx.selectedElementId === 'el-b',
    'delete must leave selection alone when it points at a different element',
  );
})();

// ----- moveInReadingOrder ----------------------------------------------

(function moveInReadingOrderSpec() {
  const a = makeText('el-a');
  const b = makeText('el-b');
  const c = makeText('el-c');
  const section = makeSection([a, b, c]);
  const { ctx, log } = makeCtx(section);

  const moved = moveInReadingOrder(ctx, section, b, -1);

  assert(moved === true, 'move should succeed when neighbor exists');
  assert(section.elements[0] === b, 'b must move to index 0');
  assert(section.elements[1] === a, 'a must shift to index 1');
  assert(section.elements[2] === c, 'c stays at index 2');
  assert(log.renderAll === 1, 'move must renderAll');
  assert(log.scheduleSave === 1, 'move must scheduleSave');
  assert(log.selectElement.length === 1 && log.selectElement[0] === 'el-b', 'move must reselect the moved element');
})();

(function moveInReadingOrderBoundarySpec() {
  const a = makeText('el-a');
  const section = makeSection([a]);
  const { ctx, log } = makeCtx(section);

  const movedUp = moveInReadingOrder(ctx, section, a, -1);
  const movedDown = moveInReadingOrder(ctx, section, a, 1);

  assert(movedUp === false, 'move up at idx 0 must return false');
  assert(movedDown === false, 'move down at last idx must return false');
  assert(log.renderAll === 0, 'no-op moves must NOT renderAll');
  assert(log.scheduleSave === 0, 'no-op moves must NOT scheduleSave');
})();

// ----- applyZOrderAction ------------------------------------------------

(function applyZOrderActionSpec() {
  const a = makeText('el-a', 0, 0, 1);
  const b = makeText('el-b', 0, 0, 2);
  const c = makeText('el-c', 0, 0, 3);
  const section = makeSection([a, b, c]);
  const { ctx, log } = makeCtx(section);

  applyZOrderAction(ctx, section, a, 'front');

  // After bringToFront then renormalizeZ: a was lowest → ends up top → renormalized to z 2.
  assert(a.box.z === 2, `bringToFront + renormalize: a must end at z 2 (got ${a.box.z})`);
  assert(log.renderAll === 1, 'applyZOrderAction must renderAll');
  assert(log.scheduleSave === 1, 'applyZOrderAction must scheduleSave');
  assert(
    log.selectElement.length === 1 && log.selectElement[0] === 'el-a',
    'applyZOrderAction must reselect the moved element',
  );
})();

// ----- parentArrayFor failure contract ---------------------------------

(function parentArrayForMissingSpec() {
  const a = makeText('el-a');
  const section = makeSection([a]);
  const { ctx } = makeCtx(section);
  const ghost = makeText('el-ghost');

  let threw = false;
  try {
    duplicateElement(ctx, section, ghost);
  } catch (err) {
    threw = true;
    const msg = err instanceof Error ? err.message : String(err);
    assert(
      msg.includes('parentArrayFor') && msg.includes('el-ghost') && msg.includes('section-smoke'),
      `error must name parentArrayFor, the element id, and the section id (got: ${msg})`,
    );
  }
  assert(threw, 'duplicateElement on a missing element must throw loudly (no silent fallback)');
})();

console.log('[inspector-actions:smoke] OK');
