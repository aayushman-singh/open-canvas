// src/editor-client/save-wiring.ts
//
// ADR 0058 Phase 2q.j — save button + window keyboard shortcut wiring.
// canvas-client.ts:13527-13623 carries the inline twin. Retires on
// ADR 0015 Phase 3 atomic cutover; until then, the inline IIFE is the
// production source-of-truth and this module is dead code.
//
// One function:
//
//   - attachSaveButtonImpl(ctx) — boot-time wiring of three things:
//
//       1. The "Save" button click — flush the debounced HTTP save
//          timer then force an immediate saveStateNow.
//       2. The "Save as template" button click — only attached when
//          the Owner has the Save-as-template affordance; calls
//          ctx.saveSiteAsTemplate.
//       3. The window keydown / keyup / blur handlers for canvas
//          shortcuts:
//            - Escape: cancel pending-import placement-mode if active
//              (priority — must run before any other Escape handler).
//            - Ctrl/Cmd+Z: undo. Ctrl/Cmd+Y or Shift+Ctrl/Cmd+Z: redo.
//            - Ctrl/Cmd+S: force save (skip the 500ms debounce).
//            - Space (no modifiers, not editing): temporary pan mode.
//            - V (no modifiers, not editing): switch to select mode.
//            - Delete/Backspace (no modifiers, not editing): delete the
//              selected element OR the selected page section. Routes
//              through `handleDeleteShortcut` in delete-shortcut.ts —
//              site-pinned header/footer cannot be deleted (toast); the
//              last section on the active page cannot be deleted (toast
//              from handleSectionAction); success surfaces a "Deleted
//              {elementType}" / "Deleted section" toast.
//            - 1: fit current page. 0: fit all pages.
//          keyup-Space and window blur end the temporary-pan mode so
//          a released-space outside the canvas still exits pan.
//
// Co-existence with Phase 2o.b (keyboard.ts): keyboard.ts owns the
// per-element / per-section keyboard handlers wired onto individual
// canvas DOM nodes. This module owns the GLOBAL window-keydown shortcuts
// that fire regardless of which DOM node has focus (Ctrl+S, Ctrl+Z,
// Space-for-pan, V-for-select, fit shortcuts, etc.). The two listener
// scopes do not overlap — keyboard.ts wires `element.addEventListener`,
// this module wires `window.addEventListener`. No deduplication needed.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { DeleteShortcutContext } from './delete-shortcut.js';
import type {
  DomContext,
  EditorContext,
  SelectionContext,
} from './editor-context.js';
import type { FitAllPagesContext, FitToPageContext } from './render.js';
import type { RedoContext, UndoContext } from './persist.js';
import { fitToPage, fitAllPages } from './render.js';
import { undo, redo } from './persist.js';
import { handleDeleteShortcut } from './delete-shortcut.js';

// ADR 0064 — save-button + window-keyboard-shortcut wiring touches one
// canonical cluster (DomContext for the two button refs) plus the
// editing latch from SelectionContext, then a grab bag of save /
// placement / pan-mode / fit-shortcut verbs + state that no canonical
// alias owns yet. The inline `Pick` enumerates the local grab bag,
// `DeleteShortcutContext` is folded in so the forwarded
// `handleDeleteShortcut(ctx, ev)` call typechecks without a cast, and
// `UndoContext` / `RedoContext` / `FitToPageContext` / `FitAllPagesContext`
// fold in the narrow surfaces of the four forwarded callees in persist.ts
// and render.ts so the four keyboard-shortcut call sites typecheck
// without `ctx as EditorContext`. (Earlier carves of this file retained
// those casts as ADR 0064 scaffolding until persist.ts and render.ts
// carved; they have, so the scaffolding retires here.)
export type AttachSaveButtonContext = DomContext &
  SelectionContext &
  DeleteShortcutContext &
  UndoContext &
  RedoContext &
  FitToPageContext &
  FitAllPagesContext &
  Pick<
    EditorContext,
    | 'saveTimer'
    | 'saveStateNow'
    | 'saveSiteAsTemplate'
    | 'pendingImport'
    | 'exitPlacementMode'
    | 'temporaryPanPreviousMode'
    | 'spaceHeldForPan'
    | 'interactionMode'
    | 'setInteractionMode'
    | 'clearTemporaryPanState'
    | 'activePageId'
    | 'endTemporaryPan'
  >;

export function attachSaveButtonImpl(ctx: AttachSaveButtonContext): void {
  if (ctx.saveButton) {
    ctx.saveButton.addEventListener('click', () => {
      if (ctx.saveTimer) {
        clearTimeout(ctx.saveTimer);
        ctx.saveTimer = null;
      }
      void ctx.saveStateNow();
    });
  }
  if (ctx.saveTemplateButton) {
    ctx.saveTemplateButton.addEventListener('click', () => {
      void ctx.saveSiteAsTemplate();
    });
  }
  window.addEventListener('keydown', (ev) => {
    // Placement-mode Escape takes priority — it cancels the pending import
    // before any other Escape behaviour (e.g. inline-editing exits, which
    // are scoped to their own targets and won't fire here anyway).
    if (ev.key === 'Escape' && ctx.pendingImport) {
      ev.preventDefault();
      ctx.exitPlacementMode();
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && (ev.key === 'z' || ev.key === 'Z') && !ev.shiftKey) {
      ev.preventDefault();
      // Phase 2m extracted undo/redo into persist.ts as free functions
      // that take ctx. The IIFE twin still calls closure-scoped undo()
      // / redo(); on cutover, those calls retire and the keyboard
      // handler drives undo(ctx) / redo(ctx) directly. No ctx-method
      // wrapper exists yet (and would just re-import from this side),
      // so the static imports above are the binding.
      undo(ctx);
      return;
    }
    if (
      mod &&
      ((ev.key === 'y' || ev.key === 'Y') ||
        ((ev.key === 'z' || ev.key === 'Z') && ev.shiftKey))
    ) {
      ev.preventDefault();
      redo(ctx);
      return;
    }
    const isSave = mod && (ev.key === 's' || ev.key === 'S');
    if (isSave) {
      ev.preventDefault();
      if (ctx.saveTimer) {
        clearTimeout(ctx.saveTimer);
        ctx.saveTimer = null;
      }
      void ctx.saveStateNow();
      return;
    }
    if (
      ev.key === ' ' &&
      !ev.repeat &&
      !ctx.editingElementId &&
      !ev.ctrlKey &&
      !ev.metaKey &&
      !ev.altKey &&
      !ctx.isEditableShortcutTarget(ev.target)
    ) {
      ev.preventDefault();
      ctx.temporaryPanPreviousMode = ctx.interactionMode;
      ctx.spaceHeldForPan = true;
      ctx.setInteractionMode('pan');
      return;
    }
    if (
      (ev.key === 'v' || ev.key === 'V') &&
      !ctx.editingElementId &&
      !ev.ctrlKey &&
      !ev.metaKey &&
      !ev.altKey &&
      !ctx.isEditableShortcutTarget(ev.target)
    ) {
      ctx.clearTemporaryPanState();
      ctx.setInteractionMode('select');
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      const outcome = handleDeleteShortcut(ctx, ev);
      if (outcome !== 'none') {
        ev.preventDefault();
        return;
      }
    }
    if (ev.key === '1' && !ctx.isEditableShortcutTarget(ev.target)) {
      ev.preventDefault();
      fitToPage(ctx, ctx.activePageId);
    }
    if (ev.key === '0' && !ctx.isEditableShortcutTarget(ev.target)) {
      ev.preventDefault();
      fitAllPages(ctx);
    }
  });
  window.addEventListener('keyup', (ev) => {
    if (ev.key === ' ') {
      ev.preventDefault();
      ctx.endTemporaryPan();
    }
  });
  window.addEventListener('blur', () => {
    ctx.endTemporaryPan();
  });
}
