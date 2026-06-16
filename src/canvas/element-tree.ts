// src/canvas/element-tree.ts
//
// Shared traversal helpers for nested Canvas Element trees. Tabs, Collection
// templates/entries, and Flow Items all host child Canvas Elements; callers
// that reason about "all elements in a section" should use this module rather
// than open-coding one nesting shape and forgetting the others.

import type { CanvasElement } from './schema.js';

export type ElementTreeParentKind =
  | 'section'
  | 'tab-panel'
  | 'collection-entry'
  | 'collection-custom-template'
  | 'flow-item';

export interface ElementTreeFindResult {
  element: CanvasElement;
  parentArray: CanvasElement[] | null;
  parentKind: ElementTreeParentKind;
}

export function visitElementTree(
  element: CanvasElement,
  visit: (element: CanvasElement) => void,
): void {
  visit(element);
  visitElementTreeChildren(element, visit);
}

export function visitElementForest(
  elements: readonly CanvasElement[],
  visit: (element: CanvasElement) => void,
): void {
  for (const element of elements) visitElementTree(element, visit);
}

export function flattenElementForest(elements: readonly CanvasElement[]): CanvasElement[] {
  const out: CanvasElement[] = [];
  visitElementForest(elements, (element) => out.push(element));
  return out;
}

export function findElementInForest(
  elements: CanvasElement[],
  elementId: string,
): ElementTreeFindResult | null {
  for (const element of elements) {
    const found = findElementInTree(element, elementId, elements, 'section');
    if (found !== null) return found;
  }
  return null;
}

export function remapElementForestIdsInPlace(
  elements: CanvasElement[],
  nextElementId: (previousId: string, element: CanvasElement) => string,
): void {
  visitElementForest(elements, (element) => {
    const previousId = element.id;
    element.id = nextElementId(previousId, element);
    delete (element as { anchorId?: string }).anchorId;
  });
}

function findElementInTree(
  element: CanvasElement,
  elementId: string,
  parentArray: CanvasElement[] | null,
  parentKind: ElementTreeParentKind,
): ElementTreeFindResult | null {
  if (element.id === elementId) return { element, parentArray, parentKind };

  if (element.type === 'tabs') {
    for (const tab of element.tabs) {
      const found = findElementInChildArray(tab.elements, elementId, 'tab-panel');
      if (found !== null) return found;
    }
    return null;
  }

  if (element.type === 'collection') {
    for (const entry of element.entries ?? []) {
      const found = findElementInChildArray(entry, elementId, 'collection-entry');
      if (found !== null) return found;
    }
    if (element.customTemplate !== undefined) {
      const found = findElementInChildArray(
        element.customTemplate,
        elementId,
        'collection-custom-template',
      );
      if (found !== null) return found;
    }
    return null;
  }

  if (element.type === 'flow-container') {
    for (const item of element.items) {
      const found = findElementInTree(item.element, elementId, null, 'flow-item');
      if (found !== null) return found;
    }
  }

  return null;
}

function findElementInChildArray(
  elements: CanvasElement[],
  elementId: string,
  parentKind: ElementTreeParentKind,
): ElementTreeFindResult | null {
  for (const element of elements) {
    const found = findElementInTree(element, elementId, elements, parentKind);
    if (found !== null) return found;
  }
  return null;
}

function visitElementTreeChildren(
  element: CanvasElement,
  visit: (element: CanvasElement) => void,
): void {
  if (element.type === 'tabs') {
    for (const tab of element.tabs) {
      visitElementForest(tab.elements, visit);
    }
    return;
  }

  if (element.type === 'collection') {
    for (const entry of element.entries ?? []) {
      visitElementForest(entry, visit);
    }
    for (const child of element.customTemplate ?? []) {
      visitElementTree(child, visit);
    }
    return;
  }

  if (element.type === 'flow-container') {
    for (const item of element.items) {
      visitElementTree(item.element, visit);
    }
  }
}
