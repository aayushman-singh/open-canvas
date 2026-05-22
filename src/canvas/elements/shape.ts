// src/canvas/elements/shape.ts
//
// Render fn for the existing `ShapeElement` element type.

import { escapeAttr } from './render-utils.js';
import type { ShapeElement } from '../schema.js';

export function renderShape(element: ShapeElement): string {
  return `<div class="rev01-shape" data-variant="${escapeAttr(element.variant)}"></div>`;
}
