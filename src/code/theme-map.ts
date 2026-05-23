// src/code/theme-map.ts
//
// Wishlist #19 — Code Block. Wave 4 owner.
//
// Maps a Style Kit name to the Shiki theme variant we will use when
// rendering code snippets. The POC is light-only (every kit gets the same
// `github-light` theme) because the dark/visitor-mode pairing belongs to
// wishlist #20 (visitor-mode), which will introduce a parallel `themeDark`
// field. We keep the indirection here so #20 only edits this file when it
// lands — every consumer (`highlightCode`, `renderCode`) already routes
// through `themeForStyleKit`.
//
// A Shiki *theme* is the syntax colouring (token colours, foreground).
// A Style Kit's `panel` background and `fontFamilyMono` family are layered
// on by the renderer's <pre> wrapper, NOT by the Shiki theme, so the kit
// always wins for the surface chrome and only Shiki colours the tokens.

/**
 * Single curated Shiki theme. Wave 4 ships one light theme; #20 will add
 * the dark variant alongside this.
 */
export const SHIKI_LIGHT_THEME = 'github-light' as const;
export type ShikiThemeName = typeof SHIKI_LIGHT_THEME;

/**
 * Resolve a Style Kit name to a Shiki theme. Returns the single light theme
 * for every kit (POC scope). Wave 4 deliberately accepts the kit string as
 * `string` rather than `BuiltInStyleKit` — `customStyleKit` (Wave 2 #10)
 * also flows through here, and even a malformed kit string must not crash
 * the renderer.
 */
export function themeForStyleKit(styleKit: string): ShikiThemeName {
  // POC: light-only. The argument is currently ignored — keeping the
  // signature lets #20 add `themeForStyleKitDark(styleKit)` without churning
  // every caller. Eating the argument with `void` here avoids drift between
  // wave 4's light renderer and wave 5's visitor-mode picker: same
  // indirection, two resolvers.
  void styleKit;
  return SHIKI_LIGHT_THEME;
}
