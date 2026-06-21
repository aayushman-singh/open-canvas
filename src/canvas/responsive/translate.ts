// src/canvas/responsive/translate.ts
//
// Translation layer: maps a Positioned Element's desktop `box` (px on the
// design canvas) into the resolved (x, y, w, h) the Visitor sees at a
// smaller named breakpoint. Pure data — produces numbers, never CSS.
//
// ─── Scaling formula ───────────────────────────────────────────────────────
//
// Each named breakpoint has a fixed "design width" the page is rendered at
// when the Visitor's viewport falls into that band:
//
//   desktop  = page.width             (source-of-truth, e.g. 1440)
//   tablet   = TABLET_DESIGN_WIDTH    (1023 — top edge of tablet band)
//   phone    = PHONE_DESIGN_WIDTH     (375  — typical iPhone width)
//
// The scale factor at a breakpoint is `breakpointWidth / page.width`. Every
// element box dimension at that breakpoint is the desktop value times the
// scale factor, then rounded to the nearest integer pixel:
//
//   resolved.x = round(box.x * scale)
//   resolved.y = round(box.y * scale)
//   resolved.w = round(box.w * scale)
//   resolved.h = round(box.h * scale)
//
// An Owner-authored `ResponsiveBoxOverride` at the breakpoint supersedes the
// scaled value field-by-field — every override field is optional, so a tablet
// override that sets only `w` keeps the scaled x/y/h. `hidden: true` removes
// the element entirely at that breakpoint; we emit `display: none` in CSS and
// the resolved box dimensions are irrelevant.
//
// Why fixed design widths instead of true fluid interpolation? CSS media
// queries cannot dynamically interpolate between viewport widths without
// JavaScript. The brief forbids visitor-side JS, so we snap to three named
// design widths. Visitors at 400px (inside the phone band) see the page
// rendered at 375px, centred — same as the gamma.app published behaviour.
//
// All values returned are plain numbers in px. CSS emission (the `!important`
// flag, `display: none` for hidden, the `@media` wrapping) lives in `./css.ts`.

import type {
  BaseElement,
  Breakpoint,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  PublishedSnapshot,
  ResponsiveBoxOverride,
} from '../schema.js';

/**
 * Design width the page is rendered at when the Visitor's viewport falls in
 * the tablet band (768–1023px). 1023 is the top edge of the band so most
 * tablets see the page at its largest legitimate tablet width.
 */
export const TABLET_DESIGN_WIDTH = 1023;

/**
 * Design width the page is rendered at when the Visitor's viewport falls in
 * the phone band (< 768px). 375 matches the iPhone reference width and is
 * narrow enough that a 400px phone sees no horizontal scroll.
 */
export const PHONE_DESIGN_WIDTH = 375;

/** Resolved per-breakpoint box. `hidden === true` means emit `display: none`. */
export interface ResolvedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  hidden: boolean;
}

/**
 * The full resolved layout for one Positioned Element across the two smaller
 * breakpoints. Desktop is the canonical source-of-truth (the `box` field on
 * the element) and never appears here — the renderer already emits it inline.
 *
 * `tabletHasOverride` / `phoneHasOverride` flag whether the element carries
 * any Owner-authored override at that breakpoint (including `hidden: true`).
 * The CSS emitter uses these to skip emitting redundant rules for elements
 * on small pages that already fit the breakpoint's design width unscaled.
 */
export interface ResolvedElementLayout {
  elementId: string;
  tablet: ResolvedBox;
  tabletHasOverride: boolean;
  phone: ResolvedBox;
  phoneHasOverride: boolean;
}

/**
 * Resolved per-breakpoint section dimensions. The renderer already emits the
 * desktop section width (= page.width) and height inline; this struct carries
 * the scaled dimensions for the smaller breakpoints.
 */
export interface ResolvedSectionLayout {
  sectionId: string;
  tablet: { w: number; h: number };
  phone: { w: number; h: number };
}

/**
 * Resolved per-breakpoint page width. Sections and elements all scale with
 * the same factor inside a single page.
 */
export interface ResolvedPageLayout {
  pageId: string;
  desktopWidth: number;
  tablet: { w: number };
  phone: { w: number };
  sections: ResolvedSectionLayout[];
  elements: ResolvedElementLayout[];
}

/**
 * Linear interpolation factor for a named smaller breakpoint.
 *
 * The `'desktop'` branch returns 1 by definition — the desktop box is the
 * source-of-truth and is emitted inline by the renderer, so the responsive
 * pipeline never calls this with `'desktop'`. The branch exists to make the
 * function total over `Breakpoint` (otherwise the `switch` would need a
 * non-exhaustive default), which keeps it usable from any caller that
 * already holds a `Breakpoint` value.
 */
export function scaleFactor(pageWidth: number, breakpoint: Breakpoint): number {
  if (pageWidth <= 0) return 1;
  switch (breakpoint) {
    case 'desktop':
      return 1;
    case 'tablet':
      return TABLET_DESIGN_WIDTH / pageWidth;
    case 'phone':
      return PHONE_DESIGN_WIDTH / pageWidth;
  }
}

/** Round to nearest integer pixel — keeps emitted CSS values stable + readable. */
function roundPx(value: number): number {
  return Math.round(value);
}

/**
 * Resolve a single element's box at a smaller breakpoint. Default behaviour is
 * proportional scaling from the desktop box; any field-level override on the
 * element supersedes the scaled value. `hidden: true` short-circuits — the
 * resolved box dimensions become irrelevant.
 */
export function resolveElementBox(
  element: Pick<BaseElement, 'box' | 'responsive'>,
  pageWidth: number,
  breakpoint: 'tablet' | 'phone',
): ResolvedBox {
  const scale = scaleFactor(pageWidth, breakpoint);
  const override: ResponsiveBoxOverride | undefined = element.responsive?.[breakpoint];
  const hidden = override?.hidden === true;
  const x = override?.x ?? roundPx(element.box.x * scale);
  const y = override?.y ?? roundPx(element.box.y * scale);
  const w = override?.w ?? roundPx(element.box.w * scale);
  const h = override?.h ?? roundPx(element.box.h * scale);
  return { x, y, w, h, hidden };
}

/**
 * Resolve every element + section + page width across a Published Snapshot.
 * The CSS emitter walks this structure once and produces the `<style>` body.
 *
 * Site-wide header/footer sections (when present on the snapshot) are merged
 * into every page's resolved layout so the emitter produces matching tablet +
 * phone rules for them. Without this merge those sections inherit the desktop
 * width inline and never reflow at smaller viewports — visitors see them
 * locked at design width while the rest of the page scales.
 */
export function resolveSnapshotLayout(snapshot: PublishedSnapshot): ResolvedPageLayout[] {
  const sharedSections: CanvasSection[] = [];
  if (snapshot.header) sharedSections.push(snapshot.header);
  if (snapshot.footer) sharedSections.push(snapshot.footer);
  return snapshot.pages.map((page) => resolvePageLayout(page, sharedSections));
}

function resolvePageLayout(
  page: CanvasPage,
  sharedSections: readonly CanvasSection[],
): ResolvedPageLayout {
  const tabletScale = scaleFactor(page.width, 'tablet');
  const phoneScale = scaleFactor(page.width, 'phone');
  const allSections: CanvasSection[] = [...sharedSections, ...page.sections];
  const sections: ResolvedSectionLayout[] = allSections.map((section) =>
    resolveSectionLayout(section, page.width, tabletScale, phoneScale),
  );
  const elements: ResolvedElementLayout[] = [];
  for (const section of allSections) {
    for (const element of section.elements) {
      elements.push(resolveElementLayout(element, page.width));
    }
  }
  return {
    pageId: page.id,
    desktopWidth: page.width,
    tablet: { w: TABLET_DESIGN_WIDTH },
    phone: { w: PHONE_DESIGN_WIDTH },
    sections,
    elements,
  };
}

function resolveSectionLayout(
  section: CanvasSection,
  pageWidth: number,
  tabletScale: number,
  phoneScale: number,
): ResolvedSectionLayout {
  return {
    sectionId: section.id,
    tablet: {
      w: roundPx(pageWidth * tabletScale),
      h: section.responsive?.tablet?.h ?? roundPx(section.height * tabletScale),
    },
    phone: {
      w: roundPx(pageWidth * phoneScale),
      h: section.responsive?.phone?.h ?? roundPx(section.height * phoneScale),
    },
  };
}

function resolveElementLayout(element: CanvasElement, pageWidth: number): ResolvedElementLayout {
  return {
    elementId: element.id,
    tablet: resolveElementBox(element, pageWidth, 'tablet'),
    tabletHasOverride: element.responsive?.tablet !== undefined,
    phone: resolveElementBox(element, pageWidth, 'phone'),
    phoneHasOverride: element.responsive?.phone !== undefined,
  };
}
