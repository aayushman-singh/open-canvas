// src/canvas/section-library/extraction.smoke.ts
//
// ADR 0061 — Section Library coverage smoke. Originally Phase C verified
// origin-map coverage against the pre-Phase-D `seed.state` shape. After
// Phase D's TemplateSeed→composition rewrite, the load-bearing invariants
// shift onto the composition refs themselves:
//
//   1. Every TemplateSeed composition ref (headerRef + footerRef +
//      pages[*].bodyRefs[*]) resolves to a real `SectionLibraryEntry`
//      via its deterministic `${baseSlug}-v1` row id (see
//      `entryRowId`). A miss would crash `instantiateTemplate` at
//      runtime.
//   2. Every entry in `ORIGIN_TO_BASE_SLUG` still resolves to a
//      SECTION_LIBRARY entry — kept as a documentation aid (the table
//      is the audit trail of which pool entry came from which legacy
//      (templateId, sectionId) pair). Phase G can drop this.
//   3. `baseSlug` uniqueness — two entries with the same baseSlug
//      would collide on the `(base_slug, version)` unique index from
//      Phase A's migration.
//
// Run with `bun run section-library-extraction:smoke`.

import { allTemplateSeeds } from '../../templates/registry.js';
import { entryRowId } from './boot-upsert.js';
import { ORIGIN_TO_BASE_SLUG } from './origin-mapping.js';
import { SECTION_LIBRARY } from './registry.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[section-library-extraction:smoke] ${message}`);
}

// Build the rowId index once — every composition ref's `sectionId` must
// be a key in this map for instantiateTemplate to succeed.
const rowIdIndex = new Map<string, number>();
const slugIndex = new Map<string, number>();
for (let i = 0; i < SECTION_LIBRARY.length; i += 1) {
  const entry = SECTION_LIBRARY[i]!;
  rowIdIndex.set(entryRowId(entry), i);
  slugIndex.set(entry.baseSlug, i);
}

// -- Invariant 1: every composition ref resolves to a SECTION_LIBRARY entry ---

const unresolvedRefs: string[] = [];
for (const seed of allTemplateSeeds) {
  const refIds: string[] = [];
  if (seed.headerRef) refIds.push(seed.headerRef.sectionId);
  if (seed.footerRef) refIds.push(seed.footerRef.sectionId);
  for (const page of seed.pages) {
    for (const ref of page.bodyRefs) refIds.push(ref.sectionId);
  }
  for (const sectionId of refIds) {
    if (!rowIdIndex.has(sectionId)) {
      unresolvedRefs.push(`${seed.id} → ${sectionId}`);
    }
  }
}

assert(
  unresolvedRefs.length === 0,
  `${String(unresolvedRefs.length)} composition refs do not resolve to a SECTION_LIBRARY entry — either the entries/*.json file is missing or the composition's sectionId is stale:\n  ${unresolvedRefs.join('\n  ')}`,
);

// -- Invariant 2: every origin map entry still resolves -----------------------

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

console.log(
  `[section-library-extraction:smoke] OK — ${String(SECTION_LIBRARY.length)} entries, ${String(allTemplateSeeds.length)} compositions resolve, ${String(Object.keys(ORIGIN_TO_BASE_SLUG).length)} origin refs intact`,
);
