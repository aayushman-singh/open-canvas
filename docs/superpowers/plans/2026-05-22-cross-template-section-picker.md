# Cross-Template Section Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a site Owner browse sections from every Template Seed in a new "Sections" tab of the editor sidebar, then insert any of those sections into the current site at a chosen slot, with the source section's seed media materialised into the target site's asset namespace so images and videos keep rendering.

**Architecture:** Add one shared server util (`src/canvas/section-import.ts`) that clones a source `CanvasSection`, regenerates IDs, and materialises every `SEED_ASSET_REGISTRY` reference into the target site's `siteAsset` rows — mirroring the existing `prepareSeedAssetsForSite` flow but scoped to a single section. Expose two new owner-authenticated endpoints (`GET /api/templates/sections` catalog and `POST /api/sites/:siteId/sections/import` insert), persist site + new asset rows in a single `database.batch` transaction. On the client, refactor the single-tab sidebar in `canvas-index.tsx` into a real tablist with a switcher in `canvas-client.ts`, add a "Sections" tab containing a fetched catalog grid, and add a "placement mode" overlay that draws clickable drop slots between sections after the Owner clicks "Use" on a card.

**Tech Stack:** Cloudflare Workers, Hono JSX, Drizzle ORM, Neon serverless Postgres, Clerk, vanilla browser JS, Bun smoke scripts.

---

## Scope

**In scope (MVP):**

- Browse sections from any of the 5 built template seeds.
- Insert a cloned section into a slot chosen via placement-mode drop slots.
- Materialise the source section's seed media into the target site so images render.
- Search by section name; filter by template.

**Out of scope (v2):**

- Cross-site section import (lift a section from another live site).
- Drag-to-reorder existing sections.
- HTML5 drag-from-picker-card directly to canvas position.
- Thumbnail images for cards — MVP uses text-only cards with heading-text excerpt and recipe pill.
- Saving owner-authored sections as reusable picker entries.

---

## File Structure

**Create:**

- `src/canvas/section-import.ts` — pure util that clones a `CanvasSection` and produces the new section + seed asset rows for a target site.
- `src/canvas/section-import-smoke.ts` — smoke test that imports a known section from each template and asserts ID regeneration + asset materialisation.
- `src/routes/api/sections.ts` — Hono router with `GET /api/templates/sections` catalog and `POST /api/sites/:siteId/sections/import` endpoints.
- `src/templates/section-catalog.ts` — boot-time-built catalog of `{ templateId, templateName, sectionId, recipeId, sectionName, headingPreview }` from `allTemplateSeeds`.

**Modify:**

- `src/editor/canvas-index.tsx` — replace the single-tab markup with a two-tab tablist + two panels (Add + Sections).
- `src/editor/canvas-client.ts` — add `attachSidebarTabs()`, the Sections panel data fetch + render, and the placement-mode overlay.
- `src/editor/canvas-styles.ts` — picker grid, card, placement-mode slot styles.
- `src/index.ts` — mount the sections router.
- `package.json` — add `section-import:smoke` script.

---

## API Contracts

### `GET /api/templates/sections`

Auth: requires owner session (`auth.userId` set by the existing auth middleware).

Response 200:

```json
{
  "sections": [
    {
      "templateId": "starter-canvas",
      "templateName": "Starter Canvas",
      "sectionId": "sec-hero-split-001",
      "recipeId": "hero-split",
      "sectionName": "Hero",
      "headingPreview": "Ship a site that feels lived-in."
    }
  ]
}
```

`headingPreview` is the plain-text projection of the section's first `TextElement` with `role: 'heading'`, truncated to 80 chars (ellipsis if cut). If no heading text element, fall back to the section's recipe-id (e.g. `"hero-split"`).

### `POST /api/sites/:siteId/sections/import`

Auth: requires owner session and the owner must own `:siteId`.

Request body:

```json
{
  "templateId": "starter-canvas",
  "sectionId": "sec-hero-split-001",
  "insertAt": 2
}
```

- `insertAt` is the index into `editableState.pages[0].sections` where the new section is spliced. `0` = front. Length = end. `< 0` or `> length` → 400.
- `templateId` must resolve to a `TemplateSeed` in `allTemplateSeeds`; `sectionId` must exist within `seed.state.pages[0].sections`. Either miss → 404.

Response 200:

```json
{ "editableState": { "...": "full updated EditableSite" } }
```

On any validation failure (resulting state fails `validateEditableSite`, asset materialisation reports unknown seed IDs, etc.) → 500 with `{ error: string, details?: string[] }`. **No fallback** — fail loudly per the global "Failure Handling" rule. If the resulting state would be invalid, do not persist; return the error.

---

## Asset Materialisation Behaviour

The util reuses `prepareSeedAssetsForSite`'s mental model but scoped to one section:

1. Walk the source section's elements. For every `MediaElement`, collect `assetId` and `posterAssetId` (if set).
2. For each collected raw asset ID, look it up in `SEED_ASSET_REGISTRY`. Unknown → fail loudly with that ID listed in `unknownSeedIds`.
3. Compute the materialised target ID: `seed-${targetSiteId}-${rawSeedId}` (matches `siteSeedAssetId` in [src/routes/api/sites.ts:116](src/routes/api/sites.ts#L116)).
4. **Skip duplicates** — both within the section (one raw seed referenced by 3 elements → 1 row, all 3 element refs rewritten to the materialised ID) AND against the target site's existing `siteAsset` rows (the util receives a `Set<string>` of existing asset IDs and skips materialised IDs that already exist; the endpoint queries `siteAsset.id` for `siteId = targetSiteId` first and passes the set in).
5. Rewrite each element's `assetId` (and `posterAssetId` when present) to the materialised ID.

The cloned section also gets:

- A new `section.id` of the form `sec-<recipeId>-<crypto.randomUUID().slice(0,8)>` (matches the existing recipe-generated section ID convention).
- New element IDs of the form `<originalIdRolePrefix>-<crypto.randomUUID().slice(0,8)>` — strip any trailing random suffix from the original ID first to preserve the role-prefix; e.g. `hero-heading-abc123` → role prefix `hero-heading` → new ID `hero-heading-d4f9c2a1`. If the original has no recognisable prefix, generate `el-<random>`.

---

## Placement Mode UX

When the Owner clicks "Use" on a picker card:

1. Client stores `pendingImport: { templateId: string, sectionId: string }` in canvas-client state.
2. Canvas enters placement mode. The renderer emits one absolutely-positioned `<button class="rev01-section-slot" data-slot-index="N">` element per slot: one above section 0, one between every pair of adjacent sections, one below the last section. So a page with 3 sections gets 4 slots: 0, 1, 2, 3.
3. Slots are styled as a 24px-tall horizontal strip with a dashed accent border and a centred "+ Insert here" label that's only visible on hover or when the corresponding `pendingImport` is set.
4. Pressing Escape, clicking outside the canvas, or clicking the picker card again clears `pendingImport` and exits placement mode.
5. Clicking a slot fires `POST /api/sites/:siteId/sections/import` with `insertAt: <slot data-slot-index>`. On 200, the response's `editableState` replaces local state and `renderAll()` re-runs. Status bar shows "Section inserted from <templateName>".
6. On non-200, status bar shows `"Insert failed: <detail>"` and placement mode stays active so the Owner can retry or cancel.

---

## Sidebar Tab Switcher Contract

The existing markup has a single `<button class="active" role="tab">` and a single `<div class="rev01-sidebar-panel" role="tabpanel">`. The refactor adds:

- `data-sidebar-tab="add" | "sections"` attribute on each tab button.
- `data-sidebar-panel="add" | "sections"` attribute on each panel.
- A new `attachSidebarTabs()` function in canvas-client.ts that wires click handlers: clicked button gains `.active` and `aria-selected="true"`; matching panel loses the `hidden` attribute; the previously-active button and panel get inverted. The Sections panel is `hidden` initially.
- `attachSidebarTabs()` runs once during the existing `init()` flow alongside `attachSidebarActions()`.

The Sections tab only fetches the catalog on its first activation (a `sectionsCatalog: SectionCatalogEntry[] | null` cache lives in canvas-client state). Subsequent activations reuse the cached list.

---

## Tasks

### Task 1: Section import util — clone + asset materialisation

**Files:**

- Create: `src/canvas/section-import.ts`
- Test: `src/canvas/section-import-smoke.ts`

- [ ] **Step 1: Write the failing smoke test**

```typescript
// src/canvas/section-import-smoke.ts
//
// Manual smoke: clone a section from each template seed into a fresh target
// site, assert IDs are regenerated, assert every media element's assetId is
// remapped to the target site's materialised seed-<siteId>-<rawSeedId> form,
// and assert the new asset rows match the registry contents. Run with
// `bun.cmd run section-import:smoke`.

import { allTemplateSeeds } from '../templates/registry.js';
import { SEED_ASSET_REGISTRY } from './seed-assets.js';
import { importSectionIntoSite } from './section-import.js';
import type { CanvasSection, MediaElement } from './schema.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const targetSiteId = 'test-target-site-id';
const existingAssetIds = new Set<string>();

for (const seed of allTemplateSeeds) {
  const sourceSection = seed.state.pages[0]?.sections[0];
  assert(sourceSection !== undefined, `${seed.id} missing page[0].sections[0]`);

  const result = importSectionIntoSite({
    targetSiteId,
    sourceSection: sourceSection as CanvasSection,
    existingAssetIds,
  });
  assert(result.ok, `import failed for ${seed.id}: ${result.ok ? '' : result.errors.join('; ')}`);
  if (!result.ok) continue;

  assert(result.section.id !== sourceSection.id, `${seed.id}: section.id was not regenerated`);
  for (const element of result.section.elements) {
    if (element.type !== 'media') continue;
    const media = element as MediaElement;
    const expectedPrefix = `seed-${targetSiteId}-`;
    assert(
      media.assetId.startsWith(expectedPrefix),
      `${seed.id}: media.assetId "${media.assetId}" not remapped`,
    );
    if (media.posterAssetId !== undefined) {
      assert(
        media.posterAssetId.startsWith(expectedPrefix),
        `${seed.id}: media.posterAssetId "${media.posterAssetId}" not remapped`,
      );
    }
  }

  for (const row of result.newAssetRows) {
    assert(row.siteId === targetSiteId, `${seed.id}: asset row siteId mismatch`);
    assert(row.id.startsWith(`seed-${targetSiteId}-`), `${seed.id}: asset row id shape wrong`);
    const rawSeedId = row.id.slice(`seed-${targetSiteId}-`.length);
    const registryEntry = SEED_ASSET_REGISTRY[rawSeedId];
    assert(registryEntry !== undefined, `${seed.id}: row references unknown raw seed ${rawSeedId}`);
    if (registryEntry !== undefined) {
      assert(row.kind === registryEntry.kind, `${seed.id}: row kind mismatch`);
      assert(row.bytesBase64 === registryEntry.bytesBase64, `${seed.id}: row bytes mismatch`);
    }
  }
}

// Dedup check: same registry asset referenced from a fresh import after
// existingAssetIds is primed should not produce a duplicate row.
const seed = allTemplateSeeds[0]!;
const firstSection = seed.state.pages[0]!.sections[0] as CanvasSection;
const firstImport = importSectionIntoSite({
  targetSiteId,
  sourceSection: firstSection,
  existingAssetIds: new Set<string>(),
});
assert(firstImport.ok, 'first import must succeed');
if (firstImport.ok) {
  const seenSet = new Set(firstImport.newAssetRows.map((r) => r.id));
  const secondImport = importSectionIntoSite({
    targetSiteId,
    sourceSection: firstSection,
    existingAssetIds: seenSet,
  });
  assert(secondImport.ok, 'second import must succeed');
  if (secondImport.ok) {
    assert(
      secondImport.newAssetRows.length === 0,
      `dedup failed: produced ${secondImport.newAssetRows.length} rows when all should be skipped`,
    );
  }
}

console.log('section-import smoke OK');
```

- [ ] **Step 2: Run smoke to verify it fails**

Run: `bun.cmd run src/canvas/section-import-smoke.ts`
Expected: FAIL with `Cannot find module './section-import.js'` or similar.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/canvas/section-import.ts
//
// Pure util for cloning a CanvasSection into a target site: regenerates all
// IDs, walks media elements to collect seed-asset references, materialises
// each raw SEED_ASSET_REGISTRY entry into a siteAsset row scoped to the
// target site (id = seed-<siteId>-<rawSeedId>), and rewrites every assetId
// and posterAssetId on the cloned section to point at the materialised ids.
//
// Dedup: a raw seed id appearing in N elements produces exactly 1 row, and
// rows whose target id is already in `existingAssetIds` are omitted from
// newAssetRows (the element refs are still rewritten so they resolve).
//
// Fail loud: an element whose assetId is not in SEED_ASSET_REGISTRY produces
// `{ ok: false, errors }`. No silent skip. No fallback bytes.

import { SEED_ASSET_REGISTRY } from './seed-assets.js';
import type { CanvasSection, MediaElement } from './schema.js';

export interface ImportSectionInput {
  targetSiteId: string;
  sourceSection: CanvasSection;
  existingAssetIds: Set<string>;
}

export interface ImportedAssetRow {
  id: string;
  siteId: string;
  mediaType: string;
  bytesBase64: string;
  kind: 'image' | 'video';
  alt: string;
}

export type ImportSectionResult =
  | { ok: true; section: CanvasSection; newAssetRows: ImportedAssetRow[] }
  | { ok: false; errors: string[] };

function rolePrefix(originalId: string): string {
  const lastDash = originalId.lastIndexOf('-');
  if (lastDash <= 0) return originalId || 'el';
  const tail = originalId.slice(lastDash + 1);
  if (/^[a-z0-9]{4,}$/i.test(tail)) return originalId.slice(0, lastDash);
  return originalId;
}

function newId(prefix: string): string {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${prefix}-${random}`;
}

function materialisedAssetId(targetSiteId: string, rawSeedId: string): string {
  return `seed-${targetSiteId}-${rawSeedId}`;
}

export function importSectionIntoSite(input: ImportSectionInput): ImportSectionResult {
  const { targetSiteId, sourceSection, existingAssetIds } = input;
  const cloned = structuredClone(sourceSection) as CanvasSection;
  const errors: string[] = [];

  const idMap = new Map<string, string>();
  for (const element of cloned.elements) {
    const original = element.id;
    const fresh = newId(rolePrefix(original));
    idMap.set(original, fresh);
    element.id = fresh;
  }

  const recipeSlug = cloned.recipeId;
  cloned.id = newId(`sec-${recipeSlug}`);

  const assetIdMap = new Map<string, string>();
  for (const element of cloned.elements) {
    if (element.type !== 'media') continue;
    const media = element as MediaElement;
    const seed = SEED_ASSET_REGISTRY[media.assetId];
    if (!seed) {
      errors.push(`unknown seed asset id: ${media.assetId}`);
    } else if (!assetIdMap.has(media.assetId)) {
      assetIdMap.set(media.assetId, materialisedAssetId(targetSiteId, media.assetId));
    }
    if (media.posterAssetId !== undefined) {
      const posterSeed = SEED_ASSET_REGISTRY[media.posterAssetId];
      if (!posterSeed) {
        errors.push(`unknown seed poster asset id: ${media.posterAssetId}`);
      } else if (!assetIdMap.has(media.posterAssetId)) {
        assetIdMap.set(media.posterAssetId, materialisedAssetId(targetSiteId, media.posterAssetId));
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  for (const element of cloned.elements) {
    if (element.type !== 'media') continue;
    const media = element as MediaElement;
    const remapped = assetIdMap.get(media.assetId);
    if (!remapped) {
      return { ok: false, errors: [`internal: missing remap for ${media.assetId}`] };
    }
    media.assetId = remapped;
    if (media.posterAssetId !== undefined) {
      const remappedPoster = assetIdMap.get(media.posterAssetId);
      if (!remappedPoster) {
        return { ok: false, errors: [`internal: missing remap for ${media.posterAssetId}`] };
      }
      media.posterAssetId = remappedPoster;
    }
  }

  const newAssetRows: ImportedAssetRow[] = [];
  for (const [rawSeedId, materialisedId] of assetIdMap.entries()) {
    if (existingAssetIds.has(materialisedId)) continue;
    const seed = SEED_ASSET_REGISTRY[rawSeedId]!;
    newAssetRows.push({
      id: materialisedId,
      siteId: targetSiteId,
      mediaType: seed.mediaType,
      bytesBase64: seed.bytesBase64,
      kind: seed.kind,
      alt: seed.alt,
    });
  }

  return { ok: true, section: cloned, newAssetRows };
}
```

- [ ] **Step 4: Add the smoke script to package.json**

Modify `package.json` `"scripts"` to add:

```json
"section-import:smoke": "bun run src/canvas/section-import-smoke.ts"
```

- [ ] **Step 5: Run smoke to verify it passes**

Run: `bun.cmd run section-import:smoke`
Expected: prints `section-import smoke OK` and exits 0.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/canvas/section-import.ts src/canvas/section-import-smoke.ts package.json
git commit -m "feat: add section-import util for cross-template section reuse"
```

---

### Task 2: Boot-time section catalog

**Files:**

- Create: `src/templates/section-catalog.ts`

- [ ] **Step 1: Write the catalog module**

```typescript
// src/templates/section-catalog.ts
//
// Boot-time index of every section from every TemplateSeed. The picker UI
// fetches this list once; templates change only on code deploy, so the
// catalog is built statically at module load.

import { allTemplateSeeds } from './registry.js';
import type { TextElement } from '../canvas/schema.js';

export interface SectionCatalogEntry {
  templateId: string;
  templateName: string;
  sectionId: string;
  recipeId: string;
  sectionName: string;
  headingPreview: string;
}

function firstHeadingPreview(section: { elements: ReadonlyArray<{ type: string }> }): string {
  for (const element of section.elements) {
    if (element.type !== 'text') continue;
    const text = element as unknown as TextElement;
    if (text.role !== 'heading') continue;
    const plain = text.content.map((run) => run.text).join('');
    if (plain.trim().length === 0) continue;
    return plain.length > 80 ? `${plain.slice(0, 77)}…` : plain;
  }
  return '';
}

function buildCatalog(): SectionCatalogEntry[] {
  const entries: SectionCatalogEntry[] = [];
  for (const seed of allTemplateSeeds) {
    const page = seed.state.pages[0];
    if (!page) continue;
    for (const section of page.sections) {
      const heading = firstHeadingPreview(section);
      entries.push({
        templateId: seed.id,
        templateName: seed.name,
        sectionId: section.id,
        recipeId: section.recipeId,
        sectionName: section.name ?? section.recipeId,
        headingPreview: heading.length > 0 ? heading : section.recipeId,
      });
    }
  }
  return entries;
}

export const SECTION_CATALOG: ReadonlyArray<SectionCatalogEntry> = Object.freeze(buildCatalog());
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `CanvasSection.name` is optional and the path `section.name ?? section.recipeId` does not typecheck, change to `section.name || section.recipeId`. If `name` is non-optional, drop the `??` clause.

- [ ] **Step 3: Verify catalog content via smoke**

Run an inline sanity check by adding to the existing canvas smoke OR by running:

```bash
bun run -e "import('./src/templates/section-catalog.js').then((m) => { console.log('entries:', m.SECTION_CATALOG.length); console.log(m.SECTION_CATALOG.slice(0, 3)); })"
```

Expected: prints a non-zero entry count and the first three entries' shapes. Confirm at least 5 entries (one per template).

- [ ] **Step 4: Commit**

```bash
git add src/templates/section-catalog.ts
git commit -m "feat: add boot-time section catalog from template seeds"
```

---

### Task 3: Sections API endpoints

**Files:**

- Create: `src/routes/api/sections.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Locate the existing auth middleware pattern**

Read `src/routes/api/canvas.ts` for the existing owner-auth and site-ownership patterns. Note: the existing canvas router uses `c.get('auth')` set by an upstream middleware and queries the `site` table for `customerId` match. The new sections router follows the same pattern.

Run: open `src/routes/api/canvas.ts` and read the first ~80 lines and any route that takes `:siteId` to understand auth + ownership checks.

- [ ] **Step 2: Write the sections router**

```typescript
// src/routes/api/sections.ts
//
// Owner-facing endpoints for cross-template section reuse.
// - GET  /api/templates/sections — public-to-owners catalog from all template seeds.
// - POST /api/sites/:siteId/sections/import — clone a section from a template
//   seed into the owner's site at a chosen slot, materialising seed media.

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { customer, site, siteAsset } from '../../db/schema.js';
import { SECTION_CATALOG } from '../../templates/section-catalog.js';
import { allTemplateSeeds } from '../../templates/registry.js';
import { importSectionIntoSite } from '../../canvas/section-import.js';
import { validateEditableSite } from '../../canvas/validate.js';
import type { EditableSite } from '../../canvas/schema.js';
import type { AppEnv } from '../../index.js';

const sections = new Hono<AppEnv>();

sections.get('/templates/sections', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  return c.json({ sections: SECTION_CATALOG });
});

interface ImportBody {
  templateId: string;
  sectionId: string;
  insertAt: number;
}

function parseImportBody(
  value: unknown,
): { ok: true; body: ImportBody } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'body must be an object' };
  const v = value as Record<string, unknown>;
  if (typeof v.templateId !== 'string' || v.templateId.length === 0) {
    return { ok: false, error: 'templateId is required' };
  }
  if (typeof v.sectionId !== 'string' || v.sectionId.length === 0) {
    return { ok: false, error: 'sectionId is required' };
  }
  if (typeof v.insertAt !== 'number' || !Number.isInteger(v.insertAt) || v.insertAt < 0) {
    return { ok: false, error: 'insertAt must be a non-negative integer' };
  }
  return {
    ok: true,
    body: {
      templateId: v.templateId,
      sectionId: v.sectionId,
      insertAt: v.insertAt,
    },
  };
}

sections.post('/sites/:siteId/sections/import', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  const siteId = c.req.param('siteId');
  const raw = await c.req.json().catch(() => null);
  const parsed = parseImportBody(raw);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }
  const { templateId, sectionId, insertAt } = parsed.body;

  const seed = allTemplateSeeds.find((t) => t.id === templateId);
  if (!seed) {
    return c.json({ error: `unknown templateId: ${templateId}` }, 404);
  }
  const sourceSection = seed.state.pages[0]?.sections.find((s) => s.id === sectionId);
  if (!sourceSection) {
    return c.json({ error: `unknown sectionId in template: ${sectionId}` }, 404);
  }

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return c.json({ error: 'no customer row for current user' }, 409);
  }

  const siteRow = await database
    .select({
      id: site.id,
      customerId: site.customerId,
      editableState: site.editableState,
    })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1);
  const siteRecord = siteRow[0];
  if (!siteRecord) {
    return c.json({ error: 'site not found' }, 404);
  }
  if (siteRecord.customerId !== customerId) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const state = siteRecord.editableState as EditableSite;
  const page = state.pages[0];
  if (!page) {
    return c.json({ error: 'site editable state has no page' }, 500);
  }
  if (insertAt > page.sections.length) {
    return c.json(
      { error: `insertAt ${insertAt} exceeds section count ${page.sections.length}` },
      400,
    );
  }

  const existingAssetRows = await database
    .select({ id: siteAsset.id })
    .from(siteAsset)
    .where(eq(siteAsset.siteId, siteId));
  const existingAssetIds = new Set(existingAssetRows.map((r) => r.id));

  const importResult = importSectionIntoSite({
    targetSiteId: siteId,
    sourceSection,
    existingAssetIds,
  });
  if (!importResult.ok) {
    return c.json({ error: 'section import failed', details: importResult.errors }, 500);
  }

  page.sections.splice(insertAt, 0, importResult.section);

  const validation = validateEditableSite(state);
  if (!validation.valid) {
    return c.json(
      { error: 'imported section produced invalid state', details: validation.errors },
      500,
    );
  }

  const siteUpdate = database.update(site).set({ editableState: state }).where(eq(site.id, siteId));
  if (importResult.newAssetRows.length === 0) {
    await siteUpdate;
  } else {
    const assetInsert = database.insert(siteAsset).values(importResult.newAssetRows);
    await database.batch([siteUpdate, assetInsert]);
  }

  return c.json({ editableState: state });
});

export default sections;
```

- [ ] **Step 3: Mount the router in src/index.ts**

Locate the section of `src/index.ts` where existing routers are mounted (e.g. `app.route('/api/sites', sites)` and `app.route('/api/canvas', canvas)`). Add immediately after them:

```typescript
import sections from './routes/api/sections.js';
// ...
app.route('/api', sections);
```

The internal routes are `/templates/sections` and `/sites/:siteId/sections/import`, so mounting at `/api` yields the URLs documented in the API contracts above.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `AppEnv` is not exported from `src/index.ts`, export it (or import the existing app `Env` type from wherever the canvas router imports it — match that pattern).

- [ ] **Step 5: Manual endpoint sanity check via dev server**

Run: `npm run dev`
In a second terminal, with an authenticated session cookie copied from the browser:

```bash
curl -s http://localhost:8787/api/templates/sections -H "Cookie: <session-cookie>" | head -c 500
```

Expected: JSON `{ "sections": [...] }` with non-empty array. If 401, the session cookie path is wrong; check `npm run dev` output for the Clerk dev origin.

Stop the dev server (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/sections.ts src/index.ts
git commit -m "feat: add sections catalog and import API endpoints"
```

---

### Task 4: Sidebar tab switcher infra

**Files:**

- Modify: `src/editor/canvas-index.tsx`
- Modify: `src/editor/canvas-client.ts`
- Modify: `src/editor/canvas-styles.ts`

- [ ] **Step 1: Convert single-tab markup to a real tablist with two tabs (Sections panel content is a stub)**

In `src/editor/canvas-index.tsx`, replace the block from line 136 to line 218 (the `.rev01-sidebar-tabs` div and the `.rev01-sidebar-panel` div) with:

```tsx
<div class="rev01-sidebar-tabs" role="tablist" aria-label="Canvas tools">
  <button
    type="button"
    class="active"
    role="tab"
    aria-selected="true"
    data-sidebar-tab="add"
  >
    Add
  </button>
  <button
    type="button"
    role="tab"
    aria-selected="false"
    data-sidebar-tab="sections"
  >
    Sections
  </button>
</div>
<div
  class="rev01-sidebar-panel"
  role="tabpanel"
  aria-label="Add"
  data-sidebar-panel="add"
>
  {/* keep all existing Add-panel groups (Sections / Components / Colors / selection) here unchanged */}
  <section class="rev01-sidebar-group">
    <h2>Sections</h2>
    <button
      type="button"
      class="rev01-sidebar-command"
      data-sidebar-add-section="blank"
    >
      Blank section
    </button>
  </section>
  {/* ... Components, Colors, selection groups — unchanged ... */}
</div>
<div
  class="rev01-sidebar-panel"
  role="tabpanel"
  aria-label="Sections"
  data-sidebar-panel="sections"
  hidden
>
  <div class="rev01-section-picker" data-section-picker-root>
    <p class="rev01-section-picker-empty">Loading sections…</p>
  </div>
</div>
```

(Preserve every existing Add-panel inner element exactly as it was — only the wrapping tab/panel shell changes.)

- [ ] **Step 2: Add tab switcher styles**

In `src/editor/canvas-styles.ts`, append to the existing styles object/template literal:

```css
.rev01-sidebar-panel[hidden] {
  display: none;
}
.rev01-section-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.rev01-section-picker-empty {
  color: var(--muted);
  font-size: 13px;
}
```

(If `.rev01-sidebar-panel[hidden]` already exists at line ~182 from prior recon, keep just the new picker rules.)

- [ ] **Step 3: Add the tab switcher in canvas-client.ts**

In `src/editor/canvas-client.ts`, immediately above the existing `attachSidebarActions()` function, add:

```javascript
function attachSidebarTabs() {
  const tabButtons = Array.from(document.querySelectorAll('[data-sidebar-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-sidebar-panel]'));
  if (tabButtons.length === 0 || panels.length === 0) return;

  function activate(tabName) {
    for (const button of tabButtons) {
      const isActive = button.getAttribute('data-sidebar-tab') === tabName;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    for (const panel of panels) {
      const isActive = panel.getAttribute('data-sidebar-panel') === tabName;
      if (isActive) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }
    if (tabName === 'sections') {
      ensureSectionsPanelLoaded();
    }
  }

  for (const button of tabButtons) {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-sidebar-tab');
      if (tabName) activate(tabName);
    });
  }
}
```

Note: `ensureSectionsPanelLoaded()` is added in Task 5; for now stub it as:

```javascript
function ensureSectionsPanelLoaded() {
  // Populated in Task 5.
}
```

Wire `attachSidebarTabs()` into the existing `init()` flow next to `attachSidebarActions()`. Find the line `attachSidebarActions();` near line 2997 and add immediately above it:

```javascript
attachSidebarTabs();
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual click-through in browser**

Run: `npm run dev`
Open the editor for an existing site in a browser. Click "Sections" tab. Confirm:

- "Sections" tab gains highlight, "Add" loses it.
- The Add panel hides; the Sections panel shows "Loading sections…".
- Clicking "Add" reverses it.

Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add src/editor/canvas-index.tsx src/editor/canvas-client.ts src/editor/canvas-styles.ts
git commit -m "feat: add sidebar tablist with stub Sections tab"
```

---

### Task 5: Sections picker UI — fetch and render catalog

**Files:**

- Modify: `src/editor/canvas-client.ts`
- Modify: `src/editor/canvas-styles.ts`

- [ ] **Step 1: Add catalog state and fetch logic in canvas-client.ts**

Above `attachSidebarTabs()`, add:

```javascript
let sectionsCatalog = null; // null = unloaded, [] = loaded-empty, [...] = loaded
let pendingImport = null; // { templateId, sectionId, templateName } when in placement mode
let activeTemplateFilter = 'all';
let activeSearchQuery = '';

async function ensureSectionsPanelLoaded() {
  const root = document.querySelector('[data-section-picker-root]');
  if (!root) return;
  if (sectionsCatalog === null) {
    try {
      const response = await authFetch('/api/templates/sections');
      if (!response.ok) {
        root.innerHTML = '<p class="rev01-section-picker-empty">Failed to load sections.</p>';
        return;
      }
      const body = await response.json();
      sectionsCatalog = Array.isArray(body && body.sections) ? body.sections : [];
    } catch (err) {
      root.innerHTML = '<p class="rev01-section-picker-empty">Failed to load sections.</p>';
      return;
    }
  }
  renderSectionsPanel();
}

function renderSectionsPanel() {
  const root = document.querySelector('[data-section-picker-root]');
  if (!root || sectionsCatalog === null) return;

  const templateIds = Array.from(new Set(sectionsCatalog.map((e) => e.templateId)));
  const templateNames = new Map(sectionsCatalog.map((e) => [e.templateId, e.templateName]));

  const filtered = sectionsCatalog.filter((entry) => {
    if (activeTemplateFilter !== 'all' && entry.templateId !== activeTemplateFilter) return false;
    if (activeSearchQuery.length > 0) {
      const haystack = (
        entry.sectionName +
        ' ' +
        entry.headingPreview +
        ' ' +
        entry.templateName
      ).toLowerCase();
      if (!haystack.includes(activeSearchQuery.toLowerCase())) return false;
    }
    return true;
  });

  const filterOptions = ['<option value="all">All templates</option>']
    .concat(
      templateIds.map(
        (id) =>
          `<option value="${escapeAttr(id)}">${escapeHtml(templateNames.get(id) || id)}</option>`,
      ),
    )
    .join('');

  const cards = filtered
    .map((entry) => {
      const isPending =
        pendingImport &&
        pendingImport.templateId === entry.templateId &&
        pendingImport.sectionId === entry.sectionId;
      return `
      <li class="rev01-section-card${isPending ? ' is-pending' : ''}">
        <div class="rev01-section-card-head">
          <span class="rev01-section-card-name">${escapeHtml(entry.sectionName)}</span>
          <span class="rev01-section-card-recipe">${escapeHtml(entry.recipeId)}</span>
        </div>
        <p class="rev01-section-card-preview">${escapeHtml(entry.headingPreview)}</p>
        <div class="rev01-section-card-foot">
          <span class="rev01-section-card-template">${escapeHtml(entry.templateName)}</span>
          <button
            type="button"
            class="rev01-section-card-use"
            data-section-card-use
            data-template-id="${escapeAttr(entry.templateId)}"
            data-section-id="${escapeAttr(entry.sectionId)}"
            data-template-name="${escapeAttr(entry.templateName)}"
          >${isPending ? 'Cancel' : 'Use'}</button>
        </div>
      </li>
    `;
    })
    .join('');

  root.innerHTML = `
    <div class="rev01-section-picker-controls">
      <input
        type="search"
        class="rev01-section-picker-search"
        placeholder="Search sections"
        value="${escapeAttr(activeSearchQuery)}"
        data-section-picker-search
      />
      <select class="rev01-section-picker-filter" data-section-picker-filter>
        ${filterOptions}
      </select>
    </div>
    ${
      filtered.length === 0
        ? '<p class="rev01-section-picker-empty">No sections match.</p>'
        : `<ul class="rev01-section-picker-grid">${cards}</ul>`
    }
  `;

  const filter = root.querySelector('[data-section-picker-filter]');
  if (filter) {
    filter.value = activeTemplateFilter;
    filter.addEventListener('change', () => {
      activeTemplateFilter = filter.value;
      renderSectionsPanel();
    });
  }
  const search = root.querySelector('[data-section-picker-search]');
  if (search) {
    search.addEventListener('input', () => {
      activeSearchQuery = search.value;
      renderSectionsPanel();
    });
  }
  for (const button of root.querySelectorAll('[data-section-card-use]')) {
    button.addEventListener('click', () => {
      const templateId = button.getAttribute('data-template-id') || '';
      const sectionId = button.getAttribute('data-section-id') || '';
      const templateName = button.getAttribute('data-template-name') || '';
      if (
        pendingImport &&
        pendingImport.templateId === templateId &&
        pendingImport.sectionId === sectionId
      ) {
        exitPlacementMode();
      } else {
        enterPlacementMode({ templateId, sectionId, templateName });
      }
    });
  }
}
```

If `authFetch`, `escapeHtml`, and `escapeAttr` are not already available at this scope in `canvas-client.ts`, locate the existing helpers (search the file for `function authFetch`, `function escapeHtml`, `function escapeAttr`) and ensure the new code sits in the same module scope.

- [ ] **Step 2: Stub the placement-mode functions**

Add immediately after the `renderSectionsPanel` function:

```javascript
function enterPlacementMode(target) {
  pendingImport = target;
  setStatus(`Click a slot to insert "${target.templateName}" section`, 'info');
  renderSectionsPanel();
  renderPlacementSlots(); // implemented in Task 6
}

function exitPlacementMode() {
  pendingImport = null;
  setStatus('Cancelled', 'info');
  renderSectionsPanel();
  renderPlacementSlots(); // implemented in Task 6
}

function renderPlacementSlots() {
  // Implemented in Task 6.
}
```

If `setStatus` does not accept `'info'` as a kind, fall back to `setStatus('...', 'ok')` and adjust the call sites accordingly — match the existing API.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. If ESLint complains about unused variables for the placeholder `renderPlacementSlots`, add an inline `// eslint-disable-next-line @typescript-eslint/no-unused-vars` _only_ for that line, or implement Task 6 directly afterwards.

- [ ] **Step 4: Manual smoke in browser**

Run: `npm run dev`

- Open editor for a site. Click "Sections" tab.
- Confirm: cards render with names, recipe pills, template labels, and "Use" buttons.
- Type into search: list filters.
- Change template filter: list filters.
- Click "Use" on a card: button text changes to "Cancel", status bar shows the pending message.
- Click "Cancel": clears the pending state.

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/editor/canvas-client.ts src/editor/canvas-styles.ts
git commit -m "feat: render sections picker grid with search and template filter"
```

---

### Task 6: Placement-mode drop slots and import POST

**Files:**

- Modify: `src/editor/canvas-client.ts`
- Modify: `src/editor/canvas-styles.ts`

- [ ] **Step 1: Add placement-slot CSS**

In `src/editor/canvas-styles.ts`, append:

```css
.rev01-section-slot {
  display: block;
  width: 100%;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 1px dashed var(--accent);
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 120ms ease,
    background-color 120ms ease;
}
.rev01-section-slot:hover,
.rev01-section-slot:focus-visible {
  opacity: 1;
  background-color: var(--accent-soft);
}
body[data-placement-active='true'] .rev01-section-slot {
  opacity: 1;
}
.rev01-section-card.is-pending .rev01-section-card-use {
  background-color: var(--accent);
  color: var(--accent-text);
}
```

If `--accent-soft` or `--accent-text` is not a defined token, substitute existing tokens that approximate (read `src/canvas/style-kits.ts` to confirm names).

- [ ] **Step 2: Implement renderPlacementSlots()**

Replace the stub `renderPlacementSlots()` in `canvas-client.ts` with:

```javascript
function renderPlacementSlots() {
  const canvasRoot = document.getElementById('canvas-root');
  if (!canvasRoot) return;

  for (const existing of canvasRoot.querySelectorAll('.rev01-section-slot')) {
    existing.remove();
  }

  if (!pendingImport) {
    document.body.removeAttribute('data-placement-active');
    return;
  }
  document.body.setAttribute('data-placement-active', 'true');

  const page = state && state.pages ? state.pages[0] : null;
  if (!page) return;
  const sections = Array.isArray(page.sections) ? page.sections : [];

  function makeSlot(insertAt) {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'rev01-section-slot';
    slot.setAttribute('data-slot-index', String(insertAt));
    slot.setAttribute('aria-label', `Insert section here (position ${insertAt})`);
    slot.textContent = '+ Insert here';
    slot.addEventListener('click', () => {
      importPendingSectionAt(insertAt);
    });
    return slot;
  }

  // Slot before the first section
  if (sections.length === 0) {
    canvasRoot.appendChild(makeSlot(0));
    return;
  }
  const sectionNodes = Array.from(canvasRoot.querySelectorAll('[data-section-id]'));
  for (let i = 0; i < sectionNodes.length; i += 1) {
    const node = sectionNodes[i];
    node.parentNode.insertBefore(makeSlot(i), node);
  }
  const lastNode = sectionNodes[sectionNodes.length - 1];
  if (lastNode && lastNode.parentNode) {
    if (lastNode.nextSibling) {
      lastNode.parentNode.insertBefore(makeSlot(sections.length), lastNode.nextSibling);
    } else {
      lastNode.parentNode.appendChild(makeSlot(sections.length));
    }
  }
}

async function importPendingSectionAt(insertAt) {
  if (!pendingImport) return;
  const target = pendingImport;
  setStatus('Inserting section…', 'info');
  try {
    const response = await authFetch(`/api/sites/${SITE_ID}/sections/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: target.templateId,
        sectionId: target.sectionId,
        insertAt,
      }),
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json();
        if (body && body.error) detail = body.error;
      } catch (_) {
        /* ignore */
      }
      setStatus(`Insert failed: ${detail}`, 'error');
      return;
    }
    const body = await response.json();
    if (!body || typeof body !== 'object' || !body.editableState) {
      setStatus('Insert failed: malformed server response', 'error');
      return;
    }
    state = body.editableState;
    selectedSectionId = null;
    selectedElementId = null;
    pendingImport = null;
    if (mainEl && state && state.styleKit) {
      mainEl.setAttribute('data-style-kit', state.styleKit);
    }
    renderAll();
    renderSectionsPanel();
    setStatus(`Inserted section from ${target.templateName}`, 'ok');
  } catch (err) {
    setStatus(`Insert failed: ${err && err.message ? err.message : String(err)}`, 'error');
  }
}
```

If `SITE_ID`, `state`, `selectedSectionId`, `selectedElementId`, `mainEl`, or `renderAll` are not in scope here, locate them in `canvas-client.ts` (they are referenced in the existing `applyPreview` code around line 2236) and ensure the new helpers are declared in the same module scope.

- [ ] **Step 3: Hook Escape key and click-outside to exit placement mode**

Find the existing global keydown handler in `canvas-client.ts` (search for `event.key === 'Escape'` — there should be at least one). Add an Escape branch:

```javascript
if (event.key === 'Escape' && pendingImport) {
  event.preventDefault();
  exitPlacementMode();
  return;
}
```

Place it ABOVE any other Escape handler so it takes priority while placement mode is active.

- [ ] **Step 4: Make renderAll() repaint slots if placement mode is active**

Find the existing `renderAll()` function. At its end, add:

```javascript
if (pendingImport) {
  renderPlacementSlots();
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: End-to-end manual test in browser**

Run: `npm run dev`

- Open editor for a site with at least 2 existing sections.
- Click "Sections" tab. Click "Use" on a card from a different template than the current site.
- Confirm: dashed slots appear above, between, and below sections.
- Click the slot between sections 1 and 2.
- Confirm:
  - Status bar shows "Inserted section from <templateName>".
  - The new section appears in the canvas at the chosen position.
  - The new section's images render (open DevTools Network tab, watch `/assets/<id>` requests succeed with 200).
  - The picker card's "Use" button is no longer in pending state.
- Click "Use" again, then press Escape.
- Confirm: slots disappear; status bar shows "Cancelled".

Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add src/editor/canvas-client.ts src/editor/canvas-styles.ts
git commit -m "feat: add placement-mode drop slots and section import POST"
```

---

### Task 7: Cross-cutting verification

**Files:**

- Run only — no edits unless issues surface.

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Format check**

Run: `npm run format:check`
Expected: no errors. If formatting drift exists, run `npm run format` and amend the most recent commit only if it is local (do not amend pushed commits).

- [ ] **Step 4: Re-run section-import smoke**

Run: `bun.cmd run section-import:smoke`
Expected: prints `section-import smoke OK`.

- [ ] **Step 5: Re-run canvas smoke**

Run: `npm run canvas:smoke`
Expected: passes — the fixture validator and renderer were not touched, but this confirms no upstream regression.

- [ ] **Step 6: Build dry-run**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Manual cross-template regression in browser**

Run: `npm run dev`

- Create a fresh site from Template A (e.g. `starter-canvas`).
- Import a section from Template B (e.g. `enterprise-scale`).
- Confirm images render.
- Refresh the editor page. Confirm the imported section persists and still renders.
- Open the site's public address (the published-snapshot route). Confirm the imported section does NOT appear there (publish has not been triggered) — this is the expected behaviour: import only mutates `editableState`.
- Trigger the existing publish flow. Confirm the imported section now appears at the published address with images.

Stop dev server.

- [ ] **Step 8: Commit any format/lint follow-ups if needed**

```bash
# only if format:check or lint produced changes
git add -u
git commit -m "chore: format and lint follow-ups for section picker"
```

---

## Risks and Mitigations

**Risk 1: `SECTION_CATALOG` is built at module load and embedded into the Workers bundle. If `allTemplateSeeds` grows large, bundle size grows.**
Mitigation: At MVP scale (5 templates × ~7 sections), payload is < 5 KB. No mitigation needed. Revisit if templates exceed 20 or if seed bodies grow rich-text-heavy.

**Risk 2: The catalog ships the section _metadata only_, but the import endpoint accesses the full source section by looking it up in `allTemplateSeeds`. If a section is renamed or removed in code but a client has a stale catalog cached, the import fails with 404.**
Mitigation: Acceptable — fail loud, owner refreshes the page, client re-fetches catalog. Documented in the contract.

**Risk 3: `database.batch([siteUpdate, assetInsert])` semantics — Neon's batch is not a true SQL transaction. If the update succeeds and the insert fails, the site's `editableState` references asset IDs whose rows do not exist.**
Mitigation: The asset insert is `INSERT INTO siteAsset VALUES (...)` with unique IDs; the only realistic failure is a PK collision, which would mean the asset already exists — in which case our `existingAssetIds` filter should have excluded it. If a collision does happen anyway, the site state would have an asset ID matching an already-existing row, so the references still resolve. Document this in `section-import.ts` and add a follow-up issue if Neon batch atomicity becomes a real concern.

**Risk 4: Owner imports a section whose `recipeId` is not in the target site's expected set.**
Mitigation: `validateEditableSite` runs against the updated state before persisting. Any unknown recipe ID causes a 500 with details. Recipes are global ([src/canvas/recipes.ts:56-65](src/canvas/recipes.ts#L56-L65)), so this should not happen unless schemas drift.

**Risk 5: Two concurrent imports race — owner double-clicks "Use" twice.**
Mitigation: The endpoint reads the current `editableState` per request, so the second import sees the result of the first. Both succeed in order. The client's `setStatus('Inserting section…')` does not disable the slot, so the user may accidentally insert twice. Acceptable for MVP — the Owner can use the existing delete-section toolbar to remove duplicates.

---

## What's NOT Included

- Cross-site section import. Sections can only come from compiled template seeds.
- Reordering existing sections via drag.
- Owner-saved sections appearing in the catalog.
- Thumbnails. Cards are text-only.
- Multi-page support. The endpoint hardcodes `state.pages[0]` per the single-page POC invariant in `2026-05-22-canvas-first-poc.md`.
- Bulk import. One section per click.

---

## Self-Review Notes

- Spec coverage: every section in this plan (API, util, sidebar tabs, picker UI, placement mode) has a task. The asset-materialisation contract from the original investigation is realised in Task 1 + Task 3.
- Placeholder scan: no TBD/TODO/"add error handling" — every step shows the code or the exact command.
- Type consistency: `pendingImport` shape is identical in Tasks 5 and 6 (`{ templateId, sectionId, templateName }`); `ImportSectionResult` shape is consistent between Task 1 (definition) and Task 3 (consumer).
- `SECTION_CATALOG.length >= 5` assertion in Task 2 step 3 — confirms at least one section per template seed.
