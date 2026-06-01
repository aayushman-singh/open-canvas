// src/canvas/elements/carousel.ts
//
// Carousel element. A horizontal slider of image slides with optional
// caption + link, optional prev/next arrows, optional dot navigation.
//
// Render output is a pure DOM tree carrying `data-opencanvas-*` markers consumed
// by the shared interactive runtime injected once per snapshot (see
// `src/interactive/inject.ts`). The render fn writes NO `<script>` itself.
//
// CSS strategy:
//   - The outer wrapper carries `data-opencanvas-slide-index="0"` (string, mutated
//     by the runtime). The visitor-facing stylesheet selects the active slide
//     with the attribute-equality pair `[data-opencanvas-slide-index='N']
//     [data-opencanvas-carousel-slide-index='N']` and applies `transform` /
//     opacity to crossfade or translate. The render emits all slides; only
//     the active one is visible per CSS.
//   - Arrows are real `<button>`s — focusable, Enter/Space activates by
//     default. Dots are also `<button>`s for the same reason.
//
// Out of scope: auto-play, multi-row carousels, touch inertia.

import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import type { BaseElement } from '../schema.js';
import { escapeAttr, escapeHtml } from './render-utils.js';

export interface CarouselSlide {
  id: string;
  assetId: string;
  caption?: string;
  href?: string;
}

/**
 * Layout axis for the slide presentation + arrow glyphs.
 *   - `horizontal` (default): chevrons ‹/›, arrows on left/right when split.
 *   - `vertical`: chevrons ⌃/⌄, arrows on top/bottom when split.
 * Slide-visibility is fade-based regardless; direction is only an arrow + axis hint.
 */
export const CAROUSEL_DIRECTIONS = ['horizontal', 'vertical'] as const;
export type CarouselDirection = (typeof CAROUSEL_DIRECTIONS)[number];

/**
 * Arrow placement preset.
 *   - `split-vertical-center` (default): prev on the leading edge, next on the
 *     trailing edge, both vertically centred (or horizontally centred when the
 *     carousel is vertical). The classic carousel layout.
 *   - `bunched-bottom-right`: prev + next sit side-by-side in the trailing
 *     corner. Modern minimalist layout you see on hero galleries.
 *   - `split-below`: prev / next pinned outside the carousel — on the leading
 *     and trailing edges of the row beneath, with the dot pagination centred
 *     between them.
 */
export const CAROUSEL_ARROW_POSITIONS = [
  'split-vertical-center',
  'bunched-bottom-right',
  'split-below',
] as const;
export type CarouselArrowPosition = (typeof CAROUSEL_ARROW_POSITIONS)[number];

/**
 * Arrow button shape.
 *   - `round` (default): circle.
 *   - `square`: rounded square.
 *   - `pill`: wider pill.
 */
export const CAROUSEL_ARROW_STYLES = ['round', 'square', 'pill'] as const;
export type CarouselArrowStyle = (typeof CAROUSEL_ARROW_STYLES)[number];

export interface CarouselElement extends BaseElement {
  type: 'carousel';
  slides: CarouselSlide[];
  showArrows: boolean;
  showDots: boolean;
  direction?: CarouselDirection;
  arrowPosition?: CarouselArrowPosition;
  arrowStyle?: CarouselArrowStyle;
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
      ? `<figcaption class="opencanvas-carousel-caption">${escapeHtml(slide.caption)}</figcaption>`
      : '';
  // Each slide carries its own index so the visitor stylesheet can target
  // `[data-opencanvas-slide-index='N'] [data-opencanvas-carousel-slide-index='N']`
  // without needing nth-child arithmetic. The alt is the caption when present
  // so screen-reader users hear a meaningful label; otherwise the alt is
  // empty (decorative image) and the wrapper's aria-roledescription = "slide"
  // carries the semantic load.
  const altText = typeof slide.caption === 'string' ? slide.caption : '';
  const imageHtml = `<img class="opencanvas-carousel-image" src="${escapeAttr(src)}" alt="${escapeAttr(altText)}" loading="lazy" />`;
  const mediaHtml =
    typeof slide.href === 'string' && slide.href.length > 0
      ? `<a class="opencanvas-carousel-link" href="${escapeAttr(slide.href)}">${imageHtml}</a>`
      : imageHtml;
  return [
    `<figure class="opencanvas-carousel-slide" `,
    `data-opencanvas-carousel-slide="${escapeAttr(slide.id)}" `,
    `data-opencanvas-carousel-slide-index="${String(index)}" `,
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

  const direction: CarouselDirection = el.direction ?? 'horizontal';
  const arrowPosition: CarouselArrowPosition = el.arrowPosition ?? 'split-vertical-center';
  const arrowStyle: CarouselArrowStyle = el.arrowStyle ?? 'round';

  const total = el.slides.length;
  const slidesHtml = el.slides
    .map((slide, idx) => renderSlide(slide, idx, total, ctx.assetBasePath))
    .join('');

  // Glyphs follow the carousel's primary axis so the affordance reads
  // unambiguously regardless of position preset. Vertical carousels use
  // up/down chevrons even when the arrows are placed in the bottom-right.
  const prevGlyph = direction === 'vertical' ? '⌃' : '‹';
  const nextGlyph = direction === 'vertical' ? '⌄' : '›';
  const arrowsHtml = el.showArrows
    ? [
        `<button class="opencanvas-carousel-arrow opencanvas-carousel-arrow-prev" type="button" `,
        `data-opencanvas-carousel-prev aria-label="Previous slide">`,
        prevGlyph,
        `</button>`,
        `<button class="opencanvas-carousel-arrow opencanvas-carousel-arrow-next" type="button" `,
        `data-opencanvas-carousel-next aria-label="Next slide">`,
        nextGlyph,
        `</button>`,
      ].join('')
    : '';

  const dotsHtml = el.showDots
    ? [
        `<div class="opencanvas-carousel-dots" role="tablist" aria-label="Slide navigation">`,
        el.slides
          .map((slide, idx) => {
            const isActive = idx === 0;
            return [
              `<button class="opencanvas-carousel-dot" type="button" `,
              `data-opencanvas-carousel-dot="${String(idx)}" `,
              `role="tab" aria-selected="${isActive ? 'true' : 'false'}" `,
              `aria-label="${escapeAttr(`Go to slide ${String(idx + 1)}`)}" `,
              `data-opencanvas-slide-target-id="${escapeAttr(slide.id)}">`,
              `</button>`,
            ].join('');
          })
          .join(''),
        `</div>`,
      ].join('')
    : '';

  // Outer wrapper. `data-opencanvas-slide-index` is the runtime-mutated cursor;
  // initial value is '0' (first slide). `data-opencanvas-slide-count` is read by
  // the runtime to bound the cursor. `aria-roledescription="carousel"` is the
  // ARIA APG carousel pattern label.
  return [
    `<div class="opencanvas-carousel" `,
    `data-opencanvas-interactive="carousel" `,
    `data-opencanvas-slide-index="0" `,
    `data-opencanvas-slide-count="${String(total)}" `,
    `data-opencanvas-direction="${escapeAttr(direction)}" `,
    `data-opencanvas-arrow-position="${escapeAttr(arrowPosition)}" `,
    `data-opencanvas-arrow-style="${escapeAttr(arrowStyle)}" `,
    `role="region" aria-roledescription="carousel">`,
    `<div class="opencanvas-carousel-track">`,
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
    {
      kind: 'select',
      label: 'Direction',
      path: 'direction',
      options: CAROUSEL_DIRECTIONS,
      defaultValue: 'horizontal',
    },
    {
      kind: 'select',
      label: 'Arrow position',
      path: 'arrowPosition',
      options: CAROUSEL_ARROW_POSITIONS,
      defaultValue: 'split-vertical-center',
    },
    {
      kind: 'select',
      label: 'Arrow style',
      path: 'arrowStyle',
      options: CAROUSEL_ARROW_STYLES,
      defaultValue: 'round',
    },
  ],
};

export const carouselSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'carousel',
      sidebarLabel: 'Carousel',
      sidebarTip: 'Add an image carousel / slideshow',
      factoryName: 'carousel',
    },
  ],
};

export const carouselAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    showArrows: {
      type: 'boolean',
      description: 'Show navigation arrows. Carousel elements only.',
    },
    showDots: {
      type: 'boolean',
      description: 'Show dot pagination. Carousel elements only.',
    },
    direction: {
      type: 'string',
      enum: [...CAROUSEL_DIRECTIONS],
      description: 'Carousel layout axis: horizontal (default) or vertical. Carousel elements only.',
    },
    arrowPosition: {
      type: 'string',
      enum: [...CAROUSEL_ARROW_POSITIONS],
      description:
        'Arrow placement preset. Carousel elements only. Defaults to split-vertical-center.',
    },
    arrowStyle: {
      type: 'string',
      enum: [...CAROUSEL_ARROW_STYLES],
      description: 'Arrow button shape: round (default), square, or pill. Carousel elements only.',
    },
    slides: {
      type: 'array',
      description:
        'Carousel slides. Carousel elements only. Each slide needs id and assetId; caption and href are optional.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          assetId: { type: 'string' },
          caption: { type: 'string' },
          href: { type: 'string' },
        },
        required: ['id', 'assetId'],
      },
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.showArrows !== undefined) {
      if (typeof args.showArrows !== 'boolean') throw new Error('showArrows must be a boolean');
      patch.showArrows = args.showArrows;
    }
    if (args.showDots !== undefined) {
      if (typeof args.showDots !== 'boolean') throw new Error('showDots must be a boolean');
      patch.showDots = args.showDots;
    }
    if (args.direction !== undefined) {
      if (typeof args.direction !== 'string') throw new Error('direction must be a string');
      patch.direction = args.direction;
    }
    if (args.arrowPosition !== undefined) {
      if (typeof args.arrowPosition !== 'string') throw new Error('arrowPosition must be a string');
      patch.arrowPosition = args.arrowPosition;
    }
    if (args.arrowStyle !== undefined) {
      if (typeof args.arrowStyle !== 'string') throw new Error('arrowStyle must be a string');
      patch.arrowStyle = args.arrowStyle;
    }
    if (args.slides !== undefined) {
      if (!Array.isArray(args.slides)) throw new Error('slides must be an array');
      patch.slides = args.slides;
    }
    return patch;
  },
};
