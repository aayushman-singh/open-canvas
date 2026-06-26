import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const routeSource = readFileSync('src/routes/dashboard/admin-templates.tsx', 'utf8');
for (const text of [
  'Curated templates',
  'Edit draft',
  'Publish',
  'Unpublish',
  'Duplicate draft',
  'Delete',
  '/api/admin/custom-templates',
]) {
  assert(routeSource.includes(text), `admin visual panel missing ${text}`);
}
// Option B — seeds are imported automatically; the manual "Create from…"
// forms are gone in favour of an auto-populated list.
for (const removed of ['Create from Template Seed', 'Create from Curated Custom Template']) {
  assert(
    !routeSource.includes(removed),
    `admin visual panel must drop the manual create form: ${removed}`,
  );
}
assert(
  !routeSource.includes('if (tmpl.templateDraftSiteId)'),
  'visual admin must not hide Edit draft for migrated templates without templateDraftSiteId',
);

const indexSource = readFileSync('src/index.ts', 'utf8');
assert(indexSource.includes("app.route('/dashboard/admin/templates', adminTemplatesRoute)"));
assert(indexSource.includes("app.route('/dashboard/admin/template-source', adminTemplateSourceRoute)"));

console.log('[admin-templates:smoke] OK');
