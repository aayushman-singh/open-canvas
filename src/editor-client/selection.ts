// src/editor-client/selection.ts
//
// ADR 0058 Phase 2o.a — selection state-machine.
// Extracted from canvas-client.ts:8012-8059. The inline IIFE twin remains
// the production source-of-truth until ADR 0015 Phase 3 atomic cutover.
//
// Two functions: selectElement + selectSection. selectElement re-enters
// selectSection through the exported name (the IIFE twin uses the closure
// reference); selectSection is also reachable via ctx.selectSection so the
// rest of the IIFE can drive the section path without importing this
// module.
//
// Failure contract preserved: idempotent on no-change (early return when
// the next id matches the active selection), inspector re-render order
// preserved (selectElement re-renders inspector AFTER selectSection
// mutates selectedSectionId), no silent fallback for missing DOM nodes —
// the querySelector path simply skips the data-selected toggle when the
// wrapper isn't live, matching the IIFE twin.
//
// Action-element auto-pin: when the selected element is an `action`, the
// inner <a.opencanvas-action> anchor gets a pinned link popover so the
// Owner can navigate to the linked page without hunting for the
// inspector's href field. Non-action elements get nothing.

import type { EditorContext } from './editor-context.js';
import { cssEscape } from './css-escape.js';

export function selectElement(ctx: EditorContext, elementId: string | null): void {
  if (ctx.selectedElementId === elementId) return;
  if (ctx.selectedElementId) {
    const prev = ctx.root?.querySelector(
      '[data-opencanvas-element="' + cssEscape(ctx.selectedElementId) + '"]',
    );
    if (prev) prev.removeAttribute('data-selected');
  }
  ctx.selectedElementId = elementId;
  ctx.chatSelectionDropped = false;
  // Dismiss any link popover anchored to the previously selected element.
  // A new selection either replaces it (action elements re-pin below) or
  // there's nothing to show for the new selection.
  if (ctx.linkPopoverPinned) ctx.removeLinkPopover();
  if (elementId) {
    if (ctx.isReelOpen) ctx.closeReel();
    const next = ctx.root?.querySelector(
      '[data-opencanvas-element="' + cssEscape(elementId) + '"]',
    );
    if (next) next.setAttribute('data-selected', 'true');
    const found = ctx.findElement(elementId);
    if (found) selectSection(ctx, found.section.id);
    // Action elements get an auto-pinned link popover so the Owner can
    // navigate to the linked page (or open the external URL) without
    // hunting for the inspector's href field. The wrapper's inner anchor
    // is the popover anchor.
    if (found && found.element && found.element.type === 'action' && next) {
      const actionAnchor = next.querySelector('a.opencanvas-action');
      if (actionAnchor) ctx.showLinkPopover(actionAnchor as HTMLElement, { pinned: true });
    }
  }
  ctx.renderInspector();
  ctx.updateChatSelectionChip();
}

export function selectSection(ctx: EditorContext, sectionId: string | null): void {
  if (ctx.selectedSectionId === sectionId) return;
  if (ctx.selectedSectionId) {
    const prev = ctx.root?.querySelector(
      '[data-opencanvas-section="' + cssEscape(ctx.selectedSectionId) + '"]',
    );
    if (prev) prev.removeAttribute('data-selected');
  }
  ctx.selectedSectionId = sectionId;
  if (sectionId) {
    const next = ctx.root?.querySelector(
      '[data-opencanvas-section="' + cssEscape(sectionId) + '"]',
    );
    if (next) next.setAttribute('data-selected', 'true');
  }
  if (!ctx.selectedElementId) ctx.renderInspector();
  if (ctx.isReelOpen) ctx.renderReel();
}
