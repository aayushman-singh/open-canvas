// src/canvas/section-library/index.ts
//
// ADR 0061 — barrel for the Section Library subsystem.

export { SECTION_LIBRARY } from './registry.js';
export type { SectionInstanceRef, SectionLibraryEntry } from './types.js';
export {
  ensureSectionLibraryUpserted,
  entryRowId,
  resetSectionLibraryUpsertMemo,
  runSectionLibraryUpsert,
  type BootUpsertResult,
} from './boot-upsert.js';
