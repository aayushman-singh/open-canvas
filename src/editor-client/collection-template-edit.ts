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

import type { CanvasElement } from '../canvas/schema.js';
import type {
  PersistContext,
  RenderContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import { seedCustomTemplate } from '../canvas/elements/collection-defaults.js';
import { type CoEditPresencePublishContext, publishLocalPresenceImmediate } from './co-edit.js';

// ADR 0064 — Collection custom-template edit verbs touch five canonical
// clusters (state lookup, selection re-target on exit, render fan-out,
// debounced persistence, loud status) plus the discrete co-edit presence
// flush. `CoEditPresencePublishContext` already folds in the non-canonical
// `editingCollectionTemplate` field both verbs read/write, so this alias
// just unions it with the five canonical views — no extra inline `Pick`
// needed. Both `enter` and `exit` share the same surface; one alias keeps
// the signatures aligned and the export honest.
export type CollectionTemplateEditContext = StateContext &
  SelectionContext &
  RenderContext &
  PersistContext &
  StatusEmitterContext &
  CoEditPresencePublishContext;

/**
 * Whether `targetId` resolves to an element living anywhere inside the
 * subtree rooted at one of the elements in `template`. Walks Tabs panel
 * children (the only canvas type with nested `CanvasElement[]` siblings —
 * mirrors the materializer's recursion in collection-materializer.ts).
 *
 * Codex review pass 4 finding 3 — used by the exit-verb's stale-child
 * re-target branch. The pass-2 fix only handled DIRECT children of
 * customTemplate (parentKind === 'collection-custom-template'). When the
 * selection sits inside a nested Tabs panel within customTemplate, the
 * walker's parentKind is 'tab-panel' and the parent-meta points at the
 * Tabs element, not the host Collection. A structural subtree-membership
 * predicate is the cheapest fix: one O(template-size) walk per exit,
 * compared with an O(depth × template-size) parent-chain reconstruction
 * via repeated findElement calls.
 */
function isInsideTemplateSubtree(
  template: readonly CanvasElement[],
  targetId: string,
): boolean {
  for (let i = 0; i < template.length; i++) {
    const node = template[i];
    if (node === undefined) continue;
    if (node.id === targetId) return true;
    if (node.type === 'tabs') {
      for (let ti = 0; ti < node.tabs.length; ti++) {
        const tab = node.tabs[ti];
        if (tab === undefined || !Array.isArray(tab.elements)) continue;
        if (isInsideTemplateSubtree(tab.elements, targetId)) return true;
      }
    }
  }
  return false;
}

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
  ctx: CollectionTemplateEditContext,
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
    //
    // Codex review pass 5 finding 1 — pass the host Collection's current
    // box dimensions so the seed scales to fit. The validator recurses
    // customTemplate against the host's `box.w/h`; an unscaled seed
    // against a small host (e.g. 200x200) would overflow the bounds and
    // block save with box-bound errors.
    element.customTemplate = seedCustomTemplate(collectionId, element.box.w, element.box.h);
  }
  ctx.editingCollectionTemplate = { collectionId: collectionId };
  ctx.renderAll();
  ctx.scheduleSave();
  // ADR 0065 F1-multi-collab-presence — broadcast the new template-edit
  // pin so remote peers' inspectors light up the "<Owner> is also
  // editing this template" indicator on the next awareness tick.
  // Bypasses the throttle gate AND the no-peer skip used by the cursor
  // path: the toggle is a discrete event (not a high-frequency stream)
  // AND we want the local awareness state truthful for a peer that
  // hasn't joined yet but will.
  publishLocalPresenceImmediate(ctx);
}

/**
 * Exit custom-template edit mode. Idempotent — calling this when no
 * template is active leaves the field at `null` and re-renders. The exit
 * is loud-free because the caller (Esc / click-outside / Done button /
 * display-away change) is always intentional.
 *
 * Codex review pass 2 finding 2 — before clearing
 * `editingCollectionTemplate`, check whether `selectedElementId` resolves
 * to an element living inside the now-soon-to-be-inactive template. If
 * so, reselect the parent Collection. Rationale: the Owner clicked a
 * template child while editing (so `selectedElementId` points at e.g.
 * the title TextElement); exiting hides the per-child grid and renders
 * the materialized N-clone grid instead. The child is no longer visually
 * selectable on the canvas but the inspector still renders its inspector
 * — the Owner edits a phantom. Reselecting the parent Collection keeps
 * the Owner in the "I just exited THIS Collection's edit mode" mental
 * model so the next interaction (re-enter, change display, edit binding)
 * lands on the right element.
 *
 * Codex review pass 4 finding 3 — pass 2 only handled DIRECT template
 * children (parentKind === 'collection-custom-template'). When the
 * selection sits inside a nested Tabs panel within customTemplate, the
 * walker's parentKind is 'tab-panel' and the host Collection is no
 * longer the immediate parent-meta. The fix is structural: locate the
 * active Collection from the pin, then ask whether `selectedElementId`
 * is anywhere in its `customTemplate` subtree (via
 * `isInsideTemplateSubtree`). One O(template-size) walk per exit; covers
 * both direct children and any depth of nesting.
 */
export function exitCollectionTemplateEditImpl(ctx: CollectionTemplateEditContext): void {
  // Re-target a stale child selection BEFORE flipping the edit-mode
  // field. findElement's customTemplate recursion (added in pass 1 F1)
  // resolves regardless of the field's state — the lookup is structural,
  // not gated on editingCollectionTemplate — so the parent-Collection id
  // is reachable either way. Doing it before the flip keeps the verb's
  // intent ordering clean: "compute new selection from current state",
  // then "mutate state and re-render".
  const selectedId = ctx.selectedElementId;
  if (selectedId !== null && ctx.editingCollectionTemplate !== null) {
    const activeCollectionId = ctx.editingCollectionTemplate.collectionId;
    const activeFound = ctx.findElement(activeCollectionId);
    if (
      activeFound &&
      activeFound.element.type === 'collection' &&
      Array.isArray(activeFound.element.customTemplate) &&
      selectedId !== activeCollectionId &&
      isInsideTemplateSubtree(activeFound.element.customTemplate, selectedId)
    ) {
      ctx.selectElement(activeCollectionId);
    }
  }
  ctx.editingCollectionTemplate = null;
  ctx.renderAll();
  // ADR 0065 F1-multi-collab-presence — broadcast the cleared pin so
  // peers' indicators drop the local Owner immediately. Same rationale
  // as the enter-verb's publish: discrete event, no peer-gate skip.
  publishLocalPresenceImmediate(ctx);
}
