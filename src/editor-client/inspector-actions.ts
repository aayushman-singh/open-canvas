// src/editor-client/inspector-actions.ts
//
// ADR 0058 Phase 2h.1.a — inspector element-action verbs + helpers.
// Extracted from canvas-client.ts:4139-4273. The inline IIFE twin
// remains the production source-of-truth until ADR 0015 Phase 3
// atomic cutover.
//
// This module is verbs only — state-mutating functions that take
// `ctx: EditorContext` (narrowed per ADR 0064) and operate on the
// EditableSite. The DOM surface that calls them is the 3-dot element
// menu (./element-menu.ts); the inspector itself no longer carries
// z-order / duplicate / delete / reading-order rows for elements
// — those duplicated the menu and cluttered the panel. The verbs
// stay separate from the menu so any future caller (keyboard
// shortcut, command palette, agent op) can reuse them without
// pulling the menu builder.
//
// Failure contract preserved: parentArrayFor throws loudly when an
// element is not present in the section tree; the verbs do not wrap
// any call in try/catch. The captureForUndo → renderAll → renderInspector
// → scheduleSave sequence is exactly the inline IIFE's order.

import type { CanvasElement, CanvasSection } from '../canvas/schema.js';
import type {
  EditorContext,
  PersistContext,
  RenderContext,
  SelectionContext,
  StateContext,
} from './editor-context.js';
import { newElementId } from './ids.js';
import { bringToFront, nextZInArray, nudgeZ, renormalizeZ, sendToBack } from './z-order.js';

export type ZOrderAction = 'front' | 'back' | 'forward' | 'backward';

// ADR 0064 — parentArrayFor only walks the section tree via
// `findElement`, so it rides StateContext alone. Exported so other
// callers (element-menu builders, agent ops) can adopt the same alias.
export type ParentArrayForContext = StateContext;

// ADR 0064 — inspector element-action verbs (z-order + reading-order +
// duplicate) share one cluster shape: StateContext for the parent-array
// resolution, SelectionContext for the post-mutation re-select, and
// RenderContext + PersistContext for the renderAll → renderInspector →
// scheduleSave tail. Exported for element-menu builders to reuse.
export type InspectorActionContext = StateContext &
  SelectionContext &
  RenderContext &
  PersistContext;

// ADR 0064 — deleteElement extends the shared action surface with the
// single non-canonical verb `closeElementMenu`, which dismisses the
// per-element popover before the mutation lands. Exported so the
// downstream button carve picks up the same shape.
export type DeleteElementContext = InspectorActionContext & Pick<EditorContext, 'closeElementMenu'>;

/** Resolve the immediate elements array an element lives in. Exported
 *  so Phase 2h.1.b (buildElementMenu et al.) can reuse it instead of
 *  redeclaring. Throws loudly when the element is not in the section
 *  tree — same failure mode as the inline IIFE copy. */
export function parentArrayFor(
  ctx: ParentArrayForContext,
  section: CanvasSection,
  element: CanvasElement,
): CanvasElement[] {
  const found = ctx.findElement(element.id);
  if (found?.parentKind === 'flow-item') {
    throw new Error(
      'parentArrayFor: element ' +
        element.id +
        ' is hosted by a Flow Item in section ' +
        section.id +
        ' and does not have a sibling array',
    );
  }
  if (found && Array.isArray(found.parentArray)) return found.parentArray;
  throw new Error(
    'parentArrayFor: element ' + element.id + ' is not present in section ' + section.id,
  );
}

export function applyZOrderAction(
  ctx: InspectorActionContext,
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
  ctx: InspectorActionContext,
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
  ctx: InspectorActionContext,
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
  ctx: DeleteElementContext,
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
