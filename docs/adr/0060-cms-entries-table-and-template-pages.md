# ADR 0060: CMS-style entries live in a dedicated table; the canvas holds template pages, not individual entries

**Status:** Accepted
**Date:** 2026-06-04
**Decision driver:** Aayushman Singh (Owner)

## Context

Today, every blog post (or any other repeated content unit) is stored as a separate `CanvasPage` inside `EditableSite.pages[]`. The portfolio-showcase fixture ships four sample blog entries this way (`page-pf-post-*`). The editor's page list grows linearly with content: a site with fifty notes shows fifty pages on the canvas, each authored manually.

The `CollectionElement` already supports a `'page-bound'` mode with a `cardTemplate`, `fieldBindings`, `filter`, and `sort` — see `src/canvas/elements/collection.ts:29`. The schema for binding entries to page metadata exists, but the materializer that hydrates the `entries` array at render time is a documented no-op (`docs/superpowers/specs/2026-05-28-collection-element-design.md:15`).

The Owner's intent (recorded in this session) is that the editor canvas should show the **shape** of a blog — a single ghost page representing the entry template — and that real entries should be authored outside the canvas through a dashboard CRUD surface. After publish, real entries should hydrate the index page's collection and expand the template page into one concrete page per entry.

## Decision

1. **Entries live in a new `collection_entry` table**, not in `EditableSite.pages[]`.
   - Columns: `id`, `site_id` (FK), `collection_slug` (e.g. `"blog"`), `slug` (per-entry, unique within site+collection), `title`, `excerpt`, `body` (Markdown), `published_date`, `author`, `category`, `tags` (jsonb string array), `og_image_asset_id`, `status` (`'draft' | 'published'`), `created_at`, `updated_at`.
   - Indexed on `(site_id, collection_slug, published_date desc)` for listing and on `(site_id, collection_slug, slug)` unique for slug resolution.
   - Cascade-deleted with the site.

2. **`CanvasPage` gains two optional fields** to mark template pages:
   - `pageKind?: 'collection-index' | 'collection-item-template'`
   - `collectionSlug?: string` — required when `pageKind` is set, names the collection this page binds to (e.g. `"blog"`).
   - Absent fields = ordinary page. Validator rejects `collectionSlug` without `pageKind` and vice versa.

3. **The publish flow runs a `materializeCollections` pass** on the `EditableSite` before snapshot:
   - **Index pages** (`pageKind === 'collection-index'`): every `CollectionElement` with `mode: 'page-bound'` matching the page's `collectionSlug` gets its `entries[]` array populated by cloning `cardTemplate` once per matching entry and substituting `{{title}}`, `{{excerpt}}`, `{{publishedDate}}`, etc. per `fieldBindings`.
   - **Template pages** (`pageKind === 'collection-item-template'`): the page is cloned once per published entry in its collection. Each clone gets a fresh `id`, slug `<collectionSlug>/<entry.slug>`, page metadata pulled from the entry row, and any text/media element marked with `data-collection-field="<field>"` substituted with the entry's value.
   - Draft entries (`status: 'draft'`) are excluded.
   - The function is pure: `(EditableSite, CollectionEntry[]) → EditableSite`. The original is not mutated.

4. **A "Entries" tab is added to the per-site dashboard sidebar** between Forms and Versions.
   - Lists collections (derived from `collection_slug` distinct values in this site's entries, plus any template/index pages in `EditableSite`).
   - Per-collection list view: title, status pill, published date, slug, edit/delete actions.
   - Create/edit form: title, slug, excerpt, Markdown body, published date, author, category, tags (comma-separated), status toggle.
   - All writes go through `/api/sites/:siteId/entries/...` REST endpoints owned by the same Owner-auth boundary as existing dashboard surfaces.

5. **The editor does not know about entries.** It edits `pages[]` only. The materialization happens server-side at publish.

## Shared types (contract for parallel implementation)

```ts
// src/db/schema.ts — added to existing file
export const COLLECTION_ENTRY_STATUSES = ['draft', 'published'] as const;
export type CollectionEntryStatus = (typeof COLLECTION_ENTRY_STATUSES)[number];

// Drizzle row type — equivalent shape used by API + dashboard + materializer:
// id, siteId, collectionSlug, slug, title, excerpt, body, publishedDate (string ISO date),
// author, category, tags (string[]), ogImageAssetId (string | null),
// status: CollectionEntryStatus, createdAt, updatedAt.
```

```ts
// src/canvas/schema.ts — added to CanvasPage
pageKind?: 'collection-index' | 'collection-item-template';
collectionSlug?: string;
```

```ts
// src/canvas/elements/collection-materializer.ts — new module
export interface MaterializerEntry {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  publishedDate: string;
  author: string;
  category: string;
  tags: string[];
  ogImageAssetId: string | null;
}
export function materializeCollections(
  site: EditableSite,
  entries: MaterializerEntry[],
): EditableSite;
```

```
REST endpoints (Clerk-auth, scoped to siteId the Owner owns or collaborates on):
GET    /api/sites/:siteId/entries                       → CollectionEntry[]
GET    /api/sites/:siteId/entries?collection=blog       → CollectionEntry[] filtered
POST   /api/sites/:siteId/entries                       → create; body = {collectionSlug, slug, title, excerpt, body, publishedDate, author, category, tags, ogImageAssetId?, status}
GET    /api/sites/:siteId/entries/:entryId              → CollectionEntry
PATCH  /api/sites/:siteId/entries/:entryId              → partial update of the above
DELETE /api/sites/:siteId/entries/:entryId              → 204
```

## Consequences

- The portfolio-showcase fixture's four blog post pages remain in `pages[]` for now and continue to work — they predate this ADR. New templates ship with a single `collection-item-template` page plus a `collection-index` page, and the dashboard "Entries" tab is the only way to add content. A follow-up ADR will migrate the fixture, but this is not a blocker for shipping the feature.
- The publish flow gains a deterministic, pure materialization pass. The Yjs co-edit model is unaffected — entries are not Yjs-tracked; concurrent edits to the same entry are last-writer-wins by `updated_at`.
- The Owner experience changes: adding a blog post no longer means "add a new page to the canvas." It means "open the Entries tab and write." The canvas is for shape; the table is for content.
- No third-party CMS is added. Hosting, auth, and access control all reuse the existing dashboard infrastructure (Clerk + collaborator role gate).

## Non-goals

- Rich-text editing inside the entry form (Markdown only; rendering is via the same Markdown→HTML the rest of the site uses, deferred to the renderer follow-up).
- Multi-locale entries (one row = one locale; locale lives on the template page).
- Programmatic webhook delivery on entry create.
- Migrating the portfolio-showcase fixture entries — handled by a follow-up ADR.

## Follow-ups

- Add a renderer pass that converts entry body Markdown into safe HTML at materialization time.
- Add a fixture-migration ADR that flips portfolio-showcase from page-stored entries to template-page + entries-table.
- Add OG image-by-entry support once OG generation is reworked (currently per-page; entries will inherit until then).
