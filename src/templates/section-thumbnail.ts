// src/templates/section-thumbnail.ts
//
// Synth a tiny SVG schematic preview of a CanvasSection from its raw element
// boxes. Used by the section-picker grid (seed catalog + library sections)
// so each card shows a wireframe of where the section's blocks land instead
// of a generic recipe-id label.
//
// Deliberately simple: one coloured `<rect>` per element, sized + positioned
// against a viewBox that matches the section's natural width / height. The
// browser renders the SVG at whatever CSS width the card gives it, so a
// single source string scales to whatever the picker layout decides.
//
// No images, no fonts, no asset fetches — the schematic relies entirely on
// the element's box geometry and discriminated `type`, which are guaranteed
// present on every CanvasElement.

import type { CanvasElement, CanvasSection, ElementType } from '../canvas/schema.js';

/** Pixel width every section is designed against (matches CanvasPage.width default). */
const DEFAULT_PAGE_WIDTH = 1440;

/** Fallback section height when a seed somehow ships height === 0. */
const FALLBACK_SECTION_HEIGHT = 320;

/**
 * Colour table per element type. Picked for readability against the picker
 * card's neutral background — not meant to match the live kit, which would
 * vary per template. A schematic is more legible when types are visually
 * distinct than when it tries to mimic the rendered look.
 */
const ELEMENT_TYPE_FILL: Record<ElementType, string> = {
  text: '#cbd5e1',
  media: '#60a5fa',
  action: '#ef4444',
  shape: '#fcd34d',
  container: 'transparent',
  form: '#34d399',
  embed: '#a78bfa',
  chart: '#fb923c',
  accordion: '#e5e7eb',
  carousel: '#7c3aed',
  table: '#d1d5db',
  code: '#1f2937',
  nav: '#e5e7eb',
  collection: '#fde68a',
};

/**
 * XML attribute-value escaper. Mirrors the canvas/render-utils helper so
 * this module stays free of cross-package imports.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rectForElement(el: CanvasElement): string {
  const fill = ELEMENT_TYPE_FILL[el.type];
  const x = Math.max(0, el.box.x);
  const y = Math.max(0, el.box.y);
  const w = Math.max(1, el.box.w);
  const h = Math.max(1, el.box.h);
  // Containers get an outline-only treatment so nested children stay visible
  // — a solid fill would mask whatever sits inside the container's box.
  if (el.type === 'container') {
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
      `fill="none" stroke="#9ca3af" stroke-width="2" rx="4" />`
    );
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeAttr(fill)}" rx="3" />`;
}

/**
 * Build the schematic SVG string. `pageWidth` defaults to 1440 (the canonical
 * design width). The returned string is safe to embed inline as
 * `innerHTML` because every dynamic value is either a finite number or runs
 * through the small attribute escaper above.
 */
export function buildSectionThumbnailSvg(
  section: CanvasSection,
  pageWidth: number = DEFAULT_PAGE_WIDTH,
): string {
  const width = pageWidth > 0 ? pageWidth : DEFAULT_PAGE_WIDTH;
  const height = section.height > 0 ? section.height : FALLBACK_SECTION_HEIGHT;
  const rects = section.elements.map(rectForElement).join('');
  return (
    // preserveAspectRatio="xMidYMid meet" keeps the schematic's natural
    // aspect — a 1440x200 banner doesn't get zoomed into a square and lose
    // its proportions. The card container's own background shows through
    // the leftover letterbox area, which itself is a useful preview signal.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(section.name)} layout preview">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc" />` +
    rects +
    `</svg>`
  );
}
