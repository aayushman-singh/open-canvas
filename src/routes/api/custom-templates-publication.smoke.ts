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

assert(
  schemaSource.includes("templateDraftSiteIdUnique: uniqueIndex('custom_template_template_draft_site_id_unique')") &&
    schemaSource.includes(".where(sql`template_draft_site_id IS NOT NULL`)"),
  'custom_template must define a partial unique index for templateDraftSiteId',
);

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

// Task 2 service/API source assertions
const curatedAdminSource = readFileSync('src/templates/curated-admin.ts', 'utf8');
assert(
  curatedAdminSource.includes('TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID'),
  'curated admin service must fail when template asset custodian config is missing',
);
assert(
  curatedAdminSource.includes("siteKind: 'template_draft'"),
  'draft creation must create hidden template_draft sites',
);
assert(
  curatedAdminSource.includes("publicationStatus: 'published'"),
  'publish must mark curated template published',
);
assert(
  curatedAdminSource.includes("publicationStatus: 'drafting'"),
  'new curated template drafts must not appear in the picker before publish',
);
assert(
  curatedAdminSource.includes("publicationStatus: 'unpublished'"),
  'unpublish must keep the row and hide it',
);
assert(
  curatedAdminSource.includes('ensureCuratedTemplateDraft'),
  'existing curated templates without a draft must lazily get one before visual edit',
);
assert(
  curatedAdminSource.includes('cannot delete a published curated template'),
  'delete must block published templates before deletion',
);
assert(
  curatedAdminSource.includes('delete(site)'),
  'delete must explicitly remove the associated template_draft site row',
);

const customTemplatesRouteSource = readFileSync('src/routes/api/custom-templates.ts', 'utf8');
for (const marker of [
  "customTemplatesAdmin.get('/'",
  "customTemplatesAdmin.post('/drafts'",
  "customTemplatesAdmin.post('/:id/draft'",
  "customTemplatesAdmin.post('/:id/publish'",
  "customTemplatesAdmin.post('/:id/unpublish'",
  "customTemplatesAdmin.patch('/:id'",
  "customTemplatesAdmin.post('/:id/duplicate'",
  "customTemplatesAdmin.delete('/:id'",
]) {
  assert(customTemplatesRouteSource.includes(marker), `admin route missing ${marker}`);
}

console.log('[custom-templates-publication:smoke] OK');
