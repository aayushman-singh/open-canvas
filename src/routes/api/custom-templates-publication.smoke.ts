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
assert(schemaSource.includes('source_template_id'), 'custom_template must carry source_template_id for seed overrides');

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
assert(
  customTemplatesRouteSource.includes('isTemplateSourceAdminCustomer'),
  'custom template admin API must use the Template Curator customer gate',
);
assert(
  customTemplatesRouteSource.includes('ADMIN_CLERK_USER_IDS'),
  'custom template admin API must accept the admin allowlist as a curator fallback',
);
assert(
  !customTemplatesRouteSource.includes('requireAdmin()'),
  'custom template admin API must not use the generic Clerk-ID admin gate',
);
assert(
  customTemplatesRouteSource.includes('isTemplateSourceAdminCustomer(customerRecord, auth.userId, c.env.ADMIN_CLERK_USER_IDS)'),
  'custom template admin API must pass auth user id and admin allowlist into the curator gate',
);
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

// 1. Publication status checks for global templates in owner-facing routes.
// Option B — seed-derived rows are normal templates now, so the catalog no
// longer filters them out; it only gates on published global visibility.
assert(
  customTemplatesRouteSource.includes("eq(customTemplate.publicationStatus, 'published')"),
  'GET /api/custom-templates must check publicationStatus for global templates',
);

assert(
  customTemplatesRouteSource.includes("customTemplatesOwner.get('/:id/preview'") &&
    customTemplatesRouteSource.includes("publicationStatus: customTemplate.publicationStatus") &&
    customTemplatesRouteSource.includes("tmpl.publicationStatus !== 'published'"),
  "GET /api/custom-templates/:id/preview must check publicationStatus for global templates"
);

assert(
  customTemplatesRouteSource.includes("customTemplatesOwner.get('/:id/assets/:assetId'") &&
    customTemplatesRouteSource.includes("publicationStatus: customTemplate.publicationStatus") &&
    customTemplatesRouteSource.includes("tmpl.publicationStatus !== 'published'"),
  "GET /api/custom-templates/:id/assets/:assetId must check publicationStatus for global templates"
);

// 2. Custodian seed asset materialization
assert(
  curatedAdminSource.includes("prepareSeedAssetsForCustomer") &&
    curatedAdminSource.includes("ownerAsset") &&
    curatedAdminSource.includes("onConflictDoNothing()"),
  "createCuratedTemplateDraft must prepare and insert custodian ownerAsset rows"
);

// 3. New admin route body parsing returns 400 for malformed JSON
const matchesSilentlyCatch = customTemplatesRouteSource.match(/c\.req\.json\(\)\.catch\(\(\)\s*=>\s*\(\{\}\)\)/g);
assert(
  !matchesSilentlyCatch || matchesSilentlyCatch.length === 0,
  "Admin routes must not silently catch JSON parse errors with empty objects"
);

// 4. siteKind template_draft verification in publish and delete
assert(
  curatedAdminSource.includes("siteKind: site.siteKind") &&
    curatedAdminSource.includes("siteKind !== 'template_draft'"),
  "Publish and delete must verify the draft site's siteKind is template_draft"
);

// 5. PATCH tagline rename-only retaining behavior
assert(
  curatedAdminSource.includes("const updateData: Partial<typeof customTemplate.$inferInsert> = {") &&
    curatedAdminSource.includes("input.tagline !== undefined"),
  "renameCuratedTemplate must dynamically check and assign tagline if defined"
);

// 6. Refactor check: curated-admin.ts must not import from routes/api/sites and must import the shared module
assert(!curatedAdminSource.includes("../routes/api/sites"), "curated-admin.ts must not import from ../routes/api/sites.js");
assert(curatedAdminSource.includes("./seed-asset-materialization.js"), "curated-admin.ts must import from seed-asset-materialization.js");

// Task 3: Access assertions for template draft access, canvas, and asset routes
const draftAccessSource = readFileSync('src/templates/template-draft-access.ts', 'utf8');
assert(
  draftAccessSource.includes('isTemplateSourceAdminCustomer'),
  'template draft access must be restricted to Template Curators',
);
assert(
  draftAccessSource.includes("eq(site.siteKind, 'template_draft')"),
  'template draft access must only open template_draft sites',
);

const canvasApiSource = readFileSync('src/routes/api/canvas.ts', 'utf8');
assert(
  canvasApiSource.includes('loadTemplateDraftForCurator'),
  'canvas API must use template draft access after normal site access misses',
);

const assetRouteSource = readFileSync('src/assets/route.ts', 'utf8');
assert(
  assetRouteSource.includes('loadTemplateDraftForCurator'),
  'asset API must scope template draft asset list/upload through custodian site owner',
);
assert(
  assetRouteSource.includes('TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID'),
  'asset API must verify configured custodian before listing/uploading template draft assets',
);
assert(
  assetRouteSource.includes("c.req.query('siteId')"),
  'asset GET must accept siteId so template mode can list custodian assets',
);

const devVarsExample = readFileSync('.dev.vars.example', 'utf8');
assert(
  devVarsExample.includes('TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID'),
  '.dev.vars.example must document the template asset custodian config',
);

console.log('[custom-templates-publication:smoke] OK');
