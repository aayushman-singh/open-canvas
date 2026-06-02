// src/canvas/elements/tabs.ts
//
// `TabsElement` — a tab strip + N hidden panels surfacing one panel at a time.
// ADR 0052.
//
// Each `Tab` carries a panel-local element array. The renderer wraps each
// panel in a `position: relative` div sized to (TabsElement.box.w ×
// TabsElement.box.h − tabBarHeight); panel children are absolute-positioned
// within that box exactly as section children are absolute-positioned within
// their section. Reuses the same nesting + renderChild pattern as
// `CollectionElement`.
//
// Visitor-side click handling lives in `render.ts` (`renderTabsHandlerScript`)
// — one delegated listener at the end of `<main>`, emitted only when at least
// one `TabsElement` exists in the snapshot. Same pattern as ADR 0051's copy
// handler.

import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, renderInlineRun, styleFromEntries } from './render-utils.js';
import type { BaseElement, CanvasElement, InlineRun } from '../schema.js';

export interface Tab {
  /** anchor-id charset (`/^[a-z][a-z0-9-]*$/`), unique within the TabsElement. */
  id: string;
  /** Rich-text tab label — same shape as TextElement.content / ActionElement.label. */
  label: InlineRun[];
  /** Panel children, panel-local coordinates. */
  elements: CanvasElement[];
}

export interface TabsElement extends BaseElement {
  type: 'tabs';
  /** Length ≥ 2 — single-tab `TabsElement` is structurally a Container with a label. */
  tabs: Tab[];
  /** Must reference one of `tabs[].id`. Required; the initial visible tab is a design decision. */
  activeTabId: string;
  /** Bar height in px; default 56. */
  tabBarHeight?: number;
}

/** Default bar height when `tabBarHeight` is unset. ADR 0052 dec 3 rationale. */
export const TABS_DEFAULT_BAR_HEIGHT = 56;

export interface TabsRenderCtx {
  styleKit: string;
  renderChild: (element: CanvasElement) => string;
}

export function renderTabs(el: TabsElement, ctx: TabsRenderCtx): string {
  const barHeight = el.tabBarHeight ?? TABS_DEFAULT_BAR_HEIGHT;
  const panelWidth = el.box.w;
  const panelHeight = Math.max(0, el.box.h - barHeight);

  const barButtonsHtml = el.tabs
    .map((tab) => {
      const isActive = tab.id === el.activeTabId;
      const labelHtml = tab.label.map(renderInlineRun).join('');
      const activeAttr = isActive ? ' data-tab-active' : '';
      return `<button type="button" class="opencanvas-tab" data-opencanvas-tab-id="${escapeAttr(tab.id)}"${activeAttr}>${labelHtml}</button>`;
    })
    .join('');

  const barStyle = styleFromEntries([['height', `${String(barHeight)}px`]]);
  const barHtml = `<div class="opencanvas-tab-bar" data-tab-bar style="${barStyle}">${barButtonsHtml}</div>`;

  const panelStyleEntries: [string, string][] = [
    ['position', 'relative'],
    ['width', `${String(panelWidth)}px`],
    ['height', `${String(panelHeight)}px`],
  ];
  const panelStyle = styleFromEntries(panelStyleEntries);

  const panelsHtml = el.tabs
    .map((tab) => {
      const isActive = tab.id === el.activeTabId;
      const activeAttr = isActive ? ' data-tab-active' : '';
      const childrenHtml = tab.elements.map((child) => ctx.renderChild(child)).join('');
      return `<div class="opencanvas-tab-panel" data-opencanvas-tab-panel-id="${escapeAttr(tab.id)}"${activeAttr} style="${panelStyle}">${childrenHtml}</div>`;
    })
    .join('');

  return `<div class="opencanvas-tabs" data-opencanvas-tabs="${escapeAttr(el.id)}">${barHtml}${panelsHtml}</div>`;
}

// Tabs is the second element type to nest CanvasElement[] (after Collection).
// The first inspector cut exposes only the scalar fields the generic inspector
// can safely edit. The richer follow-up introduces an "Edit tabs" custom mount
// that drives tab order + label edits.

export const tabsInspectorSpec: InspectorSpec = {
  fields: [
    {
      kind: 'text',
      label: 'Active tab id',
      path: 'activeTabId',
    },
    {
      kind: 'number',
      label: 'Tab bar height',
      path: 'tabBarHeight',
      min: 1,
    },
  ],
};

export const tabsSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'tabs',
      sidebarLabel: 'Tabs',
      sidebarTip: 'Add a tabbed panel group',
      toolbarLabel: '+Tabs',
      toolbarTip: 'Add tabs',
      factoryName: 'tabs',
    },
  ],
};

// Agent tool spec — minimal first cut. Tabs internal structure (nested
// element arrays per panel) is too complex for a one-shot patch field;
// reorder / add / remove tab operations live in their own standalone tools
// that ship in the inspector follow-up. The basic patch surface lets the
// agent swap `activeTabId` and `tabBarHeight` without rewiring panels.
export const tabsAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    activeTabId: {
      type: 'string',
      description: 'Id of the tab to surface as active. Must reference one of tabs[].id.',
    },
    tabBarHeight: {
      type: 'number',
      description: `Bar height in px. Default ${String(TABS_DEFAULT_BAR_HEIGHT)} when unset.`,
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.activeTabId !== undefined) {
      if (typeof args.activeTabId !== 'string' || args.activeTabId.length === 0) {
        throw new Error('activeTabId must be a non-empty string');
      }
      patch.activeTabId = args.activeTabId;
    }
    if (args.tabBarHeight !== undefined) {
      if (typeof args.tabBarHeight !== 'number' || !Number.isFinite(args.tabBarHeight)) {
        throw new Error('tabBarHeight must be a finite number');
      }
      patch.tabBarHeight = args.tabBarHeight;
    }
    return patch;
  },
};

export const TABS_RECIPE_ID = 'tabs-group' as const;
