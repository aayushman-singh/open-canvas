// src/canvas/elements/accordion.ts
//
// Accordion element. A collapsible list of items: each item has a focusable
// header (the `title`) and a body of inline rich text that toggles open/closed
// when the visitor clicks (or focuses + Enter/Space).
//
// Render output is a pure DOM tree carrying `data-opencanvas-*` markers consumed
// by the shared interactive runtime injected once per snapshot (see
// `src/interactive/inject.ts`). The render fn writes NO `<script>` itself —
// the runtime hydrates every accordion on the page on `DOMContentLoaded`.
//
// Initial state: the FIRST item is open, all others closed. `allowMultipleOpen`
// is mirrored to the wrapper as a data-attribute so the runtime knows whether
// opening one item should close its siblings.
//
// Accessibility:
//   - Each header is a real `<button>` so it is focusable + Enter/Space
//     activates by default. `aria-expanded` + `aria-controls` wire it to the
//     body region; the body sets `role="region"` + `aria-labelledby`.
//   - Closed bodies are emitted with `hidden` (and the runtime mirrors that
//     attribute on toggle) — assistive tech skips collapsed regions.

import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import type { BaseElement, InlineRun } from '../schema.js';
import { escapeAttr, escapeHtml, renderInlineRun } from './render-utils.js';

export interface AccordionItem {
  id: string;
  title: string;
  body: InlineRun[];
}

export interface AccordionElement extends BaseElement {
  type: 'accordion';
  items: AccordionItem[];
  allowMultipleOpen: boolean;
}

export interface AccordionRenderCtx {
  styleKit: string;
}

function renderInlineRuns(runs: InlineRun[]): string {
  return runs.map(renderInlineRun).join('');
}

export function renderAccordion(el: AccordionElement, ctx: AccordionRenderCtx): string {
  // ctx.styleKit is plumbed through the shared render context shape; this
  // element renders semantic markup only and inherits visual tokens from the
  // wrapping page's `[data-style-kit]` selector.
  void ctx;

  const itemsHtml = el.items
    .map((item, idx) => {
      const headerId = `opencanvas-acc-header-${escapeAttr(el.id)}-${escapeAttr(item.id)}`;
      const bodyId = `opencanvas-acc-body-${escapeAttr(el.id)}-${escapeAttr(item.id)}`;
      // Initial open state: first item is open by default. This gives the
      // visitor an immediate "what is this widget?" cue without forcing them
      // to click anything; for an `allowMultipleOpen: false` accordion the
      // remaining items stay closed (the runtime never opens a sibling on
      // first paint).
      const isOpen = idx === 0;
      const expandedAttr = isOpen ? 'true' : 'false';
      const openAttr = isOpen ? ' data-opencanvas-acc-open="true"' : '';
      const hiddenAttr = isOpen ? '' : ' hidden';
      const bodyHtml = renderInlineRuns(item.body);
      return [
        `<div class="opencanvas-accordion-item" data-opencanvas-acc-item="${escapeAttr(item.id)}"${openAttr}>`,
        `<button class="opencanvas-accordion-header" type="button" id="${headerId}" `,
        `data-opencanvas-acc-toggle="${escapeAttr(item.id)}" `,
        `aria-expanded="${expandedAttr}" aria-controls="${bodyId}">`,
        escapeHtml(item.title),
        `</button>`,
        `<div class="opencanvas-accordion-body" id="${bodyId}" role="region" `,
        `aria-labelledby="${headerId}" data-opencanvas-acc-body="${escapeAttr(item.id)}"${hiddenAttr}>`,
        bodyHtml,
        `</div>`,
        `</div>`,
      ].join('');
    })
    .join('');

  // `data-opencanvas-interactive="accordion"` is the runtime hook. `data-opencanvas-
  // allow-multi-open` (string literal "true"/"false") tells the runtime whether
  // to close siblings on open. Group role so AT reads the items as a related
  // set.
  return [
    `<div class="opencanvas-accordion" `,
    `data-opencanvas-interactive="accordion" `,
    `data-opencanvas-allow-multi-open="${el.allowMultipleOpen ? 'true' : 'false'}" `,
    `role="group">`,
    itemsHtml,
    `</div>`,
  ].join('');
}

export const ACCORDION_RECIPE_ID = 'accordion-list' as const;

export const accordionInspectorSpec: InspectorSpec = {
  fields: [
    // Per-item editor (title + rich-text body). Imperative because each item
    // hosts a contentEditable body with its own toolbar + serializer round-
    // trip back into InlineRun[]. When carousel/table/nav land via the same
    // mount-handler pattern, the shared list-card shape will be a candidate
    // for a declarative `list-editor` kind (ADR 0011 dec 3, generalize on
    // three data points).
    { kind: 'custom-mount', name: 'accordion-items' },
    { kind: 'checkbox', label: 'Allow multiple open', path: 'allowMultipleOpen' },
  ],
};

export const accordionSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'accordion',
      sidebarLabel: 'Accordion',
      sidebarTip: 'Add a collapsible accordion (FAQ-style)',
      factoryName: 'accordion',
    },
  ],
};

export const accordionAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    allowMultipleOpen: {
      type: 'boolean',
      description: 'Allow multiple accordion items open. Accordion elements only.',
    },
    items: {
      type: 'array',
      description:
        'Accordion items. Accordion elements only. Each item needs id, title, and body as InlineRun objects. IMPORTANT: this is FULL-REPLACE — to add a single item you MUST send the complete list of existing items plus the new one. Sending a partial array WILL DELETE the omitted items. Omitting all items via an empty [] clears the accordion entirely.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'array', items: { type: 'object' } },
        },
        required: ['id', 'title', 'body'],
      },
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.allowMultipleOpen !== undefined) {
      if (typeof args.allowMultipleOpen !== 'boolean') {
        throw new Error('allowMultipleOpen must be a boolean');
      }
      patch.allowMultipleOpen = args.allowMultipleOpen;
    }
    if (args.items !== undefined) {
      if (!Array.isArray(args.items)) throw new Error('items must be an array');
      patch.items = args.items;
    }
    return patch;
  },
};
