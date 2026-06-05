// src/canvas/elements/container.ts
//
// `ContainerElement` interface + renderer + inspector spec (ADR 0011 Step 1).
// "Container" is the legacy schema name; conceptually this is a Surface
// primitive (card/panel/frame). The class name `opencanvas-surface` is the
// canonical one. Decorative-by-default: ARIA is applied on the element
// wrapper in render.ts.

import { escapeAttr } from './render-utils.js';
import { SURFACE_VARIANTS, type BaseElement, type SurfaceVariant } from '../schema.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { parseActionHref, type ActionHref } from './action.js';

export interface ContainerElement extends BaseElement {
  type: 'container';
  variant: SurfaceVariant;
  /**
   * Optional link target — when set, the renderer emits the container's
   * outer wrapper as `<a href="…">` instead of `<div>`. Card-as-link pattern.
   * ADR 0051 dec 5. No constraint on child action elements: canvas children
   * are DOM siblings (absolute-positioned at the section level), so no
   * nested-anchor violation arises.
   */
  linkHref?: ActionHref;
  /**
   * Optional accessible label for the link wrapper. When `linkHref` is set,
   * the visible card content is decorative chrome (image, headline, tags) but
   * the link itself needs a screen-reader name. `linkLabel` is emitted as
   * `aria-label` on the `<a>`. Ignored when `linkHref` is absent.
   */
  linkLabel?: string;
  /**
   * Optional accent that themes against the active style kit. May be a token
   * name registered in `StyleKitPreset.tintTokens` (e.g. `'forest'`) or a
   * raw CSS colour (`'#3a8a5f'`). Renderer resolves the token first, falls
   * back to the literal. Emitted as the `--opencanvas-tint` CSS custom
   * property on the container wrapper, plus a `data-tint="…"` attribute so
   * style-kit CSS can scope rules to tinted containers. Closes gap #17.
   */
  tint?: string;
  /**
   * ADR 0063 dec 3 — optional layout marker the materializer keys on when
   * defaulting a Collection's per-entry template. `'card'` containers inside
   * a `display === 'card'` Collection are treated as the per-entry card
   * shape. Absence = ordinary container; no behaviour change for existing
   * Containers (purely additive). Only one valid value today; widened only
   * when a second marker earns its place.
   */
  preset?: 'card';
}

export function renderContainer(element: ContainerElement): string {
  return `<div class="opencanvas-surface" data-variant="${escapeAttr(element.variant)}"></div>`;
}

export const containerInspectorSpec: InspectorSpec = {
  fields: [
    { kind: 'select', label: 'Variant', path: 'variant', options: SURFACE_VARIANTS },
    { kind: 'text', label: 'Link label', path: 'linkLabel', emptyOmits: true },
  ],
};

export const containerSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'container',
      sidebarLabel: 'Container',
      sidebarTip: 'Add a layout container to group elements',
      toolbarLabel: '+□',
      toolbarTip: 'Add container',
      factoryName: 'container',
    },
  ],
};

export const containerAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    variant: {
      type: 'string',
      enum: [...SURFACE_VARIANTS],
      description: 'Container surface variant. Container elements only.',
    },
    linkHref: {
      type: 'object',
      description:
        'Optional link target { type: "external" | "page", ... }. When set, the container wrapper becomes <a>. Container elements only. Pass null or empty to clear.',
    },
    linkLabel: {
      type: 'string',
      description:
        'Accessible name for the linked container wrapper. Required when linkHref is set. Pass null or empty to clear.',
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.variant !== undefined) {
      if (typeof args.variant !== 'string') throw new Error('variant must be a string');
      patch.variant = args.variant;
    }
    if (args.linkHref !== undefined) {
      patch.linkHref =
        args.linkHref === null || args.linkHref === ''
          ? undefined
          : parseActionHref(args.linkHref, 'linkHref');
    }
    if (args.linkLabel !== undefined) {
      if (args.linkLabel === null || args.linkLabel === '') {
        patch.linkLabel = undefined;
      } else if (typeof args.linkLabel !== 'string') {
        throw new Error('linkLabel must be a string, null, or empty string');
      } else {
        patch.linkLabel = args.linkLabel;
      }
    }
    return patch;
  },
};
