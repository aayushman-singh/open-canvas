// src/canvas/elements/carousel.ts
//
// Phase 0 stub. `CarouselElement` interface + render stub. Wave 4 owner: see
// docs/superpowers/plans/2026-05-23-17-interactive-accordion-carousel.md.

import type { BaseElement } from '../schema.js';

export interface CarouselSlide {
  id: string;
  assetId: string;
  caption?: string;
  href?: string;
}

export interface CarouselElement extends BaseElement {
  type: 'carousel';
  slides: CarouselSlide[];
  showArrows: boolean;
  showDots: boolean;
}

export interface CarouselRenderCtx {
  styleKit: string;
  assetBasePath: string;
}

export function renderCarousel(el: CarouselElement, ctx: CarouselRenderCtx): string {
  void el;
  void ctx;
  throw new Error(
    'TODO: implement in Wave 4 — see docs/superpowers/plans/2026-05-23-17-interactive-accordion-carousel.md',
  );
}

export const CAROUSEL_RECIPE_ID = 'carousel-strip' as const;
