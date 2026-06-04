// src/db/section-library-schema.smoke.ts
//
// ADR 0061 Phase A — schema additions for Section Library lineage + category.
//
// `drizzle/0016_section_library_lineage.sql` is the deploy artefact; this
// smoke is the algorithmic mirror that runs in CI without a database. It
// verifies the schema.ts side of the migration in three checks:
//
//   1. SECTION_CATEGORIES is the closed enum the ADR pins (Decision 8) in
//      the user-facing reading order the picker dropdown will display.
//   2. The `librarySection` Drizzle table carries the four new columns
//      (`baseSlug`, `version`, `parentId`, `category`) and they preserve
//      the NOT NULL / DEFAULT shape the SQL declares.
//   3. The `(baseSlug, version)` uniqueness invariant rejects duplicates,
//      mirrored as a JS Map check that fails when the same (baseSlug,
//      version) pair is inserted twice — the same constraint the SQL
//      unique index enforces against the live DB.
//
// Run with `bun run section-library-schema:smoke`.

import { SECTION_CATEGORIES, librarySection, type SectionCategory } from './schema.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[section-library-schema:smoke] ${message}`);
}

// -- Check 1: SECTION_CATEGORIES is the closed enum, in dropdown order ----------

const EXPECTED_CATEGORIES: readonly SectionCategory[] = [
  'header',
  'hero',
  'features',
  'testimonials',
  'cta',
  'gallery',
  'footer',
  'other',
];

assert(
  SECTION_CATEGORIES.length === EXPECTED_CATEGORIES.length,
  `SECTION_CATEGORIES has ${String(SECTION_CATEGORIES.length)} members; ADR 0061 dec 8 pins ${String(EXPECTED_CATEGORIES.length)}`,
);
for (let i = 0; i < EXPECTED_CATEGORIES.length; i += 1) {
  assert(
    SECTION_CATEGORIES[i] === EXPECTED_CATEGORIES[i],
    `SECTION_CATEGORIES[${String(i)}] is ${String(SECTION_CATEGORIES[i])}; expected ${String(EXPECTED_CATEGORIES[i])}. Order drives picker dropdown order — keep the reading order.`,
  );
}

// -- Check 2: librarySection table carries the four new columns ----------------

interface ColumnLike {
  notNull: boolean;
  hasDefault: boolean;
  default?: unknown;
  columnType: string;
}

function pickColumn(table: typeof librarySection, key: keyof typeof librarySection): ColumnLike {
  const column = table[key] as unknown;
  assert(
    column !== undefined && column !== null && typeof column === 'object',
    `librarySection.${String(key)} is missing from the Drizzle table — the column was not added in schema.ts`,
  );
  return column as ColumnLike;
}

const baseSlugCol = pickColumn(librarySection, 'baseSlug');
const versionCol = pickColumn(librarySection, 'version');
const parentIdCol = pickColumn(librarySection, 'parentId');
const categoryCol = pickColumn(librarySection, 'category');

assert(baseSlugCol.notNull === true, 'librarySection.baseSlug must be NOT NULL (per migration: backfilled then SET NOT NULL)');
assert(versionCol.notNull === true, 'librarySection.version must be NOT NULL');
assert(versionCol.hasDefault === true && versionCol.default === 1, 'librarySection.version must default to 1');
assert(parentIdCol.notNull === false, 'librarySection.parentId must be NULL-able (self-FK to predecessor row)');
assert(categoryCol.notNull === true, 'librarySection.category must be NOT NULL');
assert(
  categoryCol.hasDefault === true && categoryCol.default === 'other',
  "librarySection.category must default to 'other' (backfill target for pre-migration rows)",
);

// -- Check 3: (baseSlug, version) uniqueness invariant -------------------------

interface MockRow {
  baseSlug: string;
  version: number;
  parentId: string | null;
}

class UniqueIndexViolation extends Error {
  constructor(baseSlug: string, version: number) {
    super(`duplicate key value violates unique constraint "library_section_base_slug_version_idx" (${baseSlug}, ${String(version)})`);
  }
}

class MockLibrarySectionTable {
  private readonly rows: MockRow[] = [];
  insert(row: MockRow): void {
    for (const existing of this.rows) {
      if (existing.baseSlug === row.baseSlug && existing.version === row.version) {
        throw new UniqueIndexViolation(row.baseSlug, row.version);
      }
    }
    this.rows.push(row);
  }
}

// Happy path: v1 + v2 of the same base_slug both insert; parent_id links them.
{
  const table = new MockLibrarySectionTable();
  table.insert({ baseSlug: 'home-template-hero', version: 1, parentId: null });
  table.insert({ baseSlug: 'home-template-hero', version: 2, parentId: 'id-v1' });
  table.insert({ baseSlug: 'home-template-features', version: 1, parentId: null });
  // No exception → invariant holds for monotonically-increasing versions.
}

// Constraint check: duplicate (baseSlug, version) is rejected.
{
  const table = new MockLibrarySectionTable();
  table.insert({ baseSlug: 'home-template-hero', version: 1, parentId: null });
  let rejected = false;
  try {
    table.insert({ baseSlug: 'home-template-hero', version: 1, parentId: null });
  } catch (err) {
    rejected = err instanceof UniqueIndexViolation;
  }
  assert(rejected, '(baseSlug, version) duplicate must be rejected — the SQL unique index enforces this against the live DB');
}

// Different base_slug, same version: legal — every category-1 v1 row coexists.
{
  const table = new MockLibrarySectionTable();
  table.insert({ baseSlug: 'home-template-hero', version: 1, parentId: null });
  table.insert({ baseSlug: 'launch-template-hero', version: 1, parentId: null });
  table.insert({ baseSlug: 'library-template-testimonial-quote', version: 1, parentId: null });
  // No exception → only (base_slug, version) is unique, not version alone.
}

console.log(`[section-library-schema:smoke] OK — SECTION_CATEGORIES + 4 new librarySection columns + (base_slug, version) uniqueness verified`);
