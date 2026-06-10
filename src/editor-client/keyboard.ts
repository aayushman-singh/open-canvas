// src/editor-client/keyboard.ts
//
// ADR 0058 Phase 2o.b — window-level keyboard handlers.
// canvas-client.ts:13525-13608 carries the inline twin (three window
// listeners — keydown / keyup / blur — wired inside attachSaveButton).
// The twin retires on ADR 0015 Phase 3 atomic cutover; until then, the
// inline IIFE is the production source-of-truth and this module is dead
// code.
//
// One export:
//
//   - registerKeyboardHandlers(ctx) — attach the three window listeners.
//     Shortcuts covered:
//       - Escape       → exitPlacementMode (when ctx.pendingImport set)
//       - Ctrl/Cmd+Z   → undo
//       - Ctrl/Cmd+Y / Ctrl/Cmd+Shift+Z → redo
//       - Ctrl/Cmd+S   → flush saveTimer + saveStateNow (synchronous)
//       - Space (held) → temporary pan mode (releases on keyup/blur)
//       - V            → switch to select mode + clear temporary pan
//       - Delete/Backspace → handleDeleteShortcut (delete-shortcut.ts)
//       - 1            → fitToPage(ctx.activePageId)
//       - 0            → fitAllPages
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { DeleteShortcutContext } from './delete-shortcut.js';
import type { EditorContext } from './editor-context.js';
import type { FitAllPagesContext, FitToPageContext } from './render.js';
import type { UndoContext } from './persist.js';
import { undo, redo } from './persist.js';
import { fitToPage, fitAllPages } from './render.js';
import { handleDeleteShortcut } from './delete-shortcut.js';

// ADR 0064 — the Phase 2o.b window-keyboard handler shares its surface
// almost wholesale with save-wiring.ts's AttachSaveButtonContext (the two
// listeners are byte-identical twins until ADR 0015 Phase 3 cutover
// retires the inline IIFE). The narrow type folds in the three forwarded
// callees' own contexts — UndoContext (RedoContext = UndoContext in
// persist.ts, so one alias covers both undo + redo forwards),
// FitToPageContext / FitAllPagesContext for fitToPage/fitAllPages, and
// DeleteShortcutContext for handleDeleteShortcut — so the forward calls
// typecheck without `ctx as EditorContext` casts. The inline `Pick`
// enumerates the local grab bag (save / placement / pan-mode verbs +
// state) that no canonical alias owns yet. No DomContext: keyboard.ts is
// pure window-scope listeners and never touches the cached button refs
// (those live in save-wiring.ts).
export type RegisterKeyboardHandlersContext = DeleteShortcutContext &
  UndoContext &
  FitToPageContext &
  FitAllPagesContext &
  Pick<
    EditorContext,
    | 'saveTimer'
    | 'saveStateNow'
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

/**
 * Private to this module — the canonical impl lives at
 * canvas-client.ts:958. Pure 9-line utility; re-declaring it here is
 * cheaper than a forward-decl on ctx and keeps the inline twin
 * byte-identical. Other phases (drag handlers, inspector toolbar) carry
 * their own copies in canvas-client.ts; if cross-module reuse forces
 * sharing later, it lifts onto ctx then.
 */
function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest('input, textarea, select, button');
  if (control) return true;
  const editable = target.closest('[contenteditable]');
  if (!editable) return false;
  return editable.getAttribute('contenteditable') !== 'false';
}

export function registerKeyboardHandlers(ctx: RegisterKeyboardHandlersContext): void {
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
      undo(ctx);
      return;
    }
    if (
      mod &&
      (ev.key === 'y' || ev.key === 'Y' || ((ev.key === 'z' || ev.key === 'Z') && ev.shiftKey))
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
      !isEditableShortcutTarget(ev.target)
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
      !isEditableShortcutTarget(ev.target)
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
    if (ev.key === '1' && !isEditableShortcutTarget(ev.target)) {
      ev.preventDefault();
      fitToPage(ctx, ctx.activePageId);
    }
    if (ev.key === '0' && !isEditableShortcutTarget(ev.target)) {
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
