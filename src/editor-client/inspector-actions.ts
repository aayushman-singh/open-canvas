// src/editor-client/inspector-actions.ts
//
// ADR 0058 Phase 2h.1.a — inspector element-action cluster. Extracted
// from canvas-client.ts:4139-4273 (the inline IIFE twin remains as the
// production source-of-truth until ADR 0015 Phase 3 atomic cutover).
//
// The cluster contains:
//   - 3 leaf helpers (applyZOrderAction, parentArrayFor, moveInReadingOrder)
//   - 2 action verbs (duplicateElement, deleteElement)
//   - 3 DOM builders (buildReorderGroup, buildZOrderGroup,
//     buildElementActionsGroup)
//
// `parentArrayFor` is module-private (only called by other helpers in
// this file). All other exports take `ctx: EditorContext` as their
// first parameter and read/mutate ctx fields the same way the inline
// IIFE reads/mutates its closure surface — diff reads as
// s/<closure-var>/ctx.<closure-var>/g.
//
// Failure contract preserved: parentArrayFor throws loudly when an
// element is not present in the section tree; the verbs do not wrap
// any call in try/catch. The captureForUndo → renderAll → renderInspector
// → scheduleSave sequence is exactly the inline IIFE's order.

import type { CanvasElement, CanvasSection } from '../canvas/schema.js';
import type { EditorContext } from './editor-context.js';
import { newElementId } from './ids.js';
import { bringToFront, nextZInArray, nudgeZ, renormalizeZ, sendToBack } from './z-order.js';

type ZOrderAction = 'front' | 'back' | 'forward' | 'backward';

/** Resolve the immediate elements array an element lives in. Module-
 *  private: called only from the verbs and DOM builders below. Throws
 *  loudly when the element is not present in the section tree — same
 *  failure mode as the inline IIFE copy. */
function parentArrayFor(
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

export function buildReorderGroup(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'opencanvas-reorder-buttons';
  const arr = parentArrayFor(ctx, section, element);
  const idx = arr.indexOf(element);
  const total = arr.length;
  const caption = document.createElement('div');
  caption.className = 'opencanvas-reorder-caption';
  caption.textContent = 'Reading order: ' + (idx + 1) + ' of ' + total;

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.textContent = 'Move up in reading order';
  upBtn.disabled = idx <= 0;
  upBtn.addEventListener('click', () => {
    moveInReadingOrder(ctx, section, element, -1);
  });

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.textContent = 'Move down in reading order';
  downBtn.disabled = idx >= total - 1;
  downBtn.addEventListener('click', () => {
    moveInReadingOrder(ctx, section, element, 1);
  });

  group.appendChild(upBtn);
  group.appendChild(downBtn);

  const wrap = document.createElement('div');
  wrap.appendChild(caption);
  wrap.appendChild(group);
  return wrap;
}

export function buildZOrderGroup(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'opencanvas-zorder-buttons';
  const defs: { label: string; action: ZOrderAction }[] = [
    { label: 'Bring to front', action: 'front' },
    { label: 'Send to back', action: 'back' },
    { label: 'Forward', action: 'forward' },
    { label: 'Backward', action: 'backward' },
  ];
  for (let i = 0; i < defs.length; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const def = defs[i];
    if (!def) continue;
    btn.textContent = def.label;
    const action = def.action;
    btn.addEventListener('click', () => {
      applyZOrderAction(ctx, section, element, action);
    });
    group.appendChild(btn);
  }
  return group;
}

// Duplicate and delete verbs for the selected positioned element. Section-
// level Duplicate/Delete live in the section toolbar; this group surfaces
// the same verbs for elements so Owners don't have to remember a keyboard
// shortcut (Delete still works for deletion).
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

export function buildElementActionsGroup(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'opencanvas-zorder-buttons';
  const dup = document.createElement('button');
  dup.type = 'button';
  dup.textContent = 'Duplicate';
  dup.addEventListener('click', () => {
    duplicateElement(ctx, section, element);
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = 'Delete';
  del.addEventListener('click', () => {
    deleteElement(ctx, section, element);
  });
  group.appendChild(dup);
  group.appendChild(del);
  return group;
}
