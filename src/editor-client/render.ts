// src/editor-client/render.ts
//
// ADR 0058 Phase 2l — camera/viewport cluster + renderAll orchestrator.
// canvas-client.ts:672-825 carries the inline twin for the camera helpers
// (clampZoom, screenToWorld, worldToScreen, applyCameraTransform, setZoom,
// zoomAtPoint, fitToPage, fitZoom, computePagePositions, getPagePosition,
// fitAllPages). canvas-client.ts:3962-4054 carries the inline twin for
// renderAll + autoGrowTextElements. Both retire on Phase 3 cutover.
//
// Behavioural parity is pinned by the existing editor smokes against the
// production inline path; this module ships no sibling smoke (the bundle
// stays buildable but is dead code until createEditor is fleshed out).
//
// Thirteen functions live here:
//
//   - clampZoom(value, max) — snap zoom to one-decimal precision and
//     clamp to ZOOM_MIN .. (max ?? ZOOM_MAX_MANUAL). Returns 1 for
//     non-finite inputs (boot guard).
//
//   - screenToWorld(ctx, screenX, screenY) — map browser-coord pointer
//     into the un-transformed canvas-coord plane. No-op vector { x:0, y:0 }
//     when the viewport hasn't mounted yet (boot order matters).
//
//   - worldToScreen(ctx, worldX, worldY) — inverse of screenToWorld.
//
//   - applyCameraTransform(ctx) — write camera.x/camera.y/camera.zoom
//     into the canvas-root CSS transform + zoom readout. Triggers
//     repaintRemoteCursors + onMarkToolbarReflow when those ctx methods
//     are attached (gates with `typeof` checks to keep parity with the
//     inline IIFE's "wired late" boot order — co-edit cursors and the
//     mark toolbar register their callbacks after the camera fires its
//     first transform).
//
//   - setZoom(ctx, newZoom, maxClamp) — clampZoom + applyCameraTransform.
//
//   - zoomAtPoint(ctx, newZoom, screenX, screenY) — zoom keeping the
//     world-space coordinates under (screenX, screenY) fixed. Used by
//     wheel-zoom + pinch-zoom.
//
//   - fitToPage(ctx, pageId) — center the named page in the viewport and
//     auto-zoom up to ZOOM_MAX_FIT (100%). Defaults pageId to the active
//     page.
//
//   - fitZoom(ctx) — alias for fitToPage(null) used by the toolbar "Fit"
//     button.
//
//   - computePagePositions(ctx) — recompute pagePositions[] from
//     state.pages, summing per-section heights + header/footer + label
//     offsets. Mutates ctx.pagePositions in place.
//
//   - getPagePosition(ctx, pageId) — lookup helper over ctx.pagePositions.
//
//   - fitAllPages(ctx) — center the bounding box of all artboards in the
//     viewport and auto-zoom up to ZOOM_MAX_FIT (100%).
//
//   - renderAllImpl(ctx) — top-level render orchestrator. Rebuilds every
//     artboard from state.pages, applies the camera transform, kicks
//     downstream renderers (inspector / reel / placement slots) and
//     auto-grows text elements to their content height. Exported as
//     `renderAllImpl` (not `renderAll`) so createEditor can wire it onto
//     `ctx.renderAll = () => renderAllImpl(ctx)` at boot — the ctx
//     interface already declares the signature.
//
//   - autoGrowTextElements(ctx) — walk every [data-element-type="text"]
//     wrapper and grow the element's box height when its content overflows.
//     Called from renderAllImpl after the canvas mount; needs the live
//     DOM to read scrollHeight.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { EditorContext } from './editor-context.js';
import {
  ARTBOARD_LABEL_HEIGHT,
  PAGE_GAP,
  ZOOM_MAX_FIT,
  ZOOM_MAX_MANUAL,
  ZOOM_MIN,
} from './editor-constants.js';
import { applyCustomKitCss } from './custom-kit-css.js';
import { augmentCollectionPreviewsImpl } from './collection-preview.js';

export function clampZoom(value: number, max?: number): number {
  if (!Number.isFinite(value)) return 1;
  const upper = typeof max === 'number' ? max : ZOOM_MAX_MANUAL;
  if (value < ZOOM_MIN) return ZOOM_MIN;
  if (value > upper) return upper;
  // Snap to one-decimal precision so repeated +/- stays predictable.
  return Math.round(value * 10) / 10;
}

export function screenToWorld(
  ctx: EditorContext,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  if (!ctx.viewport) return { x: 0, y: 0 };
  const rect = ctx.viewport.getBoundingClientRect();
  return {
    x: (screenX - rect.left - ctx.camera.x) / ctx.camera.zoom,
    y: (screenY - rect.top - ctx.camera.y) / ctx.camera.zoom,
  };
}

export function worldToScreen(
  ctx: EditorContext,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  if (!ctx.viewport) return { x: 0, y: 0 };
  const rect = ctx.viewport.getBoundingClientRect();
  return {
    x: worldX * ctx.camera.zoom + ctx.camera.x + rect.left,
    y: worldY * ctx.camera.zoom + ctx.camera.y + rect.top,
  };
}

export function applyCameraTransform(ctx: EditorContext): void {
  if (!ctx.root) return;
  ctx.root.style.transform =
    'translate(' + ctx.camera.x + 'px, ' + ctx.camera.y + 'px) scale(' + ctx.camera.zoom + ')';
  ctx.root.style.transformOrigin = '0 0';
  if (ctx.zoomReadout) ctx.zoomReadout.textContent = Math.round(ctx.camera.zoom * 100) + '%';
  // Camera moved → every remote pointer-cursor's world→screen mapping
  // changed too. Skip when the layer hasn't mounted yet (very first
  // applyCameraTransform during boot fires before any peer connects).
  if (typeof ctx.repaintRemoteCursors === 'function') {
    ctx.repaintRemoteCursors();
  }
  // Mark toolbar + link popover anchor to a canvas element via
  // getBoundingClientRect (which already reflects the camera
  // transform); window.scroll/resize listeners cover browser scroll
  // but the canvas-internal pan/zoom never fires those, so the
  // toolbar would stick to its pre-pan screen position instead of
  // tracking its element. Re-position both whenever the camera moves.
  if (typeof ctx.onMarkToolbarReflow === 'function') {
    ctx.onMarkToolbarReflow();
  }
}

export function setZoom(ctx: EditorContext, newZoom: number, maxClamp?: number): void {
  ctx.camera.zoom = clampZoom(newZoom, maxClamp);
  applyCameraTransform(ctx);
}

export function zoomAtPoint(
  ctx: EditorContext,
  newZoom: number,
  screenX: number,
  screenY: number,
): void {
  if (!ctx.viewport) return;
  const rect = ctx.viewport.getBoundingClientRect();
  const worldX = (screenX - rect.left - ctx.camera.x) / ctx.camera.zoom;
  const worldY = (screenY - rect.top - ctx.camera.y) / ctx.camera.zoom;
  ctx.camera.zoom = clampZoom(newZoom, ZOOM_MAX_MANUAL);
  ctx.camera.x = screenX - rect.left - worldX * ctx.camera.zoom;
  ctx.camera.y = screenY - rect.top - worldY * ctx.camera.zoom;
  applyCameraTransform(ctx);
}

export function fitToPage(ctx: EditorContext, pageId: string | null): void {
  if (!ctx.viewport) return;
  const page = ctx.currentPage();
  const pos = getPagePosition(ctx, pageId || (page && page.id));
  if (!pos) return;
  const rect = ctx.viewport.getBoundingClientRect();
  const pad = 64;
  const availW = rect.width - pad * 2;
  const availH = rect.height - pad * 2;
  if (availW <= 0 || availH <= 0) return;
  const scaleX = availW / pos.width;
  const scaleY = availH / pos.height;
  const newZoom = clampZoom(Math.min(scaleX, scaleY), ZOOM_MAX_FIT);
  ctx.camera.zoom = newZoom;
  ctx.camera.x = (rect.width - pos.width * newZoom) / 2 - pos.x * newZoom;
  ctx.camera.y = (rect.height - pos.height * newZoom) / 2 - pos.y * newZoom;
  applyCameraTransform(ctx);
}

export function fitZoom(ctx: EditorContext): void {
  fitToPage(ctx, null);
}

// Pan-only camera move: bring the named page's top-left corner into the
// viewport at a small inset (PAD), preserving the current zoom. Used by
// setActivePageImpl so every page switch (link popover Go-to, page-list
// sidebar click, artboard label click, inactive-artboard click) brings
// the new artboard into view without re-zooming. Falls through to
// fitToPage when the page is too large to fit at the current zoom — that
// is the only branch that touches camera.zoom.
//
// Math:
//   worldToScreen says screen.x = world.x * zoom + camera.x + rect.left.
//   We want the page's left edge (world.x = pos.x) to land at viewport
//   left + PAD, i.e. screen.x = rect.left + PAD. Solving for camera.x:
//     camera.x = PAD - pos.x * zoom
//   Symmetric for y, with PAD against the viewport top.
export function panToPage(ctx: EditorContext, pageId: string | null): void {
  if (!ctx.viewport) return;
  const pos = getPagePosition(ctx, pageId);
  if (!pos) return;
  const rect = ctx.viewport.getBoundingClientRect();
  const pad = 64;
  const zoom = ctx.camera.zoom;
  // If the page is wider than the entire viewport at the current zoom,
  // fall back to fit-to-page so the user can see the whole thing. The
  // check intentionally ignores the inset — a page that's narrower than
  // the viewport but wider than (viewport - 2*pad) still fits well
  // enough at the requested inset and the right edge falls just past
  // the viewport, which matches the editor's existing aesthetic (the
  // initial-load home page sits with its right edge near the viewport
  // edge too).
  if (pos.width * zoom > rect.width) {
    fitToPage(ctx, pageId);
    return;
  }
  ctx.camera.x = pad - pos.x * zoom;
  ctx.camera.y = pad - pos.y * zoom;
  applyCameraTransform(ctx);
}

export function computePagePositions(ctx: EditorContext): void {
  if (!ctx.state || !ctx.state.pages) {
    ctx.pagePositions = [];
    return;
  }
  const positions: EditorContext['pagePositions'] = [];
  let x = 0;
  for (let i = 0; i < ctx.state.pages.length; i++) {
    const page = ctx.state.pages[i]!;
    let totalHeight = 0;
    for (let j = 0; j < page.sections.length; j++) {
      totalHeight += page.sections[j]!.height || 0;
    }
    if (ctx.state.header) totalHeight += ctx.state.header.height || 0;
    if (ctx.state.footer) totalHeight += ctx.state.footer.height || 0;
    positions.push({
      pageId: page.id,
      x: x,
      y: ARTBOARD_LABEL_HEIGHT,
      width: page.width,
      height: totalHeight,
    });
    x += page.width + PAGE_GAP;
  }
  ctx.pagePositions = positions;
}

export function getPagePosition(
  ctx: EditorContext,
  pageId: string | null | undefined,
): EditorContext['pagePositions'][number] | null {
  for (let i = 0; i < ctx.pagePositions.length; i++) {
    if (ctx.pagePositions[i]!.pageId === pageId) return ctx.pagePositions[i]!;
  }
  return null;
}

export function fitAllPages(ctx: EditorContext): void {
  if (!ctx.viewport || ctx.pagePositions.length === 0) return;
  const rect = ctx.viewport.getBoundingClientRect();
  const pad = 64;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < ctx.pagePositions.length; i++) {
    const p = ctx.pagePositions[i]!;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + p.width > maxX) maxX = p.x + p.width;
    if (p.y + p.height > maxY) maxY = p.y + p.height;
  }
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  if (contentW <= 0 || contentH <= 0) return;
  const availW = rect.width - pad * 2;
  const availH = rect.height - pad * 2;
  const scaleX = availW / contentW;
  const scaleY = availH / contentH;
  const newZoom = clampZoom(Math.min(scaleX, scaleY), ZOOM_MAX_FIT);
  ctx.camera.zoom = newZoom;
  ctx.camera.x = (rect.width - contentW * newZoom) / 2 - minX * newZoom;
  ctx.camera.y = (rect.height - contentH * newZoom) / 2 - minY * newZoom;
  applyCameraTransform(ctx);
}

// -- renderAll orchestrator ---------------------------------------------

export function renderAllImpl(ctx: EditorContext): void {
  if (!ctx.state) return;
  computePagePositions(ctx);

  const fragment = document.createDocumentFragment();

  for (let pi = 0; pi < ctx.state.pages.length; pi++) {
    const page = ctx.state.pages[pi]!;
    const pos = getPagePosition(ctx, page.id);
    if (!pos) continue;

    const artboard = document.createElement('div');
    artboard.className = 'opencanvas-artboard';
    artboard.setAttribute('data-page-id', page.id);
    artboard.setAttribute(
      'data-active',
      page.id === (ctx.activePageId || ctx.state.pages[0]!.id) ? 'true' : 'false',
    );
    artboard.style.transform = 'translate(' + pos.x + 'px, ' + pos.y + 'px)';

    const label = document.createElement('div');
    label.className = 'opencanvas-artboard-label';
    label.textContent = page.title || page.slug;
    label.setAttribute('data-page-id', page.id);
    artboard.appendChild(label);

    const article = document.createElement('article');
    article.className = 'opencanvas-page';
    article.setAttribute('data-opencanvas-page', page.id);
    article.style.position = 'relative';
    ctx.applyPageMotionAttributes(article, page);
    ctx.applyPageStyleProperties(article, page);
    const renderWidth = ctx.pageRenderWidth(page);

    if (ctx.state.header) {
      article.appendChild(ctx.buildSectionNode(ctx.state.header, renderWidth));
    }

    const pageGhosts = ctx.ghostSections.filter(
      (g) => g.pageId === null || g.pageId === page.id,
    );
    // Ghosts at afterSectionId === null mount at the very top of the page
    // body (above the first real section). This matches the orchestrator
    // semantics where null means "insert at top".
    for (let gi = 0; gi < pageGhosts.length; gi++) {
      if (pageGhosts[gi]!.afterSectionId === null) {
        article.appendChild(buildGhostSectionNode(ctx, pageGhosts[gi]!, renderWidth));
      }
    }

    for (let si = 0; si < page.sections.length; si++) {
      const section = page.sections[si]!;
      article.appendChild(ctx.buildSectionNode(section, renderWidth));
      for (let gi = 0; gi < pageGhosts.length; gi++) {
        if (pageGhosts[gi]!.afterSectionId === section.id) {
          article.appendChild(buildGhostSectionNode(ctx, pageGhosts[gi]!, renderWidth));
        }
      }
    }

    // Stale-ghost fallback: any ghost whose afterSectionId no longer points
    // at a real section on this page (the section was renamed or deleted
    // between op-preview and renderAll) gets appended at the end so the
    // Owner still sees the proposal instead of it silently disappearing.
    for (let gi = 0; gi < pageGhosts.length; gi++) {
      const g = pageGhosts[gi]!;
      if (g.afterSectionId === null) continue;
      const stillExists = page.sections.some((s) => s.id === g.afterSectionId);
      if (!stillExists) {
        article.appendChild(buildGhostSectionNode(ctx, g, renderWidth));
      }
    }

    if (ctx.state.footer) {
      article.appendChild(ctx.buildSectionNode(ctx.state.footer, renderWidth));
    }

    artboard.appendChild(article);

    const outline = document.createElement('div');
    outline.className = 'opencanvas-artboard-outline';
    artboard.appendChild(outline);

    fragment.appendChild(artboard);
  }

  ctx.root!.replaceChildren(fragment);

  if (ctx.mainEl && ctx.state.styleKit) {
    ctx.mainEl.setAttribute('data-style-kit', ctx.state.styleKit);
  }
  applyCustomKitCss(ctx.state);
  // Keep the sidebar style-kit chips in sync with state.styleKit so that
  // undo/redo (or any non-sidebar kit change) reflects in the chip row.
  const sidebarKitButtons = document.querySelectorAll('[data-sidebar-style-kit]');
  if (sidebarKitButtons.length > 0) ctx.syncSidebarStyleKitButtons(sidebarKitButtons);

  applyCameraTransform(ctx);
  ctx.renderInspector();

  ctx.renderReel();
  autoGrowTextElements(ctx);
  // ADR 0063 dec 5 — augment Collection wrappers with editor-only
  // placeholder card chrome (3 cards + a "Source: <slug or unset>"
  // banner) when the binding is unset or matches zero entries. Runs
  // strictly after autoGrowTextElements so the inner frame's final box
  // dimensions are settled; the augmenter is idempotent so a redundant
  // call on a no-Collection page is a cheap zero-iteration loop.
  augmentCollectionPreviewsImpl(ctx);

  if (ctx.pendingImport) {
    ctx.renderPlacementSlots();
  }

  if (!ctx.activePageId && ctx.state.pages.length > 0) {
    ctx.activePageId = ctx.state.pages[0]!.id;
  }
}

export function autoGrowTextElements(ctx: EditorContext): void {
  const wrappers = ctx.root!.querySelectorAll('[data-element-type="text"]');
  for (let i = 0; i < wrappers.length; i++) {
    const w = wrappers[i] as HTMLElement;
    const inner = w.querySelector('.opencanvas-text');
    if (!inner) continue;
    const eid = w.getAttribute('data-opencanvas-element');
    if (!eid) continue;
    const found = ctx.findElement(eid);
    if (!found) continue;
    const textH = (inner as HTMLElement).scrollHeight;
    if (textH > found.element.box.h) {
      found.element.box.h = textH;
      ctx.setBoxStyle(w, found.element.box);
    }
  }
}

// ---------------------------------------------------------------------------
// Ghost-section wrapper — wraps ctx.buildSectionNode output with a dimmed,
// dashed-border, "AI proposal" pilled container so the Owner sees what the
// agent is proposing in place. Pointer events are off on the inner content
// so a stray drag doesn't try to edit the ghost; the wrapper itself can
// still receive a click so a future affordance (e.g. inline accept/reject)
// has somewhere to live. Today there are no inline ghost buttons — the
// authoritative Accept/Reject live on the chat suggestion card.
// ---------------------------------------------------------------------------

function buildGhostSectionNode(
  ctx: EditorContext,
  ghost: EditorContext['ghostSections'][number],
  renderWidth: number,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'opencanvas-ghost-section';
  wrapper.setAttribute('data-opencanvas-ghost-section', ghost.id);
  wrapper.style.position = 'relative';
  wrapper.style.width = renderWidth + 'px';

  const pill = document.createElement('div');
  pill.className = 'opencanvas-ghost-pill';
  pill.textContent = 'AI proposal';
  wrapper.appendChild(pill);

  const inner = ctx.buildSectionNode(ghost.section, renderWidth);
  inner.setAttribute('data-ghost', 'true');
  wrapper.appendChild(inner);

  return wrapper;
}
