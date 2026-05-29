import { raw } from 'hono/html';

// Open Canvas brand mark — MIGRATION.md §4.
//
// Single source of truth for the OC logo silhouette + wordmark used across:
//   - landing chrome (`StatusBar`, `Footer`)
//   - dashboard chrome (`shell.tsx` primary sidebar)
//   - any future surface that needs the brand lockup.
//
// The frame + lens ring inherit `currentColor` (set `color:var(--ink)` on
// the parent) so the silhouette themes for free across light/dark; the two
// red bars stay branded via `var(--red)`.
//
// `OcLogo` returns just the SVG (callers pick the wrapper class/size); the
// `Wordmark` helper bundles the SVG + `.oc-word` text in the canonical
// `.oc-logo` lockup defined in components.css.

export type OcLogoProps = {
  size?: number;
};

export function OcLogo({ size = 28 }: OcLogoProps) {
  return raw(
    `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true">` +
      `<rect x="14" y="9" width="40" height="46" stroke="currentColor" stroke-width="2.4"/>` +
      `<circle cx="34" cy="32" r="11" stroke="currentColor" stroke-width="7"/>` +
      `<rect x="40" y="19" width="21" height="3.6" rx="1.8" fill="var(--red)"/>` +
      `<rect x="6" y="43" width="21" height="3.6" rx="1.8" fill="var(--red)"/>` +
      `</svg>`,
  );
}

export type WordmarkProps = {
  size?: number;
};

export function Wordmark({ size = 28 }: WordmarkProps) {
  return (
    <span class="oc-logo" style="color:var(--ink)">
      <OcLogo size={size} />
      <span class="oc-word">Open&nbsp;Canvas</span>
    </span>
  );
}
