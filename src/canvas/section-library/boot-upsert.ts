// src/canvas/section-library/boot-upsert.ts
//
// ADR 0061 Decision 2 — code is the structural source of truth for
// built-in Sections. Every deploy upserts every `SECTION_LIBRARY` entry
// into `library_section` so admin in-DB edits to `visibility:'global'`
// rows are intentionally overwritten — built-in Sections must be
// reviewable in code, diffable in PRs, and reproducible from a clean DB.
//
// Workers cold-start equivalent of "server boot": the upsert runs once
// per isolate on first request via a memoized promise wired into
// `src/index.ts`. The hook fires via `executionCtx.waitUntil` so it
// does not block the first request handler — the next request to need
// pool data sees the upsert complete (the cold-start window is short,
// and the legacy non-pool read path stays functional during it).
//
// Idempotency comes from `ON CONFLICT (base_slug, version) DO UPDATE`
// against the unique index added in Phase A. Multiple isolates upserting
// concurrently converge on the same row.

import { sql } from 'drizzle-orm';

import type { Db } from '../../db/client.js';
import { librarySection } from '../../db/schema.js';
import { SECTION_LIBRARY } from './registry.js';
import type { SectionLibraryEntry } from './types.js';

const CODE_DEFINED_VERSION = 1;

/**
 * Deterministic row id for a code-defined entry. The same `baseSlug`
 * always maps to the same `id` so the boot upsert can refer to parent
 * rows by id without a round-trip lookup. Slug-shaped instead of
 * UUID-shaped so admin tools display it human-readably; the `text`
 * column type accepts either shape.
 */
export function entryRowId(entry: Pick<SectionLibraryEntry, 'baseSlug'>): string {
  return `${entry.baseSlug}-v${String(CODE_DEFINED_VERSION)}`;
}

export interface BootUpsertResult {
  upserted: number;
}

/**
 * Walks the entries argument (defaulting to SECTION_LIBRARY) and upserts
 * each as a `visibility:'global'` row keyed by `(base_slug, version)`.
 * The conflict target matches the unique index
 * `library_section_base_slug_version_idx` from migration 0016 so
 * concurrent isolates and re-runs both resolve to UPDATE-in-place.
 *
 * The `entries` override is exposed for smoke tests only — production
 * callers pass nothing and get the live registry. Keeping it as a
 * parameter rather than module-level mutable state preserves the
 * "registry is canonical" invariant per Decision 2.
 */
export async function runSectionLibraryUpsert(
  database: Db,
  entries: ReadonlyArray<SectionLibraryEntry> = SECTION_LIBRARY,
): Promise<BootUpsertResult> {
  if (entries.length === 0) {
    console.log('[section-library] upserted 0 sections (registry empty)');
    return { upserted: 0 };
  }

  for (const entry of entries) {
    const rowId = entryRowId(entry);
    await database
      .insert(librarySection)
      .values({
        id: rowId,
        customerId: null,
        visibility: 'global',
        name: entry.name,
        description: entry.description,
        recipeId: entry.recipeId,
        sectionData: entry.sectionData,
        assetManifest: entry.assetManifest,
        headingPreview: entry.headingPreview,
        baseSlug: entry.baseSlug,
        version: CODE_DEFINED_VERSION,
        parentId: null,
        category: entry.category,
      })
      .onConflictDoUpdate({
        target: [librarySection.baseSlug, librarySection.version],
        set: {
          name: entry.name,
          description: entry.description,
          recipeId: entry.recipeId,
          sectionData: entry.sectionData,
          assetManifest: entry.assetManifest,
          headingPreview: entry.headingPreview,
          category: entry.category,
          updatedAt: sql`now()`,
        },
      });
  }

  console.log(`[section-library] upserted ${String(entries.length)} sections`);
  return { upserted: entries.length };
}

/**
 * Per-isolate memoization. `ensureSectionLibraryUpserted` returns the
 * same Promise on subsequent calls so the upsert runs exactly once per
 * cold-start. `resetSectionLibraryUpsertMemo` is exported for the smoke
 * — production code never calls it.
 */
let upsertPromise: Promise<BootUpsertResult> | null = null;

export function ensureSectionLibraryUpserted(database: Db): Promise<BootUpsertResult> {
  if (upsertPromise === null) {
    upsertPromise = runSectionLibraryUpsert(database).catch((err: unknown) => {
      // Reset the memo on failure so the next request retries instead of
      // permanently caching the rejection. The fail-loud rule still applies:
      // the rejection propagates to the caller (waitUntil) where it surfaces
      // in Worker logs.
      upsertPromise = null;
      throw err;
    });
  }
  return upsertPromise;
}

export function resetSectionLibraryUpsertMemo(): void {
  upsertPromise = null;
}
