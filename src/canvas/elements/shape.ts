// src/canvas/elements/shape.ts
//
// `ShapeElement` interface + renderer.

import { escapeAttr } from './render-utils.js';
import type { BaseElement, ShapeVariant } from '../schema.js';

export interface ShapeElement extends BaseElement {
  type: 'shape';
  variant: ShapeVariant;
}

export function renderShape(element: ShapeElement): string {
  return `<div class="rev01-shape" data-variant="${escapeAttr(element.variant)}"></div>`;
}
