// src/editor-client/editor-context.ts
//
// ADR 0058 — EditorContext is a 1:1 mirror of the IIFE closure surface
// of src/editor/canvas-client.ts. The interface starts empty here and
// grows commit-by-commit as Phase 2h+ extractions add the fields their
// modules touch.
//
// Read this file to see the migration's scoreboard: when the interface
// stops growing, the IIFE is fully decomposed.

import type { EditableSite, InlineRun } from '../canvas/schema.js';
import type { FindElementResult } from './editor-context-types.js';

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
   *  on the idempotence to avoid re-render storms. */
  selectElement(elementId: string): void;
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
   *  tone ("ok" / "error" / undefined). Auto-decorates trailing "…" with
   *  a spinner. Carousel upload UI calls this to mark in-progress and
   *  error states without re-rendering the inspector. */
  setStatus(text: string, tone?: 'ok' | 'error'): void;
}
