// src/canvas/elements/shape.ts
//
// `ShapeElement` interface + renderer + inspector spec (ADR 0011 Step 1).

import { escapeAttr } from './render-utils.js';
import { SHAPE_VARIANTS, type BaseElement, type ShapeVariant } from '../schema.js';
import {
  FREEFORM_RENDER_MODES,
  type FreeformRenderMode,
  renderFreeformShapeInnerSvg,
} from '../shape-freeform.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { ICON_NAMES, type IconName, renderIconSvg } from '../icons.js';

export interface ShapeElement extends BaseElement {
  type: 'shape';
  variant: ShapeVariant;
  /**
   * Icon glyph. Required when `variant === 'icon'`; ignored otherwise.
   * One of the registered names in `ICON_NAMES` (see src/canvas/icons.ts).
   * ADR 0051 dec 2.
   */
  iconKind?: IconName;
  /**
   * SVG path `d` in normalized 0..100 viewBox coords. Required when
   * `variant === 'freeform'`.
   */
  path?: string;
  /**
   * Fill blob vs ink stroke for freeform shapes. Defaults to `fill`.
   */
  freeformRender?: FreeformRenderMode;
}

export function renderShape(element: ShapeElement): string {
  if (element.variant === 'freeform' && typeof element.path === 'string' && element.path.length > 0) {
    const render = element.freeformRender ?? 'fill';
    return `<div class="opencanvas-shape" data-variant="freeform" data-freeform-render="${escapeAttr(render)}">${renderFreeformShapeInnerSvg(element.path, render)}</div>`;
  }
  if (element.variant === 'icon' && element.iconKind !== undefined) {
    // ADR 0051 dec 2 — variant 'icon' fills the element box with the inline
    // SVG. inline=false sizes the SVG at 100%×100% so the absolute-positioned
    // wrapper drives the dimensions.
    return `<div class="opencanvas-shape" data-variant="icon" data-icon-kind="${escapeAttr(element.iconKind)}">${renderIconSvg(element.iconKind, { inline: false })}</div>`;
  }
  return `<div class="opencanvas-shape" data-variant="${escapeAttr(element.variant)}"></div>`;
}

export const shapeInspectorSpec: InspectorSpec = {
  fields: [
    { kind: 'select', label: 'Variant', path: 'variant', options: SHAPE_VARIANTS },
    {
      kind: 'select',
      label: 'Draw style',
      path: 'freeformRender',
      options: FREEFORM_RENDER_MODES,
      showWhen: { path: 'variant', equals: 'freeform' },
    },
    // Picker only mounts when the shape is an icon variant — mirrors the
    // schema's "iconKind required when variant='icon', ignored otherwise".
    // Before this field landed, owners couldn't change a shape's glyph at
    // all once the template seeded it.
    {
      kind: 'icon',
      label: 'Icon',
      path: 'iconKind',
      showWhen: { path: 'variant', equals: 'icon' },
    },
  ],
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
    {
      key: 'freeform',
      sidebarLabel: 'Freeform',
      sidebarTip: 'Draw a freeform shape on the canvas',
      toolbarLabel: '+✎',
      toolbarTip: 'Draw freeform shape',
      factoryName: 'freeform-shape',
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
    iconKind: {
      type: 'string',
      enum: [...ICON_NAMES],
      description: `Icon glyph; required when variant === 'icon'. One of [${ICON_NAMES.join(', ')}]. Shape elements only.`,
    },
    path: {
      type: 'string',
      description: 'SVG path d for variant === freeform (0..100 viewBox). Shape elements only.',
    },
    freeformRender: {
      type: 'string',
      enum: [...FREEFORM_RENDER_MODES],
      description: 'Fill blob or ink stroke when variant === freeform. Shape elements only.',
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.variant !== undefined) {
      if (typeof args.variant !== 'string') throw new Error('variant must be a string');
      patch.variant = args.variant;
    }
    if (args.iconKind !== undefined) {
      if (args.iconKind === null || args.iconKind === '') {
        patch.iconKind = undefined;
      } else {
        if (typeof args.iconKind !== 'string') throw new Error('iconKind must be a string');
        patch.iconKind = args.iconKind;
      }
    }
    if (args.path !== undefined) {
      if (args.path === null || args.path === '') {
        patch.path = undefined;
      } else if (typeof args.path !== 'string') {
        throw new Error('path must be a string');
      } else {
        patch.path = args.path;
      }
    }
    if (args.freeformRender !== undefined) {
      if (args.freeformRender === null || args.freeformRender === '') {
        patch.freeformRender = undefined;
      } else if (typeof args.freeformRender !== 'string') {
        throw new Error('freeformRender must be a string');
      } else {
        patch.freeformRender = args.freeformRender;
      }
    }
    return patch;
  },
};
