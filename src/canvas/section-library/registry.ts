// src/canvas/section-library/registry.ts
//
// ADR 0061 — the code-defined Section Library registry.
//
// Every entry in `SECTION_LIBRARY` becomes a `visibility:'global'` row in
// `library_section` via the boot upsert (boot-upsert.ts). The registry is
// the structural source of truth per Decision 2 — admin in-DB edits to
// `global` rows are intentionally ephemeral and overwritten on next deploy.
//
// Phase B intentionally leaves this array empty — the upsert mechanism
// ships first. Phase C populates ~50 entries extracted from the nine
// TemplateSeeds; Phase F adds three standalone testimonial fixtures.

import type { SectionLibraryEntry } from './types.js';

export const SECTION_LIBRARY: ReadonlyArray<SectionLibraryEntry> = [];
