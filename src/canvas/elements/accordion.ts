// src/canvas/elements/accordion.ts
//
// Accordion element. A collapsible list of items: each item has a focusable
// header (the `title`) and a body of inline rich text that toggles open/closed
// when the visitor clicks (or focuses + Enter/Space).
//
// Render output is a pure DOM tree carrying `data-rev01-*` markers consumed
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
      const headerId = `rev01-acc-header-${escapeAttr(el.id)}-${escapeAttr(item.id)}`;
      const bodyId = `rev01-acc-body-${escapeAttr(el.id)}-${escapeAttr(item.id)}`;
      // Initial open state: first item is open by default. This gives the
      // visitor an immediate "what is this widget?" cue without forcing them
      // to click anything; for an `allowMultipleOpen: false` accordion the
      // remaining items stay closed (the runtime never opens a sibling on
      // first paint).
      const isOpen = idx === 0;
      const expandedAttr = isOpen ? 'true' : 'false';
      const openAttr = isOpen ? ' data-rev01-acc-open="true"' : '';
      const hiddenAttr = isOpen ? '' : ' hidden';
      const bodyHtml = renderInlineRuns(item.body);
      return [
        `<div class="rev01-accordion-item" data-rev01-acc-item="${escapeAttr(item.id)}"${openAttr}>`,
        `<button class="rev01-accordion-header" type="button" id="${headerId}" `,
        `data-rev01-acc-toggle="${escapeAttr(item.id)}" `,
        `aria-expanded="${expandedAttr}" aria-controls="${bodyId}">`,
        escapeHtml(item.title),
        `</button>`,
        `<div class="rev01-accordion-body" id="${bodyId}" role="region" `,
        `aria-labelledby="${headerId}" data-rev01-acc-body="${escapeAttr(item.id)}"${hiddenAttr}>`,
        bodyHtml,
        `</div>`,
        `</div>`,
      ].join('');
    })
    .join('');

  // `data-rev01-interactive="accordion"` is the runtime hook. `data-rev01-
  // allow-multi-open` (string literal "true"/"false") tells the runtime whether
  // to close siblings on open. Group role so AT reads the items as a related
  // set.
  return [
    `<div class="rev01-accordion" `,
    `data-rev01-interactive="accordion" `,
    `data-rev01-allow-multi-open="${el.allowMultipleOpen ? 'true' : 'false'}" `,
    `role="group">`,
    itemsHtml,
    `</div>`,
  ].join('');
}

export const ACCORDION_RECIPE_ID = 'accordion-list' as const;
