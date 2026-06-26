// src/editor-client/shape-freeform-draw.ts
//
// Freeform shape drawing via perfect-freehand (MIT). Editor-only — the
// stored SVG path string is what published pages render.

import { getStroke } from 'perfect-freehand';
import type { CanvasElement, CanvasSection } from '../canvas/schema.js';
import {
  buildFreeformPathFromPoints,
  type FreeformRenderMode,
} from '../canvas/shape-freeform.js';
import type {
  DomContext,
  EditorContext,
  PersistContext,
  RenderContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import { newElementId } from './ids.js';
import { addElementToSectionImpl } from './section-toolbar.js';

export interface PendingFreeformDraw {
  freeformRender: FreeformRenderMode;
  /** When redrawing, the element being replaced. */
  targetElementId?: string;
}

type Vec2 = [number, number];

export type FreeformDrawModeContext = DomContext &
  StatusEmitterContext &
  Pick<EditorContext, 'pendingFreeformDraw' | 'interactionMode' | 'zoomToolbar'>;

export type FreeformDrawContext = FreeformDrawModeContext &
  StateContext &
  SelectionContext &
  RenderContext &
  PersistContext &
  Pick<EditorContext, 'pointerToCanvas' | 'panToElement'>;

let activeOverlay: SVGSVGElement | null = null;
let activeSectionEl: HTMLElement | null = null;
let activePoints: Vec2[] = [];
let drawingPointerId: number | null = null;

function strokeFromOutline(pts: Vec2[], options: { size: number; last: boolean }): Vec2[] {
  return getStroke(pts, {
    size: options.size,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: true,
    last: options.last,
  });
}

function removeOverlay(): void {
  if (activeOverlay && activeOverlay.parentNode) {
    activeOverlay.parentNode.removeChild(activeOverlay);
  }
  activeOverlay = null;
  activeSectionEl = null;
  activePoints = [];
  drawingPointerId = null;
}

function ensureOverlay(sectionEl: HTMLElement): SVGSVGElement {
  if (activeOverlay && activeSectionEl === sectionEl) return activeOverlay;
  removeOverlay();
  activeSectionEl = sectionEl;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('opencanvas-freeform-draw-overlay');
  svg.setAttribute('viewBox', `0 0 ${String(sectionEl.clientWidth)} ${String(sectionEl.clientHeight)}`);
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '40';
  sectionEl.style.position = sectionEl.style.position || 'relative';
  sectionEl.appendChild(svg);
  activeOverlay = svg;
  return svg;
}

function previewPath(
  points: Vec2[],
  render: FreeformRenderMode,
  sectionEl: HTMLElement,
): void {
  const svg = ensureOverlay(sectionEl);
  svg.setAttribute('viewBox', `0 0 ${String(sectionEl.clientWidth)} ${String(sectionEl.clientHeight)}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (points.length < 2) return;

  const built = buildFreeformPathFromPoints(points, render, strokeFromOutline);
  if (!built) {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', points.map(([x, y]) => `${String(x)},${String(y)}`).join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', 'currentColor');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
    return;
  }

  const { box, path } = built;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${String(box.x)} ${String(box.y)}) scale(${String(box.w / 100)} ${String(box.h / 100)})`);
  const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pathEl.setAttribute('d', path);
  if (render === 'fill') {
    pathEl.setAttribute('fill', 'currentColor');
    pathEl.setAttribute('fill-opacity', '0.45');
    pathEl.setAttribute('stroke', 'currentColor');
    pathEl.setAttribute('stroke-width', '1');
  } else {
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('stroke', 'currentColor');
    pathEl.setAttribute('stroke-width', '2');
    pathEl.setAttribute('stroke-linecap', 'round');
    pathEl.setAttribute('stroke-linejoin', 'round');
  }
  g.appendChild(pathEl);
  svg.appendChild(g);
}

function resolveSectionEl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const section = target.closest('.opencanvas-section');
  return section instanceof HTMLElement ? section : null;
}

function commitStroke(
  ctx: FreeformDrawContext,
  section: CanvasSection,
  sectionEl: HTMLElement,
  points: Vec2[],
  pending: PendingFreeformDraw,
): void {
  const built = buildFreeformPathFromPoints(points, pending.freeformRender, strokeFromOutline);
  removeOverlay();
  if (!built) {
    ctx.setStatus('Stroke too short — try again', 'error');
    return;
  }

  ctx.captureForUndo();

  if (pending.targetElementId) {
    const found = ctx.findElement(pending.targetElementId);
    if (found && found.element.type === 'shape') {
      const shape = found.element;
      shape.variant = 'freeform';
      shape.path = built.path;
      shape.freeformRender = pending.freeformRender;
      shape.box = {
        ...shape.box,
        x: built.box.x,
        y: built.box.y,
        w: built.box.w,
        h: built.box.h,
      };
      delete shape.iconKind;
      ctx.rebuildElement(shape.id);
      ctx.selectElement(shape.id);
      ctx.scheduleSave();
      ctx.setStatus('Freeform path updated', 'ok');
      return;
    }
  }

  const newEl = {
    id: newElementId(),
    type: 'shape',
    variant: 'freeform',
    path: built.path,
    freeformRender: pending.freeformRender,
    box: {
      x: built.box.x,
      y: built.box.y,
      w: built.box.w,
      h: built.box.h,
      z: nextZ(section),
    },
  } as CanvasElement;

  addElementToSectionImpl(ctx, section, newEl);
  ctx.setStatus('Freeform shape added', 'ok');
}

function nextZ(section: CanvasSection): number {
  let max = 0;
  for (let i = 0; i < section.elements.length; i++) {
    const el = section.elements[i];
    if (!el) continue;
    if (el.box.z > max) max = el.box.z;
  }
  return max + 1;
}

export function enterFreeformDrawModeImpl(
  ctx: FreeformDrawModeContext,
  opts: { freeformRender?: FreeformRenderMode; targetElementId?: string } = {},
): void {
  ctx.pendingFreeformDraw = {
    freeformRender: opts.freeformRender ?? 'fill',
    ...(opts.targetElementId !== undefined ? { targetElementId: opts.targetElementId } : {}),
  };
  ctx.interactionMode = 'draw';
  if (ctx.viewport) ctx.viewport.setAttribute('data-interaction-mode', 'draw');
  document.body.setAttribute('data-freeform-draw-active', 'true');
  syncFreeformDrawToolbarImpl(ctx);
  ctx.setStatus(
    (opts.freeformRender ?? 'fill') === 'fill'
      ? 'Draw a filled shape — Esc to cancel'
      : 'Draw a stroke — Esc to cancel',
    'ok',
  );
}

export function exitFreeformDrawModeImpl(ctx: FreeformDrawModeContext, cancelled: boolean): void {
  removeOverlay();
  ctx.pendingFreeformDraw = null;
  ctx.interactionMode = 'select';
  if (ctx.viewport) ctx.viewport.setAttribute('data-interaction-mode', 'select');
  document.body.removeAttribute('data-freeform-draw-active');
  syncFreeformDrawToolbarImpl(ctx);
  if (cancelled) ctx.setStatus('Drawing cancelled', 'ok');
}

export function setFreeformRenderModeImpl(
  ctx: FreeformDrawModeContext,
  mode: FreeformRenderMode,
): void {
  if (!ctx.pendingFreeformDraw) return;
  ctx.pendingFreeformDraw = { ...ctx.pendingFreeformDraw, freeformRender: mode };
  syncFreeformDrawToolbarImpl(ctx);
  ctx.setStatus(
    mode === 'fill' ? 'Filled blob mode' : 'Ink stroke mode',
    'ok',
  );
}

export function syncFreeformDrawToolbarImpl(ctx: FreeformDrawModeContext): void {
  const toolbar = ctx.zoomToolbar;
  if (!toolbar) return;
  const show = ctx.pendingFreeformDraw !== null;
  toolbar.querySelectorAll('[data-freeform-render], [data-freeform-draw-controls]').forEach((node) => {
    if (node instanceof HTMLElement) node.hidden = !show;
  });
  const btns = toolbar.querySelectorAll('[data-mode-action]');
  for (let i = 0; i < btns.length; i++) {
    const action = btns[i]!.getAttribute('data-mode-action');
    btns[i]!.setAttribute(
      'aria-pressed',
      action === ctx.interactionMode ? 'true' : 'false',
    );
  }
  const mode = ctx.pendingFreeformDraw?.freeformRender ?? 'fill';
  const fillBtn = toolbar.querySelector('[data-freeform-render="fill"]');
  const strokeBtn = toolbar.querySelector('[data-freeform-render="stroke"]');
  if (fillBtn) fillBtn.setAttribute('aria-pressed', mode === 'fill' ? 'true' : 'false');
  if (strokeBtn) strokeBtn.setAttribute('aria-pressed', mode === 'stroke' ? 'true' : 'false');
}

export function attachFreeformDrawHandlersImpl(ctx: FreeformDrawContext): void {
  const root = ctx.root;
  if (!root) return;

  root.addEventListener('pointerdown', (ev) => {
    if (!ctx.pendingFreeformDraw || ctx.interactionMode !== 'draw') return;
    if (ev.button !== 0) return;
    const sectionEl = resolveSectionEl(ev.target);
    if (!sectionEl) return;
    const sectionId = sectionEl.getAttribute('data-opencanvas-section');
    if (!sectionId) return;
    const section = ctx.findSection(sectionId);
    if (!section) return;
    if (ev.target instanceof Element && ev.target.closest('.opencanvas-element')) return;

    const pt = ctx.pointerToCanvas(ev, sectionEl);
    if (!pt) return;

    ev.preventDefault();
    drawingPointerId = ev.pointerId;
    activePoints = [[pt.x, pt.y]];
    sectionEl.setPointerCapture(ev.pointerId);
    previewPath(activePoints, ctx.pendingFreeformDraw.freeformRender, sectionEl);

    const onMove = (moveEv: PointerEvent) => {
      if (moveEv.pointerId !== drawingPointerId) return;
      const movePt = ctx.pointerToCanvas(moveEv, sectionEl);
      if (!movePt) return;
      activePoints = [...activePoints, [movePt.x, movePt.y]];
      previewPath(activePoints, ctx.pendingFreeformDraw!.freeformRender, sectionEl);
    };

    const finish = (upEv: PointerEvent) => {
      if (upEv.pointerId !== drawingPointerId) return;
      sectionEl.releasePointerCapture(upEv.pointerId);
      sectionEl.removeEventListener('pointermove', onMove);
      sectionEl.removeEventListener('pointerup', finish);
      sectionEl.removeEventListener('pointercancel', cancel);
      const pending = ctx.pendingFreeformDraw;
      if (!pending) return;
      commitStroke(ctx, section, sectionEl, activePoints, pending);
      exitFreeformDrawModeImpl(ctx, false);
    };

    const cancel = (cancelEv: PointerEvent) => {
      if (cancelEv.pointerId !== drawingPointerId) return;
      sectionEl.releasePointerCapture(cancelEv.pointerId);
      sectionEl.removeEventListener('pointermove', onMove);
      sectionEl.removeEventListener('pointerup', finish);
      sectionEl.removeEventListener('pointercancel', cancel);
      removeOverlay();
      activePoints = [];
      drawingPointerId = null;
    };

    sectionEl.addEventListener('pointermove', onMove);
    sectionEl.addEventListener('pointerup', finish);
    sectionEl.addEventListener('pointercancel', cancel);
  });
}