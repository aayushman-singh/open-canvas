// src/editor-client/inspector-actions.ts
//
// ADR 0058 Phase 2h.1.a — inspector element-action verbs + helpers.
// Extracted from canvas-client.ts:4139-4273. The inline IIFE twin
// remains the production source-of-truth until ADR 0015 Phase 3
// atomic cutover.
//
// This module is verbs only — state-mutating functions that take
// `ctx: EditorContext` and operate on the EditableSite. DOM builders
// that wrap these verbs in HTMLElement scaffolding live in
// inspector-action-buttons.ts (split because builders can't be smoke-
// tested under bare Bun — no `document` global).
//
// Failure contract preserved: parentArrayFor throws loudly when an
// element is not present in the section tree; the verbs do not wrap
// any call in try/catch. The captureForUndo → renderAll → renderInspector
// → scheduleSave sequence is exactly the inline IIFE's order.

import type { CanvasElement, CanvasSection } from '../canvas/schema.js';
import type { EditorContext } from './editor-context.js';
import { newElementId } from './ids.js';
import { bringToFront, nextZInArray, nudgeZ, renormalizeZ, sendToBack } from './z-order.js';

export type ZOrderAction = 'front' | 'back' | 'forward' | 'backward';

/** Resolve the immediate elements array an element lives in. Exported
 *  so Phase 2h.1.b (buildElementMenu et al.) can reuse it instead of
 *  redeclaring. Throws loudly when the element is not in the section
 *  tree — same failure mode as the inline IIFE copy. */
export function parentArrayFor(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
): CanvasElement[] {
  const found = ctx.findElement(element.id);
  if (found && Array.isArray(found.parentArray)) return found.parentArray;
  throw new Error(
    'parentArrayFor: element ' + element.id + ' is not present in section ' + section.id,
  );
}

export function applyZOrderAction(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
  action: ZOrderAction,
): void {
  const arr = parentArrayFor(ctx, section, element);
  if (action === 'front') bringToFront(arr, element);
  else if (action === 'back') sendToBack(arr, element);
  else if (action === 'forward') nudgeZ(arr, element, 1);
  else if (action === 'backward') nudgeZ(arr, element, -1);
  renormalizeZ(arr);
  ctx.renderAll();
  ctx.selectElement(element.id);
  ctx.scheduleSave();
}

export function moveInReadingOrder(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
  direction: number,
): boolean {
  const arr = parentArrayFor(ctx, section, element);
  const idx = arr.indexOf(element);
  if (idx < 0) return false;
  const target = idx + direction;
  if (target < 0 || target >= arr.length) return false;
  arr.splice(idx, 1);
  arr.splice(target, 0, element);
  ctx.renderAll();
  ctx.selectElement(element.id);
  ctx.scheduleSave();
  return true;
}

export function duplicateElement(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
): void {
  const arr = parentArrayFor(ctx, section, element);
  const clone = structuredClone(element);
  clone.id = newElementId();
  if (clone.box && typeof clone.box === 'object') {
    if (typeof clone.box.x === 'number') clone.box.x = clone.box.x + 20;
    if (typeof clone.box.y === 'number') clone.box.y = clone.box.y + 20;
    clone.box.z = nextZInArray(arr);
  }
  const idx = arr.indexOf(element);
  if (idx >= 0) arr.splice(idx + 1, 0, clone);
  else arr.push(clone);
  ctx.selectedElementId = clone.id;
  ctx.captureForUndo();
  ctx.renderAll();
  ctx.renderInspector();
  ctx.scheduleSave();
}

export function deleteElement(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
): void {
  const arr = parentArrayFor(ctx, section, element);
  const idx = arr.indexOf(element);
  if (idx < 0) return;
  arr.splice(idx, 1);
  ctx.closeElementMenu();
  if (ctx.selectedElementId === element.id) ctx.selectedElementId = null;
  ctx.captureForUndo();
  ctx.renderAll();
  ctx.renderInspector();
  ctx.scheduleSave();
}
