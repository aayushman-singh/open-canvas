// src/editor-client/editor-context.ts
//
// ADR 0058 — EditorContext is a 1:1 mirror of the IIFE closure surface
// of src/editor/canvas-client.ts. The interface starts empty here and
// grows commit-by-commit as Phase 2h+ extractions add the fields their
// modules touch.
//
// Read this file to see the migration's scoreboard: when the interface
// stops growing, the IIFE is fully decomposed.

import type { CanvasElement, CanvasSection } from '../canvas/schema.js';

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
 * Result shape of `findElement`. Mirrors the inline IIFE's
 * `findElementIn` return — the section that contains the element, the
 * element itself, the immediate parent array it lives in, plus parent-
 * kind/meta so callers can distinguish section-level vs nested (tab
 * panel / collection entry) parents.
 */
export interface FindElementResult {
  section: CanvasSection;
  element: CanvasElement;
  parentArray: CanvasElement[];
  parentKind: 'section' | 'tab-panel' | 'collection-entry';
  parentMeta:
    | null
    | { tabsElement: CanvasElement; tab: { elements: CanvasElement[] } }
    | { collectionElement: CanvasElement; entryIndex: number };
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
  // -- Phase 2h.1.a: inspector element-action cluster ---------------------
  /** Id of the selected positioned element, or null when nothing is
   *  selected. Read AND mutated by inspector verbs (duplicate sets it
   *  to the clone's id; delete clears it if it pointed at the removed
   *  element). */
  selectedElementId: string | null;
  /** Walk the loaded site (header → footer → current page sections) and
   *  return the section + element + immediate parent array for `elementId`,
   *  or null when the id is not present. Mirrors the inline
   *  `findElement` closure helper. */
  findElement(elementId: string): FindElementResult | null;
  /** Re-render the whole canvas + inspector. */
  renderAll(): void;
  /** Re-render only the inspector pane. */
  renderInspector(): void;
  /** Make `elementId` the active selection. No-op when already selected. */
  selectElement(elementId: string): void;
  /** Push the current state onto the undo stack (debounced). */
  captureForUndo(): void;
  /** Debounced persistence — POSTs the state to the editor save endpoint. */
  scheduleSave(): void;
  /** Close the per-element context menu if one is open. */
  closeElementMenu(): void;
}
