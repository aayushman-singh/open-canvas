// src/canvas/elements/shape.ts
//
// `ShapeElement` interface + renderer + inspector spec (ADR 0011 Step 1).

import { escapeAttr } from './render-utils.js';
import { SHAPE_VARIANTS, type BaseElement, type ShapeVariant } from '../schema.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';

export interface ShapeElement extends BaseElement {
  type: 'shape';
  variant: ShapeVariant;
}

export function renderShape(element: ShapeElement): string {
  return `<div class="rev01-shape" data-variant="${escapeAttr(element.variant)}"></div>`;
}

export const shapeInspectorSpec: InspectorSpec = {
  fields: [{ kind: 'select', label: 'Variant', path: 'variant', options: SHAPE_VARIANTS }],
};

export const shapeSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'shape',
      sidebarLabel: 'Shape',
      sidebarTip: 'Add a decorative shape',
      toolbarLabel: '+◇',
      toolbarTip: 'Add shape',
      factoryName: 'shape',
    },
  ],
};

export const shapeAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    variant: {
      type: 'string',
      enum: [...SHAPE_VARIANTS],
      description: 'Shape variant. Shape elements only.',
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.variant !== undefined) {
      if (typeof args.variant !== 'string') throw new Error('variant must be a string');
      patch.variant = args.variant;
    }
    return patch;
  },
};
