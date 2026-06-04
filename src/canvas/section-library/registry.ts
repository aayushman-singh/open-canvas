// src/canvas/section-library/registry.ts
//
// ADR 0061 — the code-defined Section Library registry.
//
// Every entry in `SECTION_LIBRARY` becomes a `visibility:'global'` row in
// `library_section` via the boot upsert (boot-upsert.ts). The registry is
// the structural source of truth per Decision 2 — admin in-DB edits to
// `global` rows are intentionally ephemeral and overwritten on next deploy.
//
// Phase C populated the registry from the 9 TemplateSeeds via
// `scripts/extract-section-library.ts`. Re-run that script after editing
// any TemplateSeed content or adding new entries/*.json files. Phase F
// adds standalone testimonial fixtures as JSON files under `entries/`
// and the manifest picks them up automatically on re-run.

import { EXTRACTED_ENTRIES } from './entries/manifest.js';
import type { SectionLibraryEntry } from './types.js';

export const SECTION_LIBRARY: ReadonlyArray<SectionLibraryEntry> = EXTRACTED_ENTRIES;
