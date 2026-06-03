// src/editor-client/editor-context-types.ts
//
// ADR 0058 — Return-types of `EditorContext` methods. Lives next to
// editor-context.ts so the context-shape file stays narrow (its purpose
// is to be the migration scoreboard; accumulating return-types over
// ~50 sub-phases would drown that signal).

import type { CanvasElement, CanvasSection } from '../canvas/schema.js';
import type { Tab } from '../canvas/elements/tabs.js';

/**
 * Result shape of `findElement`. Mirrors the inline IIFE's
 * `findElementIn` return — the section that contains the element, the
 * element itself, the immediate parent array it lives in, plus parent-
 * kind/meta so callers can distinguish section-level vs nested (tab
 * panel / collection entry) parents.
 */
export interface FindElementResult {
  section: CanvasSection;
  element: CanvasElement;
  parentArray: CanvasElement[];
  parentKind: 'section' | 'tab-panel' | 'collection-entry';
  parentMeta:
    | null
    | { tabsElement: CanvasElement; tab: Tab }
    | { collectionElement: CanvasElement; entryIndex: number };
}
