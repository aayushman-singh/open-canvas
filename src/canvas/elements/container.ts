// src/canvas/elements/container.ts
//
// `ContainerElement` interface + renderer. "Container" is the legacy schema
// name; conceptually this is a Surface primitive (card/panel/frame). The
// class name `rev01-surface` is the canonical one. Decorative-by-default:
// ARIA is applied on the element wrapper in render.ts.

import { escapeAttr } from './render-utils.js';
import type { BaseElement, SurfaceVariant } from '../schema.js';

export interface ContainerElement extends BaseElement {
  type: 'container';
  variant: SurfaceVariant;
}

export function renderContainer(element: ContainerElement): string {
  return `<div class="rev01-surface" data-variant="${escapeAttr(element.variant)}"></div>`;
}
