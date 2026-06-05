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
// the querySelectorAll path simply skips the data-selected toggle when
// no wrappers are live.
//
// Multi-instance DOM: site-pinned sections (header/footer) are repeated
// per artboard (render.ts:285-295) and share a single section/element id.
// Both selectSection and selectElement therefore querySelectorAll and
// loop, so the highlight reflects on every page instead of just the
// first match in document order.
//
// Affordance anchoring: c70240c propagated `data-selected` across every
// repeated instance, but chrome that needs a single DOM rect (the inline
// rich-text toolbar, drag/align affordances, inspector popovers that
// position via getBoundingClientRect) still has to pick exactly one
// wrapper. The helper `findElementWrapperInArtboardOf` scopes the lookup
// to the artboard the user actually clicked into — so a click on page-3's
// footer text spawns the RTE toolbar over page-3, not page-1. Callers
// pass the clicked DOM node (or any descendant of it) as `contextEl`;
// the helper walks up to `.opencanvas-artboard` and querySelectors WITHIN
// that artboard. Falls back to the first DOM match only when no artboard
// ancestor is found (defensive — every wrapper rendered by render.ts
// lives inside an artboard).
//
// Action-element auto-pin: when the selected element is an `action`, the
// inner <a.opencanvas-action> anchor gets a pinned link popover so the
// Owner can navigate to the linked page without hunting for the
// inspector's href field. Non-action elements get nothing.

import type { EditorContext } from './editor-context.js';
import { cssEscape } from './css-escape.js';
import { mountResizeHandles, unmountResizeHandles } from './element-menu.js';

export function selectElement(ctx: EditorContext, elementId: string | null): void {
  if (ctx.selectedElementId === elementId) return;
  if (ctx.selectedElementId) {
    // Site-pinned sections (header/footer) materialise one DOM wrapper per
    // artboard but share a single element id, so we must scrub every match.
    const prev = ctx.root?.querySelectorAll(
      '[data-opencanvas-element="' + cssEscape(ctx.selectedElementId) + '"]',
    );
    if (prev) {
      for (let i = 0; i < prev.length; i++) {
        const prevEl = prev[i] as HTMLElement | undefined;
        if (!prevEl) continue;
        prevEl.removeAttribute('data-selected');
        // Strip the resize handle quad from the previously-selected wrapper
        // so the DOM only ever carries one set of 8 handles at a time. See
        // element-menu.ts for the rationale (descendant-cascade bug).
        unmountResizeHandles(prevEl);
      }
    }
  }
  ctx.selectedElementId = elementId;
  ctx.chatSelectionDropped = false;
  // Dismiss any link popover anchored to the previously selected element.
  // A new selection either replaces it (action elements re-pin below) or
  // there's nothing to show for the new selection.
  if (ctx.linkPopoverPinned) ctx.removeLinkPopover();
  if (elementId) {
    if (ctx.isReelOpen) ctx.closeReel();
    const next = ctx.root?.querySelectorAll(
      '[data-opencanvas-element="' + cssEscape(elementId) + '"]',
    );
    if (next) {
      for (let i = 0; i < next.length; i++) {
        const nextEl = next[i] as HTMLElement | undefined;
        if (!nextEl) continue;
        nextEl.setAttribute('data-selected', 'true');
        // Mount the resize handle quad on every matching wrapper. Repeated
        // site-pinned sections render one wrapper per artboard but share a
        // single element id; mounting on each keeps handle behaviour
        // consistent across pages instead of clinging to the first match
        // in document order.
        mountResizeHandles(nextEl);
      }
    }
    const found = ctx.findElement(elementId);
    if (found) selectSection(ctx, found.section.id);
    // Action elements get an auto-pinned link popover so the Owner can
    // navigate to the linked page (or open the external URL) without
    // hunting for the inspector's href field. The wrapper's inner anchor
    // is the popover anchor. With repeated section instances we still pin
    // to a single anchor (the popover is single-instance) — the first
    // match is fine since all instances point at the same href.
    const firstNext = next && next.length > 0 ? next[0]! : null;
    if (found && found.element && found.element.type === 'action' && firstNext) {
      const actionAnchor = firstNext.querySelector('a.opencanvas-action');
      if (actionAnchor) ctx.showLinkPopover(actionAnchor as HTMLElement, { pinned: true });
    }
  }
  ctx.renderInspector();
  ctx.updateChatSelectionChip();
}

// Scope an element-id lookup to the artboard that contains `contextEl`.
// Site-pinned header/footer sections materialise one wrapper per artboard
// but share a single element id, so a plain `querySelector` always hands
// back the first DOM match — meaning chrome anchored via
// getBoundingClientRect (RTE toolbar, drag affordances, inspector popovers
// that need a real screen rect) lands on page 1 no matter which page the
// Owner actually clicked.
//
// The helper walks `contextEl` up to its `.opencanvas-artboard` ancestor,
// then runs the wrapper lookup inside that artboard. The result is the
// instance the click actually hit, not the one document order picked.
//
// Fallback: when `contextEl` is null OR no artboard ancestor exists OR
// the artboard-scoped lookup misses, we fall back to the first
// document-wide match. The fallback path is the same behaviour the
// pre-fix code had — the helper degrades, it does not throw — but in
// practice every wrapper rendered by render.ts lives inside an artboard,
// so the fallback only fires when the caller passes a context node from
// outside the canvas (e.g. a sidebar control re-selecting an element by
// id without a click event to scope to).
export function findElementWrapperInArtboardOf(
  ctx: EditorContext,
  elementId: string,
  contextEl: Element | null,
): HTMLElement | null {
  if (!ctx.root) return null;
  const selector = '[data-opencanvas-element="' + cssEscape(elementId) + '"]';
  if (contextEl) {
    const artboard = contextEl.closest('.opencanvas-artboard');
    if (artboard) {
      const scoped = artboard.querySelector(selector);
      if (scoped instanceof HTMLElement) return scoped;
    }
  }
  const fallback = ctx.root.querySelector(selector);
  return fallback instanceof HTMLElement ? fallback : null;
}

// ADR 0063 dec 6 — clicks inside a Collection's rendered DOM (per-entry
// cards from the Phase 2B materializer, or editor-only placeholder cards
// from collection-preview.ts) select the parent Collection, not the inner
// node. Mirrors Carousel slide behaviour: per-entry instances are
// materializer output, not authorable elements, so every click bubbles
// to the Collection element itself.
//
// The walk: starting at the clicked DOM node, walk parents until we hit
// the first ancestor with `data-element-type`. If that ancestor's value
// is "collection", return its element-id (its `data-opencanvas-element`
// attribute). Otherwise return null and let the default
// resolveElementWrapperAtPoint result stand — the click was on something
// outside any Collection.
export function resolveCollectionAncestorForClick(clickTarget: Element | null): string | null {
  let node: Element | null = clickTarget;
  while (node) {
    if (node instanceof HTMLElement) {
      const elType = node.getAttribute('data-element-type');
      if (elType !== null) {
        if (elType === 'collection') {
          return node.getAttribute('data-opencanvas-element');
        }
        return null;
      }
    }
    node = node.parentElement;
  }
  return null;
}

export function selectSection(ctx: EditorContext, sectionId: string | null): void {
  if (ctx.selectedSectionId === sectionId) return;
  if (ctx.selectedSectionId) {
    const prev = ctx.root?.querySelectorAll(
      '[data-opencanvas-section="' + cssEscape(ctx.selectedSectionId) + '"]',
    );
    if (prev) for (let i = 0; i < prev.length; i++) prev[i]!.removeAttribute('data-selected');
  }
  ctx.selectedSectionId = sectionId;
  if (sectionId) {
    const next = ctx.root?.querySelectorAll(
      '[data-opencanvas-section="' + cssEscape(sectionId) + '"]',
    );
    if (next) for (let i = 0; i < next.length; i++) next[i]!.setAttribute('data-selected', 'true');
  }
  if (!ctx.selectedElementId) ctx.renderInspector();
  if (ctx.isReelOpen) ctx.renderReel();
}
