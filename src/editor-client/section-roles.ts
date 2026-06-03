// src/editor-client/section-roles.ts
//
// ADR 0015 Phase 2d — Section Role helpers. Every Section in the POC
// carries one of three roles (`body` by default, `header`, `footer`);
// these predicates and label helpers consult the role and the page
// section layout to surface user-facing labels and insertion bounds.
//
// canvas-client.ts:3812-3834 + :8093-8099 carry inline copies. All
// pure: no DOM, no IIFE-local state, no side effects.

import type { CanvasPage, CanvasSection } from '../canvas/schema.js';

export function isPinnedSection(section: CanvasSection | undefined): boolean {
  return !!section && (section.role === 'header' || section.role === 'footer');
}

export function hasHeaderSection(page: CanvasPage): boolean {
  return page.sections.length > 0 && page.sections[0]?.role === 'header';
}

export function hasFooterSection(page: CanvasPage): boolean {
  return (
    page.sections.length > 0 &&
    page.sections[page.sections.length - 1]?.role === 'footer'
  );
}

export function pinnedSectionLabel(section: CanvasSection): string {
  if (section.role === 'header') return 'Header';
  if (section.role === 'footer') return 'Footer';
  return '';
}

export function sectionDisplayName(section: CanvasSection, fallback: string): string {
  const label = pinnedSectionLabel(section);
  const name = section.name || fallback;
  return label ? label + ' — ' + name : name;
}

/** Clamp an insertion index against header (always first) and footer
 *  (always last) pin positions; new body sections cannot land before
 *  the header or after the footer. */
export function clampInsertIndex(page: CanvasPage, insertAt: number): number {
  const lo = hasHeaderSection(page) ? 1 : 0;
  const hi = hasFooterSection(page)
    ? page.sections.length - 1
    : page.sections.length;
  if (insertAt < lo) return lo;
  if (insertAt > hi) return hi;
  return insertAt;
}
