// src/fonts/preset-catalog.ts
//
// Curated free-font preset list shipped to every editor + published page.
//
// Why a fixed list instead of "any Google Font":
//   - A flat picker of ~11 well-known free fonts covers the sans/serif/mono
//     diversity an Owner needs without dragging the dropdown into a
//     full font browser. Discoverable on first open; no search box needed.
//   - The fonts are pre-loaded by a single `<link>` tag at the document
//     head so selecting one in the inspector is instant — no per-pick
//     network round-trip to fetch the WOFF2.
//   - The list is the SAME on the editor preview and the published site
//     (this module is imported by both), so an Owner who picks "Inter"
//     in the editor sees the same Inter on the published page. Drift is
//     impossible by construction.
//
// Each entry's `cssFamily` is the EXACT string the picker writes into
// `element.pinnedStyle["font-family"]`. We append a generic fallback
// (sans-serif / serif / monospace) so the family chain resolves even on
// the rare browser that didn't load Google Fonts (corporate proxy,
// network failure during page load).
//
// Storage model: the picker writes the value into `pinnedStyle["font-
// family"]` (NOT a structured `ElementStyle.fontFamily` field). Per
// `BaseElement.pinnedStyle`'s docblock, `font-family` is an explicitly
// named typography-ornament key that lives in pinnedStyle rather than
// being promoted to structured ElementStyle.

export interface FontPreset {
  /** Owner-visible label in the inspector dropdown. */
  label: string;
  /** Exact `font-family` value to write into pinnedStyle["font-family"]. */
  cssFamily: string;
  /** Generic family classification — drives the per-group dropdown sort. */
  group: 'sans' | 'serif' | 'mono';
}

// 11 preloaded free fonts per the brief. Order: sans → serif → mono, then
// alphabetic within each bucket. The `cssFamily` quoting uses double-quotes
// so the chain reads identically to what `JSON.stringify(name)` produces
// for custom uploaded fonts — every font value flowing through pinnedStyle
// uses the same quoting convention.
export const FONT_PRESETS: readonly FontPreset[] = [
  // -- Sans
  { label: 'Inter', cssFamily: '"Inter", system-ui, sans-serif', group: 'sans' },
  { label: 'Manrope', cssFamily: '"Manrope", system-ui, sans-serif', group: 'sans' },
  { label: 'IBM Plex Sans', cssFamily: '"IBM Plex Sans", system-ui, sans-serif', group: 'sans' },
  { label: 'Outfit', cssFamily: '"Outfit", system-ui, sans-serif', group: 'sans' },
  { label: 'Space Grotesk', cssFamily: '"Space Grotesk", system-ui, sans-serif', group: 'sans' },
  {
    label: 'Bricolage Grotesque',
    cssFamily: '"Bricolage Grotesque", system-ui, sans-serif',
    group: 'sans',
  },
  // -- Serif
  { label: 'Fraunces', cssFamily: '"Fraunces", Georgia, serif', group: 'serif' },
  { label: 'Playfair Display', cssFamily: '"Playfair Display", Georgia, serif', group: 'serif' },
  { label: 'IBM Plex Serif', cssFamily: '"IBM Plex Serif", Georgia, serif', group: 'serif' },
  // -- Mono
  {
    label: 'JetBrains Mono',
    cssFamily: '"JetBrains Mono", ui-monospace, monospace',
    group: 'mono',
  },
  { label: 'IBM Plex Mono', cssFamily: '"IBM Plex Mono", ui-monospace, monospace', group: 'mono' },
];

/**
 * Build the Google Fonts CSS2 `<link>` tag that pre-loads every preset
 * above. One request — Google's CSS2 API supports multi-family queries
 * via repeated `family=` params.
 *
 * `display=swap` keeps the system fallback visible during the block
 * period and swaps the WebFont in the moment it lands — matching the
 * @font-face emit contract used by uploaded custom fonts.
 *
 * Each family is requested with a weight axis range covering 400..800 so
 * the inspector's font-weight slider (400/500/600/700) always has a face
 * the browser can pick from regardless of the chosen preset.
 */
export function fontPresetGoogleFontsLink(): string {
  const families = FONT_PRESETS.map((preset) => {
    // First token in the chain is the quoted family name; strip the
    // surrounding double-quotes to get the bare name for the URL.
    const firstToken = preset.cssFamily.split(',')[0]!.trim();
    const bare = firstToken.replace(/^"|"$/g, '');
    // Google's CSS2 endpoint uses `+` for spaces, not `%20`. The wght
    // range covers all four weights the inspector exposes.
    const encoded = encodeURIComponent(bare).replace(/%20/g, '+');
    return 'family=' + encoded + ':wght@400..800';
  }).join('&');
  return (
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    `<link href="https://fonts.googleapis.com/css2?${families}&display=swap" rel="stylesheet">`
  );
}
