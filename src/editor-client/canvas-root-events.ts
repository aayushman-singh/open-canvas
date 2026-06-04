// src/editor-client/canvas-root-events.ts
//
// ADR 0058 Phase 2q.k — canvas root events.
// canvas-client.ts:11956-12102 carries the inline twin (attachRootEvents).
// The twin retires on ADR 0015 Phase 3 atomic cutover; until then, the
// inline IIFE is the production source-of-truth and this module ships
// dead code.
//
// One export:
//
//   - attachRootEventsImpl(ctx) — wire three listeners that decide the
//     selection / activation outcome of every pointer interaction on the
//     canvas:
//       * ctx.root "click"           — artboard label / inactive artboard /
//                                      element menu trigger / section
//                                      toolbar / element body / section
//                                      body / canvas background paths.
//       * ctx.root "dblclick"        — double-click an artboard label =
//                                      activate + fit-to-page.
//       * ctx.viewport "click"       — viewport-level deselect for clicks
//                                      that miss the artboard subtree.
//       * document "mousedown"       — global click-outside deselect, with
//                                      an exclusion list covering every
//                                      "still inside the editing flow"
//                                      surface.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { EditorContext } from './editor-context.js';

export function attachRootEventsImpl(ctx: EditorContext): void {
  const root = ctx.root;
  if (!root) return;

  root.addEventListener('click', (ev) => {
    if (ctx.interactionMode === 'pan') return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    // -- Artboard label click: switch active page and zoom to fit --------
    const artboardLabel = target.closest('.opencanvas-artboard-label');
    if (artboardLabel) {
      const labelPageId = artboardLabel.getAttribute('data-page-id');
      if (labelPageId && labelPageId !== ctx.activePageId) {
        ctx.setActivePage(labelPageId);
        ctx.fitToPage(labelPageId);
      }
      root.classList.remove('canvas-pages-deselected');
      return;
    }
    // -- Inactive artboard click: activate it ---------------------------
    const clickedArtboard = target.closest('.opencanvas-artboard');
    if (clickedArtboard && clickedArtboard.getAttribute('data-active') === 'false') {
      const abPageId = clickedArtboard.getAttribute('data-page-id');
      if (abPageId) {
        ctx.setActivePage(abPageId);
      }
      root.classList.remove('canvas-pages-deselected');
      return;
    }
    const menuTrigger = target.closest('[data-element-menu-trigger]');
    if (menuTrigger) {
      const triggerId = menuTrigger.getAttribute('data-element-menu-trigger');
      const triggerWrapper = menuTrigger.closest('.opencanvas-element');
      if (triggerId && triggerWrapper instanceof HTMLElement) {
        ctx.toggleElementMenu(triggerId, triggerWrapper);
      }
      ev.stopPropagation();
      return;
    }
    if (target.closest('[data-element-menu]')) {
      ev.stopPropagation();
      return;
    }
    ctx.closeElementMenu();
    if (target.closest('[data-section-grip]')) return;
    const toolbarButton = target.closest('[data-section-action]');
    if (toolbarButton) {
      const action = toolbarButton.getAttribute('data-section-action');
      const sid = toolbarButton.getAttribute('data-section-id');
      if (action && sid) ctx.handleSectionAction(action, sid);
      ev.stopPropagation();
      return;
    }
    const elementNode = ctx.resolveElementWrapperAtPoint(target, ev.clientX, ev.clientY);
    if (elementNode) {
      const id = elementNode.getAttribute('data-opencanvas-element');
      if (!id) return;
      const elType = elementNode.getAttribute('data-element-type');
      if (elType === 'text') {
        if (ctx.editingElementId !== id) {
          ctx.selectElement(id);
          ctx.beginTextEdit(id);
        }
        return;
      }
      if (id !== ctx.selectedElementId) ctx.selectElement(id);
      return;
    }
    const sectionNode = target.closest('.opencanvas-section');
    if (sectionNode) {
      const sid = sectionNode.getAttribute('data-opencanvas-section');
      if (sid) {
        ctx.selectSection(sid);
        ctx.selectElement(null);
      }
      return;
    }
    // Background click inside the canvas viewport (artboard padding or
    // the gutter around pages): drop the active section and element so the
    // selection outline clears and the inspector goes back to its empty
    // state. Clicks on the sidebar/inspector/header reach here too via the
    // document-level mousedown listener below.
    if (ctx.selectedSectionId) ctx.selectSection(null);
    if (ctx.selectedElementId) ctx.selectElement(null);
    // Mark the canvas as page-deselected — CSS clears the .7 dim that
    // .opencanvas-artboard[data-active="false"] usually carries so every page
    // reads as neutral until the user clicks an artboard or label again.
    root.classList.add('canvas-pages-deselected');
  });

  root.addEventListener('dblclick', (ev) => {
    const dblLabel =
      ev.target instanceof Element ? ev.target.closest('.opencanvas-artboard-label') : null;
    if (dblLabel) {
      const dblPageId = dblLabel.getAttribute('data-page-id');
      if (dblPageId) {
        ctx.setActivePage(dblPageId);
        ctx.fitToPage(dblPageId);
      }
    }
  });

  // Viewport-level deselect.
  //
  // canvas-root has zero width/height — it's a transform-anchored layout
  // sentinel whose descendants (artboards) are positioned via translate.
  // Clicks that hit the visible canvas BACKGROUND (the gutter between
  // artboards, or anywhere inside opencanvas-viewport that isn't an artboard
  // child) never bubble through canvas-root, so the deselect branch
  // attached above misses them entirely. The user's mental model is:
  // "click anywhere off a page = un-grey everything," so we mirror the
  // same deselect logic at the viewport level. Filtered to skip clicks
  // that land on artboard descendants (those are handled by root's
  // listener above) and on the side-chrome buttons (zoom controls etc.)
  // that the route renders inside the viewport.
  const viewport = ctx.viewport;
  if (viewport) {
    viewport.addEventListener('click', (ev) => {
      if (ctx.interactionMode === 'pan') return;
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      if (root && root.contains(target) && target !== root) return;
      if (target.closest('[data-zoom-action], [data-mode-action]')) return;
      if (ctx.selectedSectionId) ctx.selectSection(null);
      if (ctx.selectedElementId) ctx.selectElement(null);
      root.classList.add('canvas-pages-deselected');
    });
  }

  // Click-outside deselect. The exclusion list defines every surface that
  // counts as "still inside the editing flow" — modal/ai-panel/reel because
  // they're transient editor UI, inspector + sidebar because they own the
  // selection's controls, .opencanvas-element because that's the selection
  // itself, and the link popover + mark toolbar because they render in
  // document.body (outside .opencanvas-element) but operate on the active
  // selection.
  document.addEventListener('mousedown', (ev) => {
    if (!ctx.selectedElementId && !ctx.selectedSectionId) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    if (target.closest('.opencanvas-modal-backdrop')) return;
    if (target.closest('.opencanvas-ai-panel')) return;
    if (ctx.inspector && ctx.inspector.contains(target)) return;
    if (target.closest('#canvas-reel')) return;
    if (target.closest('.opencanvas-element')) return;
    if (target.closest('.opencanvas-section')) return;
    if (target.closest('#canvas-sidebar')) return;
    if (target.closest('.opencanvas-link-popover')) return;
    if (target.closest('.opencanvas-mark-toolbar')) return;
    // Chat panel reads selectedElementId into its payload to give the
    // agent context ("change this element"); dropping selection on
    // chat focus defeats the whole "talk about my selection" flow.
    if (target.closest('#canvas-chat-panel')) return;
    if (ctx.selectedElementId) ctx.selectElement(null);
    if (ctx.selectedSectionId) ctx.selectSection(null);
  });
}
