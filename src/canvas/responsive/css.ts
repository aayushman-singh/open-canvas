// src/canvas/responsive/css.ts
//
// Generates the responsive `<style>` block for a Published Snapshot.
//
// Engine: viewport `@media` queries (NOT container queries). See
// `SUBSYSTEM.md` for the rationale — short version: the existing renderer
// emits inline `width: <pageWidth>px` on every `.rev01-section`, so a CSS
// container query on the section would always see the fixed desktop width
// and never fire below it. Changing that would require editing
// `src/canvas/render.ts` beyond the single injection hook the brief allows.
// `@media` queries against the Visitor's viewport sidestep that constraint.
//
// Selectors target the stable `data-rev01-*` attributes the renderer already
// stamps onto every page, section, and element wrapper. No selector touches
// class names or element internals.
//
// The renderer emits inline `style="..."` declarations on every wrapper. CSS
// rules from a `<style>` block cannot override inline styles by specificity
// alone — they need the `!important` flag. Every responsive declaration uses
// `!important` for this reason; it is the only acceptable use site for the
// flag in this module.

import { PHONE_MAX_PX, TABLET_MAX_PX } from './breakpoints.js';
import { escapeCssIdent } from './escape.js';
import {
  PHONE_DESIGN_WIDTH,
  TABLET_DESIGN_WIDTH,
  type ResolvedBox,
  type ResolvedPageLayout,
} from './translate.js';

/**
 * Build the CSS body (no `<style>` tags). Returns the empty string when no
 * element on the snapshot has any responsive override AND no page is wider
 * than the tablet design width — i.e. the layout is already small enough
 * that scaling would be a no-op. Returning '' tells the caller to skip the
 * `<style>` wrapper entirely and keep fixture HTML byte-for-byte identical
 * to the pre-responsive output.
 */
export function buildResponsiveCssBody(
  layouts: ResolvedPageLayout[],
  hasAnyResponsiveOverride: boolean,
): string {
  // Fast exit: no overrides AND every page is narrow enough to already fit a
  // phone viewport at its desktop width. The translator still resolves
  // everything for these cases but emitting CSS would be pointless work.
  if (!hasAnyResponsiveOverride && layouts.every((p) => p.desktopWidth <= PHONE_MAX_PX)) {
    return '';
  }
  const tabletBlock = buildBreakpointBlock(layouts, 'tablet', TABLET_MAX_PX);
  const phoneBlock = buildBreakpointBlock(layouts, 'phone', PHONE_MAX_PX);
  return `${tabletBlock}\n${phoneBlock}`;
}

function buildBreakpointBlock(
  layouts: ResolvedPageLayout[],
  breakpoint: 'tablet' | 'phone',
  mediaMaxPx: number,
): string {
  const designWidth = breakpoint === 'tablet' ? TABLET_DESIGN_WIDTH : PHONE_DESIGN_WIDTH;
  const rules: string[] = [];
  for (const page of layouts) {
    // Pages already narrower than the breakpoint's design width fit the
    // viewport unscaled. Per-element rules for those pages would just
    // re-emit the desktop box (with a stray scale-up clamped by the design
    // width) — pure noise. We still emit the page + section rules so the
    // outer width caps at the design width, then skip every element rule
    // that has no Owner-authored override at this breakpoint.
    const pageFitsBreakpointUnscaled = page.desktopWidth <= designWidth;
    const pageWidth = breakpoint === 'tablet' ? page.tablet.w : page.phone.w;
    rules.push(pageRule(page.pageId, pageWidth));
    for (const section of page.sections) {
      const dims = breakpoint === 'tablet' ? section.tablet : section.phone;
      rules.push(sectionRule(section.sectionId, dims.w, dims.h));
    }
    for (const element of page.elements) {
      const hasOverride =
        breakpoint === 'tablet' ? element.tabletHasOverride : element.phoneHasOverride;
      if (pageFitsBreakpointUnscaled && !hasOverride) continue;
      const box = breakpoint === 'tablet' ? element.tablet : element.phone;
      rules.push(elementRule(element.elementId, box));
    }
  }
  return `@media (max-width: ${String(mediaMaxPx)}px) {\n${rules.join('\n')}\n}`;
}

function pageRule(pageId: string, widthPx: number): string {
  const sel = `[data-rev01-page="${escapeCssIdent(pageId)}"]`;
  return `${sel} { width: ${String(widthPx)}px !important; }`;
}

// Sections also emit `width !important` even though their parent page has the
// same scaled width. The renderer stamps the desktop page-width inline on
// every `.rev01-section` (see `renderSection` in `render.ts`), so without
// overriding the section's own inline width the section would stay at the
// desktop width and overflow the scaled page. Two `width` declarations on
// the cascade is the cheapest way to override both wrappers' inline styles.
function sectionRule(sectionId: string, widthPx: number, heightPx: number): string {
  const sel = `[data-rev01-section="${escapeCssIdent(sectionId)}"]`;
  return `${sel} { width: ${String(widthPx)}px !important; height: ${String(heightPx)}px !important; }`;
}

function elementRule(elementId: string, box: ResolvedBox): string {
  const sel = `[data-rev01-element="${escapeCssIdent(elementId)}"]`;
  if (box.hidden) {
    return `${sel} { display: none !important; }`;
  }
  return (
    `${sel} { ` +
    `left: ${String(box.x)}px !important; ` +
    `top: ${String(box.y)}px !important; ` +
    `width: ${String(box.w)}px !important; ` +
    `height: ${String(box.h)}px !important; ` +
    `}`
  );
}

/**
 * Wraps a CSS body in `<style data-rev01-responsive>...</style>`. The
 * `data-rev01-responsive` attribute is the renderer-side marker the smoke
 * test pins on to assert the block was injected.
 */
export function wrapInStyleBlock(cssBody: string): string {
  if (cssBody === '') return '';
  return `<style data-rev01-responsive>${cssBody}</style>`;
}
