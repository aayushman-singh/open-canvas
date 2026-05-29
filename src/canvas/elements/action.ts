// src/canvas/elements/action.ts
//
// `ActionElement` interface (including `ActionHref` sub-type) + renderer +
// inspector spec (ADR 0011 Step 1). Resolver lives in `../action-href.ts`
// so this module's interface-only section stays declaration-only.

import type { InspectorSpec } from './inspector-spec.js';
import { escapeAttr, escapeHtml } from './render-utils.js';
import { resolveActionHref } from '../action-href.js';
import { ACTION_VARIANTS, type ActionVariant, type BaseElement, type CanvasPage } from '../schema.js';

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
  const href: ActionHref = typeof element.href === 'string'
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
