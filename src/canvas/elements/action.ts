// src/canvas/elements/action.ts
//
// `ActionElement` interface (including `ActionHref` sub-type) + renderer +
// inspector spec (ADR 0011 Step 1). Resolver lives in `../action-href.ts`
// so this module's interface-only section stays declaration-only.

import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, escapeHtml } from './render-utils.js';
import { resolveActionHref } from '../action-href.js';
import {
  ACTION_VARIANTS,
  type ActionVariant,
  type BaseElement,
  type CanvasPage,
} from '../schema.js';
import { isAllowedHref } from '../validate.js';

export type ActionHref =
  | { type: 'external'; url: string }
  | { type: 'page'; pageId: string; anchor?: string };

export interface ActionElement extends BaseElement {
  type: 'action';
  label: string;
  href: ActionHref;
  variant: ActionVariant;
}

export function renderAction(element: ActionElement, ctx: { pages: CanvasPage[] }): string {
  // Legacy data may store href as a plain string; normalise to ActionHref.
  const href: ActionHref =
    typeof element.href === 'string'
      ? { type: 'external' as const, url: element.href }
      : element.href;
  const resolvedHref = resolveActionHref(href, ctx.pages);
  return `<a class="rev01-action" data-variant="${escapeAttr(element.variant)}" href="${escapeAttr(resolvedHref)}">${escapeHtml(element.label)}</a>`;
}

export const actionInspectorSpec: InspectorSpec = {
  fields: [
    { kind: 'select', label: 'Variant', path: 'variant', options: ACTION_VARIANTS },
    { kind: 'text', label: 'Label', path: 'label', required: true },
    {
      kind: 'action-href',
      discriminatorLabel: 'Link Type',
      valueLabel: 'Destination',
      path: 'href',
    },
  ],
};

// Note: surfaced as "Button" in the sidebar (visitor-facing word) even
// though the element type is `action`. The key `"action"` stays the
// canonical internal identifier and matches the existing `add-action`
// section-action string in canvas-client.ts.
export const actionSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'action',
      sidebarLabel: 'Button',
      sidebarTip: 'Add a clickable button',
      toolbarLabel: '+Btn',
      toolbarTip: 'Add button',
      factoryName: 'action',
    },
  ],
};

// ---------------------------------------------------------------------------
// Agent tool spec — action element (ADR 0011 Step 2)
// ---------------------------------------------------------------------------
//
// `parseActionHref` lives here because ActionHref is action's data shape.
// `src/agent/tool-parsers.ts` keeps its own duplicate during migration;
// PR 4 cutover deletes that copy and routes through this spec.

function isRecordLocal(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseActionHref(value: unknown, fieldName: string): ActionHref {
  if (typeof value === 'string') {
    if (value.length === 0) throw new Error(`${fieldName} must be a non-empty string`);
    if (!isAllowedHref(value)) {
      throw new Error(`${fieldName} ${JSON.stringify(value)} is not allowed`);
    }
    return { type: 'external', url: value };
  }
  if (!isRecordLocal(value)) {
    throw new Error(`${fieldName} must be a string or an ActionHref object`);
  }
  if (value.type === 'external') {
    if (typeof value.url !== 'string' || value.url.length === 0) {
      throw new Error(`${fieldName}.url must be a non-empty string`);
    }
    if (!isAllowedHref(value.url)) {
      throw new Error(`${fieldName}.url ${JSON.stringify(value.url)} is not allowed`);
    }
    return { type: 'external', url: value.url };
  }
  if (value.type === 'page') {
    if (typeof value.pageId !== 'string' || value.pageId.length === 0) {
      throw new Error(`${fieldName}.pageId must be a non-empty string`);
    }
    const href: ActionHref = { type: 'page', pageId: value.pageId };
    if (value.anchor !== undefined) {
      if (typeof value.anchor !== 'string') {
        throw new Error(`${fieldName}.anchor must be a string when present`);
      }
      href.anchor = value.anchor;
    }
    return href;
  }
  throw new Error(`${fieldName}.type must be "external" or "page"`);
}

export const actionAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    label: {
      type: 'string',
      description: 'Button label text. Action elements only.',
    },
    href: {
      type: 'string',
      description:
        'Button link URL. Action elements only. Must be http/https/mailto/tel or a relative path.',
    },
    variant: {
      type: 'string',
      enum: [...ACTION_VARIANTS],
      description: 'Action button visual variant. Action elements only.',
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.variant !== undefined) {
      if (typeof args.variant !== 'string') throw new Error('variant must be a string');
      patch.variant = args.variant;
    }
    if (args.label !== undefined) {
      if (typeof args.label !== 'string') throw new Error('label must be a string');
      patch.label = args.label;
    }
    if (args.href !== undefined) {
      patch.href = parseActionHref(args.href, 'href');
    }
    return patch;
  },
};
