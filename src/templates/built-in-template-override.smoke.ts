import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Option B — built-in seeds are imported into custom_template by the
// seed-bootstrap module; the picker and site creation read only from the DB.
// `source_template_id` survives purely as the bootstrap idempotency key and
// as the link used to re-inject page-bound collection content.

const schemaSource = readFileSync('src/db/schema.ts', 'utf8');
assert(
  schemaSource.includes('sourceTemplateId: text('),
  'custom_template must carry sourceTemplateId to key the seed bootstrap',
);
assert(
  schemaSource.includes("sourceTemplateIdUnique: uniqueIndex('custom_template_source_template_id_unique')"),
  'custom_template must define a partial unique index for sourceTemplateId',
);

const bootstrapSource = readFileSync('src/templates/seed-bootstrap.ts', 'utf8');
assert(
  bootstrapSource.includes('ensureBuiltInTemplatesSeeded'),
  'seed-bootstrap must expose ensureBuiltInTemplatesSeeded',
);
assert(
  bootstrapSource.includes('sourceTemplateId: seed.id'),
  'bootstrap must stamp each imported row with its seed id',
);
assert(
  bootstrapSource.includes("publicationStatus: 'published'") &&
    bootstrapSource.includes("visibility: 'global'"),
  'bootstrap must import seeds as published global templates',
);
assert(
  bootstrapSource.includes('alreadySeeded') && bootstrapSource.includes('continue'),
  'bootstrap must be idempotent and skip seeds already imported',
);

const pickerSource = readFileSync('src/routes/dashboard/templates.tsx', 'utf8');
assert(
  pickerSource.includes('ensureBuiltInTemplatesSeeded'),
  'template picker must trigger the seed bootstrap on load',
);
assert(
  !pickerSource.includes('isNull(customTemplate.sourceTemplateId)'),
  'picker must no longer hide seed-derived rows — seeds are normal DB templates now',
);

const sitesSource = readFileSync('src/routes/api/sites.ts', 'utf8');
assert(
  !sitesSource.includes('loadPublishedBuiltInTemplateOverride'),
  'site creation must resolve templates only from custom_template (no seed override path)',
);
assert(
  sitesSource.includes('dt.sourceTemplateId') &&
    sitesSource.includes('TEMPLATE_SEED_ENTRIES[collectionSeedId]'),
  'site creation must re-inject collection entries via the source seed id',
);

console.log('[built-in-template-override:smoke] OK');
