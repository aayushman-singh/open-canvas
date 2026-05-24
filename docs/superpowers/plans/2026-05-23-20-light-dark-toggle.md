# Light/dark visitor toggle

**Wishlist #:** 20 **Tier:** B **Wave:** 3 **Status:** queued
**Depends on:** Phase 0 ✓, #10 custom theme editor (Wave 2)
**Blocks:** none

## User-visible outcome

A Visitor on a Published Site sees a small "Sun/Moon" toggle (if the Owner enabled it) flipping the site between light and dark variants of the Style Kit. The choice persists in localStorage. Initial render honours `prefers-color-scheme`. The toggle never causes flicker on first paint (server-rendered respecting the cookie/hint).

## Scope in

- Optional `dark` partial overrides on each `StyleKitPreset`: any token can be re-specified for dark mode.
- Owner toggle (per-site setting): "Enable dark variant" + dark-mode token authoring UI in Theme panel (#10).
- Public renderer:
  - On first request, reads `Sec-CH-Prefers-Color-Scheme` client hint when present; else falls back to a cookie `__rev01_cs=light|dark` set by JS on toggle.
  - Emits CSS custom properties as `:root { ... }` for light and `:root[data-mode="dark"] { ... }` for dark.
- Tiny inline `<script>` (10 lines) early in `<head>` to set `data-mode` from cookie / media query before paint.
- Toggle Element: a Section Recipe `mode-toggle` Owner can drop; or auto-injected near nav (configurable).

## Scope out

- Per-element dark override beyond Style Kit tokens.
- System-wide auto-switch on schedule.
- Multiple custom themes per site (only one "dark variant" of the active theme).

## Schema delta

Phase 0:

```ts
// src/canvas/schema.ts
export interface StyleKitPreset {
  // ... existing fields
  dark?: Partial<StyleKitPreset>; // overrides for dark mode
}

// site-level setting added in editableState:
export interface CanvasSiteState {
  // ... existing
  darkModeEnabled?: boolean;
}
```

## Files owned (write)

- `src/themes/visitor-mode/resolve.ts` — merge `customStyleKit.dark` over light tokens.
- `src/themes/visitor-mode/inline-script.ts` — early data-mode setter string.
- `src/themes/visitor-mode/toggle-element.ts` — `mode-toggle` element + recipe.
- `src/themes/visitor-mode/smoke.ts`.
- `src/themes/panel.tsx` — additive "Dark variant" section (only if #10 merged; else flag for follow-up).
- `package.json` — `visitor-mode:smoke` stub.

## Files read-only (must not modify)

- `src/canvas/schema.ts`, `src/canvas/render.ts`, `src/db/schema.ts`.
- `src/themes/custom-resolve.ts` (consume).

## Contract with neighbors

- Public renderer calls `emitDualCss(kit): string` returning both `:root{}` and `:root[data-mode="dark"]{}` blocks.
- Inline script string injected in `<head>`.

## Smoke test

- `bun run visitor-mode:smoke`:
  - Snapshot HTML contains both `:root` and `:root[data-mode="dark"]` blocks.
  - Inline-mode-setter script present in `<head>`.
  - Toggle element renders correct button.
  - `darkModeEnabled: false` → no dark block, no toggle, no script.

## Acceptance criteria

- Owner enables dark mode, sets dark tokens; Visitor toggles, sees instant flip, persists across reload.
- No FOUC on first paint.
- All smokes green.

## Open questions

- Whether to use `prefers-color-scheme` media query or just the toggle. Recommend honour `prefers-color-scheme` as default; toggle overrides and persists.
