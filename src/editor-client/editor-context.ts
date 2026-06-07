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
  InlineMark,
  InlineMarkType,
  InlineRun,
  PositionedBox,
} from '../canvas/schema.js';
import type { InspectorSpec } from '../canvas/elements/inspector-spec.js';
import type { MediaElement } from '../canvas/elements/media.js';
import type { CoEditConnection } from '../live/co-edit/client.js';
import type { FindElementResult } from './editor-context-types.js';
import type {
  AiMediaModalOpts,
  AiMediaModalResult,
  AlertModalOpts,
  ConfirmModalOpts,
  NewPageModalOpts,
  NewPageModalResult,
  SelectModalOpts,
  TextModalOpts,
} from './modals.js';
import type { SiteSnapshot } from './persist.js';
import type { PendingImport, SectionsCatalogEntry } from './sections-picker.js';

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

export interface AiUndoSidecarSnapshot {
  ghostSections: Array<{
    id: string;
    pageId: string;
    afterSectionId: string | null;
    section: CanvasSection;
  }>;
  suggestions: Array<{
    index: number;
    suggestionId: string | null;
    status: string;
    inverseOp: unknown;
  }>;
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
   *  page); callers don't need to branch on that themselves. Forward-
   *  declared on ctx since Phase 2h.2.b; Phase 2q.d collapses the forward
   *  decl into the real implementation in element-menu.ts. */
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
  /** Status DOM ref (`#canvas-status`), cached at boot. setStatusImpl
   *  writes into this node. Null when the route omits the affordance;
   *  setStatus no-ops on null. Forward-declared here so runtime-helpers.ts
   *  can install setStatusImpl against the cached ref without ctx-shape
   *  drift. ADR 0015 Phase 3.1. */
  statusEl: HTMLElement | null;
  /** Idle-reset timer handle for setStatus. Null when no reset is pending.
   *  Each setStatus call clears the prior timer and arms a 4s "Saved"
   *  reset so transient toasts fade back to the synced baseline. ADR
   *  0015 Phase 3.1. */
  statusTimer: ReturnType<typeof setTimeout> | null;
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
  /** Phase 2q.e — POST /assets/generate with the prompt + slot box
   *  dimensions, hold the returned image bytes as a blob URL preview, and
   *  let the Owner Apply (uploads to /api/owner/assets) or Discard
   *  (revokes the blob URL). Reads alt from #media-upload-alt-<elementId>
   *  when present. Aborts with a "slot has no size yet" status when
   *  element.box has zero width or height. Failure tones surface through
   *  ctx.setStatus — no silent fallback. */
  generateImageForElement(element: MediaElement, prompt: string): Promise<void>;

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
  // openConfirmModal moved to the Phase 2q.a modal cluster section below.
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
  /** Transient AI suggestion/ghost snapshots aligned with undoStack. These
   *  are intentionally not persisted to localStorage: after hard refresh the
   *  chat-card DOM is gone, so there is no sidecar UI to restore, while the
   *  canvas state snapshots remain reload-safe. */
  undoAiSidecarStack: Array<AiUndoSidecarSnapshot | null>;
  /** Symmetric redo history. Cleared on every fresh capture (mutating
   *  forward invalidates the redo timeline) and grown by undo. */
  redoStack: SiteSnapshot[];
  /** Transient AI suggestion/ghost snapshots aligned with redoStack. */
  redoAiSidecarStack: Array<AiUndoSidecarSnapshot | null>;
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
  /** Serialisation queue for saveStateNow. Every snapshot save chains its
   *  PUT through `.then(persistStateSnapshot)` against the previous
   *  save's promise so concurrent calls serialise instead of racing.
   *  Starts at `Promise.resolve(true)`. ADR 0015 Phase 3.1. */
  saveQueue: Promise<boolean>;
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

  // -- ADR 0065 D6: Collection template edit-mode -----------------------
  /** ADR 0065 D6 — global editor state pinning the Collection whose custom
   *  template is currently in edit mode. `null` when no template is being
   *  edited (the default, including immediately after page load). Set to
   *  `{ collectionId }` when the Owner clicks the inspector's "Edit
   *  template" button; cleared on Done / Esc / click-outside / page switch.
   *
   *  NOT persisted in Yjs and NOT part of `EditableSite` — UI mode is the
   *  editor's business, not the document's. Loading a site never restores
   *  edit-mode; the Owner always starts in the rendered-grid view.
   *
   *  Phase 1 ships the field initialised to `null`. Phase 2C wires the
   *  inspector enter/exit setters; Phase 2D's selection branch reads it
   *  to invert the ADR 0063 D6 click-bubble rule inside the active
   *  template (clicks target template children directly instead of
   *  bubbling to the parent Collection).
   *
   *  Failure path (ADR 0065 D6): if `collectionId` references a Collection
   *  that no longer exists (concurrent collaborator deletion), the next
   *  render-pass clears the field; no crash, no zombie viewport. */
  editingCollectionTemplate: { collectionId: string } | null;

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
   *  the linked page without hunting for the inspector's href field.
   *  Opts is optional — the hover trigger paths invoke this with no
   *  options, in which case the popover is non-pinned by default. */
  showLinkPopover(anchorEl: HTMLElement, opts?: { pinned: boolean }): void;
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
  /** Owner's pending Sections-picker import. Non-null after the Owner
   *  clicks "Use" on a card and before they click a drop slot or
   *  Cancel. renderAllImpl reads it as a truthiness gate before invoking
   *  ctx.renderPlacementSlots; sections-picker.ts owns the writes
   *  (enterPlacementModeImpl / exitPlacementModeImpl /
   *  importPendingSectionAt) and reads the full record shape. Narrowed
   *  from the previous `unknown` shape at Phase 2q.i extraction — the
   *  camera module's truthiness gate stays valid under the narrower
   *  type. */
  pendingImport: PendingImport | null;
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
   *  box. Forward-declared on ctx since Phase 2l (impl stayed inline during
   *  Phase 2); Phase 2q.d collapses the forward decl into the real
   *  implementation in style-apply.ts. */
  setBoxStyle(wrapper: HTMLElement, box: PositionedBox): void;

  // -- Phase 2q.d: run + body builders + element menu --------------------
  /** Static map from IconName → inner SVG markup (path geometry only —
   *  wrapper <svg> + stroke attrs come from renderIconSvg's caller). The
   *  IIFE injects this as a JSON literal at boot (canvas-client.ts:86),
   *  so on ctx it is a plain Record<string, string> the shape inspector
   *  reads at render time to fill icon-variant shape elements. The
   *  buildShapeBody path no-ops when the iconKind is not in the map —
   *  validate.ts rejects unknown iconKinds at /apply, but during editing
   *  the value can transiently miss the map. */
  ICON_SVG_MAP: Record<string, string>;
  /** Build the rich-text DOM for a single InlineRun. Walks
   *  CANONICAL_MARK_ORDER innermost-first so the nesting matches the
   *  public renderer; outermost <a> link wrap reads link.href/target and
   *  pins the link popover on click. Math runs use window.katex when
   *  available; missing-KaTeX fallback writes raw TeX as textContent so
   *  the run is at least visible. Bound impl lives in run-builders.ts;
   *  forward-declared on ctx since Phase 2q.g so chart-axis labels could
   *  embed math runs even before the builder itself was extracted — this
   *  commit promotes the forward decl into the real bind. */
  buildRunNode(run: InlineRun): HTMLElement;
  /** Build the per-element-type body content (text content / media tag /
   *  action button-or-anchor / form fields / etc.). Dispatches to
   *  buildTextBody / buildMediaBody / ... via a switch over element.type.
   *  Throws on unknown types — there's no fallback that draws an empty
   *  wrapper. Bound impl lives in body-builders-data.ts. */
  buildElementBody(element: CanvasElement): HTMLElement;
  /** Build the per-element wrapper DOM: data-attrs, position/box, motion
   *  attrs, body, resize handles, menu trigger, and the data-selected
   *  marker when this element matches ctx.selectedElementId. Bound impl
   *  lives in element-menu.ts; collection/tabs body builders thread back
   *  through ctx to recursively build their children. */
  buildElementNode(element: CanvasElement): HTMLElement;
  /** Apply (x, y, w, h, z, rotation) from a PositionedBox onto an absolute-
   *  positioned wrapper. Forward-declared on ctx since Phase 2l (the
   *  Phase 2l comment said impl stays inline during Phase 2); Phase 2q.d
   *  collapses the forward decl into the real implementation in
   *  style-apply.ts. */
  applyElementStyle(wrapper: HTMLElement, element: CanvasElement): void;
  /** Apply Owner-pinned CSS overrides onto the wrapper after the
   *  allowlist filter (key matches /^[a-zA-Z-]+$/, value contains none of
   *  ; : { }). Mirrors validate.ts pinnedStyleValueIssue — change one,
   *  change the other or the editor accepts what the server rejects. */
  applyPinnedStyle(wrapper: HTMLElement, element: CanvasElement): void;
  /** Build the 3-dot element context menu (bring-to-front / send-to-back
   *  / duplicate / delete) and return the menu DOM. The duplicate path
   *  clamps section-level clones to the artboard — a behaviour
   *  duplicateElement (the inspector-actions verb) does NOT encode, so
   *  the menu must inline the duplicate path rather than reuse the verb. */
  buildElementMenu(
    element: CanvasElement,
    section: CanvasSection,
    wrapper: HTMLElement,
  ): HTMLElement;
  /** Toggle the per-element 3-dot menu open or closed. Idempotent: a
   *  second call with the same elementId closes the menu. Pulls the
   *  element through ctx.findElement so the menu's verbs use the same
   *  section/parent-array bindings as the rest of the inspector cluster. */
  toggleElementMenu(elementId: string, wrapper: HTMLElement): void;
  /** Active element id whose 3-dot menu is open in the DOM. Null when no
   *  menu is open. The menu is mutually exclusive — opening a second one
   *  closes the prior. */
  openMenuElementId: string | null;
  /** Resolve href + navigate inside the editor: page hrefs swap the active
   *  artboard, in-page anchors stay put, allow-listed external hrefs open
   *  in a new tab. Returns true when the href was handled, false when it
   *  was unrecognised or rejected. Forward-declared on ctx because the
   *  nav-link builder needs it but the impl (which walks state.pages via
   *  findPageByHref) stays inline in canvas-client.ts until a later phase
   *  extracts the page-resolver cluster. */
  goToHrefOnCanvas(href: string): boolean;
  /** Swap the active artboard to the named page. Forward-declared on ctx
   *  because the action-element alt-click handler needs it but the impl
   *  stays inline in canvas-client.ts until a later phase extracts the
   *  page-routing cluster (it mutates activePageId + re-renders + nudges
   *  the camera). */
  setActivePage(pageId: string): void;

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
    /** Unique id mirroring the op-preview SSE event's `id` field — the LLM
     *  tool_call id the orchestrator minted for this proposal. Used by the
     *  ghost-preview layer to associate a suggestion entry with its ghost
     *  section in ctx.ghostSections so accept/reject/revert can find and
     *  remove the right ghost. Optional because pre-ghost-preview code paths
     *  may not have set it. */
    suggestionId?: string;
    /** Snapshot of the ghost-section blueprint for this entry (only set when
     *  the op was insertSection / designSection / duplicateSection AND the
     *  server shipped a previewSection). On Revert success the blueprint is
     *  pushed back into ctx.ghostSections so the proposal preview reappears
     *  while the entry returns to status="pending". On Accept / Reject the
     *  ghost is removed but the blueprint stays on the entry — Revert needs
     *  it. */
    ghostBlueprint?: {
      id: string;
      pageId: string;
      afterSectionId: string | null;
      section: CanvasSection;
    };
  }>;
  /** Transient ghost-preview store — one entry per pending additive section
   *  op (insertSection, designSection, duplicateSection) the agent proposed.
   *  Editor-only, NOT shared via Yjs — each Owner sees only their own ghosts
   *  so co-editors are not distracted by half-baked proposals. renderAllImpl
   *  weaves these into the canvas between real sections at lower opacity;
   *  chat-session.ts owns push/remove on op-preview / Reject / Revert.
   *  Accept clears via renderAll after the real apply replaces the ghost
   *  slot with a real section. */
  ghostSections: Array<{
    /** Mirrors pendingAiSuggestions[i].suggestionId — the originating
     *  op-preview event id. Used to find-and-remove on accept/reject/revert. */
    id: string;
    /** Concrete target page id resolved from the op using applyCanvasAgentOp's
     *  insertion precedence: explicit pageId, afterSectionId's page, then the
     *  first page. The ghost renders only on this page. */
    pageId: string;
    /** afterSectionId from the op. null = append to the end of the page body; a
     *  non-existent id is rejected before the ghost enters this store. */
    afterSectionId: string | null;
    /** Resolved section to render dimmed. Carries its own (synthetic) id;
     *  if the op is later accepted, the real apply mints a different id. */
    section: CanvasSection;
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
  // openTextModal + openSelectModal moved to the Phase 2q.a modal cluster section below.
  // sectionsCatalog moved to the Phase 2q.i sections picker section below.

  // -- Phase 2p.a: session-expired / access-revoked lifecycle ------------
  /** Latched true the first time authFetch sees a 401 from /api/*. Locks
   *  every mutating control (save / AI / publish), status-flashes the
   *  "session expired" message, and schedules a 1.5s page reload so
   *  Clerk's handshake fires fresh on the next load. Read by save / AI /
   *  publish guards so a 401 mid-flight short-circuits the in-progress
   *  side-effect (the cluster-of-controls is already disabled; the guard
   *  also suppresses the redundant "Save failed: session expired" status
   *  flash that would otherwise stomp the lifecycle message).
   *  Pinned as a forward-decl from the Phase 2n breadcrumbs; implemented
   *  in session-lifecycle.ts. */
  sessionExpired: boolean;
  /** Latched true the first time authFetch sees a 403 from /api/*. Same
   *  control-lock as sessionExpired but no auto-reload — the user's
   *  Clerk session is still valid for other sites, so a reload would just
   *  put them on the same editor with another 403. Surfaces the access-
   *  removed modal instead so the Owner can navigate away on their own
   *  terms. Read by the same save / AI / publish guards as sessionExpired.
   *  Pinned as a forward-decl from the Phase 2n breadcrumbs; implemented
   *  in session-lifecycle.ts. */
  accessRevoked: boolean;
  /** Mirrors ctx.saveButton.disabled. Or-ed against sessionExpired /
   *  accessRevoked inside setSaveBusy so once either latch flips on, the
   *  save button stays disabled regardless of subsequent setSaveBusy(false)
   *  calls. Module-private writer; no other call site reads the flag. */
  saveBusy: boolean;
  /** Toolbar Save button, cached at boot. setSaveBusy mirrors its
   *  disabled state from ctx.saveBusy; the click handler in canvas-
   *  client.ts (and, post-cutover, in createEditor) calls saveStateNow.
   *  Null when the route omits the button — every read site null-checks
   *  rather than asserting mount completion. Forward-declared here so
   *  session-lifecycle can disable it on 401/403; the click-wiring stays
   *  inline until createEditor lands. */
  saveButton: HTMLElement | null;
  /** Toolbar Publish button, cached at boot. handleSessionExpired and
   *  handleAccessRevoked disable it directly (not through a setter)
   *  because the only other writer is the publish path itself toggling
   *  in-flight state. Null when the route omits the button.
   *  Forward-declared here for the same reason as saveButton. */
  publishButton: HTMLButtonElement | null;

  // -- Phase 2p.b: co-edit / presence integration ------------------------
  /** Tracks whether the underlying WebSocket is currently OPEN. The
   *  websocketFactory's open/close/error handlers maintain it, and
   *  coEditSync reads it as the return value so the persist cluster can
   *  surface "Synced" vs "Co-edit disconnected" status lines. False at
   *  boot and during every reconnect window. */
  coEditSocketOpen: boolean;
  /** Local editor identity for the awareness pill + remote cursor labels.
   *  Resolved once at attachCoEdit time via loadPresenceIdentity (which
   *  consults ctx.presenceDisplayName, localStorage, and a uuid-prefix
   *  fallback in that order). Null before attach runs; null when the
   *  co-edit bundle global is missing and attachCoEdit short-circuited. */
  localPresence: { name: string; color: string } | null;
  /** The document.body-attached `.opencanvas-presence-layer` div that
   *  holds every remote caret + label. Lazily created by
   *  ensurePresenceLayer on the first remote presence event. Null before
   *  the layer mounts so callers don't have to assert presence; every
   *  read site short-circuits on null. */
  presenceLayer: HTMLElement | null;
  /** Live map of Yjs clientID → rendered cursor entry. onRemotePresence
   *  diffs the active peer set against this map: missing peers gain new
   *  caret + label DOM nodes appended to presenceLayer; departed peers
   *  have their nodes removed and the entry deleted. Initialised as an
   *  empty Map at boot (createEditor); no extracted module assumes the
   *  map carries entries before attachCoEdit fires its first
   *  onRemotePresence callback. */
  remoteCursors: Map<number, RemoteCursorEntry>;
  /** Authoritative count of remote awareness peers, refreshed inside
   *  onRemotePresence. The pointer-publish + selectionchange-publish
   *  paths consult this to suppress outbound updates when nobody else
   *  can see the cursor — local self renders straight from
   *  window.mousemove, not from awareness, so the skip is invisible to
   *  the operator and saves a billable DO request per cursor tick. */
  remotePeerCount: number;
  /** Last viewport-relative pointer position in world coordinates,
   *  refreshed every mousemove by handleViewportMousemove. publishPointer
   *  reads this when assembling the outbound presence payload so peers
   *  see the cursor track across the canvas in real-time. Null before
   *  the first mousemove, and null when the pointer leaves the viewport. */
  lastWorldPoint: { x: number; y: number } | null;
  /** True while a pointer-publish is scheduled but not yet flushed.
   *  schedulePointer reads this as a re-entry guard so a mousemove burst
   *  collapses into one publish per POINTER_PUBLISH_INTERVAL_MS window. */
  pointerPublishPending: boolean;
  /** Handle for the pointer-publish setTimeout. flushPointer clears it
   *  when the throttle window elapses; no other call site reads it (the
   *  field exists only so a future flushPointer could pre-empt its own
   *  timer if needed). */
  pointerPublishTimerId: ReturnType<typeof setTimeout> | null;
  /** Date.now() of the last pointer publish that went out. schedulePointer
   *  reads this to compute the throttle delay (full-interval at boot,
   *  shrinking as time-since-last-publish grows). */
  pointerPublishLastAtMs: number;
  /** Same role as pointerPublishPending but for the selectionchange-driven
   *  presence-publish loop. schedulePublishLocalPresence reads it as a
   *  re-entry guard. */
  presencePublishPending: boolean;
  /** Same role as pointerPublishLastAtMs but for the selectionchange-driven
   *  presence-publish loop. */
  presencePublishLastAtMs: number;
  /** Boot-time entry to the co-edit cluster. Reads ctx.siteId + ctx.state
   *  + ctx.wsToken, opens the WebSocket via window.__opencanvasCoEdit
   *  with a custom websocketFactory that drives the reconnect-counter UI
   *  (status line + give-up threshold + destroy on cap), wires
   *  onRemoteState (replace ctx.state + render) and onRemotePresence
   *  (refresh the presence pill + diff the remoteCursors set), and
   *  assigns the connection to ctx.coEditConnection. Also binds
   *  ctx.repaintRemoteCursors at the moment the connection attaches so
   *  the camera module's typeof-check picks up the live function from
   *  the first camera transform onwards. No-op when the co-edit bundle
   *  global is missing (smoke / kill-switch). Bound impl lives in
   *  co-edit.ts (attachCoEditImpl); exposed on ctx because the boot
   *  sequence in canvas-client.ts (and, post-cutover, in createEditor)
   *  needs a ctx-method reference, not a re-import. */
  attachCoEdit(): void;

  // -- Phase 2p.b: forward declarations ----------------------------------
  /** WebSocket token issued by the editor route for published-site
   *  collaborators; the editor host appends it to the /__live URL so the
   *  Durable Object can authorize anonymous edit-token sessions without
   *  re-running the Clerk handshake. Empty string for Owner sessions
   *  (Clerk cookie does the auth). Filled from EditorBoot at Phase 3 boot. */
  wsToken: string;
  /** Server-injected customer display name / email (resolved by the
   *  editor route from the customer row tied to the current Clerk
   *  session or invite acceptance). loadPresenceIdentity prefers this
   *  over localStorage and the uuid-prefix fallback so the presence pill
   *  reads as the operator's real identity rather than an opaque id.
   *  Empty string for sessions without a resolvable display name. Filled
   *  from EditorBoot at Phase 3 boot. */
  presenceDisplayName: string;
  /** Stable user identity (Clerk user id) used to dedupe presence in the
   *  "N editing" pill so opening the same site in two tabs reads as
   *  "1 editing", not "2". Empty string for sessions without a Clerk
   *  identity (edit-token / unauthenticated). Filled from EditorBoot at
   *  Phase 3 boot. */
  presenceUserId: string;
  /** Deep clone of the InlineRun[] taken when text editing started;
   *  Escape/Cancel restores from this. onRemoteState clears it alongside
   *  editingElementId when the active element vanishes. The text-editing
   *  cluster (later phase) owns the full implementation; declared here
   *  as `unknown` because co-edit only nulls the field and the actual
   *  InlineRun[] type ships with the editing cluster. */
  editingSnapshot: InlineRun[] | null;
  /** Commit-and-cleanup callback for the active inline text edit. Set by
   *  beginTextEditImpl to `() => finish(true)`; cleared by finish itself.
   *  rebuildElementImpl invokes this when a rebuild fires for the
   *  currently-editing element id, so the Owner's typing is serialised
   *  before the wrapper is replaced (the old inner's listeners would
   *  otherwise vanish with the GC'd node). */
  activeEditFinish: (() => void) | null;

  // -- Phase 2q.a: modal cluster -----------------------------------------
  /** Hard sync gate: every opener throws synchronously if this is true,
   *  and resets it to false in its close() path. Callers serialise modals
   *  themselves (e.g. saveToLibrary chains name → description → visibility
   *  through three sequential awaits) — no implicit queueing. The inline
   *  twin keeps modalOpen as a closure-local `let`; here it lives on ctx
   *  so the extracted openers + the inline mark-toolbar blur handler
   *  (canvas-client.ts:10290) read the same flag. Initialised false at
   *  boot. */
  modalOpen: boolean;
  /** Open the single- or multi-line text prompt. Resolves to the entered
   *  string on OK/Enter (Ctrl/Cmd+Enter when multiline) or null on
   *  Cancel/Escape/backdrop click. Throws synchronously if ctx.modalOpen
   *  is already true — callers must serialise. Bound impl lives in
   *  modals.ts (openTextModalImpl). */
  openTextModal(opts: TextModalOpts): Promise<string | null>;
  /** Open the single-pick dropdown. Resolves to the chosen value on
   *  OK/Enter or null on Cancel/Escape. Throws synchronously if
   *  ctx.modalOpen is already true. Bound impl lives in modals.ts
   *  (openSelectModalImpl). */
  openSelectModal(opts: SelectModalOpts): Promise<string | null>;
  /** Open the OK/Cancel confirm modal and resolve with the user's
   *  choice. Throws synchronously if another modal is already open —
   *  callers must serialise modals themselves, no implicit queueing.
   *  Bound impl lives in modals.ts (openConfirmModalImpl). */
  openConfirmModal(opts: ConfirmModalOpts): Promise<boolean>;
  /** Open the single-button OK acknowledgement (role="alertdialog"). Both
   *  OK/Enter and Escape close. Resolves to void. Throws synchronously if
   *  ctx.modalOpen is already true. Bound impl lives in modals.ts
   *  (openAlertModalImpl). */
  openAlertModal(opts: AlertModalOpts): Promise<void>;
  /** Open the AI media modal — prompt textarea + aspect-ratio radio row +
   *  4-up preview gallery. The supplied requestFn is invoked four times
   *  in parallel on click; picking a tile resolves with {blob, mediaType,
   *  aspectRatio, prompt}. Cancel resolves with null. Tile object URLs
   *  are revoked in the close() path; the chosen blob is handed back as
   *  a Blob (not a URL) so the caller creates and owns its own preview
   *  URL. Throws synchronously if ctx.modalOpen is already true or if
   *  opts.requestFn is missing. Bound impl lives in modals.ts
   *  (openAiMediaModalImpl). */
  openAiMediaModal(opts: AiMediaModalOpts): Promise<AiMediaModalResult | null>;
  /** Open the "+ New Page" capture modal (ADR 0034) — title, slug, and
   *  locale up front so the new page lands fully-formed. Slug
   *  auto-derives from title and freezes on first manual slug edit
   *  (re-arms on slug clear). Reserved-slug pre-validation blocks
   *  _404/404; duplicate-slug pre-validation blocks slugs in
   *  opts.existingSlugs. Resolves to {title, slug, locale} on submit or
   *  null on cancel. Throws synchronously if ctx.modalOpen is already
   *  true. Bound impl lives in modals.ts (openNewPageModalImpl). */
  openNewPageModal(opts: NewPageModalOpts): Promise<NewPageModalResult | null>;

  // -- Phase 2q.h: asset reel + section drag -----------------------------
  /** Reel tile-vs-list layout selector. "tile" renders 288px-wide thumbnail
   *  cards stacked vertically with their recipe label underneath; "list"
   *  renders a 64px-wide thumbnail strip with a name/recipe info column to
   *  the right. The Tile/List header buttons in mountReel toggle this and
   *  re-render. beginReelDrag also reads it to size the drag ghost (200px
   *  in tile mode, 64px in list mode). Default "tile" at boot. */
  reelViewMode: 'tile' | 'list';
  /** Open the film-reel overlay (sets ctx.isReelOpen=true, clears the
   *  element selection because reel + element selection are mutually
   *  exclusive UI modes, re-renders). attachGripHandlers calls this on
   *  drag-start so the reel reveals as the section lifts; the reel "+"
   *  affordance and click-to-toggle paths also drive this. Bound at boot
   *  to `openReelImpl(ctx)`. */
  openReel(): void;
  /** Re-order the section at `fromIdx` to land at `toIdx` in the current
   *  page's sections array. No-op when fromIdx equals toIdx or toIdx is
   *  the adjacent +1 slot (which would be a no-move). Pinned sections
   *  refuse to move. Bound to the reel/canvas drop path; the section
   *  inspector's "move up/down" buttons share the same impl. */
  moveSectionToIndex(fromIdx: number, toIdx: number): void;
  /** Start the canvas-side section drag gesture. Builds a 200px-wide
   *  ghost following the pointer, a drop-line indicating the insertion
   *  point (canvas or reel), and commits on mouseup. Called from
   *  attachGripHandlers after the 5px movement threshold trips. */
  beginSectionDrag(sectionId: string, startEv: MouseEvent): void;

  // -- Phase 2q.c: page CRUD + page-crumb popover ------------------------
  /** Live page-switcher popover anchored to the breadcrumb chip, or null
   *  when no popover is mounted. Open/close are toggles — calling open
   *  while non-null closes; calling close while null is a no-op. The
   *  field is mutated by openPageCrumbMenu / closePageCrumbMenu in
   *  page-crud.ts. */
  pageCrumbMenu: HTMLElement | null;
  /** Cached outside-click handler for the page-crumb popover. Stored on
   *  ctx because addEventListener('mousedown', ...) and the matching
   *  removeEventListener MUST receive the same reference; re-deriving the
   *  handler per open would leak listeners across reopens. Lazily seeded
   *  on the first open and reused for the rest of the editor session. */
  pageCrumbOutsideHandler: ((ev: Event) => void) | null;
  /** Cached Escape-key handler for the page-crumb popover. Same listener-
   *  identity requirement as pageCrumbOutsideHandler. */
  pageCrumbKeyHandler: ((ev: Event) => void) | null;
  /** Drive editor selection state for the active page. Clears the current
   *  section + element selection, re-renders inspector + reel, toggles the
   *  data-active attribute on every artboard wrapper, and refreshes the
   *  breadcrumb label. Passing null is currently unused but accepted —
   *  matches the inline twin's signature. */
  setActivePage(pageId: string | null): void;
  /** Refresh the [data-page-crumb-label] DOM text from
   *  ctx.currentPage().title / .slug, or "page" when neither is set.
   *  Idempotent — no-op when the label DOM ref is missing. */
  refreshPageCrumb(): void;
  /** Resolve a string href (e.g. "/about", "/about#hero", "about") to a
   *  CanvasPage in the current state. Returns null when the href is not
   *  internal (scheme:, "#fragment", external URL) or no page slug
   *  matches the path. Strips query + fragment so an Owner-stored
   *  "/about#hero" still resolves to the about page. */
  findPageByHref(href: unknown): CanvasPage | null;
  /** Drive editor navigation from a clicked link: internal pages switch
   *  the active artboard, external/mailto/tel open in a new tab, anchors
   *  no-op. Returns true when something was handled, false when the URL
   *  allowlist rejected the href — callers surface a status line on false. */
  goToHrefOnCanvas(href: unknown): boolean;
  /** Open the create-page modal, push the resulting page with a blank
   *  starter section, capture undo, activate the new page, fit the
   *  viewport to it, schedule a save. No-op when state is null or the
   *  modal is cancelled. */
  createPage(): Promise<void>;
  /** Prompt for a new title, derive a slug (rejects "_404"/"404",
   *  reserved for the dedicated custom-404 flow), dedupe slugs by
   *  appending -2/-3/..., capture undo, re-render, schedule a save.
   *  No-op when state is null, page is missing, or the prompt is empty. */
  renamePage(pageId: string): Promise<void>;
  /** Refuse when the page is the last one or when any action element
   *  links to it; otherwise confirm via openConfirmModal, splice it out,
   *  capture undo, re-render, fit viewport, schedule a save. The inbound-
   *  link guard is hard NO-DELETE — there is no rewrite-references
   *  fallback; the Owner must repoint the action(s) first. */
  deletePage(pageId: string): Promise<void>;
  /** Bring the named page into the viewport at the current zoom with a
   *  64px inset against viewport-left. Falls through to fitToPage when
   *  the page is wider than the viewport at the current zoom. Bound impl
   *  lives in render.ts. Wired here so explicit-navigation call sites
   *  (link-popover "Go to page", alt+click action with page-href, page
   *  sidebar / breadcrumb, collection scaffold) can opt into pan without
   *  re-importing render. setActivePage no longer pans on its own —
   *  element clicks that activate a page should NOT move the camera. */
  panToPage(pageId: string | null): void;
  /** Center the named page in the viewport and auto-zoom up to
   *  ZOOM_MAX_FIT (100%). Defaults pageId to the active page. Bound impl
   *  lives in render.ts (Phase 2l). Forward-declared here so the page
   *  CRUD cluster can fit-on-create without re-importing render. */
  fitToPage(pageId: string | null): void;
  /** Center the bounding box of all artboards in the viewport and
   *  auto-zoom up to ZOOM_MAX_FIT (100%). Bound impl lives in render.ts.
   *  Forward-declared here so deletePage can re-fit after a page exits. */
  fitAllPages(): void;

  // -- Phase 2q.f: AI preview panel (single-shot) ------------------------
  /** The live AI-preview <aside> mounted onto document.body while a
   *  single-shot AI request is awaiting Accept/Dismiss. Null when no
   *  preview is open. buildAiPanel sets it; closeAiPanel detaches the
   *  node and clears the field. Distinct from the chat-driven suggestion
   *  cluster — this is the older preview panel surfaced from inspector
   *  "AI rewrite" / "Replace media" / "Generate with AI" buttons. */
  aiPanel: HTMLElement | null;
  /** Detach the AI preview <aside> (if mounted) and release ctx.aiBusy.
   *  Every exit path through applyPreview / runAiPreview / dismiss must
   *  end here — otherwise [data-ai-button] elements stay disabled and
   *  the Owner sees a frozen editor after the first failed apply. */
  closeAiPanel(): void;
  /** POST the Owner prompt to /canvas-agent/sites/<id>/preview, build
   *  the AI panel from the response, and surface Accept / Dismiss. Sets
   *  aiBusy=true on entry; clears it (or hands it to closeAiPanel) on
   *  every exit. Surfaces server errors via an alert modal AND the
   *  status line so the Owner can't miss them. */
  runAiPreview(prompt: string): Promise<void>;
  /** Inspector "AI rewrite" handler — prompts the Owner for a brief,
   *  builds the rewriteText prompt, and routes through runAiPreview.
   *  No-op when ctx.aiBusy is true so AI buttons can't stack. Null
   *  brief (Escape / empty) returns silently — no preview is requested. */
  aiRewriteText(elementId: string): Promise<void>;
  /** Inspector "Replace media" handler — opens the 4-up AI media modal,
   *  uploads the selected blob via uploadGeneratedBlobToElement, and
   *  flashes Applied / Apply failed in the status line. Image-only;
   *  refuses video elements loudly via the status line. Bypasses the
   *  preview panel entirely — picking a tile IS the apply. */
  aiReplaceMedia(elementId: string): Promise<void>;
  /** Migrate a server-returned EditableSite into the editor's current
   *  schema shape. applyPreview pipes the /apply response through this
   *  before assigning to ctx.state. FORWARD: kept inline at this phase;
   *  state-migration.ts already owns the impl, the inline-vs-ctx wiring
   *  lands at Phase 3 cutover. Inline twin at canvas-client.ts:541. */
  migrateState(s: EditableSite): EditableSite;
  /** Upload a generated image blob to /owner/assets, rewrite the
   *  element's assetId/mediaKind/alt in place, then rebuildElement +
   *  renderInspector + scheduleSave. aiReplaceMedia hands it the tile
   *  the Owner picked from the 4-up modal. FORWARD: kept inline at this
   *  phase. Inline twin at canvas-client.ts:7876. */
  uploadGeneratedBlobToElement(
    element: MediaElement,
    blob: Blob,
    mediaType: string,
    altValue: string,
  ): Promise<void>;

  // -- Phase 2q.g: link popover + mark toolbar + text editing ------------
  /** Floating inline mark toolbar — singleton DOM node appended to
   *  document.body while a text element is in edit mode. Set by
   *  buildMarkToolbar, cleared by removeMarkToolbar. The
   *  onMarkToolbarReflow listener gates its position update on this being
   *  live so scroll/resize events outside an edit session no-op. */
  markToolbar: HTMLElement | null;
  /** The wrapper element the mark toolbar is positioned against. The
   *  reflow listeners (window scroll/resize) read this to re-pin the
   *  toolbar on scroll; null short-circuits the reflow path. */
  markToolbarAnchor: HTMLElement | null;
  /** Floating link popover — singleton DOM node appended to document.body
   *  while a link is hovered or pinned. Mutated by showLinkPopover /
   *  removeLinkPopover. */
  linkPopover: HTMLElement | null;
  /** The anchor element the link popover is positioned against. The
   *  reflow listeners (window scroll/resize) read this to re-pin the
   *  popover on scroll; null short-circuits the reflow path. */
  linkPopoverAnchor: HTMLElement | null;
  /** Debounce handle for the link-popover show delay (150ms). Set by
   *  hover-enter, cleared by hover-leave / removeLinkPopover. Null when
   *  no show is pending. */
  linkPopoverShowTimer: ReturnType<typeof setTimeout> | null;
  /** Debounce handle for the link-popover hide grace window (200ms). Set
   *  by hover-leave on non-pinned popovers, cleared by hover-enter /
   *  removeLinkPopover. Null when no hide is pending. */
  linkPopoverHideTimer: ReturnType<typeof setTimeout> | null;

  /** Re-render the toolbar font-size <select> from the current selection's
   *  ancestor font-size. Called by the selectionchange handler so the
   *  picker tracks the caret. No-op when the toolbar isn't mounted. */
  refreshMarkToolbarFontSizeState(): void;
  /** Build the inline mark toolbar above the given anchor (the text
   *  element wrapper). Replaces any toolbar already in the DOM via
   *  removeMarkToolbar before constructing. */
  buildMarkToolbar(anchor: HTMLElement): void;
  /** Apply (or toggle) a mark across the current Selection. Bold/italic/
   *  underline route through execCommand; strike/code/highlight route
   *  through the serialize → toggle → rebuild path; link opens the link
   *  modal. */
  applyMark(type: InlineMarkType): void;
  /** Flip a text element into contenteditable mode and wire its
   *  blur/keydown/paste/mouseover/mouseout/mousedown event handlers + the
   *  document-level selectionchange handler. No-op when the element id
   *  doesn't resolve or isn't a text element.
   *
   *  `clickedWrapper` is the specific `.opencanvas-element` DOM node the
   *  click handler resolved at the pointer. Load-bearing for site-pinned
   *  sections (header/footer): the same element id renders once per
   *  artboard, so without the wrapper the contenteditable + mark toolbar
   *  pin to page 1 regardless of which page the Owner actually clicked.
   *  Optional so non-click callers (sidebar select-then-edit) still work
   *  via the helper's artboard-scoped fallback. */
  beginTextEdit(elementId: string, clickedWrapper?: HTMLElement | null): void;

  // -- Forward declarations consumed by the Phase 2q.g extraction --------
  // These functions stay inline in canvas-client.ts during Phase 2; the
  // extracted modules invoke them through ctx so the call shape is
  // mechanical (s/<closure-var>/ctx.<closure-var>/g). Implementations
  // move into their own sibling modules in later phases.

  /** Force the inspector panel out of collapsed / hidden state so the
   *  newly-selected element's inspector is visible. Inline twin:
   *  canvas-client.ts:8004. */
  forceOpenInspector(): void;
  /** Build the live DOM node for a single InlineRun. Wrap order follows
   *  CANONICAL_MARK_ORDER. Inline twin: canvas-client.ts:2720. */
  buildRunNode(run: InlineRun): HTMLElement;
  /** Deep-equality on two mark arrays. Used by the serialize→mutate→
   *  rebuild path to merge adjacent identical-mark runs. Inline twin:
   *  canvas-client.ts:8739. */
  marksEqual(a: InlineMark[], b: InlineMark[]): boolean;
  /** Concatenate run.text across a content array. Used by the commit
   *  path to enforce the "concatenated plain text must not be empty"
   *  rule client-side. Inline twin: canvas-client.ts:8835. */
  plainTextOf(content: InlineRun[]): string;
  /** Re-render KaTeX inside the given subtree. Called by the paste
   *  handler so pasted math spans render immediately. Inline twin:
   *  canvas-client.ts:12261. */
  renderMathInScope(scope: HTMLElement): void;
  /** Normalise pasted HTML through the editor's canonical mark tag set
   *  so the serializer sees the tags it knows. Inline twin:
   *  canvas-client.ts:12353. */
  normalizePastedHtml(html: string): string;
  /** Build an HTML fragment string from a plain-text paste payload —
   *  promotes embedded LaTeX delimiters and double-newline breaks.
   *  Inline twin: canvas-client.ts:12282. */
  plainTextToFragmentHtml(plain: string): string;
  /** Begin a drag on the given wrapper element. The mark toolbar's
   *  drag handle calls this so the Owner can move a text element
   *  without leaving edit mode. Inline twin: canvas-client.ts:11327. */
  beginDrag(startEv: MouseEvent, wrapper: HTMLElement): void;
  /** Open the link-editing modal and resolve with the edited href /
   *  target — or null on cancel. Throws synchronously when another modal
   *  is already open (modalOpen=true). Inline twin: canvas-client.ts:9301. */
  openLinkModal(opts: {
    linkText?: string;
    href?: string;
    blank?: boolean;
    focusAfterClose?: HTMLElement | null;
  }): Promise<{ href: string; target?: '_blank' } | null>;

  // -- Phase 2q.i: sections picker + sidebar wiring ----------------------
  /** Cross-template Sections-picker catalog. Three-state sentinel:
   *  - `null` = unloaded (the picker fetches on first sidebar-tab open
   *    and memoises the result here).
   *  - `[]` = loaded-empty (the picker shows "No sections match.").
   *  - `[...]` = loaded with entries.
   *  ensureSectionsPanelLoaded reads + writes; saveAsLibrarySection
   *  (kept inline) resets to `null` after a successful save so the next
   *  panel open re-fetches and surfaces the new entry. */
  sectionsCatalog: SectionsCatalogEntry[] | null;
  /** ADR 0061 Decision 11 — sections-picker category filter ("all" or
   *  one of SECTION_CATEGORIES: header / hero / features / testimonials
   *  / cta / gallery / footer / other). Mirrored from the
   *  <select data-section-picker-filter> control; renderSectionsPickerGrid
   *  reads it to filter the catalog. Defaults to "all" at boot. Replaces
   *  the pre-Phase-E `activeTemplateFilter` (source-based) gate. */
  activeCategoryFilter: string;
  /** Sections-picker search box value. Mirrored from the
   *  <input data-section-picker-search> control; renderSectionsPickerGrid
   *  reads it (case-insensitive substring) to filter the catalog.
   *  Defaults to "" at boot. */
  activeSearchQuery: string;
  /** ADR 0061 Decision 11 — sections-picker sort mode toggle:
   *  - `'a-z'` (default): alphabetical by entry.name.
   *  - `'recent'`: by entry.createdAt DESC (DB rows first, seed rows
   *    after the 1970 sentinel). */
  activeSortMode: 'a-z' | 'recent';
  /** Re-render the Sections-picker panel (controls shell on first call,
   *  grid-only on subsequent calls so the search input keeps focus).
   *  Bound impl lives in sections-picker.ts (renderSectionsPanelImpl);
   *  exposed on ctx because importPendingSectionAt re-renders after
   *  swapping state. */
  renderSectionsPanel(): void;
  /** Stash the pending import target, surface the "click a slot" prompt,
   *  and re-render the picker grid + canvas drop slots. Bound impl lives
   *  in sections-picker.ts (enterPlacementModeImpl). */
  enterPlacementMode(target: PendingImport): void;
  /** Commit the pending import at the given inter-section index. POSTs
   *  /sites/<id>/sections/import with library or seed coordinates, then
   *  swaps ctx.state for the response's editableState (migrated), clears
   *  selection, and re-renders. Bound impl lives in sections-picker.ts. */
  importPendingSectionAt(insertAt: number): Promise<void>;
  /** The left sidebar container (`#canvas-sidebar`), cached at boot.
   *  Null when the route omits it; attachSidebarActions short-circuits
   *  on null. */
  sidebar: HTMLElement | null;
  /** Switch the active sidebar tab by data-sidebar-tab name. Toggles the
   *  .active class on every tab button + flips panel hidden flags, then
   *  kicks the tab-specific bootstrap (ensureSectionsPanelLoaded for
   *  "sections", renderVersionsPanel for "versions",
   *  updatePageSidebar for "pages"). Implementation stays inline in
   *  canvas-client.ts during Phase 2; sidebar.ts attachSidebarTabs
   *  invokes it through ctx so the tab handler list stays mechanical. */
  activateSidebarTab(tabName: string): void;
  /** Wire click handlers on the static sidebar tabs. Bound impl lives
   *  in sidebar.ts (attachSidebarTabs). Exposed on ctx for the Phase 3
   *  createEditor wiring to call symmetrically with the other
   *  attach*-style boot helpers. */
  attachSidebarTabs(): void;
  /** Wire click handlers on the static sidebar action buttons (add
   *  section, add component, style kit) + the inspector's section-
   *  action delegation. Bound impl lives in sidebar.ts
   *  (attachSidebarActions). */
  attachSidebarActions(): void;
  /** Apply a style kit visually first (mirror onto ctx.mainEl +
   *  re-render the inspector), then persist in the background. Rolls
   *  back to the previous kit on POST failure so the UI never lies
   *  about what's saved. Bound impl lives in sidebar.ts
   *  (applySidebarStyleKit). */
  applySidebarStyleKit(kit: string | null, buttons: NodeListOf<Element>): Promise<void>;
  /** Inspector summary card that reads computed CSS off ctx.mainEl so
   *  it stays in sync with whatever style-kits.ts emits at runtime.
   *  Bound impl lives in sidebar.ts (buildKitSummary). */
  buildKitSummary(): HTMLElement;

  // -- Phase 2q.j: publish + version pill + save wiring + versions panel
  /** The "v3 / Draft" pill in the editor header that doubles as a popover
   *  trigger for the social-preview card. Cached at boot from
   *  `getElementById("canvas-version")`; null when the route omits the
   *  affordance. publishSite + updateVersionBadge no-op on null. */
  versionBadge: HTMLElement | null;
  /** Live version-pill popover DOM node, mounted under document.body
   *  while the social-preview card is open. Null when closed.
   *  openVersionPill mutates this; closeVersionPill removes it from the
   *  DOM and resets to null. */
  versionPill: HTMLElement | null;
  /** Outside-mousedown listener identity for the version pill. Stored on
   *  ctx so openVersionPill (addEventListener) and closeVersionPill
   *  (removeEventListener) reference the SAME function. */
  versionPillOutsideHandler: ((ev: MouseEvent) => void) | null;
  /** Escape-key listener identity for the version pill. Same pattern as
   *  versionPillOutsideHandler. */
  versionPillKeyHandler: ((ev: KeyboardEvent) => void) | null;
  /** The "Save as template" button in the editor header (Owner-only).
   *  Cached at boot from `getElementById("canvas-save-template")`. Null
   *  when the route omits it. attachSaveButton only wires the click
   *  handler when both this and saveSiteAsTemplate are present. */
  saveTemplateButton: HTMLElement | null;
  /** True once the versions list has been fetched in the current session.
   *  renderVersionsPanel branches on this — first call kicks the GET +
   *  renders a "Loading..." placeholder; subsequent calls render directly
   *  from versionsList. publishSite + snapshot save/delete reset to false
   *  so the next render re-fetches. */
  versionsLoaded: boolean;
  /** In-memory list of snapshots for the Versions sidebar tab. Populated
   *  by renderVersionsPanel's first-load GET. Shape mirrors the server's
   *  /sites/<id>/snapshots response item — `unknown[]` on ctx so the
   *  extracted module can render fields it knows are present without
   *  forcing a schema declaration here. */
  versionsList: unknown[];
  /** Return true when the keydown target is a control that owns the
   *  keystroke (input/textarea/select/button or a contentEditable
   *  subtree). attachSaveButton's keydown uses this to suppress canvas
   *  shortcuts while the Owner is typing. Bound impl lives inline. */
  isEditableShortcutTarget(target: EventTarget | null): boolean;
  /** Delete a single element from its parent section. attachSaveButton's
   *  keydown calls this for the Delete/Backspace shortcut when an
   *  element is selected. Bound impl lives in inspector-actions.ts;
   *  ctx pins the call so the keyboard handler doesn't re-import. */
  deleteElement(
    section: import('../canvas/schema.js').CanvasSection,
    element: import('../canvas/schema.js').CanvasElement,
  ): void;
  /** Lazy-mount + populate the Sections sidebar tab (the sections-picker).
   *  activateSidebarTab calls this when the Owner clicks the Sections
   *  tab so the heavy template list only loads on demand. Bound impl
   *  lives in sections-picker.ts. */
  ensureSectionsPanelLoaded(): Promise<void> | void;
  /** Update the version-badge label + data-version attribute from the
   *  freshly-published version number. Falls back to "Draft" for 0 / non-
   *  finite values. Bound impl lives in publish.ts. */
  updateVersionBadge(version: number): void;
  /** Publish the current site to the live URL. Awaits flushPendingSave
   *  so the publish reflects the latest local state, then POSTs to
   *  /publish/sites/<id> and routes the response through the version
   *  pill update + post-publish "View live site" modal. Bound impl
   *  lives in publish.ts. */
  publishSite(): Promise<void>;
  /** Wire the publish-button click to publishSite. Idempotent — boot
   *  wires this once; safe to no-op when the button is missing. Bound
   *  impl lives in publish.ts. */
  attachPublishButton(): void;
  /** Close the version-pill social-preview popover. Removes the pill
   *  node + its outside/escape listeners and resets aria-expanded on the
   *  badge. Bound impl lives in version-pill.ts. */
  closeVersionPill(): void;
  /** Open the version-pill social-preview popover anchored under the
   *  version badge. Re-entrant — calling while open closes the existing
   *  pill (badge click toggles). Bound impl lives in version-pill.ts. */
  openVersionPill(): void;
  /** Wire the version-badge click to openVersionPill. Bound impl lives
   *  in version-pill.ts. */
  attachVersionBadge(): void;
  /** Wire the save-button + save-template-button clicks and the global
   *  window keydown/keyup/blur handlers for Ctrl+S / Ctrl+Z / Ctrl+Y /
   *  Space (temporary pan) / V (select) / Delete / 1 (fit page) / 0
   *  (fit all). Idempotent — boot calls once. Bound impl lives in
   *  save-wiring.ts. */
  attachSaveButton(): void;
  /** Lazy-mount the Versions tab button + panel onto the sidebar if it
   *  isn't there yet. Returns the panel element (or null when the
   *  sidebar isn't mounted). renderVersionsPanel calls this so the tab
   *  appears only on first render. Bound impl lives in versions-panel.ts. */
  ensureVersionsTabMounted(): HTMLElement | null;
  /** Render the Versions sidebar panel (snapshot list + Save snapshot
   *  button). First call kicks the GET + renders a "Loading..."
   *  placeholder; subsequent calls render synchronously from
   *  ctx.versionsList. Bound impl lives in versions-panel.ts. */
  renderVersionsPanel(): void;

  // -- Phase 2q.k: canvas root events -----------------------------------
  /** Wire the canvas root + viewport + document click/dblclick/mousedown
   *  listeners that drive selection state transitions: artboard label /
   *  inactive artboard activation, element menu trigger, section toolbar
   *  dispatch, element body click, section body click, background-click
   *  deselect, and the document-level click-outside deselect. Run once
   *  at boot. Implementation: attachRootEventsImpl in canvas-root-events.ts. */
  attachRootEvents(): void;

  // -- Text-inspector font-family picker --------------------------------
  /** Uploaded custom fonts for the active site, fetched once at boot via
   *  `GET /api/sites/:id/fonts`. Consumed by the text inspector's font-
   *  family picker (inspector-text-font-family.ts) for option building, and
   *  by the editor-side @font-face emitter (refreshEditorFontFaceStyleTag)
   *  so the picker's chosen face actually renders on the editor canvas.
   *  Empty array at boot; populated after the fetch resolves and after
   *  every successful upload + delete. */
  customFonts: EditorCustomFont[];
  /** Re-fetch the custom-font catalog and refresh the editor's @font-face
   *  <style> block. The boot path calls this once; the picker calls it
   *  after upload + delete so the dropdown + face declarations stay in
   *  sync without forcing a page reload. */
  refreshCustomFonts(): Promise<void>;
}

/**
 * Minimal `siteFont` shape the editor needs from the
 * GET /api/sites/:id/fonts response. Mirrors the row projection in
 * src/fonts/route.ts's LIST handler — only the fields the font-family
 * picker + @font-face emitter consume are declared so the editor bundle
 * does not drag the full Drizzle row type into its graph.
 */
export interface EditorCustomFont {
  id: string;
  name: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  contentHash: string;
  byteSize: number;
}

/**
 * One rendered remote peer's caret + label, plus the most recently
 * received cursor payload. The Phase 2p.b onRemotePresence handler
 * maintains the (clientID → entry) map; repaintRemoteCursorsImpl reads
 * it on every camera transform and viewport scroll to keep peer cursors
 * pinned to their world-space position.
 *
 * `cursor` is optional + nullable because the inline twin reads `entry.
 * cursor && entry.cursor.point` and treats both absent and null cursors
 * as "hide this peer's caret." `point` is the Figma-style free-floating
 * pointer; `{sectionId, elementId, offset}` is the text-caret anchor;
 * peers can ship either / both / neither and the renderer prefers point
 * when present.
 */
export interface RemoteCursorEntry {
  caret: HTMLElement;
  label: HTMLElement;
  cursor: {
    point?: { x: number; y: number };
    sectionId?: string;
    elementId?: string;
    offset?: number;
  } | null;
}

// ---------------------------------------------------------------------------
// ADR 0064 — narrow named-Pick contexts. Each alias names a cohesive
// cluster from the editor's runtime; modules sign their parameter as the
// intersection of the named views they touch instead of the wide
// `EditorContext`. `EditorContext` itself stays as the live shape that
// `createEditor` constructs — every named context is a view, not a
// separate runtime object. Renaming a field on `EditorContext` surfaces
// here as a compile error in the matching `Pick<…>` literal.
// ---------------------------------------------------------------------------

/** Read access to the loaded site + navigation helpers that walk it. */
export type StateContext = Pick<
  EditorContext,
  'state' | 'findElement' | 'findSection' | 'currentPage'
>;

/** Cached DOM refs the editor boot path captures and that downstream
 *  modules read for mount + measurement. Status DOM lives here too;
 *  `setStatus` is the verb in [[StatusEmitterContext]]. */
export type DomContext = Pick<
  EditorContext,
  | 'root'
  | 'inspector'
  | 'sidebar'
  | 'mainEl'
  | 'statusEl'
  | 'viewport'
  | 'saveButton'
  | 'publishButton'
  | 'versionBadge'
  | 'saveTemplateButton'
  | 'chatToggleBtn'
  | 'chatPanelEl'
  | 'chatCloseBtn'
  | 'chatSelectionEl'
  | 'chatSelectionTextEl'
  | 'chatSelectionClearBtn'
>;

/** Element / section selection state machine. */
export type SelectionContext = Pick<
  EditorContext,
  'selectedElementId' | 'selectedSectionId' | 'editingElementId' | 'selectElement' | 'selectSection'
>;

/** Re-render orchestrators. */
export type RenderContext = Pick<
  EditorContext,
  'renderAll' | 'renderInspector' | 'rebuildElement' | 'preserveInspectorScrollFor'
>;

/** Persistence — debounced save scheduler, undo capture, auth-wrapped
 *  fetch, and the boot-time identity fields the network calls reference. */
export type PersistContext = Pick<
  EditorContext,
  'scheduleSave' | 'captureForUndo' | 'authFetch' | 'apiBase' | 'siteId'
>;

/** Single-verb context for the status line. Touched by nearly every
 *  cluster, so it earns its own one-field alias rather than living
 *  inline at every call site. */
export type StatusEmitterContext = Pick<EditorContext, 'setStatus'>;
