// src/canvas/elements/carousel.ts
//
// Carousel element. A horizontal slider of image slides with optional
// caption + link, optional prev/next arrows, optional dot navigation.
//
// Render output is a pure DOM tree carrying `data-rev01-*` markers consumed
// by the shared interactive runtime injected once per snapshot (see
// `src/interactive/inject.ts`). The render fn writes NO `<script>` itself.
//
// CSS strategy:
//   - The outer wrapper carries `data-rev01-slide-index="0"` (string, mutated
//     by the runtime). The visitor-facing stylesheet selects the active slide
//     with the attribute-equality pair `[data-rev01-slide-index='N']
//     [data-rev01-carousel-slide-index='N']` and applies `transform` /
//     opacity to crossfade or translate. The render emits all slides; only
//     the active one is visible per CSS.
//   - Arrows are real `<button>`s — focusable, Enter/Space activates by
//     default. Dots are also `<button>`s for the same reason.
//
// Out of scope: auto-play, multi-row carousels, touch inertia.

import type { InspectorSpec } from './inspector-spec.js';
import type { BaseElement } from '../schema.js';
import { escapeAttr, escapeHtml } from './render-utils.js';

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

function renderSlide(
  slide: CarouselSlide,
  index: number,
  total: number,
  assetBasePath: string,
): string {
  const src = `${assetBasePath}/${slide.assetId}`;
  const captionHtml =
    typeof slide.caption === 'string' && slide.caption.length > 0
      ? `<figcaption class="rev01-carousel-caption">${escapeHtml(slide.caption)}</figcaption>`
      : '';
  // Each slide carries its own index so the visitor stylesheet can target
  // `[data-rev01-slide-index='N'] [data-rev01-carousel-slide-index='N']`
  // without needing nth-child arithmetic. The alt is the caption when present
  // so screen-reader users hear a meaningful label; otherwise the alt is
  // empty (decorative image) and the wrapper's aria-roledescription = "slide"
  // carries the semantic load.
  const altText = typeof slide.caption === 'string' ? slide.caption : '';
  const imageHtml = `<img class="rev01-carousel-image" src="${escapeAttr(src)}" alt="${escapeAttr(altText)}" loading="lazy" />`;
  const mediaHtml =
    typeof slide.href === 'string' && slide.href.length > 0
      ? `<a class="rev01-carousel-link" href="${escapeAttr(slide.href)}">${imageHtml}</a>`
      : imageHtml;
  return [
    `<figure class="rev01-carousel-slide" `,
    `data-rev01-carousel-slide="${escapeAttr(slide.id)}" `,
    `data-rev01-carousel-slide-index="${String(index)}" `,
    `role="group" aria-roledescription="slide" `,
    `aria-label="${escapeAttr(`${String(index + 1)} of ${String(total)}`)}">`,
    mediaHtml,
    captionHtml,
    `</figure>`,
  ].join('');
}

export function renderCarousel(el: CarouselElement, ctx: CarouselRenderCtx): string {
  // ctx.styleKit is plumbed through the shared render context shape; not
  // consumed here — visual tokens flow via `[data-style-kit]` ancestor.
  void ctx.styleKit;

  const total = el.slides.length;
  const slidesHtml = el.slides
    .map((slide, idx) => renderSlide(slide, idx, total, ctx.assetBasePath))
    .join('');

  const arrowsHtml = el.showArrows
    ? [
        `<button class="rev01-carousel-arrow rev01-carousel-arrow-prev" type="button" `,
        `data-rev01-carousel-prev aria-label="Previous slide">`,
        // U+2039 SINGLE LEFT-POINTING ANGLE QUOTATION MARK — visual hint only;
        // the aria-label carries the actual announcement.
        `‹`,
        `</button>`,
        `<button class="rev01-carousel-arrow rev01-carousel-arrow-next" type="button" `,
        `data-rev01-carousel-next aria-label="Next slide">`,
        // U+203A SINGLE RIGHT-POINTING ANGLE QUOTATION MARK.
        `›`,
        `</button>`,
      ].join('')
    : '';

  const dotsHtml = el.showDots
    ? [
        `<div class="rev01-carousel-dots" role="tablist" aria-label="Slide navigation">`,
        el.slides
          .map((slide, idx) => {
            const isActive = idx === 0;
            return [
              `<button class="rev01-carousel-dot" type="button" `,
              `data-rev01-carousel-dot="${String(idx)}" `,
              `role="tab" aria-selected="${isActive ? 'true' : 'false'}" `,
              `aria-label="${escapeAttr(`Go to slide ${String(idx + 1)}`)}" `,
              `data-rev01-slide-target-id="${escapeAttr(slide.id)}">`,
              `</button>`,
            ].join('');
          })
          .join(''),
        `</div>`,
      ].join('')
    : '';

  // Outer wrapper. `data-rev01-slide-index` is the runtime-mutated cursor;
  // initial value is '0' (first slide). `data-rev01-slide-count` is read by
  // the runtime to bound the cursor. `aria-roledescription="carousel"` is the
  // ARIA APG carousel pattern label.
  return [
    `<div class="rev01-carousel" `,
    `data-rev01-interactive="carousel" `,
    `data-rev01-slide-index="0" `,
    `data-rev01-slide-count="${String(total)}" `,
    `role="region" aria-roledescription="carousel">`,
    `<div class="rev01-carousel-track">`,
    slidesHtml,
    `</div>`,
    arrowsHtml,
    dotsHtml,
    `</div>`,
  ].join('');
}

export const CAROUSEL_RECIPE_ID = 'carousel-strip' as const;

export const carouselInspectorSpec: InspectorSpec = {
  fields: [
    // Per-slide editor (thumbnail + upload + caption + link + remove).
    // Imperative because each slide needs a thumbnail preview, an upload
    // button wired to postAssetUpload, and an asset-id round-trip after
    // upload completes. Same custom-mount shape as accordion-items; the
    // third such mount lands the trigger to design a declarative
    // list-editor kind per ADR 0011 dec 3.
    { kind: 'custom-mount', name: 'carousel-slides' },
    { kind: 'checkbox', label: 'Show arrows', path: 'showArrows' },
    { kind: 'checkbox', label: 'Show dots', path: 'showDots' },
  ],
};
