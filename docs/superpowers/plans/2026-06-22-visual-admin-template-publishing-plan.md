# Visual Admin Template Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a visual admin workflow where Template Curators edit hidden Template Drafts in the existing canvas editor and explicitly publish them as templates every Owner can select.

**Architecture:** Curated Custom Templates are the visual admin lane. A Curated Custom Template owns at most one hidden Template Draft, stored as a `site` row with `siteKind='template_draft'`. The editor runs in template mode against that draft; publish copies the draft state and asset manifest into the global `custom_template` row.

**Tech Stack:** Hono routes, Drizzle schema/migrations, Bun smokes, existing canvas editor client, existing `custom_template` and `site` tables.

## Global Constraints

- Built-in Template Seeds remain source-managed and reviewable through the existing GitHub path.
- Visual editing must not reverse-compile Editable Site state into Template Seed or Section Library source.
- The visual editor must use the canonical editor mutation, validation, persistence, and asset paths.
- Publish must be explicit. Draft saves do not change what Owners can select.
- Failure states must be loud: no silent default template, no guessed asset owner, no hidden reduced-capability mode.
- Template Draft assets belong to `TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID`; missing config blocks draft creation, upload, and publish.
- Normal dashboard site lists show only `siteKind='owner_site'`.
- Owner template picker shows global custom templates only when `publicationStatus='published'`.
- Use TDD: every production behavior starts with a failing smoke or focused test.
- Use forward-slash paths and `pathlib`-equivalent path-safe APIs where path handling is touched.

---

## File Structure

- Modify `src/db/schema.ts`: add `SITE_KINDS`, `site.siteKind`, `CUSTOM_TEMPLATE_PUBLICATION_STATUSES`, `customTemplate.publicationStatus`, and `customTemplate.templateDraftSiteId`.
- Create `drizzle/0021_template_drafts.sql`: add DB columns, constraints, and the unique draft relation.
- Modify `src/routes/dashboard/templates.tsx`: filter custom template picker rows to published global templates.
- Modify `src/routes/api/sites.ts`: reject unpublished/drafting global custom templates during site creation.
- Create `src/templates/curated-admin.ts`: pure service functions for curator permission checks, custodian resolution, draft creation, draft publication, unpublish, rename, duplicate, and delete rules.
- Modify `src/routes/api/custom-templates.ts`: wire admin API endpoints to `curated-admin.ts`.
- Create `src/templates/template-draft-access.ts`: shared access helper for Template Curator access to hidden Template Drafts.
- Modify `src/routes/api/canvas.ts`: allow Template Curators to load/save Template Drafts through the canonical canvas API.
- Modify `src/assets/route.ts`: scope asset listing/upload to the Template Asset Custodian when a Template Curator passes a Template Draft `siteId`.
- Create `src/routes/dashboard/admin-templates.tsx`: visual admin panel for Curated Custom Templates.
- Modify `src/routes/dashboard/admin-template-source.tsx` and `src/index.ts`: preserve the source editor at `/dashboard/admin/template-source`, mount the visual admin at `/dashboard/admin/templates`.
- Modify `src/editor/route.tsx`: add Template Draft editor route and template-mode chrome.
- Modify `src/editor-client/editor-context.ts`, `src/editor-client/index.ts`, `src/editor-client/publish.ts`, and targeted media picker helpers: add editor mode, publish-template branch, and site-scoped asset library reads.
- Modify `package.json`: add `visual-template-admin:smoke` script.
- Create smoke tests:
  - `src/routes/api/custom-templates-publication.smoke.ts`
  - `src/routes/dashboard/admin-templates.smoke.ts`
  - `src/editor-client/template-mode.smoke.ts`

---

### Task 1: Schema And Picker Publication Gate

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0021_template_drafts.sql`
- Modify: `src/routes/dashboard/templates.tsx`
- Modify: `src/routes/api/sites.ts`
- Create: `src/routes/api/custom-templates-publication.smoke.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `SITE_KINDS`, `SiteKind`, `CUSTOM_TEMPLATE_PUBLICATION_STATUSES`, `CustomTemplatePublicationStatus`
- Produces: `site.siteKind`, default `'owner_site'`
- Produces: `customTemplate.publicationStatus`, default `'published'`
- Produces: `customTemplate.templateDraftSiteId`, nullable FK to `site.id`
- Later tasks rely on `publicationStatus === 'published'` as the only custom-template picker gate.

- [ ] **Step 1: Write failing publication/status smoke**

Create `src/routes/api/custom-templates-publication.smoke.ts` with assertions that read source files and validate pure constants:

```ts
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
```

- [ ] **Step 2: Run smoke and verify RED**

Run: `bun run src/routes/api/custom-templates-publication.smoke.ts`

Expected: FAIL because `SITE_KINDS` and `CUSTOM_TEMPLATE_PUBLICATION_STATUSES` are not exported.

- [ ] **Step 3: Add schema fields and migration**

In `src/db/schema.ts`, add:

```ts
export const SITE_KINDS = ['owner_site', 'template_draft'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];
```

Add to `site` table:

```ts
siteKind: text('site_kind').notNull().default('owner_site').$type<SiteKind>(),
```

Add before `customTemplate`:

```ts
export const CUSTOM_TEMPLATE_PUBLICATION_STATUSES = [
  'drafting',
  'published',
  'unpublished',
] as const;
export type CustomTemplatePublicationStatus =
  (typeof CUSTOM_TEMPLATE_PUBLICATION_STATUSES)[number];
```

Add to `customTemplate`:

```ts
publicationStatus: text('publication_status')
  .notNull()
  .default('published')
  .$type<CustomTemplatePublicationStatus>(),
templateDraftSiteId: text('template_draft_site_id').references(() => site.id, {
  onDelete: 'set null',
}),
```

Create `drizzle/0021_template_drafts.sql`:

```sql
ALTER TABLE "site" ADD COLUMN "site_kind" text DEFAULT 'owner_site' NOT NULL;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_kind_check" CHECK ("site_kind" IN ('owner_site', 'template_draft'));--> statement-breakpoint
ALTER TABLE "custom_template" ADD COLUMN "publication_status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_template" ADD CONSTRAINT "custom_template_publication_status_check" CHECK ("publication_status" IN ('drafting', 'published', 'unpublished'));--> statement-breakpoint
ALTER TABLE "custom_template" ADD COLUMN "template_draft_site_id" text;--> statement-breakpoint
ALTER TABLE "custom_template" ADD CONSTRAINT "custom_template_template_draft_site_id_site_id_fk" FOREIGN KEY ("template_draft_site_id") REFERENCES "public"."site"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_template_template_draft_site_id_unique" ON "custom_template" USING btree ("template_draft_site_id") WHERE "template_draft_site_id" IS NOT NULL;
```

- [ ] **Step 4: Gate picker and site creation**

In `src/routes/dashboard/templates.tsx`, add `eq(customTemplate.publicationStatus, 'published')` to the global custom template query condition so only published global templates enter the Community tab.

In `src/routes/api/sites.ts`, select `publicationStatus` with the custom template row and reject rows where `publicationStatus !== 'published'` with the existing `unknown templateId` 404 response.

- [ ] **Step 5: Add script and run GREEN checks**

In `package.json`, add:

```json
"visual-template-admin:smoke": "bun run src/routes/api/custom-templates-publication.smoke.ts && bun run src/routes/dashboard/admin-templates.smoke.ts && bun run src/editor-client/template-mode.smoke.ts"
```

For Task 1 only, run:

```bash
bun run src/routes/api/custom-templates-publication.smoke.ts
bun run typecheck
```

Expected: smoke prints `[custom-templates-publication:smoke] OK`; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/0021_template_drafts.sql src/routes/dashboard/templates.tsx src/routes/api/sites.ts src/routes/api/custom-templates-publication.smoke.ts package.json
git commit -m "feat: add curated template publication state"
```

---

### Task 2: Curated Template Admin Service And API

**Files:**
- Create: `src/templates/curated-admin.ts`
- Modify: `src/routes/api/custom-templates.ts`
- Extend: `src/routes/api/custom-templates-publication.smoke.ts`

**Interfaces:**
- Consumes: schema fields from Task 1.
- Produces:
  - `requireTemplateAssetCustodianCustomerId(env): string`
  - `listCuratedTemplates(database): Promise<CuratedTemplateSummary[]>`
  - `ensureCuratedTemplateDraft(deps, templateId): Promise<{ templateId: string; draftSiteId: string }>`
  - `createCuratedTemplateDraft(deps, input): Promise<{ templateId: string; draftSiteId: string }>`
  - `publishCuratedTemplateDraft(deps, templateId): Promise<{ templateId: string; status: 'published' }>`
  - `unpublishCuratedTemplate(deps, templateId): Promise<{ templateId: string; status: 'unpublished' }>`
  - `renameCuratedTemplate(deps, templateId, input): Promise<void>`
  - `duplicateCuratedTemplateDraft(deps, templateId): Promise<{ templateId: string; draftSiteId: string }>`
  - `deleteCuratedTemplate(deps, templateId, confirmationName): Promise<void>`

- [ ] **Step 1: Extend smoke with service/API source assertions**

Add to `src/routes/api/custom-templates-publication.smoke.ts`:

```ts
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
  "customTemplatesAdmin.post('/:id/publish'",
  "customTemplatesAdmin.post('/:id/unpublish'",
  "customTemplatesAdmin.patch('/:id'",
  "customTemplatesAdmin.post('/:id/duplicate'",
  "customTemplatesAdmin.delete('/:id'",
]) {
  assert(customTemplatesRouteSource.includes(marker), `admin route missing ${marker}`);
}
```

- [ ] **Step 2: Run smoke and verify RED**

Run: `bun run src/routes/api/custom-templates-publication.smoke.ts`

Expected: FAIL because `src/templates/curated-admin.ts` does not exist.

- [ ] **Step 3: Implement service**

Create `src/templates/curated-admin.ts`. Core rules:

- `requireTemplateAssetCustodianCustomerId` trims `env.TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID`; if empty, throws `curated-template-admin: TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID must be set`.
- Draft creation from Template Seed uses `instantiateTemplate(sourceId)`.
- Draft creation from Curated Custom Template clones `customTemplate.siteState`.
- Every draft `site` insert uses `customerId` equal to custodian id and `siteKind: 'template_draft'`.
- Draft `subdomain` uses a deterministic admin-only prefix such as `template-draft-${crypto.randomUUID().slice(0, 8)}`; it never becomes a Published Address.
- New curated template rows created from a draft flow explicitly set `publicationStatus: 'drafting'`; do not rely on the schema default, which exists only to preserve older private custom-template behavior.
- `ensureCuratedTemplateDraft` loads an existing curated template, returns its `templateDraftSiteId` when present, and creates/links a new `siteKind: 'template_draft'` draft from `customTemplate.siteState` when it is null.
- Publish loads the `customTemplate.templateDraftSiteId`, loads that `site`, validates `site.editableState`, builds `assetManifest` from custodian-owned `ownerAsset` rows, updates the same `custom_template` row with `siteState`, `styleKit`, `assetManifest`, `publicationStatus: 'published'`, and `updatedAt`.
- Unpublish sets `publicationStatus: 'unpublished'` and leaves `templateDraftSiteId`.
- Delete throws `curated-template-admin: cannot delete a published curated template; unpublish it first` when status is published.
- Delete requires `confirmationName === customTemplate.name`; otherwise throw `curated-template-admin: confirmation name must match template name`.
- Delete explicitly deletes the linked draft `site` row after deleting the `custom_template` row when `templateDraftSiteId` is present. The FK points from `custom_template` to `site`, so the database will not cascade in that direction.

Reuse the existing asset-manifest shape from `src/routes/api/custom-templates.ts`; if helper extraction is needed, move `collectAssetIds` and `buildAssetManifest` to `src/templates/custom-template-assets.ts` and import it from both files.

- [ ] **Step 4: Wire admin API routes**

In `src/routes/api/custom-templates.ts`, extend `Bindings` with:

```ts
TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID?: string;
```

Add routes under `customTemplatesAdmin`:

```ts
customTemplatesAdmin.get('/', async (c) => c.json({ templates: await listCuratedTemplates(db(c.env)) }));
customTemplatesAdmin.post('/drafts', async (c) => { /* parse source/name/tagline, call createCuratedTemplateDraft */ });
customTemplatesAdmin.post('/:id/draft', async (c) => c.json(await ensureCuratedTemplateDraft({ database: db(c.env), env: c.env }, c.req.param('id'))));
customTemplatesAdmin.post('/:id/publish', async (c) => c.json(await publishCuratedTemplateDraft({ database: db(c.env), env: c.env }, c.req.param('id'))));
customTemplatesAdmin.post('/:id/unpublish', async (c) => c.json(await unpublishCuratedTemplate({ database: db(c.env) }, c.req.param('id'))));
customTemplatesAdmin.patch('/:id', async (c) => { /* parse name/tagline, call renameCuratedTemplate */ });
customTemplatesAdmin.post('/:id/duplicate', async (c) => c.json(await duplicateCuratedTemplateDraft({ database: db(c.env), env: c.env }, c.req.param('id'))));
customTemplatesAdmin.delete('/:id', async (c) => { /* parse confirmationName, call deleteCuratedTemplate */ });
```

Every catch block logs route, method, template id, message, and stack before returning JSON error. Route handlers pass the exact `confirmationName` body field to `deleteCuratedTemplate`; they do not perform partial or case-insensitive confirmation. Do not swallow service exceptions.

- [ ] **Step 5: Run GREEN checks**

```bash
bun run src/routes/api/custom-templates-publication.smoke.ts
bun run typecheck
```

Expected: smoke OK; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/templates/curated-admin.ts src/templates/custom-template-assets.ts src/routes/api/custom-templates.ts src/routes/api/custom-templates-publication.smoke.ts
git commit -m "feat: add curated template admin api"
```

---

### Task 3: Template Draft Access Through Canonical Editor APIs

**Files:**
- Create: `src/templates/template-draft-access.ts`
- Modify: `src/routes/api/canvas.ts`
- Modify: `src/assets/route.ts`
- Extend: `src/routes/api/custom-templates-publication.smoke.ts`

**Interfaces:**
- Consumes: `site.siteKind`, `isTemplateSourceAdminCustomer`.
- Produces: `loadTemplateDraftForCurator(database, customerRecord, siteId)` returning `{ customerId, site } | null`.
- Canvas API and asset API continue returning 404 for non-curators and non-template-draft sites.

- [ ] **Step 1: Extend smoke with access assertions**

Add to `src/routes/api/custom-templates-publication.smoke.ts`:

```ts
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
```

- [ ] **Step 2: Run smoke and verify RED**

Run: `bun run src/routes/api/custom-templates-publication.smoke.ts`

Expected: FAIL because `template-draft-access.ts` does not exist.

- [ ] **Step 3: Implement template draft access helper**

Create `src/templates/template-draft-access.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { isTemplateSourceAdminCustomer } from '../auth/db-admin';
import { site } from '../db/schema';
import type { Customer } from '../db/schema';
import type { Db } from '../db/client';

export async function loadTemplateDraftForCurator(
  database: Db,
  customerRecord: Customer | null | undefined,
  siteId: string,
) {
  if (!customerRecord || !isTemplateSourceAdminCustomer(customerRecord)) return null;
  const rows = await database
    .select({
      id: site.id,
      customerId: site.customerId,
      name: site.name,
      subdomain: site.subdomain,
      styleKit: site.styleKit,
      editableState: site.editableState,
      publishedVersion: site.publishedVersion,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.siteKind, 'template_draft')))
    .limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Extend canvas API**

In `src/routes/api/canvas.ts`, update `loadCanvasSiteAccess`: after `loadAccessibleSite` returns null, call `loadTemplateDraftForCurator(database, c.get('customer'), siteId)`. If present, return `ownerCustomerId: draft.customerId` and the draft site fields.

This keeps save validation, asset validation, and persistence unchanged while using the custodian customer id.

- [ ] **Step 5: Extend asset API**

In `src/assets/route.ts`:

- `GET /api/owner/assets?siteId=<draftSiteId>`: if `siteId` is present and normal access misses, use `loadTemplateDraftForCurator`; list assets for `draft.customerId`.
- `POST /api/owner/assets` already accepts multipart `siteId`; after normal `loadAccessibleSite` misses, use `loadTemplateDraftForCurator`; upload under `draft.customerId`.
- Before listing or uploading through the Template Draft path, read `TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID`; if missing, return 500 JSON `{ error: 'TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID must be set' }`. If present but different from `draft.customerId`, return 500 JSON `{ error: 'template draft customer does not match TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID' }`.
- `DELETE /api/owner/assets/:id` remains scoped to current user's own asset library in v1. Template mode can hide delete if needed; do not allow deleting custodian assets from generic owner route.

- [ ] **Step 6: Run GREEN checks**

```bash
bun run src/routes/api/custom-templates-publication.smoke.ts
bun run typecheck
```

Expected: smoke OK; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/templates/template-draft-access.ts src/routes/api/canvas.ts src/assets/route.ts src/routes/api/custom-templates-publication.smoke.ts
git commit -m "feat: allow curator access to template drafts"
```

---

### Task 4: Template Mode Editor

**Files:**
- Modify: `src/editor/route.tsx`
- Modify: `src/editor-client/editor-context.ts`
- Modify: `src/editor-client/index.ts`
- Modify: `src/editor-client/publish.ts`
- Modify targeted asset list call sites in `src/editor-client/inspector-nav-media-picker-mounts.ts` and `src/editor-client/runtime-helpers.ts`
- Create: `src/editor-client/template-mode.smoke.ts`

**Interfaces:**
- Consumes: admin API `POST /api/admin/custom-templates/:id/publish`.
- Produces: `EditorBoot.editorMode: 'site' | 'template'`
- Produces: `EditorBoot.templateId?: string`
- Produces: `EditorBoot.assetLibrarySiteId?: string`
- Produces: `EditorContext.editorMode`, `templateId`, `assetLibrarySiteId`, `publishTemplate()`.

- [ ] **Step 1: Write failing editor-mode smoke**

Create `src/editor-client/template-mode.smoke.ts`:

```ts
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const editorRouteSource = readFileSync('src/editor/route.tsx', 'utf8');
assert(editorRouteSource.includes("editorMode?: 'site' | 'template'"), 'editor route options must expose template mode');
assert(editorRouteSource.includes("canvas-publish"), 'template mode keeps canonical publish button id');
assert(editorRouteSource.includes('Publish template'), 'template mode publish button must say Publish template');
assert(editorRouteSource.includes("canvas-save-template"), 'site mode still emits save-as-template control');
assert(editorRouteSource.includes('/admin/templates/:templateId/edit'), 'editor route must mount template edit path');
assert(
  editorRouteSource.includes('ensureCuratedTemplateDraft'),
  'template edit route must lazily create a draft for existing curated templates',
);

const contextSource = readFileSync('src/editor-client/editor-context.ts', 'utf8');
assert(contextSource.includes("editorMode: 'site' | 'template'"), 'EditorBoot/Context must carry editorMode');
assert(contextSource.includes('assetLibrarySiteId'), 'EditorBoot/Context must carry assetLibrarySiteId');

const publishSource = readFileSync('src/editor-client/publish.ts', 'utf8');
assert(publishSource.includes('publishTemplate'), 'publish module must branch to template publish');
assert(publishSource.includes('/admin/custom-templates/'), 'template publish must use admin custom-template API');

const runtimeSource = readFileSync('src/editor-client/runtime-helpers.ts', 'utf8');
assert(runtimeSource.includes('ownerAssetsPath'), 'asset helpers must use mode-aware owner asset path');

console.log('[template-mode:smoke] OK');
```

- [ ] **Step 2: Run smoke and verify RED**

Run: `bun run src/editor-client/template-mode.smoke.ts`

Expected: FAIL because editor mode fields do not exist.

- [ ] **Step 3: Add editor boot/context fields**

In `src/editor-client/editor-context.ts`, extend `EditorBoot`:

```ts
editorMode: 'site' | 'template';
templateId?: string;
assetLibrarySiteId?: string;
```

Add same fields to `EditorContext`.

In `src/editor-client/index.ts`, populate:

```ts
editorMode: boot.editorMode,
templateId: boot.templateId,
assetLibrarySiteId: boot.assetLibrarySiteId,
```

Default missing boot mode to `'site'` only at the server boot payload boundary, not inside the client.

- [ ] **Step 4: Add server template edit route and chrome**

In `src/editor/route.tsx`:

- Extend `EditorPageOptions` with `editorMode?: 'site' | 'template'`, `templateId?: string`, `templateName?: string`, and `assetLibrarySiteId?: string`.
- Emit `editorMode`, `templateId`, and `assetLibrarySiteId` in `editorBoot`.
- In template mode:
  - crumb reads `Template Curator / <templateName>`
  - address span reads publication/template status text, not a public domain
  - settings link is omitted
  - save-as-template button is omitted
  - publish button text is `Publish template`
- Add `canvasEditor.get('/admin/templates/:templateId/edit', ...)` because `canvasEditor` is mounted at `/dashboard`; final URL is `/dashboard/admin/templates/:templateId/edit`.
- Route gates with `isTemplateSourceAdminCustomer(c.get('customer'))`.
- Route calls `ensureCuratedTemplateDraft({ database, env }, templateId)` before loading the draft. This handles migrated or existing curated templates whose `templateDraftSiteId` is null.
- Route loads the draft `site`, signs ws token for draft `site.customerId`, and calls `editorPageJsx` in template mode.

- [ ] **Step 5: Branch publish behavior**

In `src/editor-client/publish.ts`, if `ctx.editorMode === 'template'`, `publishSiteImpl` must:

```ts
await ctx.flushPendingSave();
const response = await ctx.authFetch(
  ctx.apiBase + '/admin/custom-templates/' + encodeURIComponent(ctx.templateId!) + '/publish',
  { method: 'POST' },
);
```

Non-OK responses surface `Publish template failed: <detail>`. Success sets status `Template published` and opens no public-site modal.

Keep site publish behavior unchanged for `editorMode === 'site'`.

- [ ] **Step 6: Make asset list path mode-aware**

Add a helper near runtime asset helpers:

```ts
export function ownerAssetsPath(ctx: Pick<EditorContext, 'apiBase' | 'assetLibrarySiteId'>): string {
  const base = ctx.apiBase + '/owner/assets';
  return ctx.assetLibrarySiteId ? base + '?siteId=' + encodeURIComponent(ctx.assetLibrarySiteId) : base;
}
```

Use it wherever editor client lists assets. Uploads already send multipart `siteId`; keep that field as `ctx.siteId`, which is the draft site id in template mode.

- [ ] **Step 7: Run GREEN checks**

```bash
bun run src/editor-client/template-mode.smoke.ts
bun run typecheck
```

Expected: smoke OK; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/editor/route.tsx src/editor-client/editor-context.ts src/editor-client/index.ts src/editor-client/publish.ts src/editor-client/inspector-nav-media-picker-mounts.ts src/editor-client/runtime-helpers.ts src/editor-client/template-mode.smoke.ts
git commit -m "feat: add template mode editor"
```

---

### Task 5: Visual Admin Panel

**Files:**
- Create: `src/routes/dashboard/admin-templates.tsx`
- Modify: `src/routes/dashboard/admin-template-source.tsx`
- Modify: `src/index.ts`
- Modify: `src/routes/dashboard/shell.tsx`
- Create: `src/routes/dashboard/admin-templates.smoke.ts`

**Interfaces:**
- Consumes admin custom-template API from Task 2.
- Produces visual admin at `/dashboard/admin/templates`.
- Preserves source admin at `/dashboard/admin/template-source`.

- [ ] **Step 1: Write failing admin panel smoke**

Create `src/routes/dashboard/admin-templates.smoke.ts`:

```ts
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const routeSource = readFileSync('src/routes/dashboard/admin-templates.tsx', 'utf8');
for (const text of [
  'Curated templates',
  'Create from Template Seed',
  'Create from Curated Custom Template',
  'Edit draft',
  'Publish',
  'Unpublish',
  'Duplicate draft',
  'Delete',
  '/api/admin/custom-templates',
]) {
  assert(routeSource.includes(text), `admin visual panel missing ${text}`);
}

const indexSource = readFileSync('src/index.ts', 'utf8');
assert(indexSource.includes("app.route('/dashboard/admin/templates', adminTemplatesRoute)"));
assert(indexSource.includes("app.route('/dashboard/admin/template-source', adminTemplateSourceRoute)"));

console.log('[admin-templates:smoke] OK');
```

- [ ] **Step 2: Run smoke and verify RED**

Run: `bun run src/routes/dashboard/admin-templates.smoke.ts`

Expected: FAIL because `admin-templates.tsx` does not exist.

- [ ] **Step 3: Build admin route**

Create `src/routes/dashboard/admin-templates.tsx`:

- Same auth gate as `admin-template-source.tsx`: `clerkAuth`, `requireAuth`, `isTemplateSourceAdminCustomer`.
- Uses `DashboardShell`.
- HTML layout has list pane and detail/actions pane.
- Client script:
  - GET `/api/admin/custom-templates`
  - POST `/api/admin/custom-templates/drafts`
  - PATCH `/api/admin/custom-templates/:id`
  - POST `/api/admin/custom-templates/:id/publish`
  - POST `/api/admin/custom-templates/:id/unpublish`
  - POST `/api/admin/custom-templates/:id/duplicate`
  - DELETE `/api/admin/custom-templates/:id`
  - Opens `/dashboard/admin/templates/:id/edit` for edit draft.
- UI includes a link to `/dashboard/admin/template-source` labelled `Source editor`.

- [ ] **Step 4: Preserve source admin route**

In `src/index.ts`:

```ts
import adminTemplatesRoute from './routes/dashboard/admin-templates';
app.route('/dashboard/admin/templates', adminTemplatesRoute);
app.route('/dashboard/admin/template-source', adminTemplateSourceRoute);
```

Remove the old `/dashboard/admin/templates` mount for `adminTemplateSourceRoute`.

In `src/routes/dashboard/admin-template-source.tsx`, change internal base path from `/dashboard/admin/templates` to `/dashboard/admin/template-source`.

In `src/routes/dashboard/shell.tsx`, keep admin link pointing at `/dashboard/admin/templates`.

- [ ] **Step 5: Run GREEN checks**

```bash
bun run src/routes/dashboard/admin-templates.smoke.ts
bun run typecheck
```

Expected: smoke OK; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/routes/dashboard/admin-templates.tsx src/routes/dashboard/admin-template-source.tsx src/index.ts src/routes/dashboard/shell.tsx src/routes/dashboard/admin-templates.smoke.ts
git commit -m "feat: add visual template admin panel"
```

---

### Task 6: Integration Verification And Hardening

**Files:**
- Modify: `package.json`
- Modify: smoke files from earlier tasks if needed.
- Modify: `.dev.vars.example` to document `TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID`.

**Interfaces:**
- Consumes all previous tasks.
- Produces final smoke script and env documentation.

- [ ] **Step 1: Add env documentation check**

Extend `src/routes/api/custom-templates-publication.smoke.ts`:

```ts
const devVarsExample = readFileSync('.dev.vars.example', 'utf8');
assert(
  devVarsExample.includes('TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID'),
  '.dev.vars.example must document the template asset custodian config',
);
```

- [ ] **Step 2: Run smoke and verify RED**

Run: `bun run src/routes/api/custom-templates-publication.smoke.ts`

Expected: FAIL if `.dev.vars.example` does not document the env var.

- [ ] **Step 3: Document env var**

Add to `.dev.vars.example`:

```env
TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID=
```

Do not add any default custodian behavior. Missing `TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID` remains a blocking configuration error.

- [ ] **Step 4: Run feature verification**

```bash
bun run src/routes/api/custom-templates-publication.smoke.ts
bun run src/routes/dashboard/admin-templates.smoke.ts
bun run src/editor-client/template-mode.smoke.ts
bun run typecheck
```

Expected: all three smokes print OK; typecheck exits 0.

- [ ] **Step 5: Run package smoke script**

```bash
bun run visual-template-admin:smoke
```

Expected: all included smokes print OK.

- [ ] **Step 6: Commit**

```bash
git add package.json .dev.vars.example src/routes/api/custom-templates-publication.smoke.ts src/routes/dashboard/admin-templates.smoke.ts src/editor-client/template-mode.smoke.ts
git commit -m "test: verify visual template admin flow"
```

---

## Final Verification

After all tasks:

```bash
bun run visual-template-admin:smoke
bun run template-source-admin:smoke
bun run typecheck
```

Expected:

- `visual-template-admin:smoke` exits 0.
- `template-source-admin:smoke` exits 0, proving the source admin lane still works.
- `typecheck` exits 0.

Before final handoff, run `git status --short` and ensure only intentional files are changed or committed.

## Self-Review

Spec coverage:

- Create Template Draft from seed/custom template: Task 2.
- Hidden draft not in dashboard: Task 1 schema plus Task 3 access and dashboard filter in Task 5 smoke coverage.
- Visual editor: Task 4.
- Publish/unpublish/manage: Task 2 API plus Task 5 UI.
- Picker shows published only: Task 1.
- Existing sites unaffected: Task 2 publish overwrites template row only; site creation still clones state.
- Asset custodian: Task 2, Task 3, Task 6.

Plan uses concrete paths and type names used by later tasks are defined in earlier tasks.
