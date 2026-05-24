# Accordion + carousel + interactive runtime

**Wishlist #:** 17 **Tier:** B **Wave:** 4 **Status:** queued
**Depends on:** Phase 0 ✓ (`accordion`, `carousel` ElementType stubs)
**Blocks:** none

## User-visible outcome

An Owner drops an Accordion (collapsible list of items) or a Carousel (horizontal slider of cards) onto a section, fills items, publishes. Visitors interact: clicking an Accordion item expands it; tapping Carousel arrows or swiping moves slides. Both render without a JavaScript framework — vanilla event listeners only.

## Scope in

- Two new ElementTypes: `accordion`, `carousel`.
- Shared "interactive runtime" — tiny vanilla JS bundle (~3KB) injected once per snapshot, hydrating elements based on `data-rev01-interactive` attributes.
- Accordion item shape: title + body (rich-text via `InlineRun[]`).
- Carousel slide: image asset id + optional caption + optional link.
- Keyboard accessibility: accordion items focusable + Enter toggles; carousel arrows are real buttons.
- No external lib — vanilla JS, ~150 lines total.

## Scope out

- Auto-play carousel (no timer-based slides for POC).
- Multi-row carousels.
- Nested interactive elements.
- Touch swipe inertia (basic touchstart/touchend; no momentum).

## Schema delta

Phase 0 stubs:

```ts
// src/canvas/elements/accordion.ts
export interface AccordionElement extends BaseElement {
  type: 'accordion';
  items: Array<{ id: string; title: string; body: InlineRun[] }>;
  allowMultipleOpen: boolean;
}

// src/canvas/elements/carousel.ts
export interface CarouselElement extends BaseElement {
  type: 'carousel';
  slides: Array<{ id: string; assetId: string; caption?: string; href?: string }>;
  showArrows: boolean;
  showDots: boolean;
}
```

## Files owned (write)

- `src/canvas/elements/accordion.ts`.
- `src/canvas/elements/carousel.ts`.
- `src/interactive/runtime.ts` — vanilla JS hydration entry.
- `src/interactive/build.ts` — bundle the runtime into a static JS string injected into snapshots.
- `src/interactive/accordion.ts` — toggle behaviour.
- `src/interactive/carousel.ts` — slide navigation.
- `src/interactive/inject.ts` — snapshot-time injection of `<script>` tag + runtime.
- `src/interactive/smoke.ts`.
- `package.json` — `interactive:smoke` stub.

## Files read-only (must not modify)

- `src/canvas/schema.ts`, `src/canvas/render.ts`, `src/db/schema.ts`.

## Contract with neighbors

- Published snapshot HTML includes one `<script>` tag inline with the runtime IIFE.
- Each interactive element emits `data-rev01-interactive="accordion"` / `="carousel"` attributes the runtime queries via `document.querySelectorAll`.
- Runtime safe to load late (DOMContentLoaded guard).

## Smoke test

- `bun run interactive:smoke`:
  - Render snapshot with both elements → HTML contains runtime tag + correct data attributes.
  - Simulate accordion toggle (use jsdom-light or a manual DOM stub) → state attribute flips.
  - Simulate carousel next/prev → slide index updates.

## Acceptance criteria

- Visitor clicks accordion item, body shows.
- Visitor clicks carousel arrow, slide changes.
- No JS framework added.
- All smokes green.

## Open questions

- Single shared runtime vs per-element-type chunk. Recommend single runtime for simplicity at POC scale. Document trade.
