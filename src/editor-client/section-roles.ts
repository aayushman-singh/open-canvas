// src/editor-client/section-roles.ts
//
// ADR 0059 — page-level pinning is removed. `CanvasSection.role` no longer
// admits `'header' | 'footer'`; site-level header/footer live exclusively
// at `EditableSite.header` and `EditableSite.footer`. The helpers below are
// retained as thin no-ops so the schema/validator cutover commit stays
// focused; Phase 5 (next commit) deletes them and rewrites the callers
// (reel.ts, section-toolbar.ts, section-drag.ts, section-inspector.ts,
// runtime-helpers.ts, index.ts) to drop the pinned-section branches.

import type { CanvasPage, CanvasSection } from '../canvas/schema.js';

export function isPinnedSection(_section: CanvasSection | undefined): boolean {
  return false;
}

export function hasHeaderSection(_page: CanvasPage): boolean {
  return false;
}

export function hasFooterSection(_page: CanvasPage): boolean {
  return false;
}

export function pinnedSectionLabel(_section: CanvasSection): string {
  return '';
}

export function sectionDisplayName(section: CanvasSection, fallback: string): string {
  return section.name || fallback;
}

export function clampInsertIndex(page: CanvasPage, insertAt: number): number {
  if (insertAt < 0) return 0;
  if (insertAt > page.sections.length) return page.sections.length;
  return insertAt;
}
