// src/canvas/section-library/extraction.smoke.ts
//
// ADR 0061 Phase C — extraction completeness smoke.
//
// Three invariants the extraction script must keep true between runs.
// Without these, Phase D's TemplateSeed rewrite would silently drop
// sections or fail to resolve refs at instantiation time.
//
//   1. Every section in `allTemplateSeeds` (state.header, state.footer,
//      state.pages[*].sections[*]) has an `(templateId, sectionId)` row
//      in `ORIGIN_TO_BASE_SLUG`. If a section is missing, the rewrite
//      can't find its pool slug.
//   2. Every entry in `ORIGIN_TO_BASE_SLUG` resolves to a real
//      `SectionLibraryEntry` in `SECTION_LIBRARY`. If the origin map
//      points at a non-existent slug, the boot upsert can't materialise
//      it and the renderer fails loudly.
//   3. Every `SectionLibraryEntry.baseSlug` is unique. Two entries
//      sharing a slug would collide on the `(base_slug, version)`
//      unique index in Phase A's migration.
//
// The smoke runs against the live extraction artefacts (the JSON files
// + manifest + origin map) so re-running the extraction script with new
// templates is enough to keep coverage in sync.
//
// Run with `bun run section-library-extraction:smoke`.

import { allTemplateSeeds } from '../../templates/registry.js';
import { ORIGIN_TO_BASE_SLUG, resolveBaseSlug } from './origin-mapping.js';
import { SECTION_LIBRARY } from './registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[section-library-extraction:smoke] ${message}`);
}

// -- Invariant 1: every TemplateSeed section is in the origin map --------------

const missingOriginRefs: string[] = [];
for (const seed of allTemplateSeeds) {
  const checkSection = (sectionId: string): void => {
    const key = `${seed.id}:${sectionId}`;
    if (!(key in ORIGIN_TO_BASE_SLUG)) {
      missingOriginRefs.push(key);
    }
  };
  if (seed.state.header) checkSection(seed.state.header.id);
  if (seed.state.footer) checkSection(seed.state.footer.id);
  for (const page of seed.state.pages ?? []) {
    for (const section of page.sections) {
      checkSection(section.id);
    }
  }
}

assert(
  missingOriginRefs.length === 0,
  `${String(missingOriginRefs.length)} TemplateSeed sections have no origin map entry — re-run scripts/extract-section-library.ts:\n  ${missingOriginRefs.join('\n  ')}`,
);

// -- Invariant 2: every origin map entry resolves to a SECTION_LIBRARY row -----

const slugIndex = new Map<string, number>();
for (let i = 0; i < SECTION_LIBRARY.length; i += 1) {
  slugIndex.set(SECTION_LIBRARY[i]!.baseSlug, i);
}

const danglingOrigins: string[] = [];
for (const [key, baseSlug] of Object.entries(ORIGIN_TO_BASE_SLUG)) {
  if (!slugIndex.has(baseSlug)) {
    danglingOrigins.push(`${key} → ${baseSlug}`);
  }
}

assert(
  danglingOrigins.length === 0,
  `${String(danglingOrigins.length)} origin map rows point at slugs missing from SECTION_LIBRARY — the manifest is out of sync with the JSON files:\n  ${danglingOrigins.join('\n  ')}`,
);

// -- Invariant 3: baseSlug uniqueness -----------------------------------------

const seen = new Map<string, number>();
const duplicateSlugs: string[] = [];
for (let i = 0; i < SECTION_LIBRARY.length; i += 1) {
  const slug = SECTION_LIBRARY[i]!.baseSlug;
  const prev = seen.get(slug);
  if (prev !== undefined) {
    duplicateSlugs.push(`${slug} (positions ${String(prev)} and ${String(i)})`);
  } else {
    seen.set(slug, i);
  }
}

assert(
  duplicateSlugs.length === 0,
  `${String(duplicateSlugs.length)} duplicate baseSlugs in SECTION_LIBRARY — would collide on (base_slug, version) unique index:\n  ${duplicateSlugs.join('\n  ')}`,
);

// -- Bonus: resolveBaseSlug surface-test on a known-existing key ---------------

if (SECTION_LIBRARY.length > 0) {
  const firstKey = Object.keys(ORIGIN_TO_BASE_SLUG)[0]!;
  const [templateId, sectionId] = firstKey.split(':');
  const resolved = resolveBaseSlug(templateId!, sectionId!);
  assert(slugIndex.has(resolved), `resolveBaseSlug('${templateId}', '${sectionId}') returned '${resolved}' which is not in SECTION_LIBRARY`);
}

console.log(
  `[section-library-extraction:smoke] OK — ${String(SECTION_LIBRARY.length)} entries, ${String(Object.keys(ORIGIN_TO_BASE_SLUG).length)} origin refs, all consistent`,
);
