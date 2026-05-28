# Responsive canvas render

**Wishlist #:** 1 **Tier:** S **Wave:** 1 **Status:** queued
**Depends on:** Phase 0 ✓
**Blocks:** none

## User-visible outcome

A Visitor opening a Published Site on a laptop sees the page exactly as the Owner laid it out on the canvas. A Visitor opening the same Published Address on a narrower laptop or in a resized window sees the same content fluidly reflowed — text wraps, media scales, Positioned Elements stay readable — without the Owner doing any extra work. Editing remains desktop-only.

## Scope in

- A responsive translation layer that maps a Positioned Element's `box` (px on the design canvas) into a fluid published layout that adapts to the Visitor's viewport width.
- Per-Element optional `responsive` overrides (Owner-authored, optional): override box, hide/show, or pin alignment at named breakpoints.
- Three named breakpoints: `desktop` (≥1024px, source-of-truth), `tablet` (768–1023px), `phone` (<768px).
- Renderer changes in `src/canvas/elements/*.ts` so each element type uses the responsive translation.
- Smoke that asserts a known canvas state renders correct HTML/CSS at all three breakpoints.

## Scope out

- Mobile / touch editing on canvas. ADR 0003 locks desktop-only editing.
- Per-element media queries beyond the three named breakpoints.
- Auto-layout / flex re-flow inside Containers (still absolute-positioned within a Section).

## Schema delta

Already scaffolded in Phase 0:

```ts
// src/canvas/schema.ts (Phase 0)
export type Breakpoint = 'desktop' | 'tablet' | 'phone';

export interface ResponsiveBoxOverride {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  hidden?: boolean;
}

export interface ResponsiveOverrides {
  tablet?: ResponsiveBoxOverride;
  phone?: ResponsiveBoxOverride;
}

// BaseElement.responsive?: ResponsiveOverrides   (added in Phase 0)
```

## Files owned (write)

- `src/canvas/responsive/translate.ts` — px-on-canvas → fluid CSS per breakpoint.
- `src/canvas/responsive/css.ts` — generates the `<style>` block injected into Published Snapshot HTML.
- `src/canvas/responsive/smoke.ts` — smoke entry.
- `package.json` — fill in `responsive:smoke` stub.
- `src/canvas/render.ts` — **only** the responsive-CSS injection hook (a single function call wrapped by Phase 0 scaffold).

## Files read-only (must not modify)

- `src/canvas/schema.ts` (frozen after Phase 0).
- `src/canvas/elements/index.ts` (frozen).
- `src/db/schema.ts`.
- Any other feature dir.

## Contract with neighbors

- Exports `renderResponsiveCss(state: EditableSite): string` consumed by `src/canvas/render.ts` and the Published Snapshot public handler.
- Reads `BaseElement.responsive?` if present, else derives from `box` using a single deterministic scaling rule.
- The public renderer wraps each Section in a CSS container query (`@container`) so resizing changes the Visitor view without JS.

## Smoke test

- `bun run responsive:smoke`:
  - Loads `src/canvas/fixtures/home.json`.
  - Asserts emitted CSS contains exactly three breakpoint blocks.
  - Asserts a known Element with `responsive.phone.hidden = true` produces `display: none` inside the phone block.
  - Asserts box-without-override scales width proportionally between desktop and phone (within tolerance).

## Acceptance criteria

- Visitor at 375px wide sees the home fixture readable, no horizontal scroll.
- Visitor at 1440px sees the exact desktop layout the editor showed.
- Tablet block exists and renders sensibly at 800px.
- Resizing browser smoothly transitions between breakpoints (container queries).
- `bun run typecheck` + `bun run lint` + `bun run canvas:smoke` + `bun run responsive:smoke` all pass.

## Open questions

- Scaling rule: linear interpolate vs anchor-based scaling. Pick at implementation time; document choice in `src/canvas/responsive/SUBSYSTEM.md`.
