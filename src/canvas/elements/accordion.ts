// src/canvas/elements/accordion.ts
//
// Phase 0 stub. `AccordionElement` interface + render stub. Wave 4 owner: see
// docs/superpowers/plans/2026-05-23-17-interactive-accordion-carousel.md.

import type { BaseElement, InlineRun } from '../schema.js';

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

export function renderAccordion(el: AccordionElement, ctx: AccordionRenderCtx): string {
  void el;
  void ctx;
  throw new Error(
    'TODO: implement in Wave 4 — see docs/superpowers/plans/2026-05-23-17-interactive-accordion-carousel.md',
  );
}

export const ACCORDION_RECIPE_ID = 'accordion-list' as const;
