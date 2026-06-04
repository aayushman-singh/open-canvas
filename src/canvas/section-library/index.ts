// src/canvas/section-library/index.ts
//
// ADR 0061 — barrel for the Section Library subsystem.

export { SECTION_LIBRARY } from './registry.js';
export { SECTION_CATEGORIES, type SectionCategory } from './categories.js';
export type { SectionInstanceRef, SectionLibraryEntry } from './types.js';
export {
  ensureSectionLibraryUpserted,
  entryRowId,
  resetSectionLibraryUpsertMemo,
  runSectionLibraryUpsert,
  type BootUpsertResult,
} from './boot-upsert.js';
export { categoryForRecipe } from './category.js';
export { ORIGIN_TO_BASE_SLUG, resolveBaseSlug } from './origin-mapping.js';
