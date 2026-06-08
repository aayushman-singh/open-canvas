// src/editor-client/delete-shortcut.ts
//
// Delete/Backspace keyboard shortcut dispatcher.
//
// Wired by save-wiring.ts (production source-of-truth, ADR 0058 Phase 3
// bundle entry) at the window-level keydown listener. The keyboard.ts
// twin (dead code until Phase 3 cutover retires it) also calls into
// this helper so the two listeners stay byte-aligned.
//
// Contract (matches the editor-feature spec):
//   - Fires on `Delete` and `Backspace`.
//   - Skips when any modifier (Ctrl / Meta / Alt) is held — those slots
//     belong to the browser/OS shortcut surface.
//   - Skips when an editable target has focus (`<input>`, `<textarea>`,
//     `[contenteditable]`) so native text-editing wins.
//   - Skips when an inline text edit is in progress (`ctx.editingElementId`
//     is set).
//   - Routes by selection type:
//       · element selected → reuse `ctx.deleteElement(section, element)`
//         (the same mutation path the inspector "Delete" button calls).
//         Surfaces "Deleted {elementType}" via ctx.setStatus.
//       · section selected → check pinned-status; site header/footer
//         (per ADR 0059 — `state.header.id` / `state.footer.id`) are
//         non-deletable and surface a "Site header/footer cannot be
//         deleted" toast. Otherwise reuse `ctx.handleSectionAction(
//         'delete-section', id)`, which itself enforces the last-section
//         guard and surfaces its own status on failure. On success this
//         module surfaces "Deleted section".
//   - Returns the literal result of the attempt so the caller can decide
//     whether to `ev.preventDefault()`. Returning `'none'` means the
//     shortcut did NOT apply (no selection, modifier held, editable
//     focus) and the caller should leave the event alone.

import type {
  EditorContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';

// ADR 0064 — first narrow-context carve. The module touches three named
// clusters (selection, state queries, status emission) plus four verbs
// that don't yet have named contexts of their own; the inline `Pick`
// declares the verb surface honestly without introducing aliases that
// would have a single caller.
export type DeleteShortcutContext = SelectionContext &
  StateContext &
  StatusEmitterContext &
  Pick<EditorContext, 'isEditableShortcutTarget' | 'deleteElement' | 'handleSectionAction'>;

export type DeleteShortcutOutcome =
  | 'none'           // shortcut did not apply — caller must NOT preventDefault
  | 'element'        // element deleted
  | 'section'        // page section deleted
  | 'pinned-blocked' // section selection refused (site header/footer)
  | 'no-selection';  // shortcut applied (consume key) but nothing was selected

export interface DeleteShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly target: EventTarget | null;
}

/**
 * Decide + dispatch the Delete/Backspace keyboard shortcut.
 *
 * The caller (save-wiring.ts / keyboard.ts) wraps this in the window
 * keydown listener. `preventDefault()` is the caller's responsibility —
 * fire it whenever the return is anything other than `'none'`.
 */
export function handleDeleteShortcut(
  ctx: DeleteShortcutContext,
  ev: DeleteShortcutEvent,
): DeleteShortcutOutcome {
  if (ev.key !== 'Delete' && ev.key !== 'Backspace') return 'none';
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return 'none';
  if (ctx.editingElementId) return 'none';
  if (ctx.isEditableShortcutTarget(ev.target)) return 'none';

  if (ctx.selectedElementId) {
    const found = ctx.findElement(ctx.selectedElementId);
    if (!found) return 'no-selection';
    const elementType = found.element.type;
    ctx.deleteElement(found.section, found.element);
    ctx.setStatus('Deleted ' + elementType, 'ok');
    return 'element';
  }

  if (ctx.selectedSectionId) {
    const state = ctx.state;
    if (
      state &&
      ((state.header && state.header.id === ctx.selectedSectionId) ||
        (state.footer && state.footer.id === ctx.selectedSectionId))
    ) {
      ctx.setStatus('Site header/footer cannot be deleted', 'error');
      return 'pinned-blocked';
    }
    // Pre-check the last-section guard so we surface the success toast
    // ONLY when the underlying delete will actually proceed. Without this
    // check the success status would overwrite handleSectionAction's
    // "Can't delete the last section" error toast.
    const page = ctx.currentPage();
    if (page && page.sections.length <= 1) {
      ctx.handleSectionAction('delete-section', ctx.selectedSectionId);
      return 'section';
    }
    ctx.handleSectionAction('delete-section', ctx.selectedSectionId);
    ctx.setStatus('Deleted section', 'ok');
    return 'section';
  }

  return 'no-selection';
}
