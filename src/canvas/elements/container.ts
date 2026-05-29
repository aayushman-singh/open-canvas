// src/canvas/elements/container.ts
//
// `ContainerElement` interface + renderer + inspector spec (ADR 0011 Step 1).
// "Container" is the legacy schema name; conceptually this is a Surface
// primitive (card/panel/frame). The class name `rev01-surface` is the
// canonical one. Decorative-by-default: ARIA is applied on the element
// wrapper in render.ts.

import { escapeAttr } from './render-utils.js';
import { SURFACE_VARIANTS, type BaseElement, type SurfaceVariant } from '../schema.js';
import type { InspectorSpec } from './inspector-spec.js';

export interface ContainerElement extends BaseElement {
  type: 'container';
  variant: SurfaceVariant;
}

export function renderContainer(element: ContainerElement): string {
  return `<div class="rev01-surface" data-variant="${escapeAttr(element.variant)}"></div>`;
}

export const containerInspectorSpec: InspectorSpec = {
  fields: [
    { kind: 'select', label: 'Variant', path: 'variant', options: SURFACE_VARIANTS },
  ],
};
