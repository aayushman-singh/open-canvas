// src/editor-client/collection-template-edit.ts
//
// ADR 0065 Phase 2C — enter/exit verbs for Collection custom-template
// edit mode. These are the only canonical writers to
// `ctx.editingCollectionTemplate`; Phase 3 wires Esc / click-outside /
// page-switch handlers to call `exitCollectionTemplateEditImpl`, and the
// inspector buttons (element-inspector.ts) call both.
//
// Precondition discipline (ADR 0065 D3 + D9):
//   * `enterCollectionTemplateEditImpl` requires the resolved element to be
//     a Collection with `display === 'custom'`. The caller is responsible
//     for switching display first — the display-dropdown change handler
//     in element-inspector.ts does that atomically before invoking enter.
//   * Missing / wrong-type elements are LOUD failures via ctx.setStatus
//     ('error' tone). No silent fallback (CLAUDE.md "all-or-nothing").
//
// Seed atomicity (ADR 0065 D3): when entering for the first time
// (`customTemplate === undefined`), the verb mutates BOTH
// `el.customTemplate = seedCustomTemplate()` AND
// `ctx.editingCollectionTemplate = { collectionId }` in a single
// captureForUndo + scheduleSave window so undo restores the pre-seed
// state cleanly.

import type { EditorContext } from './editor-context.js';
import { seedCustomTemplate } from '../canvas/elements/collection-defaults.js';

/**
 * Enter custom-template edit mode for the named Collection.
 *
 * Preconditions enforced at runtime:
 *  - the id resolves to an element in the current state;
 *  - the resolved element is a Collection (type === 'collection');
 *  - the Collection's `display` is already `'custom'` — the caller MUST
 *    switch display first (the inspector's display-dropdown handler does
 *    this atomically).
 *
 * On the first switch (when `customTemplate` is absent) this seeds the
 * template with `seedCustomTemplate()` AND flips `editingCollectionTemplate`
 * in the same captureForUndo + scheduleSave window — one atomic write per
 * ADR 0065 D3. On every subsequent enter the seed is skipped (silent keep
 * per D4 means a previously customised template is preserved across
 * mode-switches).
 *
 * Loud-failure paths surface via ctx.setStatus('error') and return early
 * without mutating any state.
 */
export function enterCollectionTemplateEditImpl(
  ctx: EditorContext,
  collectionId: string,
): void {
  const found = ctx.findElement(collectionId);
  if (!found) {
    ctx.setStatus(
      'Cannot edit template: element ' + collectionId + ' was not found.',
      'error',
    );
    return;
  }
  const element = found.element;
  if (element.type !== 'collection') {
    ctx.setStatus(
      'Cannot edit template: element ' + collectionId + ' is not a Collection.',
      'error',
    );
    return;
  }
  if (element.display !== 'custom') {
    ctx.setStatus(
      'Cannot edit template: Collection display must be Custom first.',
      'error',
    );
    return;
  }
  ctx.captureForUndo();
  if (element.customTemplate === undefined) {
    // First-ever switch — seed the template and flip the edit-mode pin
    // atomically. structuredClone throws on failure (ADR 0065 D3 failure
    // path); we let the throw propagate rather than swallow it.
    //
    // Codex review pass 1 — pass collectionId so the seed's element ids
    // are suffixed `--<collectionId>`. Two Collections on the same page
    // would otherwise both end up with `card-default-root` in their
    // customTemplate and fail the page-level duplicate-id check.
    element.customTemplate = seedCustomTemplate(collectionId);
  }
  ctx.editingCollectionTemplate = { collectionId: collectionId };
  ctx.renderAll();
  ctx.scheduleSave();
}

/**
 * Exit custom-template edit mode. Idempotent — calling this when no
 * template is active leaves the field at `null` and re-renders. The exit
 * is loud-free because the caller (Esc / click-outside / Done button /
 * display-away change) is always intentional.
 *
 * Codex review pass 2 finding 2 — before clearing
 * `editingCollectionTemplate`, check whether `selectedElementId` resolves
 * to an element living inside the now-soon-to-be-inactive template (i.e.
 * `parentKind === 'collection-custom-template'`). If so, reselect the
 * parent Collection. Rationale: the Owner clicked a template child while
 * editing (so `selectedElementId` points at e.g. the title TextElement);
 * exiting hides the per-child grid and renders the materialized N-clone
 * grid instead. The child is no longer visually selectable on the canvas
 * but the inspector still renders its inspector — the Owner edits a
 * phantom. Reselecting the parent Collection keeps the Owner in the "I
 * just exited THIS Collection's edit mode" mental model so the next
 * interaction (re-enter, change display, edit binding) lands on the
 * right element.
 */
export function exitCollectionTemplateEditImpl(ctx: EditorContext): void {
  // Re-target a stale child selection BEFORE flipping the edit-mode
  // field. findElement's customTemplate recursion (added in pass 1 F1)
  // resolves regardless of the field's state — the lookup is structural,
  // not gated on editingCollectionTemplate — so the parent-Collection id
  // is reachable either way. Doing it before the flip keeps the verb's
  // intent ordering clean: "compute new selection from current state",
  // then "mutate state and re-render".
  const selectedId = ctx.selectedElementId;
  if (selectedId !== null && ctx.editingCollectionTemplate !== null) {
    const found = ctx.findElement(selectedId);
    if (found && found.parentKind === 'collection-custom-template') {
      const meta = found.parentMeta;
      if (meta !== null && 'collectionElement' in meta) {
        ctx.selectElement(meta.collectionElement.id);
      }
    }
  }
  ctx.editingCollectionTemplate = null;
  ctx.renderAll();
}
