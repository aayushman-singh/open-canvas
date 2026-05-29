// src/canvas/elements/shape.ts
//
// `ShapeElement` interface + renderer + inspector spec (ADR 0011 Step 1).

import { escapeAttr } from './render-utils.js';
import { SHAPE_VARIANTS, type BaseElement, type ShapeVariant } from '../schema.js';
import type { InspectorSpec } from './inspector-spec.js';

export interface ShapeElement extends BaseElement {
  type: 'shape';
  variant: ShapeVariant;
}

export function renderShape(element: ShapeElement): string {
  return `<div class="rev01-shape" data-variant="${escapeAttr(element.variant)}"></div>`;
}

export const shapeInspectorSpec: InspectorSpec = {
  fields: [
    { kind: 'select', label: 'Variant', path: 'variant', options: SHAPE_VARIANTS },
  ],
};
