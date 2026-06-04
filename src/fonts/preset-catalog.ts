// src/fonts/preset-catalog.ts
//
// Curated free-font preset list shipped to every editor + published page.
//
// Why a fixed list instead of "any Google Font":
//   - A flat picker of ~12 well-known free fonts covers the sans/serif/mono
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
// Why this list specifically:
//   - Inter + Manrope + IBM Plex Sans + Outfit cover modern sans.
//   - Fraunces + Playfair Display + IBM Plex Serif cover serif (display +
//     editorial + utility).
//   - JetBrains Mono + IBM Plex Mono cover monospace.
//   - Space Grotesk + Bricolage Grotesque are the "geometric / display"
//     accents already shipping in built-in kits.
//
// Each entry's `cssFamily` is the EXACT string the Owner-selected dropdown
// writes into `element.elementStyle.fontFamily`. We append a generic
// fallback (sans-serif / serif / monospace) so the family chain resolves
// even on the rare browser that didn't load Google Fonts (corporate proxy,
// network failure during page load).

export interface FontPreset {
  /** Owner-visible label in the inspector dropdown. */
  label: string;
  /** Exact `font-family` value to write into element.elementStyle.fontFamily. */
  cssFamily: string;
  /** Generic family classification — drives the per-group dropdown sort. */
  group: 'sans' | 'serif' | 'mono';
}

export const FONT_PRESETS: readonly FontPreset[] = [
  // -- Sans
  { label: 'Inter', cssFamily: "'Inter', system-ui, sans-serif", group: 'sans' },
  { label: 'Manrope', cssFamily: "'Manrope', system-ui, sans-serif", group: 'sans' },
  { label: 'IBM Plex Sans', cssFamily: "'IBM Plex Sans', system-ui, sans-serif", group: 'sans' },
  { label: 'Outfit', cssFamily: "'Outfit', system-ui, sans-serif", group: 'sans' },
  { label: 'Space Grotesk', cssFamily: "'Space Grotesk', system-ui, sans-serif", group: 'sans' },
  { label: 'Bricolage Grotesque', cssFamily: "'Bricolage Grotesque', system-ui, sans-serif", group: 'sans' },
  // -- Serif
  { label: 'Fraunces', cssFamily: "'Fraunces', Georgia, serif", group: 'serif' },
  { label: 'Playfair Display', cssFamily: "'Playfair Display', Georgia, serif", group: 'serif' },
  { label: 'IBM Plex Serif', cssFamily: "'IBM Plex Serif', Georgia, serif", group: 'serif' },
  // -- Mono
  { label: 'JetBrains Mono', cssFamily: "'JetBrains Mono', ui-monospace, monospace", group: 'mono' },
  { label: 'IBM Plex Mono', cssFamily: "'IBM Plex Mono', ui-monospace, monospace", group: 'mono' },
];

/**
 * Build the Google Fonts CSS2 `<link>` tag that pre-loads every preset
 * above. One request — Google's CSS2 API supports multi-family queries
 * via repeated `family=` params.
 *
 * The list is appended to whichever `<link>` the document already ships
 * (chrome surfaces have their own Bricolage/Hanken/Spline Sans Mono link
 * for the editor UI; published pages currently ship none, so this is the
 * first font link they get). Either way the visitor browser dedups
 * identical-url requests, so the extra families piggy-back on a single
 * CSS payload.
 *
 * `display=swap` keeps the system fallback visible during the block
 * period and swaps the WebFont in the moment it lands — matching the
 * @font-face emit contract used by uploaded custom fonts.
 */
export function fontPresetGoogleFontsLink(): string {
  // Google's CSS2 endpoint expects `family=Foo` per family. Spaces in names
  // are encoded as `+`. We do not request specific weight axes here — the
  // default 400/regular face is enough for the preset list; an Owner who
  // wants a heavier face uses the element's `fontWeight` field which the
  // browser resolves against whichever face the WOFF2 carries.
  const families = FONT_PRESETS.map((preset) => {
    // Strip leading/trailing single quotes from the cssFamily's first token
    // — the cssFamily is "'Foo', fallback" so we slice the bit between the
    // quotes. encodeURIComponent handles + and spaces consistently across
    // browsers.
    const quoted = preset.cssFamily.split(',')[0]!.trim();
    const bare = quoted.replace(/^'|'$/g, '');
    return 'family=' + encodeURIComponent(bare).replace(/%20/g, '+');
  }).join('&');
  return (
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    `<link href="https://fonts.googleapis.com/css2?${families}&display=swap" rel="stylesheet">`
  );
}
