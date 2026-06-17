// src/canvas/elements/flow-container.ts
//
// FlowContainerElement (ADRs 0078-0080) is a compound element that lays out
// hosted Content Elements through Flow Items. It lives inside a Canvas Section
// like every other Canvas Element; only its children opt out of section-level
// absolute positioning.

import type { BaseElement, CanvasElement } from '../schema.js';
import type { AgentToolSpec } from './agent-tool-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { PHONE_MAX_PX, TABLET_MAX_PX } from '../responsive/breakpoints.js';
import { escapeAttr, escapeCssAttrId, styleFromEntries } from './render-utils.js';

export const FLOW_LAYOUT_MODES = ['stack', 'row', 'grid'] as const;
export type FlowLayoutMode = (typeof FLOW_LAYOUT_MODES)[number];

export const FLOW_ALIGNMENTS = ['start', 'center', 'end', 'stretch'] as const;
export type FlowAlign = (typeof FLOW_ALIGNMENTS)[number];

export const FLOW_JUSTIFY_VALUES = ['start', 'center', 'end', 'space-between'] as const;
export type FlowJustify = (typeof FLOW_JUSTIFY_VALUES)[number];

export const FLOW_BREAKPOINTS = ['tablet', 'phone'] as const;
export type FlowBreakpoint = (typeof FLOW_BREAKPOINTS)[number];

export interface FlowSpacing {
  row: number;
  column: number;
}

export interface FlowPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FlowLayoutResponsiveOverride {
  gap?: FlowSpacing;
  padding?: FlowPadding;
  align?: FlowAlign;
  justify?: FlowJustify;
  wrap?: boolean;
  columns?: number;
}

export interface FlowLayout {
  mode: FlowLayoutMode;
  gap: FlowSpacing;
  padding: FlowPadding;
  align: FlowAlign;
  justify: FlowJustify;
  /** Required when mode === 'row'. Rejected on other modes by validation. */
  wrap?: boolean;
  /** Required when mode === 'grid'. Rejected on other modes by validation. */
  columns?: number;
  responsive?: Partial<Record<FlowBreakpoint, FlowLayoutResponsiveOverride>>;
}

export interface FlowItemResponsiveOverride {
  span?: number;
  align?: FlowAlign;
  hidden?: boolean;
  order?: number;
}

export interface FlowItem {
  id: string;
  element: CanvasElement;
  span?: number;
  align?: FlowAlign;
  responsive?: Partial<Record<FlowBreakpoint, FlowItemResponsiveOverride>>;
}

export interface FlowContainerElement extends BaseElement {
  type: 'flow-container';
  layout: FlowLayout;
  items: FlowItem[];
}

export interface FlowContainerRenderCtx {
  renderHostedElement: (element: CanvasElement) => string;
}

function alignToCss(value: FlowAlign): string {
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
}

function justifyToCss(value: FlowJustify): string {
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
}

function renderLayoutStyle(layout: FlowLayout): string {
  const entries: Array<[string, string]> = [
    ['box-sizing', 'border-box'],
    ['width', '100%'],
    ['height', '100%'],
    ['gap', `${String(layout.gap.row)}px ${String(layout.gap.column)}px`],
    [
      'padding',
      `${String(layout.padding.top)}px ${String(layout.padding.right)}px ${String(
        layout.padding.bottom,
      )}px ${String(layout.padding.left)}px`,
    ],
    ['overflow', 'hidden'],
  ];

  if (layout.mode === 'grid') {
    entries.push(
      ['display', 'grid'],
      ['grid-template-columns', `repeat(${String(layout.columns ?? 1)},minmax(0,1fr))`],
      ['align-items', alignToCss(layout.align)],
      ['justify-content', justifyToCss(layout.justify)],
    );
  } else {
    entries.push(
      ['display', 'flex'],
      ['flex-direction', layout.mode === 'stack' ? 'column' : 'row'],
      ['align-items', alignToCss(layout.align)],
      ['justify-content', justifyToCss(layout.justify)],
    );
    if (layout.mode === 'row') {
      entries.push(['flex-wrap', layout.wrap === true ? 'wrap' : 'nowrap']);
    }
  }

  return styleFromEntries(entries);
}

function renderFlowItem(item: FlowItem, layout: FlowLayout, ctx: FlowContainerRenderCtx): string {
  const entries: Array<[string, string]> = [
    ['position', 'relative'],
    ['min-width', '0'],
    ['min-height', '0'],
  ];
  if (layout.mode === 'grid' && item.span !== undefined) {
    entries.push(['grid-column', `span ${String(item.span)}`]);
  }
  if (item.align !== undefined) {
    entries.push(['align-self', alignToCss(item.align)]);
  }
  const style = styleFromEntries(entries);
  const childHtml = ctx.renderHostedElement(item.element);
  return `<div class="opencanvas-flow-item" data-opencanvas-flow-item="${escapeAttr(item.id)}" style="${style}">${childHtml}</div>`;
}

function flowPaddingCss(padding: FlowPadding): string {
  return `${String(padding.top)}px ${String(padding.right)}px ${String(
    padding.bottom,
  )}px ${String(padding.left)}px`;
}

function flowGapCss(gap: FlowSpacing): string {
  return `${String(gap.row)}px ${String(gap.column)}px`;
}

function importantRule(selector: string, entries: Array<[string, string]>): string {
  if (entries.length === 0) return '';
  return `${selector}{${entries.map(([key, value]) => `${key}:${value} !important`).join(';')}}`;
}

function responsiveLayoutEntries(
  layout: FlowLayout,
  override: FlowLayoutResponsiveOverride,
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (override.gap !== undefined) entries.push(['gap', flowGapCss(override.gap)]);
  if (override.padding !== undefined) entries.push(['padding', flowPaddingCss(override.padding)]);
  if (override.align !== undefined) entries.push(['align-items', alignToCss(override.align)]);
  if (override.justify !== undefined) {
    entries.push(['justify-content', justifyToCss(override.justify)]);
  }
  if (layout.mode === 'row' && override.wrap !== undefined) {
    entries.push(['flex-wrap', override.wrap ? 'wrap' : 'nowrap']);
  }
  if (layout.mode === 'grid' && override.columns !== undefined) {
    entries.push(['grid-template-columns', `repeat(${String(override.columns)},minmax(0,1fr))`]);
  }
  return entries;
}

function responsiveItemEntries(
  layout: FlowLayout,
  override: FlowItemResponsiveOverride,
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (override.hidden !== undefined) entries.push(['display', override.hidden ? 'none' : 'block']);
  if (override.order !== undefined) entries.push(['order', String(override.order)]);
  if (override.align !== undefined) entries.push(['align-self', alignToCss(override.align)]);
  if (layout.mode === 'grid' && override.span !== undefined) {
    entries.push(['grid-column', `span ${String(override.span)}`]);
  }
  return entries;
}

function renderFlowResponsiveCss(element: FlowContainerElement): string {
  const blocks: string[] = [];
  const containerSelector = `[data-opencanvas-flow-container="${escapeCssAttrId(element.id)}"]`;
  const breakpointMax: Record<FlowBreakpoint, number> = {
    tablet: TABLET_MAX_PX,
    phone: PHONE_MAX_PX,
  };
  for (const bp of FLOW_BREAKPOINTS) {
    const rules: string[] = [];
    const layoutOverride = element.layout.responsive?.[bp];
    if (layoutOverride !== undefined) {
      rules.push(
        importantRule(containerSelector, responsiveLayoutEntries(element.layout, layoutOverride)),
      );
    }
    for (const item of element.items) {
      const itemOverride = item.responsive?.[bp];
      if (itemOverride === undefined) continue;
      const itemSelector = `${containerSelector} [data-opencanvas-flow-item="${escapeCssAttrId(item.id)}"]`;
      rules.push(importantRule(itemSelector, responsiveItemEntries(element.layout, itemOverride)));
    }
    const body = rules.filter((rule) => rule.length > 0).join('');
    if (body.length > 0) {
      blocks.push(`@media (max-width: ${String(breakpointMax[bp])}px){${body}}`);
    }
  }
  if (blocks.length === 0) return '';
  return `<style data-opencanvas-flow-responsive="${escapeAttr(element.id)}">${blocks.join('')}</style>`;
}

export function renderFlowContainer(
  element: FlowContainerElement,
  ctx: FlowContainerRenderCtx,
): string {
  const style = renderLayoutStyle(element.layout);
  const itemsHtml = element.items.map((item) => renderFlowItem(item, element.layout, ctx)).join('');
  const responsiveCss = renderFlowResponsiveCss(element);
  return `${responsiveCss}<div class="opencanvas-flow-container" data-opencanvas-flow-container="${escapeAttr(element.id)}" data-flow-layout-mode="${escapeAttr(element.layout.mode)}" style="${style}">${itemsHtml}</div>`;
}

export const flowContainerSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'flow-container',
      sidebarLabel: 'Flow',
      sidebarTip: 'Add a responsive flow layout container',
      toolbarLabel: '+Flow',
      toolbarTip: 'Add flow container',
      factoryName: 'flow-container',
    },
  ],
};

export const flowContainerAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    layout: {
      type: 'object',
      description:
        'Flow Container layout object. Must satisfy the Flow Layout grammar: mode stack|row|grid, gap, padding, align, justify, and mode-specific wrap/columns.',
    },
    items: {
      type: 'array',
      description:
        'Full Flow Item list. Each item has id, optional span/align/responsive placement, and one hosted CanvasElement in item.element with box x/y/w/h/z all set to 0.',
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.layout !== undefined) {
      if (args.layout === null || typeof args.layout !== 'object' || Array.isArray(args.layout)) {
        throw new Error('layout must be an object');
      }
      patch.layout = args.layout;
    }
    if (args.items !== undefined) {
      if (!Array.isArray(args.items)) {
        throw new Error('items must be an array');
      }
      patch.items = args.items;
    }
    return patch;
  },
};

export const FLOW_CONTAINER_RECIPE_ID = 'flow-container' as const;
