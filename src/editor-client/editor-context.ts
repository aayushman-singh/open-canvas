// src/editor-client/editor-context.ts
//
// ADR 0058 — EditorContext is a 1:1 mirror of the IIFE closure surface
// of src/editor/canvas-client.ts. The interface starts empty here and
// grows commit-by-commit as Phase 2h+ extractions add the fields their
// modules touch.
//
// Read this file to see the migration's scoreboard: when the interface
// stops growing, the IIFE is fully decomposed.

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  InlineRun,
  PositionedBox,
} from '../canvas/schema.js';
import type { InspectorSpec } from '../canvas/elements/inspector-spec.js';
import type { MediaElement } from '../canvas/elements/media.js';
import type { CoEditConnection } from '../live/co-edit/client.js';
import type { FindElementResult } from './editor-context-types.js';
import type { SiteSnapshot } from './persist.js';

/**
 * Shape of the boot payload the editor route emits as
 * `window.__opencanvasEditorBoot`. Phase 3 cutover wires this; Phase 2
 * extractions reference the shape but do not yet consume a real boot.
 */
export interface EditorBoot {
  siteId: string;
  apiBase: string;
  wsToken: string;
  displayName: string;
  userId: string;
}

/**
 * Single mutable object mirroring the IIFE closure surface. Extracted
 * modules accept this as their first parameter and read/mutate fields
 * directly — the same shape the IIFE uses today, lifted out of closure.
 *
 * Empty at the gating commit. Each Phase 2h+ extraction appends the
 * fields its module touches. See ADR 0058 Decision 4.
 */
export interface EditorContext {
  // -- Phase 2h.1.b: foundational state surface --------------------------
  /** The loaded site, mutable. Today's IIFE has `let state = null` and
   *  mutates `state.pages[i].sections[j]…` freely; extracted modules
   *  read/write through ctx.state so they share the same object identity.
   *
   *  Null before boot completes and after a fatal load failure. Callers
   *  that read fields off state MUST null-check first — there is no
   *  silent fallback to an empty site. */
  state: EditableSite | null;
  /** Canvas mount DOM ref (`main.opencanvas-editor`), cached at boot.
   *  Read by builders that need to inspect the live computed CSS (kit
   *  summary, responsive breakpoint readouts). Null before boot wires
   *  the mount point. */
  mainEl: HTMLElement | null;

  // -- Phase 2h.1.a: inspector element-action cluster ---------------------
  /** Read AND written by inspector verbs — duplicate writes the clone id,
   *  delete clears when it matched the removed element. Callers must use
   *  ctx.selectedElementId rather than capturing the field via closure. */
  selectedElementId: string | null;
  /** Walks header → footer → current-page sections in that order; the
   *  parent-walk order matters for nested containers (tab panels,
   *  collection entries). */
  findElement(elementId: string): FindElementResult | null;
  renderAll(): void;
  renderInspector(): void;
  /** No-op when `elementId` is already the active selection; callers rely
   *  on the idempotence to avoid re-render storms. Passing null clears the
   *  selection — the inspector-close button uses this to dismiss the
   *  inspector when no element is selected. */
  selectElement(elementId: string | null): void;
  /** Called BEFORE the mutation; pairs with redoStack for symmetric
   *  undo/redo. Callers that mutate then capture invert the contract. */
  captureForUndo(): void;
  /** Debounced. */
  scheduleSave(): void;
  closeElementMenu(): void;

  // -- Phase 2h.2.a: media inspector mounts ------------------------------
  /** Mutated externally by AI panel handlers — flips true while an AI
   *  request is in flight so every AI button on the page disables until
   *  the preview lands or is dismissed. Mount fns read this synchronously
   *  at render time; the inspector re-renders when the flag flips. */
  aiBusy: boolean;
  /** Dispatch table populated at boot from inspector action registrations
   *  (e.g. "replace-media" → aiReplaceMedia). Mount fns look up handlers
   *  by name and throw synchronously at first mount when missing, rather
   *  than failing silently on click. */
  INSPECTOR_ACTION_HANDLERS: Record<string, (elementId: string) => void>;

  // -- Phase 2h.2.b: form inspector mounts -------------------------------
  /** Re-renders just the named element's DOM in place — call after
   *  mutating fields whose render output depends on the field value, to
   *  avoid a full renderAll(). Falls back to renderAll when the element
   *  has no live wrapper in the canvas (e.g. it lives on a non-current
   *  page); callers don't need to branch on that themselves. */
  rebuildElement(elementId: string): void;

  // -- Phase 2h.2.c: content inspector mounts ----------------------------
  /** Walks a contentEditable subtree DFS, emits the InlineRun[] the rich
   *  text was serialised to. Used by accordion item-body editors that
   *  round-trip user edits back into storage. Throws on invalid link
   *  hrefs rather than silently rewriting. */
  serializeContentToRuns(rootNode: Node): InlineRun[];
  /** Builds the per-asset thumbnail DOM node used in media pickers and
   *  carousel-slide editor cards. Returns a <div class="picker-thumb
   *  empty"> sentinel when the asset id is missing/placeholder; otherwise
   *  an <img> wired to the click handler. */
  buildPickerThumb(
    assetId: string,
    selectedAssetId: string,
    onClick: (assetId: string) => void,
  ): HTMLElement;
  /** Uploads a Blob to /owner/assets, scoped to (siteId, elementId) when
   *  the elementId is non-empty. Throws on non-OK response or malformed
   *  body — no silent fallback to placeholder ids. Returns the assigned
   *  asset id and the server-detected kind. */
  postAssetUpload(
    blob: Blob,
    altValue: string,
    elementId: string,
  ): Promise<{ assetId: string; kind: string }>;
  /** Writes a status line to the editor's status DOM ref, with optional
   *  tone ("ok" / "error" / "info" / undefined). Auto-decorates trailing
   *  "…" with a spinner. Carousel upload UI calls this to mark in-progress
   *  and error states without re-rendering the inspector. The 'info' tone
   *  is text-only — no CSS class lands on the status DOM ref; it exists
   *  so callers can name the call-site intent explicitly. */
  setStatus(text: string, tone?: 'ok' | 'error' | 'info'): void;

  // -- Phase 2h.2.d: nav links + media picker mounts ---------------------
  /** Same shape as the global `fetch` but throws "session expired" /
   *  "access revoked" on 401/403 after triggering the session-expired or
   *  access-revoked UI flows. Mount fns use it for slot-history / gallery
   *  GETs so the picker doesn't silently render stale data when the editor
   *  loses auth mid-session. */
  authFetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
  /** API root the IIFE was booted with (e.g. "/api" in prod, "/__api" in
   *  preview). Joined with "/owner/assets" and "/sites/<id>/elements/<id>/
   *  history" inside the media picker — kept as a raw prefix so call sites
   *  read like the IIFE twin. */
  apiBase: string;
  /** Site id the IIFE was booted with. Same role as apiBase — kept as a
   *  raw string so media-picker URL construction is `s/<closure-var>/
   *  ctx.<closure-var>/g` from the inline twin without restructuring. */
  siteId: string;
  /** Mutates element.assetId (+ optional element.mediaKind), re-renders,
   *  schedules a save, then upserts the chosen asset into the slot-history
   *  ledger (PUT /sites/<id>/elements/<id>/history/<assetId>). Awaits
   *  refreshFn when supplied so picker rows re-render after the apply
   *  completes. History upsert errors only log to console — they do not
   *  fail the apply, since the new asset is already on the element. */
  applyAssetIdToElement(
    element: MediaElement,
    nextAssetId: string,
    refreshFn?: () => Promise<unknown>,
    nextKind?: string,
  ): Promise<void>;
  /** Deletes an asset from the gallery. First DELETE probes for references
   *  (412 path lists editable + published slots in a confirm modal), then
   *  re-issues DELETE with ?confirm=1 on user OK. Clears the asset id from
   *  local state on success and awaits refreshFn. Status line carries the
   *  outcome ("Asset deleted" / "Delete failed: <detail>"). */
  runDeleteAsset(assetId: string, refreshFn?: () => Promise<unknown>): Promise<void>;
  /** Drives the upload pipeline for the media picker: image branch crops
   *  to slot aspect then uploads; video branch extracts a first-frame
   *  poster, crops the poster, uploads the video + poster, then applies.
   *  Reads alt from #media-upload-alt-<elementId>. Aborts with a status
   *  line when the slot has no size yet. "crop cancelled" is the one
   *  non-error exit — surfaces as "Cancelled" status, no error tone. */
  uploadMediaForElement(
    element: MediaElement,
    file: File,
    refreshFn?: () => Promise<unknown>,
  ): Promise<void>;

  // -- Phase 2h.3.a: section inspector ----------------------------------
  /** Inspector panel DOM ref, cached at boot. Null before boot wires the
   *  mount point; the section inspector is a no-op while null so the
   *  module never has to assert a live mount. */
  inspector: HTMLElement | null;
  /** Section selection state. Null when no section is selected (element
   *  or nothing is the active selection). Read-only from the section
   *  inspector; selectSection writes it elsewhere. */
  selectedSectionId: string | null;
  /** Tag for the inspector content currently rendered ("section:<id>" /
   *  "element:<id>" / "page"). preserveInspectorScrollFor reads + mutates
   *  it so successive renders of the same subject keep the scrollTop
   *  while subject switches reset to top. */
  inspectorRenderSubject: string | null;
  /** Walks state.header → state.footer → currentPage().sections in that
   *  order and returns the first match. Returns null when no section has
   *  the id — callers must null-check; the section inspector hides itself
   *  on null rather than throwing. */
  findSection(sectionId: string | null): CanvasSection | null;
  /** Preserve inspector scrollTop across re-renders of the same subject;
   *  reset to top when subject changes. Mutates inspectorRenderSubject
   *  on call so callers don't have to thread the tag separately. */
  preserveInspectorScrollFor(subject: string): void;
  /** Revoke every object URL queued under [data-object-url] inside the
   *  inspector before re-render. Without this, every blob-backed preview
   *  leaks its bytes for the rest of the tab session. */
  revokePendingPreviews(): void;
  /** Resolve the legal role values for a section's role dropdown in the
   *  inspector. "header"/"footer" only appear when the section is already
   *  pinned OR sits at the page boundary AND no other section already
   *  carries that role. Returned list is what the <select> renders. */
  selectableSectionRoles(section: CanvasSection): string[];
  /** Open the AI section-create modal anchored after the named section.
   *  Synchronously checks ctx.aiBusy and short-circuits when an AI request
   *  is in flight. */
  aiCreateSection(afterSectionId: string): void;

  // -- Phase 2h.3.b: page inspector --------------------------------------
  /** Canvas DOM root (`document.getElementById("canvas-root")`), cached at
   *  boot. Null before boot wires it; the page inspector and replay path
   *  are no-ops while null so the module never has to assert a live root. */
  root: HTMLElement | null;
  /** Active artboard id. Drives currentPage()'s selection — null falls
   *  back to state.pages[0]. Mutated externally by setActivePage; the
   *  page inspector reads it through ctx during replayAnimations so the
   *  selector lookup matches whatever the canvas is showing. */
  activePageId: string | null;
  /** Walks state.pages and returns the one matching activePageId, or
   *  state.pages[0] when no active id is set. Null when state is null
   *  or pages is empty — callers must null-check; the page inspector
   *  hides itself on null rather than throwing. */
  currentPage(): CanvasPage | null;
  /** Re-render the page list in the left sidebar. Called after page
   *  title/slug mutations so the sidebar entry text matches the freshly
   *  edited fields. No-op when the sidebar root is missing or state is
   *  null. */
  updatePageSidebar(): void;
  /** Open the OK/Cancel confirm modal and resolve with the user's
   *  choice. Throws synchronously if another modal is already open —
   *  callers must serialise modals themselves, no implicit queueing. */
  openConfirmModal(opts: {
    title?: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }): Promise<boolean>;
  /** Mirror page.entranceAnimation + page.scrollTriggerMode onto the
   *  artboard's <article> via data-motion-preset / data-entrance-animation
   *  + data-scroll-trigger. Clears all three first so transitioning to
   *  "none" doesn't leave stale attributes behind. */
  applyPageMotionAttributes(article: HTMLElement, page: CanvasPage): void;
  /** Mirror page.pageBackground / sectionGap / maxWidth onto the
   *  artboard's <article> as inline styles. Width comes from
   *  pageRenderWidth(page) (max-width-clamped). Empty-string assignments
   *  clear unset fields rather than leaving prior values pinned. */
  applyPageStyleProperties(article: HTMLElement, page: CanvasPage): void;
  /** The effective render width: page.maxWidth when set and below
   *  page.width, otherwise page.width. Throws on null page — callers
   *  always pass a page resolved from state.pages, so null is a
   *  dangling-reference bug rather than a silent default-1440 path. */
  pageRenderWidth(page: CanvasPage): number;

  // -- Phase 2h.3.c: element inspector orchestrator ----------------------
  /** True while the asset reel (full-screen browser overlay) is open. The
   *  element inspector hides itself synchronously when this flips true so
   *  the inspector pane doesn't render under/over the reel. The reel
   *  open/close path mutates this; the inspector only reads it. */
  isReelOpen: boolean;
  /** Per-element-type inspector spec table. JSON-injected into the IIFE at
   *  boot (canvas-client.ts: `const INSPECTOR_DISPATCH = ${json};`) so the
   *  closure carries it as a constant. On ctx, the type matches the
   *  source `InspectorDispatch` shape — `collection` is intentionally
   *  excluded from the static dispatch table (children render their own
   *  inspectors), so the runtime lookup returns undefined for it and the
   *  inspector body stays empty. */
  INSPECTOR_DISPATCH: Record<Exclude<CanvasElement['type'], 'collection'>, InspectorSpec>;
  /** Walk an InspectorSpec into DOM, appending fields to ctx.inspector.
   *  The walker owns kind-by-kind branches for select / select-mapped /
   *  text / textarea / checkbox / number / button-action / action-href /
   *  custom-mount. Mount handlers are looked up via the INSPECTOR_MOUNT_
   *  HANDLERS closure (NOT yet on ctx — still inline in canvas-client.ts);
   *  this field exposes the walker so the element-inspector orchestrator
   *  can render the spec without re-importing the walker's closure deps. */
  renderInspectorSpec(spec: InspectorSpec, element: CanvasElement): void;
  /** API_BASE + "/canvas/sites/" + SITE_ID — the per-site API root used
   *  for /assets, /style-kit, etc. The IIFE caches it as `SITE_BASE` at
   *  the top of the closure; on ctx it's a plain string so extracted
   *  modules can construct `<siteBase>/assets/<id>` without re-deriving
   *  apiBase + siteId concatenation. */
  siteBase: string;

  // -- Phase 2m: persist + undo/redo cluster -----------------------------
  /** In-memory undo history. Entries are structured-cloned EditableSite
   *  snapshots taken before each mutation. Capped at UNDO_MAX (60) in
   *  flushPendingUndoCapture; persisted to localStorage at
   *  UNDO_PERSIST_MAX (20) so a busy session doesn't blow the per-origin
   *  storage quota. Mutated by captureForUndo / flushPendingUndoCapture /
   *  undo / redo / initUndo; read by persistUndo. */
  undoStack: SiteSnapshot[];
  /** Symmetric redo history. Cleared on every fresh capture (mutating
   *  forward invalidates the redo timeline) and grown by undo. */
  redoStack: SiteSnapshot[];
  /** 0ms debounce handle for captureForUndo. A burst of mutations
   *  collapses into one snapshot rather than one snapshot per setter.
   *  Null when no capture is pending. undo/redo flush this synchronously
   *  so a fast Ctrl+Z sees the post-mutation state on the stack. */
  undoTimer: ReturnType<typeof setTimeout> | null;
  /** True while undo/redo is replaying a snapshot. captureForUndo skips
   *  on this flag so the restore itself doesn't grow the stack and turn
   *  every undo into a no-op. */
  undoRedoing: boolean;
  /** Latched true the first time persistUndo's localStorage write fails
   *  (quota exceeded, private-window block, etc.). Idempotent failure
   *  channel — subsequent persist attempts no-op, so a write loop can't
   *  spam the console. The status line surfaces the failure once. */
  undoPersistenceFailed: boolean;
  /** 500ms debounce handle for the HTTP PUT save path. Null when no save
   *  is pending. flushPendingSave (kept inline) clears this synchronously
   *  before forcing an immediate save. */
  saveTimer: ReturnType<typeof setTimeout> | null;
  /** Live co-edit handle, or null when WS isn't attached. scheduleSave
   *  branches on this — present means Yjs autosave drives persistence;
   *  null means the HTTP PUT debounce is the save path. */
  coEditConnection: CoEditConnection | null;
  /** Project the current state into the Yjs doc. Returns true when the
   *  socket is open and the projection went out; false when the channel
   *  is missing or unhealthy. scheduleSave reads the boolean to decide
   *  between "Synced" / "Co-edit disconnected" status lines. */
  coEditSync(): boolean;
  /** Force an immediate HTTP PUT of the current state, chained through
   *  the save queue so concurrent calls serialise. Resolves true on a
   *  successful save, false on a server / network failure (loud — the
   *  status line carries the detail; no silent fallback). */
  saveStateNow(): Promise<boolean>;
  /** Latch the undo-persistence-failed flag, log a structured error, and
   *  surface a status line. Exposed on ctx because the IIFE's inline
   *  paths beyond persistUndo (e.g. boot-time storage probe) also need
   *  to trip the latch without re-importing the persist module. */
  disableUndoPersistence(reason: string, error: unknown): void;

  // -- Phase 2o.a: selection state-machine -------------------------------
  /** Latched true the first time the Owner clicks "Drop selection" in the
   *  chat selection chip — the chip then renders empty until a fresh
   *  selectElement() reopens the loop. selectElement() resets to false on
   *  every new selection (including null) so the chip surfaces the next
   *  element the Owner picks. */
  chatSelectionDropped: boolean;
  /** True while a link popover is pinned (auto-shown for action elements,
   *  or stuck-open via the popover's pin button). selectElement reads this
   *  to decide whether to dismiss the popover when the selection moves; an
   *  unpinned hover popover doesn't survive any selection change, so the
   *  flag-only gate is correct. */
  linkPopoverPinned: boolean;
  /** Remove the live link popover from the DOM and clear the pinned/anchor
   *  state. Called by selectElement when the prior selection had a pinned
   *  popover — the new selection either pins its own or shows none. */
  removeLinkPopover(): void;
  /** Close the film-reel overlay (sets ctx.isReelOpen=false, re-renders
   *  the canvas without the reel). selectElement calls this when entering
   *  an element selection, since the reel and a selected element are
   *  mutually exclusive UI modes. */
  closeReel(): void;
  /** Show a link popover anchored to the given element. The {pinned:true}
   *  branch auto-fires for action elements so the Owner can navigate to
   *  the linked page without hunting for the inspector's href field. */
  showLinkPopover(anchorEl: HTMLElement, opts: { pinned: boolean }): void;
  /** Re-render the chat selection chip from ctx.selectedElementId +
   *  ctx.chatSelectionDropped. selectElement calls this after mutating
   *  selection state so the chip surfaces the freshly picked element. */
  updateChatSelectionChip(): void;
  /** Re-render the film-reel overlay (selected-section highlight, reel
   *  contents). selectSection calls this when the reel is open so the
   *  reel's section highlight tracks the section selection. */
  renderReel(): void;
  /** Idempotent selection setter — no-op when sectionId already matches
   *  the active selection. Reads ctx.selectedSectionId, ctx.root,
   *  ctx.selectedElementId, ctx.isReelOpen; mutates ctx.selectedSectionId
   *  and calls ctx.renderInspector / ctx.renderReel. Exposed on ctx
   *  because selectElement re-enters selectSection for the element's
   *  parent section. */
  selectSection(sectionId: string | null): void;

  // -- Phase 2l: camera + render orchestrator ----------------------------
  /** The .opencanvas-viewport wrapper inserted around #canvas-root at boot.
   *  Owns the dark background + dock-clearing margins; carries
   *  overflow:hidden so the camera (not the browser) handles pan+zoom.
   *  Null before mountViewport runs — every camera helper exits early
   *  on null so the boot order doesn't have to assert mount completion. */
  viewport: HTMLElement | null;
  /** The floating zoom toolbar (+/-/Fit) at the bottom-right of the
   *  editor. Wired late by the camera bootstrap; the camera helpers do
   *  not read it (only the click handlers do), so the field is exposed on
   *  ctx for the late wiring path rather than for the inline render. */
  zoomToolbar: HTMLElement | null;
  /** The "100%" zoom-percentage readout inside the zoom toolbar.
   *  applyCameraTransform writes Math.round(camera.zoom * 100) + "%" into
   *  it on every transform — null is treated as "readout not mounted yet"
   *  and skipped without a fallback. */
  zoomReadout: HTMLElement | null;
  /** The {x, y, zoom} camera state. Mutated in place by setZoom /
   *  zoomAtPoint / fitToPage / fitAllPages and read by applyCameraTransform.
   *  Initial values mirror the IIFE's `{ x: 0, y: 0, zoom: 1 }` — fresh
   *  identity-matrix camera at boot. */
  camera: { x: number; y: number; zoom: number };
  /** Per-page artboard layout: where each page's artboard sits in
   *  world-space (x is the left edge of the artboard, y is
   *  ARTBOARD_LABEL_HEIGHT below the top, width comes from page.width,
   *  height sums header + page sections + footer). Recomputed by
   *  computePagePositions; consumed by getPagePosition + renderAllImpl +
   *  fitToPage + fitAllPages + (Phase 2i) drag handlers. Exposed on ctx
   *  because the drag cluster needs the artboard bounds. */
  pagePositions: Array<{
    pageId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  /** Truthy when the Owner has clicked "Use" on a Sections-picker card
   *  and the canvas should render between-section drop slots. The field
   *  is set+cleared by the sections-picker (Phase 2k territory) and only
   *  read by renderAllImpl as a truthiness gate before calling
   *  ctx.renderPlacementSlots — so the on-ctx type is the loosest possible
   *  shape (`unknown`) rather than the full PendingImport record. */
  pendingImport: unknown;
  /** Re-render the inline link popover when the camera moves. The IIFE's
   *  inline applyCameraTransform calls this through a `typeof === "function"`
   *  gate because the co-edit cursor layer mounts asynchronously after the
   *  first camera transform fires; the extracted module replicates the
   *  same gate against the (optional) ctx method to preserve boot-order
   *  parity. Filled in by the Phase 2p co-edit cluster. */
  repaintRemoteCursors?: () => void;
  /** Re-anchor the mark toolbar + link popover when the camera moves. The
   *  inline IIFE's applyCameraTransform gates this through a
   *  `typeof === "function"` check; the extracted module replicates the
   *  same gate so the boot order (camera fires before mark-toolbar wiring)
   *  stays valid. Filled in by the mark-toolbar cluster (later phase). */
  onMarkToolbarReflow?: () => void;
  /** Build the live DOM node for a section at the given page width.
   *  Called from renderAllImpl for header → page sections → footer in
   *  that order. Exposed on ctx because renderAllImpl in this module needs
   *  it but the implementation stays inline in canvas-client.ts (Phase 2
   *  doesn't touch the IIFE); future phases will move the builder over
   *  and the field stays. */
  buildSectionNode(section: CanvasSection, pageWidth: number): HTMLElement;
  /** Toggle the .active class + aria-pressed on every sidebar style-kit
   *  chip so the chip row matches state.styleKit. Called from renderAllImpl
   *  on every full render so undo/redo (or any non-sidebar kit change)
   *  reflects in the chip row. Implementation stays inline in
   *  canvas-client.ts during Phase 2; renderAllImpl invokes it through
   *  ctx to keep the call shape mechanical. */
  syncSidebarStyleKitButtons(buttons: NodeListOf<Element>): void;
  /** Draw the between-section drop slots used while a sections-picker
   *  import is pending. renderAllImpl only invokes this when
   *  ctx.pendingImport is truthy; implementation stays inline in
   *  canvas-client.ts during Phase 2. */
  renderPlacementSlots(): void;
  /** Apply (x, y, w, h, z, rotation) from a PositionedBox onto an absolute-
   *  positioned wrapper. autoGrowTextElements calls this after growing a
   *  text element's box.h so the live DOM matches the freshly mutated
   *  box. Implementation stays inline in canvas-client.ts during Phase 2;
   *  the field exists on ctx so the extracted autoGrowTextElements can
   *  invoke it through the same call shape the inline twin uses. */
  setBoxStyle(wrapper: HTMLElement, box: PositionedBox): void;

  // -- Phase 2k.a: chat panel toggle + selection chip --------------------
  /** Toolbar button that opens the chat panel. Wired early — before site
   *  data loads — so the Owner can open the panel during the boot wait.
   *  toggleChatPanel mirrors the open state onto its .active class.
   *  Null when the route omits the toggle (no graceful fallback — the
   *  toggle is part of the editor shell, so null means a DOM regression). */
  chatToggleBtn: HTMLElement | null;
  /** The chat panel container itself. toggleChatPanel flips its `hidden`
   *  flag to open/close; null short-circuits the toggle so the boot order
   *  (DOM caching happens before any user interaction wires) doesn't have
   *  to assert mount completion. */
  chatPanelEl: HTMLElement | null;
  /** Close button inside the chat panel. Wired to the same toggleChatPanel
   *  handler as chatToggleBtn — flipping a hidden panel hidden is the
   *  close action. Null when the route omits the close affordance. */
  chatCloseBtn: HTMLElement | null;
  /** The "this element is in scope" chip mounted inside the chat panel.
   *  updateChatSelectionChip flips its `hidden` flag from
   *  ctx.selectedElementId + ctx.chatSelectionDropped + ctx.state. Null
   *  short-circuits the update so the chip never renders during boot when
   *  the chat panel hasn't mounted yet. */
  chatSelectionEl: HTMLElement | null;
  /** The text span inside the chat selection chip — receives
   *  "<elementType> - <truncated id>". Null short-circuits the update
   *  alongside chatSelectionEl since both must be live for the chip to
   *  render its label. */
  chatSelectionTextEl: HTMLElement | null;
  /** The X button on the chat selection chip. Click flips
   *  ctx.chatSelectionDropped=true and re-runs updateChatSelectionChip so
   *  the chip hides for the next message; the canvas selection itself is
   *  untouched. Null when the route omits the clear affordance. */
  chatSelectionClearBtn: HTMLElement | null;
  /** Open/close the chat panel — flips ctx.chatPanelEl.hidden, mirrors
   *  the new open state onto ctx.chatToggleBtn's .active class, and
   *  focuses #canvas-chat-input on open. Bound impl lives in
   *  chat-panel.ts (toggleChatPanel); exposed on ctx because the
   *  toggle/close event handlers in canvas-client.ts (and, post-cutover,
   *  in createEditor) need a ctx-method reference, not a re-import. */
  toggleChatPanel(): void;

  // -- Phase 2k.b: chat session form + SSE streaming --------------------
  /** The chat panel's <form> element. The chat-session module attaches a
   *  submit listener that POSTs the message + SSE-streams the response.
   *  Null short-circuits the whole flow so boot order (DOM caching runs
   *  before the user can submit) doesn't have to assert mount completion.
   *  Suggestion-chip clicks call ctx.chatForm.requestSubmit() to reuse
   *  the same submit handler. */
  chatForm: HTMLFormElement | null;
  /** The chat panel's <input> for the message. Submit handler reads
   *  .value, clears it after capture, then re-arms for the next turn.
   *  Suggestion-chip clicks write into this before triggering submit. */
  chatInput: HTMLInputElement | null;
  /** The scrolling message list inside the chat panel. appendChatMessage
   *  appends + auto-scrolls; the SSE token branch streams text into a
   *  reusable assistant bubble appended here. Null short-circuits every
   *  append + scroll path so missing DOM is silent at boot. */
  chatMessages: HTMLElement | null;
  /** Welcome blurb shown before the first message in a fresh chat.
   *  hideChatWelcome flips its .hidden flag on the first turn so the
   *  blurb makes way for the conversation. Null leaves the flag alone —
   *  the route may have omitted the blurb. */
  chatWelcome: HTMLElement | null;
  /** Server-issued session id correlating subsequent turns. Captured from
   *  the SSE "session" event and threaded back into the next request's
   *  payload so the agent's context survives across turns. Null on the
   *  first turn (the server mints the id and echoes it back). */
  chatSessionId: string | null;
  /** True while a chat turn is in flight (request issued, SSE stream not
   *  yet closed). Suggestion-chip clicks and the submit handler both
   *  short-circuit on this so a busy chat never races a second submission.
   *  Flipped false on "done", "error", network error, or non-OK response. */
  chatBusy: boolean;
  /** Append a styled message bubble to ctx.chatMessages. role drives the
   *  CSS class (`opencanvas-chat-msg <role>`); text becomes the bubble's
   *  textContent (NOT innerHTML — caller doesn't have to sanitise). No-op
   *  when ctx.chatMessages is null. Implemented by chat-session.ts as
   *  appendChatMessageImpl; createEditor wiring binds ctx.appendChatMessage
   *  = (role, text) => appendChatMessageImpl(ctx, role, text) at boot. */
  appendChatMessage(role: string, text: string): void;
  /** Hide the welcome blurb the chat panel ships with so it makes way for
   *  the first message. No-op when ctx.chatWelcome is null or already
   *  hidden. Implemented by chat-session.ts as hideChatWelcomeImpl;
   *  createEditor wiring binds ctx.hideChatWelcome = () =>
   *  hideChatWelcomeImpl(ctx) at boot. */
  hideChatWelcome(): void;

  // -- Phase 2n: AI integration -----------------------------------------
  /** The "Accept all changes" banner at the top of the chat panel.
   *  chat-session.ts binds it during setupChatSession (the assignment is
   *  co-located with the chatForm DOM-ref bind it neighbours in the IIFE)
   *  and pins the initial-hidden state on bind. The banner's show/hide
   *  semantics + click handler live in ai-integration.ts. Null short-
   *  circuits refreshAcceptAllButton + showAcceptAllSummary so a missing
   *  DOM ref is silent rather than fatal. */
  chatAcceptAllBtn: HTMLElement | null;
  /** Open the "Apply N change(s)?" summary modal listing every pending
   *  op as an ordered list; the Apply all button routes through
   *  ctx.applyAgentOps with the same suggestion array so chat-side cards
   *  flip status in lockstep with the canvas mutation. No-op when no
   *  suggestions are pending. Implementation: showAcceptAllSummaryImpl
   *  in ai-integration.ts; createEditor binds ctx.showAcceptAllSummary
   *  = () => showAcceptAllSummaryImpl(ctx). */
  showAcceptAllSummary(): void;
  /** Pending AI suggestion tracker — one entry per op-preview event the
   *  agent emitted this turn. Mutated by the SSE op-preview branch in
   *  chat-session.ts (push), by accept (status="accepted" + inverseOp on
   *  ai-integration.ts's applyAgentOps), by reject (status="rejected" in
   *  the SSE branch's reject button handler), and by revertAgentEntry
   *  (status="pending" again on success). The entry shape stays loose
   *  (`op: unknown`, `inverseOp: unknown`) because the underlying
   *  CanvasAgentOp union is exposed only to the server's apply route. */
  pendingAiSuggestions: Array<{
    op: unknown;
    toolName: string;
    status: string;
    cardEl: HTMLElement;
    targetNode: HTMLElement | null;
    inverseOp: unknown;
    acceptBtn?: HTMLButtonElement;
    rejectBtn?: HTMLButtonElement;
    revertBtn?: HTMLButtonElement;
  }>;
  /** POST the given ops through /canvas-agent/.../apply, snapshot pre-
   *  state to compute per-op inverses, flip matching suggestion entries
   *  to status="accepted" on success and attach the captured inverse to
   *  entry.inverseOp so a later Revert click can roll back without
   *  affecting unrelated later accepts. Returns false on flushPendingSave
   *  failure or a non-OK /apply response — the status line carries the
   *  detail; no silent retries. Implementation: applyAgentOpsImpl in
   *  ai-integration.ts. */
  applyAgentOps(ops: unknown[], suggestions: unknown[]): Promise<boolean>;
  /** Re-evaluate ctx.pendingAiSuggestions and show/hide the Accept-all
   *  banner with the live (pending) count. Belt-and-suspenders hide
   *  (hidden attr + inline display:none) so a CSS regression cannot leave
   *  a phantom banner on a blank chat. Implementation:
   *  refreshAcceptAllButtonImpl in ai-integration.ts. */
  refreshAcceptAllButton(): void;
  /** Resolve a canvas DOM node for the op's elementId / sectionId /
   *  afterSectionId so the suggestion card can paint an overlay around
   *  the affected block and the card click can pan the camera there.
   *  Returns null when no canvas node matches (e.g. addPage before the
   *  new page mounts). Implementation: findCanvasNodeForOpImpl in
   *  ai-integration.ts. */
  findCanvasNodeForOp(op: unknown): HTMLElement | null;
  /** Pan ctx.camera so node centres in ctx.viewport, then pulse-ring it
   *  via the .opencanvas-ai-focus-pulse class (reflow-forced so repeated
   *  clicks restart the keyframe). No-op when node or viewport is null.
   *  Implementation: focusCanvasOnNodeImpl in ai-integration.ts. */
  focusCanvasOnNode(node: HTMLElement): void;
  /** Human-readable one-liner describing the op for the suggestion card's
   *  body text + the Accept-all summary modal's list items. Pure — the
   *  one ctx-method exception in this section, since the inline twin is
   *  a closure-free function. Implementation: describeOp in
   *  ai-integration.ts. */
  describeOp(op: unknown): string;
  /** Apply entry.inverseOp through /canvas-agent/.../apply to roll back
   *  one accepted suggestion. Flips the card back to status="pending" so
   *  the Owner can re-Accept; re-resolves entry.targetNode against the
   *  freshly rendered canvas. The "pending" semantic is the Owner's
   *  chosen alternative to freezing as "reverted". Implementation:
   *  revertAgentEntryImpl in ai-integration.ts. */
  revertAgentEntry(entry: unknown): void;
  /** Flip ctx.aiBusy and toggle disabled on every [data-ai-button] so a
   *  preview-in-flight locks the AI surface against stacked previews.
   *  ORs in ctx.sessionExpired + ctx.accessRevoked so a busy=false call
   *  during a locked session keeps the buttons disabled — the lock takes
   *  precedence. Implementation: setAiBusyImpl in ai-integration.ts. */
  setAiBusy(busy: boolean): void;

  // -- Phase 2p forward declarations (filled by co-edit / presence) -----
  /** True after the editor has detected a 401 on a mutating request
   *  (save / chat / apply) and the session-expired modal has been raised.
   *  setAiBusy ORs this into ctx.aiBusy so the AI surface stays disabled
   *  through the modal flow; applyAgentOps' catch path short-circuits the
   *  error toast when this is true to avoid double-surfacing. FORWARD:
   *  Phase 2p owns this. Inline twin at canvas-client.ts:1043. */
  sessionExpired: boolean;
  /** True after the editor has detected a 403 (Owner access revoked
   *  mid-session). Same role as sessionExpired but does not auto-recover;
   *  setAiBusy ORs this in so the AI surface stays disabled until reload.
   *  FORWARD: Phase 2p owns this. Inline twin at canvas-client.ts:1044. */
  accessRevoked: boolean;

  // -- Phase 2m residual forward declaration ---------------------------
  /** Flush the 500ms HTTP-PUT save debounce synchronously so a follow-on
   *  /canvas-agent/.../apply request sees the latest persisted state. Used
   *  by applyAgentOps / revertAgentEntry — both run apply against the
   *  freshly-saved editable state, so a still-pending save would race the
   *  apply's server-side reload. Returns false on save failure so the
   *  apply caller can short-circuit. FORWARD: kept inline by Phase 2m
   *  (the persist module exports the debouncer but not the flush path).
   *  Inline twin at canvas-client.ts:2428. */
  flushPendingSave(): Promise<boolean>;

  // -- Phase 2o.b: keyboard handlers -------------------------------------
  /** Active inline-editing element id (null when no element is in
   *  contentEditable mode). The window-level keyboard handler reads this
   *  to gate Space/V/Delete/Backspace shortcuts — typing into a text
   *  element MUST NOT trigger pan-mode, select-mode, or delete. Phase
   *  2h's inspector/edit code (canvas-client.ts:586 inline declaration,
   *  mutated by enterEditing/exitEditing around line 10148) reads and
   *  writes this; the keyboard module reads it. Cross-module use forces
   *  it onto ctx. */
  editingElementId: string | null;

  // -- Phase 2i: drag/resize cluster + pointer state machine -------------
  /** Lower bound for resize width/height, in canvas px. Mirrored in
   *  server-side validate.ts / render.ts bounds so a state authored in
   *  the editor passes server validation on save. Carried on ctx (rather
   *  than as a module-local constant in drag-resize.ts) because the
   *  inline twin reads it as a free closure identifier and the surface
   *  must mirror that closure shape per ADR 0058 Decision 1. */
  MIN_ELEMENT_SIZE_PX: number;
  /** Current pointer interaction mode. "select" lets the Owner click +
   *  drag elements; "pan" lets them drag the canvas (camera). Phase 2o.b's
   *  keyboard handler captures the pre-temporary-pan mode (so Space-held
   *  → temporary pan → release restores the prior mode) and writes via
   *  setInteractionMode. Legal runtime values are "select" and "pan" —
   *  setInteractionMode throws on anything else. Typed as the broader
   *  `string` so call sites that round-trip the value through DOM
   *  attributes (data-interaction-mode) don't need a cast at every read.
   *  Initial value at boot: "select". */
  interactionMode: string;
  /** True while the Space key is held for temporary pan-mode. Phase 2o.b's
   *  keyboard handler latches this on Space-keydown and endTemporaryPan
   *  reads it to decide whether to restore the prior mode on Space-keyup
   *  / window-blur. */
  spaceHeldForPan: boolean;
  /** The interactionMode value captured at the moment Space was pressed,
   *  so endTemporaryPan can restore it. Phase 2o.b's keyboard handler
   *  writes it on Space-keydown; null when no temporary pan is active. */
  temporaryPanPreviousMode: string | null;
  /** Set the active pointer interaction mode and mirror it onto the
   *  viewport's data-interaction-mode + zoom-toolbar aria-pressed.
   *  Throws on values other than "select"/"pan" — callers MUST stick to
   *  the two-state machine. Implementation: setInteractionModeImpl in
   *  drag-resize.ts; createEditor binds ctx.setInteractionMode =
   *  (mode) => setInteractionModeImpl(ctx, mode). */
  setInteractionMode(mode: string): void;
  /** Clear the spaceHeldForPan + temporaryPanPreviousMode latches without
   *  changing interactionMode. Phase 2o.b's keyboard handler invokes it
   *  on V (explicit select-mode) so a subsequent Space release doesn't
   *  bounce the mode back. Implementation: clearTemporaryPanStateImpl in
   *  drag-resize.ts. */
  clearTemporaryPanState(): void;
  /** Exit temporary pan-mode — if spaceHeldForPan is true, restore the
   *  pre-Space interactionMode (defaulting to "select" when the prior
   *  mode is null) and clear the latches. No-op when no temporary pan is
   *  active. Phase 2o.b's keyboard handler invokes it on Space-keyup and
   *  window-blur. Implementation: endTemporaryPanImpl in drag-resize.ts. */
  endTemporaryPan(): void;
  /** Cancel the pending sections-picker import (ctx.pendingImport) and
   *  re-render so the between-section drop slots disappear. Placement is
   *  a drag-adjacent interaction, so the cancel lives in Phase 2i.
   *  Phase 2o.b's keyboard handler invokes it on Escape when an import
   *  is pending. Implementation: exitPlacementModeImpl in drag-resize.ts;
   *  reads ctx.pendingImport, calls ctx.setStatus / ctx.renderSectionsPanel
   *  / ctx.renderPlacementSlots. */
  exitPlacementMode(): void;
  /** Map a browser-coord pointer event into the named frame's local
   *  coordinate space (section / tab-panel / collection-entry). Used by
   *  beginDragImpl + beginResizeImpl to translate mousemove deltas into
   *  state-space mutations. Returns null when sectionEl is missing or the
   *  event has no clientX (defensive guard against synthetic events
   *  during boot). FORWARD: kept inline by this phase; the camera/world
   *  helpers cluster (canvas-client.ts:947) owns the implementation and
   *  a later phase (sibling to render.ts's screenToWorld) will lift it
   *  onto ctx with a real signature. */
  pointerToCanvas(
    event: PointerEvent | MouseEvent,
    sectionEl: Element,
  ): { x: number; y: number } | null;
  /** Walk up from `target` (and synthetic hit-tests via document.
   *  elementFromPoint for overlay layers) to the nearest .opencanvas-
   *  element wrapper at the given pointer coords. Used by
   *  attachPointerHandlersImpl's mousedown branch + the canvas-wide
   *  context menu wiring. Returns null when no wrapper covers the
   *  pointer. FORWARD: kept inline by this phase; canvas-client.ts:11853
   *  owns the implementation and a later phase (the canvas-overlay/hit-
   *  test cluster) will lift it onto ctx. */
  resolveElementWrapperAtPoint(
    target: Element,
    clientX: number,
    clientY: number,
  ): HTMLElement | null;
  /** Canvas-wide link-hover handler — shows the link popover when the
   *  pointer enters a nav-link or action element outside any
   *  contenteditable subtree. attachPointerHandlersImpl wires this onto
   *  ctx.root as the `mouseover` listener. FORWARD: kept inline by this
   *  phase; canvas-client.ts:9165 owns the implementation and the future
   *  link-popover cluster (Phase TBD) will lift it onto ctx. */
  onCanvasLinkHover(ev: MouseEvent): void;
  /** Symmetric counterpart to onCanvasLinkHover — hides the link popover
   *  when the pointer leaves the link region. Wired as `mouseout` on
   *  ctx.root by attachPointerHandlersImpl. FORWARD: kept inline by this
   *  phase; canvas-client.ts:9183 owns the implementation. */
  onCanvasLinkHoverLeave(ev: MouseEvent): void;
  /** Re-render the sections picker panel (the left-sidebar tray that
   *  shows pre-built section recipes). exitPlacementModeImpl calls this
   *  so the picker resets when an import is cancelled. FORWARD: kept
   *  inline by this phase; canvas-client.ts:12522 owns the implementation
   *  and the future sections-picker phase will lift it onto ctx. */
  renderSectionsPanel(): void;

  // -- Phase 2j: section toolbar + section orchestration -----------------
  /** Compute the (x, y, w, h, z) box for a freshly-inserted element. Throws
   *  on missing current page — a null page here means the caller passed a
   *  section that no longer belongs to state, so we fail loudly rather
   *  than invent geometry. Reads ctx.currentPage(); calls nextZInArray on
   *  section.elements internally (z-order.ts). Implementation:
   *  defaultBoxImpl in section-toolbar.ts. */
  defaultBox(
    section: CanvasSection,
    w: number,
    h: number,
  ): { x: number; y: number; w: number; h: number; z: number };
  /** Append `element` to `section.elements`, apply the page's default
   *  motion preset when the element carries none, then renderAll +
   *  selectElement + panToElement + scheduleSave. The pan keeps the new
   *  element visible even when it lands far from the current scroll
   *  position. Implementation: addElementToSectionImpl in
   *  section-toolbar.ts. */
  addElementToSection(section: CanvasSection, element: CanvasElement): void;
  /** Resolve the section a sidebar drop-in should land in: explicit
   *  selection → viewport-centre hit-test → first body section → first
   *  section of any kind. Returns null when state has no pages. Reads
   *  ctx.currentPage(), ctx.selectedSectionId, ctx.findSection,
   *  ctx.viewport. Implementation: targetSectionForSidebarImpl in
   *  section-toolbar.ts. */
  targetSectionForSidebar(): CanvasSection | null;
  /** Centre ctx.camera on the named element by walking page → section →
   *  element world coords. No-op when any link in the chain is missing
   *  (page / section / element / viewport) — addElementToSection calls
   *  this unconditionally after insert, so swallowing missing-element is
   *  the correct contract. Calls applyCameraTransform(ctx) from
   *  render.ts. Implementation: panToElementImpl in section-toolbar.ts. */
  panToElement(elementId: string): void;
  /** Insert a fresh "Blank section" after the active section selection
   *  (or at the end of the page when no section is selected), then
   *  select the new section. Index runs through clampInsertIndex so
   *  header/footer pins are respected. Implementation:
   *  addBlankSectionFromSidebarImpl in section-toolbar.ts. */
  addBlankSectionFromSidebar(): void;
  /** Pure: map a sidebar component key ("text", "media", ...) to the
   *  matching "add-X" action string handleSectionAction recognises, or
   *  null when the key isn't registered in SIDEBAR_COMMANDS. Reads
   *  ctx.SIDEBAR_COMMANDS only. Implementation: componentActionForSidebar
   *  in section-toolbar.ts. */
  componentActionForSidebar(component: string): string | null;
  /** Dispatch a sidebar drop-in: pick a target section via
   *  targetSectionForSidebar, resolve the action key via
   *  componentActionForSidebar, route through handleSectionAction.
   *  Surfaces "Add a section first" / "Unknown component: <key>" status
   *  lines on the two failure paths — no silent no-ops. Implementation:
   *  addComponentFromSidebarImpl in section-toolbar.ts. */
  addComponentFromSidebar(component: string): void;
  /** Dispatch a section-toolbar action ("delete-section", "duplicate-
   *  section", "move-up", "move-down", "add-<key>", "save-to-library")
   *  against the named section. Header/footer "delete-section" branches
   *  short-circuit before page lookup so site-level deletes don't fall
   *  through to the page-section path. Phase 2o.b's keyboard handler
   *  invokes it for Delete/Backspace when a section is selected.
   *  Implementation: handleSectionActionImpl in section-toolbar.ts. */
  handleSectionAction(action: string, sectionId: string): void;
  /** Three-modal flow (name → optional description → visibility) then POST
   *  to /library/sections. Clears ctx.sectionsCatalog on success so the
   *  next picker open re-fetches. Every failure path writes a "Save
   *  failed: <detail>" status line — no silent swallows. Awaits
   *  ctx.flushPendingSave first so the server side reads the latest
   *  persisted state. Implementation: saveToLibraryImpl in
   *  section-toolbar.ts. */
  saveToLibrary(section: CanvasSection): Promise<void>;
  /** Three-modal flow (name → description → visibility) then POST to
   *  /custom-templates. Refuses empty names with a status line instead of
   *  POSTing. Same flushPendingSave-first contract + loud-failure status
   *  line as saveToLibrary. Implementation: saveSiteAsTemplateImpl in
   *  section-toolbar.ts. */
  saveSiteAsTemplate(): Promise<void>;

  // -- Phase 2j forward declarations (kept inline by this phase) ---------
  /** Per-key sidebar command lookup table flattened from SIDEBAR_DISPATCH
   *  at IIFE start. Phase 2j's handleSectionAction reads
   *  SIDEBAR_COMMANDS[key] to decide whether an "add-<key>" action routes
   *  through insertElementForSidebarCommand. Loose record shape
   *  (Record<string, unknown>) because the SidebarCommandSpec union is
   *  internal to the inline IIFE and Phase 2j doesn't read its fields
   *  beyond truthiness. FORWARD: kept inline by this phase; a later phase
   *  owns the dispatch table extraction. Inline twin at
   *  canvas-client.ts:89-99. */
  SIDEBAR_COMMANDS: Record<string, unknown>;
  /** Build + insert a sidebar-command element into the given section
   *  (or its nested tabs/collection target). Mutates state, renders,
   *  schedules a save. Phase 2j's handleSectionAction routes "add-<key>"
   *  actions through this. FORWARD: kept inline by this phase; the
   *  per-element factory cluster owns the implementation. Inline twin at
   *  canvas-client.ts:352-392. */
  insertElementForSidebarCommand(section: CanvasSection, commandKey: string): void;
  /** Resolve the world-space position of a page's artboard given its id,
   *  or null when the page isn't in ctx.pagePositions. Phase 2j's
   *  panToElement reads this to translate an element's section-local
   *  coords into world coords. FORWARD: kept inline by this phase
   *  (computePagePositions writes pagePositions inline; the lookup helper
   *  travels with it). Inline twin at canvas-client.ts:794-799. */
  getPagePosition(pageId: string): {
    pageId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  /** Open the editor's single-field text modal (1-line by default; opt-in
   *  multiline). Resolves with the entered string, or null when the
   *  Owner cancels (Escape / backdrop click / Cancel button). Throws
   *  synchronously when another modal is already open — callers must
   *  serialise modals themselves. Phase 2j's saveToLibrary +
   *  saveSiteAsTemplate chain three of these per call. FORWARD: kept
   *  inline by this phase (the modal cluster has its own boundary).
   *  Inline twin at canvas-client.ts:1195-1285. */
  openTextModal(opts: {
    title?: string;
    label?: string;
    defaultValue?: string;
    placeholder?: string;
    multiline?: boolean;
  }): Promise<string | null>;
  /** Open the editor's single-field select modal. Same cancel /
   *  modal-stacking contract as openTextModal. Phase 2j's
   *  saveToLibrary + saveSiteAsTemplate use this for the visibility
   *  picker. FORWARD: kept inline by this phase. Inline twin at
   *  canvas-client.ts:1287+. */
  openSelectModal(opts: {
    title?: string;
    label?: string;
    options?: Array<{ value: string; label?: string }>;
    defaultValue?: string;
  }): Promise<string | null>;
  /** Cached cross-template sections catalog: null until first load, then
   *  an array (possibly empty) of catalog rows. Phase 2j's saveToLibrary
   *  sets this back to null on a successful POST so the next picker open
   *  re-fetches. FORWARD: kept inline by this phase (the sections picker
   *  owns the load + filter logic and the row shape). Loose `unknown`
   *  array typing — Phase 2j only writes null. Inline twin at
   *  canvas-client.ts:12233. */
  sectionsCatalog: unknown[] | null;
}
