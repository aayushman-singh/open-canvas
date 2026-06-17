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
// `scripts/extract-section-library.ts` (legacy extraction). For
// composition-era templates, add or edit `entries/*.json` files and
// run `bun run section-library:sync` to regenerate `entries/manifest.ts`.

import { EXTRACTED_ENTRIES } from './entries/manifest.js';
import type { SectionLibraryEntry } from './types.js';

export const SECTION_LIBRARY: ReadonlyArray<SectionLibraryEntry> = EXTRACTED_ENTRIES;
