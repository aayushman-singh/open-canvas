// src/editor-client/drag-resize.ts
//
// ADR 0058 Phase 2i — drag/resize handler cluster + pointer wiring.
// Now the production source-of-truth following the ADR 0015 Phase 3
// cutover; the editor route serves this bundle and the inline IIFE is
// retired.
//
// Three exports:
//
//   - attachPointerHandlersImpl(ctx) — the boot-time wiring fn. Attaches
//     onCanvasLinkHover/Leave to ctx.root and a `mousedown` handler that
//     branches three ways: bail in pan-mode (the camera pan path owns
//     mousedown then), start a beginResize on a resize-handle click, or
//     resolve the element wrapper at the pointer and either select it
//     (first click) or start a beginDrag (second click on the same
//     selection). Resists three pre-existing mousedown owners learned the
//     hard way: the element context menu, the section grip's reel-open,
//     and the tabs element's tab-switch button. createEditor invokes
//     this once at boot; not bound onto ctx itself since no other module
//     re-fires it.
//
//   - beginDragImpl(ctx, startEv, wrapper) — frame-relative drag of the
//     element under `wrapper`. Frame resolution walks up to the nearest
//     tab-panel or section ancestor so a tab-panel child stays inside its
//     panel rather than escaping into the parent section. Mutates
//     wrapper.style.left/top + found.element.box.x/y on every mousemove
//     and calls ctx.scheduleSave on mouseup; does NOT call captureForUndo
//     (intentional — the snapshot is taken at the mousedown→select
//     transition, not at the drag-end transition). Throws loudly when
//     frameEl is a section but no active page exists (boot-ordering bug
//     rather than a silent "skip the drag" default).
//
//   - beginResizeImpl(ctx, startEv, wrapper, dir) — frame-relative resize
//     with eight-direction handle dispatch. Same frame resolution as
//     beginDrag; reads MIN_ELEMENT_SIZE_PX off ctx so the lower-bound
//     clamp matches the historical inline closure constant. fromLeft/
//     fromTop track which side moves with the pointer (north/west handles
//     shift origin while south/east only grow size). Same throw-on-
//     missing-page contract as beginDrag.
//
// Bound math notes: the section branch reads page.width + section.height
// directly from state (canonical world coords). The nested-frame branch
// reads getBoundingClientRect on the tab-panel / collection card and
// divides by ctx.camera.zoom — the rect is screen-space (post canvas
// zoom on ctx.root) and the section ancestor itself uses translate-only
// transforms, so a single divide by the camera zoom recovers world
// coords. Regression: a former wrapperScale() helper read the section's
// own transform looking for a scale factor that was never there (the
// scale lives on ctx.root), causing the nested-frame clamp to collapse
// to camera.zoom × world-size and trap dragged elements in roughly the
// top-left quadrant of the panel at any zoom < 1.

import type {
  DomContext,
  EditorContext,
  PersistContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import {
  enterFreeformDrawModeImpl,
  exitFreeformDrawModeImpl,
  syncFreeformDrawToolbarImpl,
} from './shape-freeform-draw.js';

/**
 * 8px snap grid applied to free-form element positioning during drag/resize.
 * Holding Alt during the gesture bypasses snap for pixel-precise nudges.
 * The matching grid overlay is rendered by CSS on any frame element that
 * carries the `data-snap-overlay` attribute (set on gesture start, removed
 * on gesture end by beginDragImpl/beginResizeImpl).
 */
const SNAP_GRID_PX = 8;
function snapTo(value: number, gridPx: number): number {
  return Math.round(value / gridPx) * gridPx;
}

// ADR 0064 — the drag math touches StateContext (findElement +
// currentPage for the section-branch bounds) and PersistContext
// (scheduleSave on mouseup), plus three non-canonical helpers
// (pointerToCanvas, camera) that this module owns. Shared between
// beginDragImpl and beginResizeImpl; beginResize extends it with
// MIN_ELEMENT_SIZE_PX.
export type DragGestureContext = StateContext &
  PersistContext &
  Pick<EditorContext, 'pointerToCanvas' | 'camera'>;

// ADR 0064 — resize adds the min-size clamp constant to the drag
// surface. Kept as a distinct alias so beginDragImpl doesn't have to
// pretend to need MIN_ELEMENT_SIZE_PX.
export type ResizeGestureContext = DragGestureContext & Pick<EditorContext, 'MIN_ELEMENT_SIZE_PX'>;

// ADR 0064 — the root mousedown wiring touches DomContext for the
// canvas root, SelectionContext for the click→select→drag latch, then
// forwards into the drag/resize gesture surfaces. Adds the four
// non-canonical verbs / state fields that drive the mousedown branch
// (interactionMode, hover dispatch, element-wrapper hit-test).
export type AttachPointerHandlersContext = DomContext &
  SelectionContext &
  ResizeGestureContext &
  Pick<
    EditorContext,
    | 'interactionMode'
    | 'onCanvasLinkHover'
    | 'onCanvasLinkHoverLeave'
    | 'resolveElementWrapperAtPoint'
  >;

// ADR 0064 — interaction-mode toggle reads/writes the live mode flag,
// the viewport DOM ref (DomContext), and the zoom toolbar ref (not in
// any canonical alias yet — inline Pick).
export type SetInteractionModeContext = DomContext &
  StatusEmitterContext &
  Pick<EditorContext, 'interactionMode' | 'zoomToolbar' | 'pendingFreeformDraw'>;

// ADR 0064 — the temporary-pan state machine is two flags plus the
// recursive call into setInteractionMode. No canonical alias owns the
// pan-state pair yet, so the inline Pick enumerates them honestly.
export type TemporaryPanContext = SetInteractionModeContext &
  Pick<EditorContext, 'spaceHeldForPan' | 'temporaryPanPreviousMode'>;

// ADR 0064 — placement-mode exit clears the pending import, surfaces a
// "Cancelled" toast (StatusEmitterContext), and re-renders the two
// sidebar panels that show placement affordances. The two render verbs
// are not in RenderContext (which only carries the canvas-side
// orchestrators), so they live in the inline Pick.
export type ExitPlacementModeContext = StatusEmitterContext &
  Pick<EditorContext, 'pendingImport' | 'renderSectionsPanel' | 'renderPlacementSlots'>;

export function attachPointerHandlersImpl(ctx: AttachPointerHandlersContext): void {
  const root = ctx.root;
  if (!root) return;
  // Canvas-wide link hover → popover. Inline marks inside a contenteditable
  // text element are handled by beginTextEdit's per-inner listeners; this
  // wiring covers nav links and action elements which live outside any
  // contenteditable subtree. Arrow wrappers avoid passing bare ctx methods
  // as listeners (which trips unbound-method lint — the methods do not
  // capture `this` but the rule cannot prove that statically).
  root.addEventListener('mouseover', (ev) => {
    ctx.onCanvasLinkHover(ev);
  });
  root.addEventListener('mouseout', (ev) => {
    ctx.onCanvasLinkHoverLeave(ev);
  });
  root.addEventListener('mousedown', (ev) => {
    if (ctx.interactionMode === 'pan' || ctx.interactionMode === 'draw') return;
    if (
      ev.target instanceof Element &&
      (ev.target.closest('[data-element-menu-trigger]') || ev.target.closest('[data-element-menu]'))
    )
      return;
    // Grip clicks own their own mousedown/click semantics (open reel,
    // optionally start a section drag). Letting this handler resolve an
    // element wrapper at the grip's pixel would select whatever element's
    // bbox overlaps the grip and immediately close the freshly-opened reel.
    if (ev.target instanceof Element && ev.target.closest('[data-section-grip]')) return;
    // Tab buttons inside a tabs element handle their own click to switch
    // the active tab. Letting this handler resolve the parent tabs wrapper
    // would either re-select the same element on every click (a no-op
    // round-trip) or — on a second click — start a drag that jitters the
    // wrapper before the button's click handler can swap tabs.
    if (ev.target instanceof Element && ev.target.closest('[data-opencanvas-tab-id]')) return;
    // Carousel arrows + dots (hydrated by ./hydrate-interactives.ts) own
    // their own click semantics — advance / rewind the slide cursor — and
    // call stopPropagation so the root click listener doesn't also fire.
    // mousedown bubbles BEFORE the hydrator's stopPropagation can intervene,
    // so we have to bail here explicitly: without this guard, a click on an
    // already-selected carousel's arrow would start a drag of the whole
    // carousel before the click handler runs.
    if (
      ev.target instanceof Element &&
      ev.target.closest(
        '[data-opencanvas-carousel-prev], [data-opencanvas-carousel-next], [data-opencanvas-carousel-dot]',
      )
    )
      return;
    const handle = ev.target instanceof Element ? ev.target.closest('[data-resize-handle]') : null;
    if (handle) {
      const wrapper = handle.closest('.opencanvas-element');
      const dir = handle.getAttribute('data-resize-dir') || 'se';
      if (wrapper) {
        beginResizeImpl(ctx, ev, wrapper as HTMLElement, dir);
        ev.preventDefault();
      }
      return;
    }
    const wrapper =
      ev.target instanceof Element
        ? ctx.resolveElementWrapperAtPoint(ev.target, ev.clientX, ev.clientY)
        : null;
    if (!wrapper) return;
    const elementId = wrapper.getAttribute('data-opencanvas-element');
    if (!elementId) return;
    if (ctx.editingElementId === elementId) return;
    const elType = wrapper.getAttribute('data-element-type');
    if (elType === 'text') return;
    if (ctx.selectedElementId !== elementId) {
      ctx.selectElement(elementId);
      return;
    }
    beginDragImpl(ctx, ev, wrapper);
    ev.preventDefault();
  });
}

export function beginDragImpl(
  ctx: DragGestureContext,
  startEv: PointerEvent | MouseEvent,
  wrapper: HTMLElement,
): void {
  if (wrapper.classList.contains('opencanvas-flow-content')) return;
  const elementId = wrapper.getAttribute('data-opencanvas-element');
  if (!elementId) return;
  const found = ctx.findElement(elementId);
  if (!found) return;
  // The element's box is in its IMMEDIATE container's coord space. For a
  // section child that's the section. For a tab-panel or collection-entry
  // child it's the panel/card. For an element inside an active
  // collection-template-edit frame (ADR 0065 D5, codex review pass 3
  // finding 5) the box is panel-local to the `.opencanvas-collection-
  // template-edit` wrapper, NOT the surrounding section — without that
  // selector the frame resolver falls back to the parent section's
  // bounds and the dragged element can land outside the template card,
  // tripping the validator's box-bounds rule and corrupting layout.
  const frame = wrapper.parentElement
    ? wrapper.parentElement.closest(
        '.opencanvas-tab-panel, .opencanvas-collection-template-edit, .opencanvas-section',
      )
    : null;
  const frameEl = (frame || wrapper.closest('.opencanvas-section')) as HTMLElement | null;
  if (!frameEl) return;
  const start = ctx.pointerToCanvas(startEv, frameEl);
  if (!start) return;
  const originalBox = Object.assign({}, found.element.box);
  // Bounds: at section level use the page width + section height (the
  // authoritative values from state). For nested containers (tab panel,
  // collection card) read the rendered box and divide by the canvas zoom
  // applied to ctx.root — getBoundingClientRect is post-transform, so the
  // raw width/height are screen-pixel multiples of the world-coord box.
  // ctx.camera.zoom is the ONLY scale between the section ancestor and the
  // viewport (sections themselves use translate-only transforms), so this
  // single divide recovers the world-coord box authoritatively.
  let boundW: number;
  let boundH: number;
  if (frameEl.classList.contains('opencanvas-section')) {
    const page = ctx.currentPage();
    if (!page) throw new Error('beginDrag: element ' + elementId + ' has no active page');
    boundW = page.width;
    boundH = found.section.height;
  } else {
    const rect = frameEl.getBoundingClientRect();
    const zoom = ctx.camera.zoom > 0 ? ctx.camera.zoom : 1;
    boundW = rect.width / zoom;
    boundH = rect.height / zoom;
  }

  frameEl.setAttribute('data-snap-overlay', '');

  function onMove(ev: MouseEvent): void {
    const current = ctx.pointerToCanvas(ev, frameEl!);
    if (!current) return;
    const dx = current.x - start!.x;
    const dy = current.y - start!.y;
    let nx = originalBox.x + dx;
    let ny = originalBox.y + dy;
    if (!ev.altKey) {
      nx = snapTo(nx, SNAP_GRID_PX);
      ny = snapTo(ny, SNAP_GRID_PX);
    }
    if (nx < 0) nx = 0;
    if (ny < 0) ny = 0;
    if (nx + originalBox.w > boundW) nx = boundW - originalBox.w;
    if (ny + originalBox.h > boundH) ny = boundH - originalBox.h;
    wrapper.style.left = nx + 'px';
    wrapper.style.top = ny + 'px';
    found!.element.box.x = nx;
    found!.element.box.y = ny;
  }
  function onUp(): void {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    frameEl!.removeAttribute('data-snap-overlay');
    ctx.scheduleSave();
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

export function beginResizeImpl(
  ctx: ResizeGestureContext,
  startEv: PointerEvent | MouseEvent,
  wrapper: HTMLElement,
  dir: string,
): void {
  if (wrapper.classList.contains('opencanvas-flow-content')) return;
  const elementId = wrapper.getAttribute('data-opencanvas-element');
  if (!elementId) return;
  const found = ctx.findElement(elementId);
  if (!found) return;
  // Match beginDrag's frame resolution so resizing a tab-panel/collection
  // child respects panel-local coords rather than section coords.
  // Codex review pass 3 finding 5 — `.opencanvas-collection-template-edit`
  // is the editor-only frame mounted around an active custom-template
  // wrapper (body-builders-data.ts:596); without it the resize falls back
  // to the parent section's bounds, letting handles drag past the template
  // card's edge.
  const frame = wrapper.parentElement
    ? wrapper.parentElement.closest(
        '.opencanvas-tab-panel, .opencanvas-collection-template-edit, .opencanvas-section',
      )
    : null;
  const frameEl = (frame || wrapper.closest('.opencanvas-section')) as HTMLElement | null;
  if (!frameEl) return;
  const start = ctx.pointerToCanvas(startEv, frameEl);
  if (!start) return;
  const ob = Object.assign({}, found.element.box);
  let pageWidth: number;
  let sectionHeight: number;
  if (frameEl.classList.contains('opencanvas-section')) {
    const page = ctx.currentPage();
    if (!page) throw new Error('beginResize: element ' + elementId + ' has no active page');
    pageWidth = page.width;
    sectionHeight = found.section.height;
  } else {
    // Mirrors beginDrag's bound math — see comment there. The rect is
    // screen-space (post canvas zoom); world-coord bounds = rect / camera.zoom.
    const rect = frameEl.getBoundingClientRect();
    const zoom = ctx.camera.zoom > 0 ? ctx.camera.zoom : 1;
    pageWidth = rect.width / zoom;
    sectionHeight = rect.height / zoom;
  }
  const moveX = dir.includes('e') || dir.includes('w');
  const moveY = dir.includes('s') || dir.includes('n');
  const fromLeft = dir.includes('w');
  const fromTop = dir.includes('n');
  frameEl.setAttribute('data-snap-overlay', '');

  function onMove(ev: MouseEvent): void {
    const current = ctx.pointerToCanvas(ev, frameEl!);
    if (!current) return;
    const dx = current.x - start!.x;
    const dy = current.y - start!.y;
    let nx = ob.x;
    let ny = ob.y;
    let nw = ob.w;
    let nh = ob.h;
    if (moveX) {
      if (fromLeft) {
        nx = ob.x + dx;
        nw = ob.w - dx;
      } else {
        nw = ob.w + dx;
      }
    }
    if (moveY) {
      if (fromTop) {
        ny = ob.y + dy;
        nh = ob.h - dy;
      } else {
        nh = ob.h + dy;
      }
    }
    // Snap only the edge the user is dragging; the opposite edge stays where
    // it started. Right/bottom edges snap via nx+nw / ny+nh so both edges
    // end up on the grid, then we back-compute the new size.
    if (!ev.altKey) {
      if (moveX) {
        if (fromLeft) {
          const snapped = snapTo(nx, SNAP_GRID_PX);
          nw = nx + nw - snapped;
          nx = snapped;
        } else {
          nw = snapTo(nx + nw, SNAP_GRID_PX) - nx;
        }
      }
      if (moveY) {
        if (fromTop) {
          const snapped = snapTo(ny, SNAP_GRID_PX);
          nh = ny + nh - snapped;
          ny = snapped;
        } else {
          nh = snapTo(ny + nh, SNAP_GRID_PX) - ny;
        }
      }
    }
    if (nw < ctx.MIN_ELEMENT_SIZE_PX) {
      if (fromLeft) nx = ob.x + ob.w - ctx.MIN_ELEMENT_SIZE_PX;
      nw = ctx.MIN_ELEMENT_SIZE_PX;
    }
    if (nh < ctx.MIN_ELEMENT_SIZE_PX) {
      if (fromTop) ny = ob.y + ob.h - ctx.MIN_ELEMENT_SIZE_PX;
      nh = ctx.MIN_ELEMENT_SIZE_PX;
    }
    if (nx < 0) {
      nw += nx;
      nx = 0;
    }
    if (ny < 0) {
      nh += ny;
      ny = 0;
    }
    if (nx + nw > pageWidth) nw = pageWidth - nx;
    if (ny + nh > sectionHeight) nh = sectionHeight - ny;
    wrapper.style.left = nx + 'px';
    wrapper.style.top = ny + 'px';
    wrapper.style.width = nw + 'px';
    wrapper.style.height = nh + 'px';
    found!.element.box.x = nx;
    found!.element.box.y = ny;
    found!.element.box.w = nw;
    found!.element.box.h = nh;
  }
  function onUp(): void {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    frameEl!.removeAttribute('data-snap-overlay');
    ctx.scheduleSave();
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// -- Phase 2i ctx-method implementations -------------------------------
//
// The four state-management functions (setInteractionMode,
// clearTemporaryPanState, endTemporaryPan, exitPlacementMode) were
// forward-declared in Phase 2o.b for the keyboard module's consumption.
// Phase 2i now owns the implementations. createEditor binds them as:
//   ctx.setInteractionMode    = (mode) => setInteractionModeImpl(ctx, mode);
//   ctx.clearTemporaryPanState = ()    => clearTemporaryPanStateImpl(ctx);
//   ctx.endTemporaryPan        = ()    => endTemporaryPanImpl(ctx);
//   ctx.exitPlacementMode      = ()    => exitPlacementModeImpl(ctx);

export function setInteractionModeImpl(ctx: SetInteractionModeContext, mode: string): void {
  if (mode === 'draw') {
    if (ctx.pendingFreeformDraw) {
      exitFreeformDrawModeImpl(ctx, true);
    } else {
      enterFreeformDrawModeImpl(ctx);
    }
    return;
  }
  if (ctx.pendingFreeformDraw) {
    exitFreeformDrawModeImpl(ctx, false);
  }
  if (mode !== 'select' && mode !== 'pan') {
    throw new Error('setInteractionMode: expected select, pan, or draw, got ' + String(mode));
  }
  ctx.interactionMode = mode;
  if (ctx.viewport) {
    ctx.viewport.setAttribute('data-interaction-mode', mode);
  }
  syncFreeformDrawToolbarImpl(ctx);
}

export function clearTemporaryPanStateImpl(
  ctx: Pick<EditorContext, 'spaceHeldForPan' | 'temporaryPanPreviousMode'>,
): void {
  ctx.spaceHeldForPan = false;
  ctx.temporaryPanPreviousMode = null;
}

export function endTemporaryPanImpl(ctx: TemporaryPanContext): void {
  if (!ctx.spaceHeldForPan) return;
  const nextMode = ctx.temporaryPanPreviousMode || 'select';
  clearTemporaryPanStateImpl(ctx);
  setInteractionModeImpl(ctx, nextMode);
}

export function exitPlacementModeImpl(ctx: ExitPlacementModeContext): void {
  ctx.pendingImport = null;
  ctx.setStatus('Cancelled', 'ok');
  ctx.renderSectionsPanel();
  ctx.renderPlacementSlots();
}
