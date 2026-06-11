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

import type { EditorContext, StateContext } from './editor-context.js';
import {
  ARTBOARD_LABEL_HEIGHT,
  PAGE_GAP,
  ZOOM_MAX_FIT,
  ZOOM_MAX_MANUAL,
  ZOOM_MIN,
} from './editor-constants.js';
import { applyCustomKitCss } from './custom-kit-css.js';
import type { MountTemplateEditChromeContext } from './collection-template-edit-view.js';
import { mountTemplateEditChromeImpl } from './collection-template-edit-view.js';
import { hydrateInteractives } from './hydrate-interactives.js';

// ADR 0064 — narrow Pick-based contexts for render.ts. The camera +
// pagePositions cluster has no canonical alias yet; per-function shapes
// share `CameraTransformContext` (the write-the-camera-into-the-DOM
// surface), `CameraProjectionContext` (the screen↔world projection),
// and `PagePositionsReaderContext` (the page-bounds lookup) so the
// projection helpers and the fit/pan/renderAll verbs don't redeclare
// their overlap. `StateContext` from editor-context.ts is folded in
// where the page list is read.

// ADR 0064 — write the camera state into the canvas root + zoom readout.
// Optional remote-cursor + mark-toolbar reflow hooks are kept optional
// at the type level so the boot-time `typeof === 'function'` gates stay
// honest (they fire only after the co-edit / mark clusters wire in).
export type CameraTransformContext = Pick<
  EditorContext,
  'root' | 'camera' | 'zoomReadout' | 'repaintRemoteCursors' | 'onMarkToolbarReflow'
>;

// ADR 0064 — viewport + camera together drive every screen↔world
// projection. screenToWorld / worldToScreen ride this exact pair; the
// fit / pan verbs extend it with the CameraTransform surface.
export type CameraProjectionContext = Pick<EditorContext, 'viewport' | 'camera'>;

// ADR 0064 — page-positions cache reader. getPagePosition is internal
// but its surface flows into fitToPage / panToPage / fitAllPages, so it
// earns its own narrow type instead of inline Picks at three call sites.
export type PagePositionsReaderContext = Pick<EditorContext, 'pagePositions'>;

export function clampZoom(value: number, max?: number): number {
  if (!Number.isFinite(value)) return 1;
  const upper = typeof max === 'number' ? max : ZOOM_MAX_MANUAL;
  if (value < ZOOM_MIN) return ZOOM_MIN;
  if (value > upper) return upper;
  // Snap to one-decimal precision so repeated +/- stays predictable.
  return Math.round(value * 10) / 10;
}

// ADR 0064 — screen → world pointer projection. Rides the bare
// viewport + camera pair; co-edit.ts and runtime-helpers.ts already
// pass `ctx: EditorContext`, which is structurally a CameraProjectionContext.
export function screenToWorld(
  ctx: CameraProjectionContext,
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

// ADR 0064 — inverse of screenToWorld. Same CameraProjectionContext
// surface; co-edit.ts is the sole external caller and passes the wide
// EditorContext, which satisfies the narrower view structurally.
export function worldToScreen(
  ctx: CameraProjectionContext,
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

// ADR 0064 — write camera.x/y/zoom into the canvas-root CSS transform
// + zoom-readout text, then fan out to the optional remote-cursor and
// mark-toolbar reflow hooks. ai-integration / collection-template-edit-
// view / section-toolbar / runtime-helpers all pass `ctx: EditorContext`.
export function applyCameraTransform(ctx: CameraTransformContext): void {
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

// ADR 0064 — clampZoom + applyCameraTransform. Needs the
// CameraTransform surface plus a writable camera; the latter rides
// inside CameraTransformContext (camera is a non-readonly field on
// EditorContext, so the Pick stays mutable).
export function setZoom(
  ctx: CameraTransformContext,
  newZoom: number,
  maxClamp?: number,
): void {
  ctx.camera.zoom = clampZoom(newZoom, maxClamp);
  applyCameraTransform(ctx);
}

// ADR 0064 — pinned-point zoom (wheel + pinch). Needs the viewport's
// bounding rect on top of the CameraTransform surface, so the param
// type is the intersection of both narrow views.
export function zoomAtPoint(
  ctx: CameraTransformContext & Pick<EditorContext, 'viewport'>,
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

// ADR 0064 — center the named page in the viewport and auto-zoom up to
// ZOOM_MAX_FIT (100%). Exported narrow type so save-wiring.ts can drop
// its `ctx as EditorContext` forward-cast on the `1` shortcut. Surface =
// CameraTransform (write camera + DOM) + viewport (bounding rect) +
// pagePositions (page bounds) + StateContext (currentPage default).
export type FitToPageContext = CameraTransformContext &
  Pick<EditorContext, 'viewport'> &
  PagePositionsReaderContext &
  Pick<StateContext, 'currentPage'>;

export function fitToPage(ctx: FitToPageContext, pageId: string | null): void {
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

// ADR 0064 — toolbar "Fit" button — straight delegate to fitToPage with
// a null page id (which then resolves the active page through
// ctx.currentPage). Rides the same FitToPageContext surface.
export function fitZoom(ctx: FitToPageContext): void {
  fitToPage(ctx, null);
}

// Pan-only camera move: center the named page in the viewport at the
// CURRENT zoom. Never touches camera.zoom — if the page is larger than
// the viewport at the current zoom the user sees a centered page that
// extends past the edges, and can zoom out manually. The earlier
// fitToPage fallback was removed because resetting zoom on what the
// caller asked for as a "pan" surprised users (the camera would
// silently shrink the whole canvas just because the target page didn't
// happen to fit).
//
// Math (mirrors fitToPage's centering, but using current zoom):
//   To put the page's center at the viewport's center:
//     camera.x = (rect.width - pos.width * zoom) / 2 - pos.x * zoom
//     camera.y = (rect.height - pos.height * zoom) / 2 - pos.y * zoom
//   Derivation: worldToScreen says screen.x = world.x * zoom + camera.x +
//   rect.left. The page's center sits at world.x = pos.x + pos.width/2.
//   Setting its screen.x to rect.left + rect.width/2 and solving for
//   camera.x gives the formula above.
// ADR 0064 — pan-only camera move; centers the named page at the
// current zoom without ever touching camera.zoom. Same surface as
// FitToPage minus the currentPage default (callers always pass a
// concrete pageId — set-active-page-pan smoke pins that contract).
export type PanToPageContext = CameraTransformContext &
  Pick<EditorContext, 'viewport'> &
  PagePositionsReaderContext;

export function panToPage(ctx: PanToPageContext, pageId: string | null): void {
  if (!ctx.viewport) return;
  const pos = getPagePosition(ctx, pageId);
  if (!pos) return;
  const rect = ctx.viewport.getBoundingClientRect();
  const zoom = ctx.camera.zoom;
  ctx.camera.x = (rect.width - pos.width * zoom) / 2 - pos.x * zoom;
  ctx.camera.y = (rect.height - pos.height * zoom) / 2 - pos.y * zoom;
  applyCameraTransform(ctx);
}

// ADR 0064 — rebuild pagePositions[] from state.pages (sums per-section
// height + header/footer). Writes the result back onto ctx.pagePositions
// in place, so the param surface needs both the state reader and the
// pagePositions slot.
export type ComputePagePositionsContext = Pick<EditorContext, 'state'> &
  PagePositionsReaderContext;

export function computePagePositions(ctx: ComputePagePositionsContext): void {
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

// ADR 0064 — pagePositions lookup by id. Internal helper for the
// fit/pan verbs; PagePositionsReaderContext is sufficient surface.
export function getPagePosition(
  ctx: PagePositionsReaderContext,
  pageId: string | null | undefined,
): EditorContext['pagePositions'][number] | null {
  for (let i = 0; i < ctx.pagePositions.length; i++) {
    if (ctx.pagePositions[i]!.pageId === pageId) return ctx.pagePositions[i]!;
  }
  return null;
}

// ADR 0064 — center the bounding box of every artboard in the viewport
// and auto-zoom up to ZOOM_MAX_FIT (100%). Exported narrow type so
// save-wiring.ts can drop its `ctx as EditorContext` forward-cast on
// the `0` shortcut. Surface = CameraTransform (write camera + DOM) +
// viewport (bounding rect) + pagePositions (all-page bounds). No state
// reader needed — the bounds come straight off pagePositions.
export type FitAllPagesContext = CameraTransformContext &
  Pick<EditorContext, 'viewport'> &
  PagePositionsReaderContext;

export function fitAllPages(ctx: FitAllPagesContext): void {
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

// ADR 0064 — top-level render. Touches the widest surface in this
// module: ComputePagePositions (state → pagePositions rebuild), every
// page-build verb (applyPageMotionAttributes, applyPageStyleProperties,
// pageRenderWidth, buildSectionNode), ghostSections + activePageId for
// the artboard chrome, mainEl + syncSidebarStyleKitButtons for the
// style-kit chip sync, CameraTransform for the final paint, then
// renderInspector / renderReel / autoGrowTextElements / placement
// slots. No canonical alias covers the page-build verbs yet, so they
// live as an inline Pick. Folds in MountTemplateEditChromeContext so the
// mount* forward site typechecks without `ctx as EditorContext`
// scaffolding (its ADR 0064 carve landed in 300ad71).
export type RenderAllContext = ComputePagePositionsContext &
  CameraTransformContext &
  AutoGrowTextElementsContext &
  BuildGhostSectionNodeContext &
  MountTemplateEditChromeContext &
  Pick<
    EditorContext,
    | 'activePageId'
    | 'ghostSections'
    | 'mainEl'
    | 'applyPageMotionAttributes'
    | 'applyPageStyleProperties'
    | 'pageRenderWidth'
    | 'syncSidebarStyleKitButtons'
    | 'renderInspector'
    | 'renderReel'
    | 'pendingImport'
    | 'renderPlacementSlots'
  >;

export function renderAllImpl(ctx: RenderAllContext): void {
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

    const pageGhosts = ctx.ghostSections.filter((g) => g.pageId === page.id);
    for (let si = 0; si < page.sections.length; si++) {
      const section = page.sections[si]!;
      article.appendChild(ctx.buildSectionNode(section, renderWidth));
      for (let gi = 0; gi < pageGhosts.length; gi++) {
        if (pageGhosts[gi]!.afterSectionId === section.id) {
          article.appendChild(buildGhostSectionNode(ctx, pageGhosts[gi]!, renderWidth));
        }
      }
    }

    // applyCanvasAgentOp appends additive section ops when afterSectionId is
    // null, so the ghost sits after the real page body and before the footer.
    for (let gi = 0; gi < pageGhosts.length; gi++) {
      if (pageGhosts[gi]!.afterSectionId === null) {
        article.appendChild(buildGhostSectionNode(ctx, pageGhosts[gi]!, renderWidth));
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
  // ADR 0065 D5 — mount the in-place template-edit chrome (banner, Done
  // button, scrim, viewport pan) when ctx.editingCollectionTemplate pins
  // a Collection. The empty/grid Collection body is rendered by
  // buildCollectionBodyImpl (body-builders-data.ts) at element-build time;
  // this layer overlays the active template's chrome on top. When the
  // field is null the mount no-ops after stripping any stale chrome.
  mountTemplateEditChromeImpl(ctx);

  // Hydrate the visitor interactive runtime against every newly-rendered
  // carousel / accordion. The `data-opencanvas-hydrated="true"` idempotence
  // flag means re-running this on a redraw that re-uses some wrappers (none
  // today — renderAll replaces the canvas-root subtree entirely) is a cheap
  // no-op. `skipPopups: true` keeps popup chrome from hijacking the canvas
  // while editing; popups are visitor-only behaviour.
  if (ctx.root) {
    hydrateInteractives(ctx.root, { skipPopups: true });
  }

  if (ctx.pendingImport) {
    ctx.renderPlacementSlots();
  }

  if (!ctx.activePageId && ctx.state.pages.length > 0) {
    ctx.activePageId = ctx.state.pages[0]!.id;
  }
}

// ADR 0064 — walk the live DOM to grow text wrappers to their content
// height. Needs root for the scoped query, findElement for the box
// lookup, and setBoxStyle to push the new height back onto the wrapper.
export type AutoGrowTextElementsContext = Pick<
  EditorContext,
  'root' | 'findElement' | 'setBoxStyle'
>;

export function autoGrowTextElements(ctx: AutoGrowTextElementsContext): void {
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

// ADR 0064 — private helper. Only reaches ctx.buildSectionNode for
// the inner section node; the wrapper chrome is built directly with
// document.createElement.
export type BuildGhostSectionNodeContext = Pick<EditorContext, 'buildSectionNode'>;

function buildGhostSectionNode(
  ctx: BuildGhostSectionNodeContext,
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
