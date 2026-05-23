# Custom theme editor

**Wishlist #:** 10 **Tier:** A **Wave:** 2 **Status:** queued
**Depends on:** Phase 0 ✓
**Blocks:** none (#20 light/dark consumes the dual-palette structure introduced here)

## User-visible outcome

An Owner opens a Theme panel in the editor and tweaks the colour palette, type pair, and surface treatment for their site. The canvas updates live. A contrast guard surfaces warnings inline when a chosen colour combination breaks accessibility minimums. The resulting theme is saved as a custom Style Kit on the site and is included in the Published Snapshot.

## Scope in

- Owner-authored Style Kit: same token shape as built-in `StyleKitPreset` (from `src/canvas/style-kits.ts`).
- New ElementType-free; lives at site level as `site.editableState.customStyleKit?: StyleKitPreset`.
- Theme panel UI:
  - Colour pickers for bg / panel / text / muted / accent / accentText.
  - Type pair picker (display + body font from a curated list).
  - Surface treatment selector (radius scale, shadow strength).
  - Live preview on canvas.
- Contrast guard reuses `src/theme/contrast.ts`. Inline warning when bg/text ratio < 4.5 or accent/accentText < 3.0.
- "Reset to built-in" button.

## Scope out

- Per-Owner reusable themes across multiple sites (per-site only for POC).
- Importing themes from URLs / files.
- Theme marketplace.
- Custom fonts (#12 handles that).

## Schema delta

Phase 0:

```ts
// src/canvas/schema.ts (Phase 0)
export interface CanvasSiteState {
  styleKit: StyleKit; // selector — picks built-in OR 'custom'
  customStyleKit?: StyleKitPreset; // only set when styleKit === 'custom'
  pages: CanvasPage[];
  symbols: SymbolMaster[]; // from #14 scaffold
}
```

Selector enum extended in Phase 0: `STYLE_KITS = [...existing, 'custom'] as const`.

## Files owned (write)

- `src/themes/panel.tsx` — editor sidebar panel.
- `src/themes/custom-resolve.ts` — when `styleKit === 'custom'`, render path resolves tokens from `customStyleKit`.
- `src/themes/contrast-guard.ts` — wrapping `src/theme/contrast.ts` with UI-friendly warning shape.
- `src/themes/smoke.ts`.
- `src/canvas/style-kits.ts` — single touch: extend lookup to include `'custom'` resolving via `customStyleKit`. Phase 0 leaves the dispatch slot.
- `package.json` — `themes:smoke` stub.

## Files read-only (must not modify)

- `src/canvas/schema.ts`, `src/canvas/render.ts`, `src/db/schema.ts`.
- `src/theme/contrast.ts` (consume only).

## Contract with neighbors

- `resolveStyleKit(state): StyleKitPreset` — returns built-in or custom tokens.
- Light/dark (#20) extends `StyleKitPreset` with `dark: Partial<StyleKitPreset>`; this feature's theme panel will gain a "Dark variant" toggle when #20 lands (forward-compatible).

## Smoke test

- `bun run themes:smoke`:
  - Author a custom kit, validate against `StyleKitPreset` shape.
  - Render fixture page with `styleKit='custom'`; assert custom tokens win.
  - Contrast guard returns warning for bg=#fff, text=#bbb (ratio < 4.5).
  - Reset to built-in restores selector.

## Acceptance criteria

- Owner edits colours, sees canvas reflect instantly.
- Contrast warning visible when ratio is below threshold.
- Publish + Visitor view shows custom theme.
- All smokes green.

## Open questions

- Font picker source. Recommend: hardcoded list of safe system-stack + Inter + Spectral; defer Google Fonts auto-load to #12.
