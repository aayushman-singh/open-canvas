// src/code/theme-map.ts
//
// Code Snippet — maps a Style Kit name to the Shiki theme variant used when
// rendering code snippets. The POC is light-only (every kit gets the same
// `github-light` theme). A future dark/visitor-mode pairing will introduce
// a parallel `themeDark` field; the indirection here means only this file
// needs to change when that lands — every consumer (`highlightCode`,
// `renderCode`) already routes through `themeForStyleKit`.
//
// A Shiki *theme* is the syntax colouring (token colours, foreground).
// A Style Kit's `panel` background and `fontFamilyMono` family are layered
// on by the renderer's <pre> wrapper, NOT by the Shiki theme, so the kit
// always wins for the surface chrome and only Shiki colours the tokens.

/**
 * Single curated Shiki theme. A future dark variant will sit alongside this.
 */
export const SHIKI_LIGHT_THEME = 'github-light' as const;
export type ShikiThemeName = typeof SHIKI_LIGHT_THEME;

/**
 * Resolve a Style Kit name to a Shiki theme. Returns the single light theme
 * for every kit (POC scope). The kit is typed as `string` rather than
 * `BuiltInStyleKit` because `customStyleKit` also flows through here, and
 * even a malformed kit string must not crash the renderer.
 */
export function themeForStyleKit(styleKit: string): ShikiThemeName {
  // POC: light-only. The argument is currently ignored — keeping the
  // signature lets a future `themeForStyleKitDark(styleKit)` slot in
  // without churning every caller. Eating the argument with `void` here
  // documents the intent.
  void styleKit;
  return SHIKI_LIGHT_THEME;
}
