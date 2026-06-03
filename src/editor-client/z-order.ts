// src/editor-client/z-order.ts
//
// ADR 0015 Phase 2d — z-index manipulation over an element array.
// canvas-client.ts:11427-11437 + :4044-4096 carry inline copies. All
// operations mutate `element.box.z` in place; the callers update their
// own state-resident references.

import type { CanvasElement } from '../canvas/schema.js';

/** Return the next z-index for an array of elements (max existing z + 1). */
export function nextZInArray(elements: readonly CanvasElement[]): number {
  let maxZ = 0;
  for (const el of elements) {
    const z = el.box && typeof el.box.z === 'number' ? el.box.z : 0;
    if (z > maxZ) maxZ = z;
  }
  return maxZ + 1;
}

/** Move `element` to the highest z in `elements` (mutates element.box.z). */
export function bringToFront(
  elements: readonly CanvasElement[],
  element: CanvasElement,
): void {
  let maxZ = element.box.z;
  for (const sibling of elements) {
    if (sibling.id === element.id) continue;
    if (typeof sibling.box.z === 'number' && sibling.box.z > maxZ) maxZ = sibling.box.z;
  }
  element.box.z = maxZ + 1;
}

/** Move `element` to the lowest z in `elements` (mutates element.box.z). */
export function sendToBack(
  elements: readonly CanvasElement[],
  element: CanvasElement,
): void {
  let minZ = element.box.z;
  for (const sibling of elements) {
    if (sibling.id === element.id) continue;
    if (typeof sibling.box.z === 'number' && sibling.box.z < minZ) minZ = sibling.box.z;
  }
  element.box.z = minZ - 1;
}

/** Swap z with the next-higher (direction > 0) or next-lower sibling.
 *  No-op + returns false when already at the top/bottom of the stack. */
export function nudgeZ(
  elements: readonly CanvasElement[],
  element: CanvasElement,
  direction: number,
): boolean {
  const elZ = element.box.z;
  let target: CanvasElement | null = null;
  for (const sibling of elements) {
    if (sibling.id === element.id) continue;
    if (typeof sibling.box.z !== 'number') continue;
    if (direction > 0) {
      if (sibling.box.z > elZ && (target === null || sibling.box.z < target.box.z)) {
        target = sibling;
      }
    } else {
      if (sibling.box.z < elZ && (target === null || sibling.box.z > target.box.z)) {
        target = sibling;
      }
    }
  }
  if (!target) return false;
  const tmp = element.box.z;
  element.box.z = target.box.z;
  target.box.z = tmp;
  return true;
}

/** Re-pack z values to 0..N-1 preserving relative order. bringToFront /
 *  sendToBack widen the range every call; without this a long edit
 *  session drifts z toward Number.MAX_SAFE_INTEGER. */
export function renormalizeZ(elements: CanvasElement[] | undefined): void {
  if (!Array.isArray(elements)) return;
  const items = elements
    .map((el, idx) => ({
      el,
      idx,
      z: typeof el.box.z === 'number' ? el.box.z : 0,
    }))
    .sort((a, b) => a.z - b.z || a.idx - b.idx);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item !== undefined) item.el.box.z = i;
  }
}
