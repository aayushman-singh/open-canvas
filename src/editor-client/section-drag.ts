// src/editor-client/section-drag.ts
//
// ADR 0058 Phase 2q.h — section drag + reel drag + grip handlers.
// canvas-client.ts:8438-8681 carries the inline twin (beginSectionDrag,
// beginReelDrag, attachGripHandlers). The inline IIFE remains the
// production source-of-truth until ADR 0015 Phase 3 atomic cutover; this
// module ships dead code until then.
//
// Why these stay together: every function in this module owns a piece of
// the "drag a section to a new spot" gesture. beginSectionDrag tears the
// section out of the canvas (ghost + drop-line in screen coords, drops
// either back onto the canvas or into the reel); beginReelDrag runs the
// reel-tile version (drag-threshold gated, drops into the reel only);
// attachGripHandlers is the root-level mousedown delegate that detects a
// `[data-section-grip]` press and decides between "click to toggle reel +
// select" or "drag past 5px → open reel + begin section drag". Splitting
// them would force every one to re-import the others.
//
// All three depend on the reel module — beginSectionDrag + beginReelDrag
// use `buildSectionThumbnail` for the ghost, both call `moveSectionToIndex`
// on drop, and attachGripHandlers calls `openReel` / `closeReel`. The
// dependency runs one-way (reel does not import section-drag at module
// init — `renderReelImpl` calls `beginReelDragImpl` lazily inside an event
// handler, which is fine even though the imports go reel.ts → section-drag.ts
// and section-drag.ts → reel.ts at top level, because the inner-function
// references aren't resolved until first click).
//
// Three functions live here:
//
//   - beginSectionDragImpl(ctx, sectionId, startEv) — start the canvas-side
//     drag. Dims the source section, builds a 200px wide ghost following the
//     pointer, paints a drop-line at the would-be insertion point (canvas
//     position OR reel position, whichever the pointer is over), commits on
//     mouseup via ctx.moveSectionToIndex. No-op on pinned sections.
//
//   - beginReelDragImpl(ctx, sectionId, fromIdx, startEv) — start the
//     reel-tile drag. 5px movement threshold before any DOM changes so a
//     plain click on the tile still fires the "select section" path. Ghost
//     is 200px in tile mode / 64px in list mode. Drop target is reel-only
//     (the reel tile can't move a section onto the canvas).
//
//   - attachGripHandlersImpl(ctx) — root mousedown delegate for
//     `[data-section-grip]`. Pan mode short-circuits (panning is the
//     primary gesture). 5px movement threshold splits click→toggle-reel +
//     select from drag→openReel + beginSectionDrag. Run once at boot.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the Phase
// 3 cutover destination, not a live call site yet.

import type { EditorContext } from './editor-context.js';
import { cssEscape } from './css-escape.js';
import { buildSectionThumbnail, moveSectionToIndex } from './reel.js';

interface CanvasDropTarget {
  zone: 'canvas';
  insertAt: number;
  nodes: Element[];
}

interface ReelDropTarget {
  zone: 'reel';
  insertAt: number;
  tiles: Element[];
}

type DropTarget = CanvasDropTarget | ReelDropTarget;

export function beginSectionDragImpl(
  ctx: EditorContext,
  sectionId: string,
  startEv: MouseEvent,
): void {
  const page = ctx.currentPage();
  if (!page) return;
  if (!ctx.root) return;
  const root = ctx.root;
  const fromIdx = page.sections.findIndex((s) => s.id === sectionId);
  if (fromIdx < 0) return;
  const section = page.sections[fromIdx]!;

  const sectionElCandidate = root.querySelector(
    '[data-opencanvas-section="' + cssEscape(sectionId) + '"]',
  );
  const sectionEl =
    sectionElCandidate instanceof HTMLElement ? sectionElCandidate : null;
  if (sectionEl) sectionEl.style.opacity = '0.5';

  const ghost = buildSectionThumbnail(ctx, section, page.width, 200);
  ghost.style.position = 'fixed';
  ghost.style.pointerEvents = 'none';
  ghost.style.opacity = '0.7';
  ghost.style.zIndex = '9000';
  ghost.style.left = startEv.clientX - 100 + 'px';
  ghost.style.top = startEv.clientY - 20 + 'px';
  document.body.appendChild(ghost);

  const dropLine = document.createElement('div');
  dropLine.className = 'reel-drop-indicator';
  dropLine.hidden = true;
  document.body.appendChild(dropLine);

  let dropTarget: DropTarget | null = null;

  function pointInsideRect(clientX: number, clientY: number, rect: DOMRect): boolean {
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  function findDropTarget(clientX: number, clientY: number): DropTarget | null {
    const reelEl = document.getElementById('canvas-reel');
    if (reelEl && !reelEl.hidden) {
      const reelRect = reelEl.getBoundingClientRect();
      if (pointInsideRect(clientX, clientY, reelRect)) {
        const tiles = Array.from(reelEl.querySelectorAll('[data-reel-section]'));
        for (let i = 0; i < tiles.length; i++) {
          const rect = tiles[i]!.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (clientY < midY) return { zone: 'reel', insertAt: i, tiles: tiles };
        }
        return { zone: 'reel', insertAt: tiles.length, tiles: tiles };
      }
    }

    const rootRect = root.getBoundingClientRect();
    if (!pointInsideRect(clientX, clientY, rootRect)) return null;

    const sectionNodes = Array.from(root.querySelectorAll('[data-opencanvas-section]'));
    for (let i = 0; i < sectionNodes.length; i++) {
      const rect = sectionNodes[i]!.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) return { zone: 'canvas', insertAt: i, nodes: sectionNodes };
    }
    return { zone: 'canvas', insertAt: sectionNodes.length, nodes: sectionNodes };
  }

  function normaliseDropTarget(target: DropTarget | null): DropTarget | null {
    if (!target) return null;
    if (target.insertAt === fromIdx || target.insertAt === fromIdx + 1) return null;
    return target;
  }

  function positionDropLine(target: DropTarget | null): void {
    if (!target) {
      dropLine.hidden = true;
      return;
    }
    dropLine.hidden = false;
    if (target.zone === 'canvas') {
      const nodes = target.nodes;
      let refRect: DOMRect;
      if (target.insertAt < nodes.length) {
        refRect = nodes[target.insertAt]!.getBoundingClientRect();
        dropLine.style.top = refRect.top - 1 + 'px';
      } else if (nodes.length > 0) {
        refRect = nodes[nodes.length - 1]!.getBoundingClientRect();
        dropLine.style.top = refRect.bottom - 1 + 'px';
      } else {
        dropLine.hidden = true;
        return;
      }
      dropLine.style.left = refRect.left + 'px';
      dropLine.style.width = refRect.width + 'px';
    } else {
      const tiles = target.tiles;
      let refRect2: DOMRect;
      if (target.insertAt < tiles.length) {
        refRect2 = tiles[target.insertAt]!.getBoundingClientRect();
        dropLine.style.top = refRect2.top - 2 + 'px';
      } else if (tiles.length > 0) {
        refRect2 = tiles[tiles.length - 1]!.getBoundingClientRect();
        dropLine.style.top = refRect2.bottom + 'px';
      } else {
        dropLine.hidden = true;
        return;
      }
      dropLine.style.left = refRect2.left + 'px';
      dropLine.style.width = refRect2.width + 'px';
    }
  }

  function onMove(ev: MouseEvent): void {
    ghost.style.left = ev.clientX - 100 + 'px';
    ghost.style.top = ev.clientY - 20 + 'px';
    dropTarget = normaliseDropTarget(findDropTarget(ev.clientX, ev.clientY));
    positionDropLine(dropTarget);
  }

  function onUp(): void {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    ghost.remove();
    dropLine.remove();
    if (sectionEl) sectionEl.style.opacity = '';
    if (dropTarget) {
      moveSectionToIndex(ctx, fromIdx, dropTarget.insertAt);
    }
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

export function beginReelDragImpl(
  ctx: EditorContext,
  sectionId: string,
  fromIdx: number,
  startEv: MouseEvent,
): void {
  const page = ctx.currentPage();
  if (!page) return;
  const section = page.sections[fromIdx];
  if (!section || section.id !== sectionId) return;
  const pageWidth = page.width;
  const sectionForGhost = section;

  const startX = startEv.clientX;
  const startY = startEv.clientY;
  let hasMoved = false;
  let ghost: HTMLElement | null = null;
  let dropLine: HTMLElement | null = null;
  let dropTarget: { insertAt: number } | null = null;

  function onMove(ev: MouseEvent): void {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!hasMoved && Math.sqrt(dx * dx + dy * dy) < 5) return;
    if (!hasMoved) {
      hasMoved = true;
      const isTile = ctx.reelViewMode === 'tile';
      ghost = buildSectionThumbnail(ctx, sectionForGhost, pageWidth, isTile ? 200 : 64);
      ghost.style.position = 'fixed';
      ghost.style.pointerEvents = 'none';
      ghost.style.opacity = '0.7';
      ghost.style.zIndex = '9000';
      document.body.appendChild(ghost);

      dropLine = document.createElement('div');
      dropLine.className = 'reel-drop-indicator';
      dropLine.hidden = true;
      document.body.appendChild(dropLine);
    }

    ghost!.style.left = ev.clientX - 50 + 'px';
    ghost!.style.top = ev.clientY - 10 + 'px';

    const reelEl = document.getElementById('canvas-reel');
    if (!reelEl || reelEl.hidden) {
      dropLine!.hidden = true;
      dropTarget = null;
      return;
    }
    const reelRect = reelEl.getBoundingClientRect();
    if (
      ev.clientX < reelRect.left ||
      ev.clientX > reelRect.right ||
      ev.clientY < reelRect.top ||
      ev.clientY > reelRect.bottom
    ) {
      dropLine!.hidden = true;
      dropTarget = null;
      return;
    }
    const tiles = Array.from(reelEl.querySelectorAll('[data-reel-section]'));
    let insertAt = tiles.length;
    for (let i = 0; i < tiles.length; i++) {
      const rect = tiles[i]!.getBoundingClientRect();
      if (ev.clientY < rect.top + rect.height / 2) {
        insertAt = i;
        break;
      }
    }
    if (insertAt === fromIdx || insertAt === fromIdx + 1) {
      dropLine!.hidden = true;
      dropTarget = null;
      return;
    }
    dropTarget = { insertAt: insertAt };
    dropLine!.hidden = false;
    let refRect: DOMRect | undefined;
    if (insertAt < tiles.length) {
      refRect = tiles[insertAt]!.getBoundingClientRect();
      dropLine!.style.top = refRect.top - 2 + 'px';
    } else if (tiles.length > 0) {
      refRect = tiles[tiles.length - 1]!.getBoundingClientRect();
      dropLine!.style.top = refRect.bottom + 'px';
    }
    if (refRect) {
      dropLine!.style.left = refRect.left + 'px';
      dropLine!.style.width = refRect.width + 'px';
    }
  }

  function onUp(): void {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (ghost) ghost.remove();
    if (dropLine) dropLine.remove();
    if (hasMoved && dropTarget) {
      moveSectionToIndex(ctx, fromIdx, dropTarget.insertAt);
    }
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

export function attachGripHandlersImpl(ctx: EditorContext): void {
  if (!ctx.root) return;
  const root = ctx.root;
  root.addEventListener('mousedown', (ev) => {
    if (ctx.interactionMode === 'pan') return;
    const grip =
      ev.target instanceof Element ? ev.target.closest('[data-section-grip]') : null;
    if (!grip) return;
    ev.preventDefault();
    ev.stopPropagation();
    const rawSectionId = grip.getAttribute('data-section-grip');
    if (!rawSectionId) return;
    const sectionId: string = rawSectionId;

    const startX = ev.clientX;
    const startY = ev.clientY;
    let hasMoved = false;

    function onMove(moveEv: MouseEvent): void {
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;
      if (!hasMoved && Math.sqrt(dx * dx + dy * dy) >= 5) {
        hasMoved = true;
        ctx.openReel();
        beginSectionDragImpl(ctx, sectionId, moveEv);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
    }
    function onUp(): void {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!hasMoved) {
        if (ctx.isReelOpen) {
          ctx.closeReel();
        } else {
          ctx.openReel();
        }
        ctx.selectSection(sectionId);
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
