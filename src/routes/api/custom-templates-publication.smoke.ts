import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  CUSTOM_TEMPLATE_PUBLICATION_STATUSES,
  SITE_KINDS,
} from '../../db/schema';

assert.deepEqual(SITE_KINDS, ['owner_site', 'template_draft']);
assert.deepEqual(CUSTOM_TEMPLATE_PUBLICATION_STATUSES, ['drafting', 'published', 'unpublished']);

const schemaSource = readFileSync('src/db/schema.ts', 'utf8');
assert(schemaSource.includes("site_kind"), 'site table must carry site_kind');
assert(schemaSource.includes("publication_status"), 'custom_template must carry publication_status');
assert(schemaSource.includes("template_draft_site_id"), 'custom_template must link to one draft site');

const pickerSource = readFileSync('src/routes/dashboard/templates.tsx', 'utf8');
assert(
  pickerSource.includes('publicationStatus') && pickerSource.includes("'published'"),
  'template picker must show only published global custom templates',
);

const createSiteSource = readFileSync('src/routes/api/sites.ts', 'utf8');
assert(
  createSiteSource.includes('publicationStatus') && createSiteSource.includes("'published'"),
  'site creation must reject unpublished global custom templates',
);

console.log('[custom-templates-publication:smoke] OK');
