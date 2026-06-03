// src/editor-client/editor-context.ts
//
// ADR 0058 — EditorContext is a 1:1 mirror of the IIFE closure surface
// of src/editor/canvas-client.ts. The interface starts empty here and
// grows commit-by-commit as Phase 2h+ extractions add the fields their
// modules touch.
//
// Read this file to see the migration's scoreboard: when the interface
// stops growing, the IIFE is fully decomposed.

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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- ADR 0058: interface is the migration scoreboard; grows as Phase 2h+ extractions land
export interface EditorContext {}
