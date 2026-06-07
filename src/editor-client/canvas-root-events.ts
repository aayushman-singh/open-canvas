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
import { resolveCollectionAncestorForClick } from './selection.js';
import { cssEscape } from './css-escape.js';

export function attachRootEventsImpl(ctx: EditorContext): void {
  const root = ctx.root;
  if (!root) return;

  root.addEventListener('click', (ev) => {
    if (ctx.interactionMode === 'pan') return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    // -- ADR 0065 D5 — click-outside template exits edit mode -----------
    // When `editingCollectionTemplate` pins a Collection, clicks on the
    // canvas region OUTSIDE the active template wrapper (the dimmed
    // surround) exit edit mode. Clicks INSIDE the template are handled
    // by the normal selection cascade below — Phase 2D's inverted
    // resolveCollectionAncestorForClick routes them to the clicked
    // child element. Done button stops propagation itself so the click
    // never reaches this handler. We check this BEFORE the artboard /
    // element / section cascade so that mid-edit clicks on the
    // surround don't first toggle a section or page activation as a
    // side-effect of the exit.
    if (ctx.editingCollectionTemplate !== null) {
      const activeId = ctx.editingCollectionTemplate.collectionId;
      const activeWrapper = root.querySelector(
        '[data-opencanvas-element="' + cssEscape(activeId) + '"][data-element-type="collection"]',
      );
      if (activeWrapper === null || !activeWrapper.contains(target)) {
        ctx.exitCollectionTemplateEdit();
        return;
      }
    }
    // -- Artboard label click: switch active page and pan to it ---------
    // setActivePage handles the camera pan now (preserves zoom). The
    // earlier behaviour also re-zoomed via fitToPage; the user-visible
    // UX is "bring the page into view at the current zoom" — pan, not
    // fit — so the explicit fitToPage was retired alongside the
    // pan-on-setActivePage wiring in page-crud.ts.
    const artboardLabel = target.closest('.opencanvas-artboard-label');
    if (artboardLabel) {
      const labelPageId = artboardLabel.getAttribute('data-page-id');
      if (labelPageId && labelPageId !== ctx.activePageId) {
        ctx.setActivePage(labelPageId);
      }
      root.classList.remove('canvas-pages-deselected');
      return;
    }
    // -- Inactive artboard click: activate it ---------------------------
    // When the click also lands on an element or section, fall through
    // so the cascade below can re-select it. Otherwise the user's first
    // click on an element on an inactive page would
    // (1) be selected by drag-resize's mousedown handler,
    // (2) then immediately cleared by setActivePage's selectElement(null),
    // (3) and the click would return before the element-select branch
    //     could re-select it. End state: deselected on first click,
    //     selects only on the second click. This was the user-visible
    //     "click deselects, click again sticks" bug.
    //
    // When the click is on the artboard padding (no element/section),
    // keep the original return-early so the background-deselect branch
    // below doesn't add `canvas-pages-deselected` back right after we
    // just removed it.
    const clickedArtboard = target.closest('.opencanvas-artboard');
    if (clickedArtboard && clickedArtboard.getAttribute('data-active') === 'false') {
      const abPageId = clickedArtboard.getAttribute('data-page-id');
      if (abPageId) {
        ctx.setActivePage(abPageId);
      }
      root.classList.remove('canvas-pages-deselected');
      const clickedElementWrapper = target.closest('.opencanvas-element');
      const clickedSectionWrapper = target.closest('.opencanvas-section');
      if (!clickedElementWrapper && !clickedSectionWrapper) return;
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
      // ADR 0063 dec 6 — when the click landed inside a Collection's
      // rendered DOM (per-entry materializer cards in Phase 2B, or
      // editor-only placeholder cards from collection-preview.ts), the
      // hit-test above picks the innermost wrapper. We override that
      // result and select the enclosing Collection instead, mirroring
      // Carousel slide behaviour — the inner nodes are materializer
      // output, not authorable elements.
      //
      // ADR 0065 D7 — INVERTED when editingCollectionTemplate pins this
      // Collection. The helper short-circuits to null inside the active
      // template so the clicked template child element selects directly.
      const collectionAncestorId = resolveCollectionAncestorForClick(target, ctx.editingCollectionTemplate);
      if (collectionAncestorId !== null) {
        if (collectionAncestorId !== ctx.selectedElementId) {
          ctx.selectElement(collectionAncestorId);
        }
        return;
      }
      const id = elementNode.getAttribute('data-opencanvas-element');
      if (!id) return;
      const elType = elementNode.getAttribute('data-element-type');
      if (elType === 'text') {
        if (ctx.editingElementId !== id) {
          ctx.selectElement(id);
          // Pass the specific clicked wrapper through so site-pinned
          // sections (header/footer) anchor the contenteditable + mark
          // toolbar to the page the Owner actually clicked, not the
          // first DOM match. selectElement updates state on the canonical
          // model; the clicked wrapper is purely a chrome anchor.
          ctx.beginTextEdit(id, elementNode);
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
    // Double-click on the label: keep the "really focus this page" intent
    // and explicitly fit-to-page (re-zooms to ZOOM_MAX_FIT). This is the
    // one path that still touches zoom — single-click pans via
    // setActivePage; double-click escalates to fit.
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

  // ADR 0065 D5 — Esc exits template-edit mode.
  //
  // Document-level keydown so the binding survives focus changes (e.g.
  // the Owner clicked a sidebar input mid-edit then pressed Esc). Modal
  // precedence: modals.ts owns its own Esc handler that closes the
  // active modal first; we skip when ctx.modalOpen is true so a stacked
  // confirm/select modal absorbs the Esc before this handler sees it.
  // We also skip during text editing (editingElementId set) — Esc
  // inside a contenteditable cancels the edit per text-edit.ts; the
  // template-edit-exit fires on the next Esc instead.
  //
  // Codex review pass 6 finding 1 — `defaultPrevented` short-circuits
  // the handler BEFORE any state checks. Text-edit's onKey is bound to
  // the contenteditable `inner` element (text-edit.ts:299), runs in the
  // bubbling path BEFORE this document-level handler, and calls
  // `preventDefault()` + `finish(false)` which clears `editingElementId`
  // synchronously. Without this guard the document handler runs next,
  // sees `editingElementId === null` (text-edit already cleared it),
  // proceeds past the editingElementId gate, and silently exits the
  // template-edit mode too — one Esc keypress eats BOTH the text-edit
  // AND the template-edit. The defaultPrevented check is the loud
  // contract: any earlier handler that consumed Esc with
  // preventDefault() owns the keystroke; the template-edit handler
  // must NOT compete. Position matters — this is the first check in
  // the handler, before editingCollectionTemplate / modalOpen /
  // editingElementId, so a consumed Esc never reaches any state read.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (ev.defaultPrevented) return;
    if (ctx.editingCollectionTemplate === null) return;
    if (ctx.modalOpen) return;
    if (ctx.editingElementId) return;
    ev.preventDefault();
    ctx.exitCollectionTemplateEdit();
  });

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
