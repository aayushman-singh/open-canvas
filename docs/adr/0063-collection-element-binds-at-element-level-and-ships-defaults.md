# ADR 0063: Collection element binds at element level, ships visible defaults, and groups entries by folder

**Status:** Accepted
**Date:** 2026-06-05
**Decision driver:** Aayushman Singh (Owner)

## Context

Today the Collection element is unusable in the editor.

Concretely:
- Dropping a Collection on a page yields an invisible-or-empty element. No placeholder cards, no obvious affordance.
- The right inspector shows only generic Style controls (background, opacity, border) — none of the source/sort/display controls a Collection needs.
- Source binding is **not on the element**. `CollectionElement` has no `collectionSlug` field ([src/canvas/elements/collection.ts:58](../../src/canvas/elements/collection.ts)). It auto-binds to the host page's `collectionSlug`, which is only present when the page's `pageKind = 'collection-index'` ([src/canvas/schema.ts:543](../../src/canvas/schema.ts)). Owners trying to add a Collection on a normal page have no working path.
- There is no Add-sidebar button for Collection ([[project-collection-add-sidebar-gap]]). It only appears via the page-creation scaffold.
- There is no card scaffold. Owners who reach a working Collection still see no per-entry layout unless they hand-author one.
- There is no way to group entries inside a single collection (e.g. "tech notes" vs "design notes" inside `blog`). Owners must either bloat tag taxonomy or fork into multiple collection slugs (and fork the dashboard tab too).
- There is no way to hand-curate entry order. Default ordering is implicit; manual control requires re-dating posts.

The Owner-perceived "done" is: drop a Collection on any page → see a grid of plausible cards immediately → pick a source from a dropdown in the inspector → optionally pick a folder and a sort → cards re-render → publish.

ADR 0060 introduced the `collection_entry` table and the page-level binding model. That model worked for the smallest case (one blog per site, one index page) and broke as soon as the surface widened. This ADR replaces the page-level binding model and ships the missing inspector and scaffolding surface.

## Decision

1. **Source binding moves from the page to the element.**
   `CollectionElement` gains:
   - `collectionSlug: string` — required; names the `collection_entry.collection_slug` to pull from.
   - `folder?: string` — optional; filters to entries whose `folder` column matches. Absent = all entries in the slug.
   - `sort: 'date-desc' | 'date-asc' | 'manual'` — required; default `'date-desc'` on insert.
   - `manualOrder?: string[]` — present only when `sort === 'manual'`; ordered list of `collection_entry.id` values.

   **Why.** Page-level binding means one page = one source. Owners with realistic homepages want "Latest blog" + "Recent case studies" + "Featured projects" as three Collections on one page. The page-as-binding-unit model can't express that. Moving the binding to the element makes Collections composable across the page surface. The cost is that `collectionSlug` becomes a per-element validated field, but the validator and registry plumbing already exist (ADR 0011).

   **Failure path.** If `collectionSlug` references a slug with no entries at publish time, the materializer emits zero cards and the publish report includes a warning line `"Collection element <id> on page <slug> matched 0 entries (source=<slug>, folder=<folder>)."` No fallback content, no silent skip — the Owner is told.

2. **`CanvasPage.pageKind = 'collection-index'` is retired. `'collection-item-template'` stays.**
   Index pages existed solely to carry the page-level `collectionSlug`. After decision 1, the field has no purpose on index pages. Template pages still need the binding because the publish-time clone-per-entry pass keys on the page's slug ([src/canvas/elements/collection-materializer.ts:414](../../src/canvas/elements/collection-materializer.ts)).

   **Migration.** A one-shot transform runs against `EditableSite` on first load post-migration: any page with `pageKind === 'collection-index'` and exactly one `CollectionElement` copies the page's `collectionSlug` onto that element with `sort: 'date-desc'`, `display: 'card'`, then clears the page's `pageKind` and `collectionSlug`. Pages with zero or multiple Collections retain the fields and surface a one-time editor banner telling the Owner to set the slug on each Collection manually. Validator from this ADR onward rejects new pages with `pageKind === 'collection-index'`.

   **Why.** Three reinforcing reasons; any one would justify retirement, the combination makes it obvious.

   1. *No remaining consumer.* After decision 1, every reader of `pageKind === 'collection-index'` is asking a question the Collection element already answers. The page-level field carries no information not already on the element. Pages whose only Collection element binds to slug `X` are functionally identical whether or not the page also declares `pageKind = 'collection-index'` with `collectionSlug = X`.

   2. *Ambiguity if kept.* If a page declares `pageKind = 'collection-index'` with `collectionSlug = 'blog'` but its Collection element binds to `collectionSlug = 'case-studies'`, the system has two contradictory sources of truth for "what does this page list." Either the page wins (and the element's slug is a lie), or the element wins (and the page's slug is decorative). Neither is defensible. Single source of truth eliminates the question.

   3. *Composability cost.* The page-kind union is a closed enum read by the validator, page-inspector dispatch ([src/editor-client/page-inspector.ts:757](../../src/editor-client/page-inspector.ts)), render path, and any future page-kind-aware code. Every value in that union is a branch in those tables. Carrying `'collection-index'` forward means every future contributor pays the cost of "what does this mean now?" Removing it makes the remaining `'collection-item-template'` value's purpose unambiguous — that page kind genuinely needs to exist because the *page itself* (not an element on it) is cloned per entry at publish time. The asymmetry is principled: kinds exist when the page is the unit of behaviour, not when an element on it is.

   Migrating in place (rather than leaving the field as a deprecated alias) avoids two-state code paths in the materializer and forces the discomfort to resolve in one commit rather than bleeding across releases.

3. **No new `Card` primitive. `Container` gains an optional `preset` field.**
   `ContainerElement` gains `preset?: 'card'`. The materializer recognises `preset === 'card'` Containers inside (or as the children of) a Collection as card-template hints. No new element type, no new dispatch entries in the registry ([src/canvas/elements/index.ts](../../src/canvas/elements/index.ts)), no new validator branch, no new Yjs projection ([src/canvas/yjs/](../../src/canvas/yjs/)), no new inspector spec, no new sidebar entry.

   **Why.** A Card is a Container with a known internal layout (image + title + excerpt + CTA) and a known click behaviour (whole surface links). It is not a new behaviour at the canvas level — Containers already link via `linkHref` ([src/canvas/elements/container.ts:26](../../src/canvas/elements/container.ts)). Per ADR 0057's dispatch-shape uniformity, every new element type costs a branch in seven dispatch tables; a preset costs one materializer if-statement. The behaviour earned a marker, not a primitive.

4. **`CollectionElement.display` is a discriminated union: `'image-only' | 'card'` (this ADR), `'custom'` (follow-up).**
   - `'image-only'`: materializer renders `<img src="...{{ogImageAssetId}}..." alt="{{title}}">` per entry inside the Collection's frame, wrapped in an `<a href="/<collectionSlug>/{{slug}}">`. No template required.
   - `'card'` (default on insert): materializer clones a **built-in default card template** per entry. The default template is a Container (`preset: 'card'`) containing an Image bound to `{{ogImageAssetId}}`, a Text element bound to `{{title}}`, a Text element bound to `{{excerpt}}`, and a Button bound to "Read more" with href `/<collectionSlug>/{{slug}}`. The default template lives in the canvas constants module ([src/canvas/elements/collection-defaults.ts](../../src/canvas/elements/collection-defaults.ts), new file) and is loaded by the materializer, not stored on each Collection.
   - `'custom'`: **deferred to a follow-up ADR (F1)**. The materializer clones the Collection's own child elements (treated as the template) per entry instead of the built-in default. Editor UX (where the template editing happens, how the user toggles between "view rendered cards" and "edit the template") is its own decision cluster.

   **Why.** Most Collections are blogs in a grid. Shipping `'card'` as the default makes the empty-Collection-feels-broken problem go away with zero configuration. `'image-only'` covers galleries and reel-style strips. `'custom'` is a long-tail need and deserves its own UX pass.

5. **On insert, a Collection auto-renders three placeholder cards in the editor.**
   The placeholder data is canned (`title: 'Sample entry one'`, etc.) and lives in the editor-only render path ([src/editor-client/collection-preview.ts](../../src/editor-client/collection-preview.ts), new file). Placeholders render iff `collectionSlug` is undefined OR resolves to zero entries. Above the placeholder grid, the editor renders a non-publishable banner: `"Placeholder cards — add entries to see real content. Source: <slug or 'unset'>."` Banner is editor-DOM only; the publish renderer never emits it.

   **Why.** An empty Collection element is visually indistinguishable from "nothing was added." The Owner must see *some* card shape immediately to recognise what they just dropped, understand the layout, and discover the inspector controls.

   **Failure path.** At publish time, zero-entry Collections render zero cards — no placeholders leak to visitors. The publish warning from decision 1 is the Owner's signal.

6. **Clicks on rendered card content select the parent Collection, not the per-entry instances.**
   In `'card'` and `'image-only'` modes, the per-entry instances are materializer output, not authorable elements. Click-handling code ([src/editor-client/selection.ts](../../src/editor-client/selection.ts)) walks up from the clicked DOM node and selects the nearest ancestor with `data-element-type="collection"`. The `'custom'` mode (F1) inverts this — clicks inside the card template subtree select the template element, since those edits are authoritative.

   **Why.** Letting Owners click into materialized DOM and "edit" it produces silent surprises: their edits get overwritten on next publish. The cleanest model is "you cannot author what the materializer authors." Mirrors Carousel slide behaviour today ([src/canvas/elements/carousel.ts](../../src/canvas/elements/carousel.ts)) where slides are list items, not nested editable elements.

7. **`collection_entry` gains a `folder` column.**
   - Type: `text NULL`, max 64 chars, no path separators (`/`, `\`), case-sensitive.
   - Validation enforced at the API write boundary (`POST/PATCH /api/sites/:siteId/entries`).
   - Index: `(site_id, collection_slug, folder, published_date desc)` for filtered listing.
   - Dashboard `Entries` tab gains: a `Folder` text input on the entry form, a `Folder` column in the list view, and a folder filter chip row above the list.
   - Collection inspector source picker is two-step: slug dropdown, then folder dropdown (populated from distinct folder values within the selected slug).

   **Why.** Owners want sub-grouping inside one slug without forking into multiple slugs (which would also fork dashboard tabs and lose "all blog entries" as a navigable view). A free-text column is one drizzle migration with no entity model. A full `collection_group` table would be four migrations (groups table, FK, dashboard CRUD, materializer rewrite) and is unjustified until folder usage demonstrates demand for ordering, descriptions, or per-folder permissions.

   **Failure path.** Folder filter referencing a folder with no matching entries → renders empty, with the same publish warning shape from decision 1.

8. **Manual ordering UI is a list-reel in the Collection inspector.**
   When `sort === 'manual'`, the inspector renders a vertical list: each row = `[thumbnail, title, drag handle]` for one entry. Drag reorders. Order persists as `manualOrder: string[]` of entry IDs on the Collection element. Entries added to the source after the manualOrder was last set get appended at the end at materialization time. Removed entries are stripped from `manualOrder` lazily on the next inspector render.

   **Why.** Date is the right default (blogs, news, anything chronological). Manual exists for hand-curated landing-page strips ("Featured 5"). `'random'` is deliberately excluded — random destroys SEO signals and confuses repeat visitors. The reel pattern mirrors the existing Carousel slide-list ordering UX, so Owners encounter one inline-reorder idiom across the editor, not two.

9. **Collection element gains an Add-sidebar button.**
   Group: `Components`, label: `Collection`, placed between `Carousel` and `Table`. Click inserts a Collection with `display: 'card'`, `sort: 'date-desc'`, `collectionSlug: undefined`. The inspector immediately surfaces an inline prompt: `"Pick a source to bind this collection."`

   **Why.** Closes the [[project-collection-add-sidebar-gap]] discoverability hole. Element-level binding (decision 1) makes element-level insertion the right primitive — there's nothing magical about page-creation scaffolding anymore.

10. **"Manage entries →" affordance moves to the Collection inspector.**
    Previously the banner rendered on `collection-index` pages via the page-inspector ([src/editor-client/page-inspector.ts:854](../../src/editor-client/page-inspector.ts)). After decision 2 it has no home there. Relocate it to the Collection's element inspector as a link reading `Manage entries in <slug>[/<folder>] →`, opening `/dashboard/sites/:siteId/entries?collection=<slug>[&folder=<folder>]`.

    **Why.** The affordance follows the binding. The Owner thinks about the Collection element when they want to add entries to it; that's the right surface for the link.

11. **The "+ New Collection" wizard provisions a working end-to-end blog in one click.**
    Clicking `+ New Collection` (the existing entry point shipped under [ADR 0060 F3](0060-cms-entries-table-and-template-pages.md#L143), located in the editor's Pages sidebar) does the following atomically:

    a. **Slug.** Defaults to `'blog'`. If `'blog'` is already taken in this site, falls back to `'collection-1'`, `'collection-2'`, etc. The wizard surfaces the chosen slug in the prompt; the Owner can rename it before confirming. No empty-slug path.

    b. **Index page.** Creates a new `CanvasPage` (title: "Blog", slug: `'blog'` matching the collection slug) with a single Collection element pre-bound: `collectionSlug = <chosen>`, `display = 'card'`, `sort = 'date-desc'`, `folder = undefined`, no `manualOrder`. The Collection takes up a sensible viewport portion (full content-max-width, ~600px tall, grid layout). Page background and theme inherit the site defaults so the result feels native, not boilerplate.

    c. **Template page.** Creates a `CanvasPage` with `pageKind = 'collection-item-template'`, `collectionSlug = <chosen>`, slug `<chosen>/_template`. Pre-populated with a sensible per-entry article layout: hero image (`{{ogImageAssetId}}`), `<h1>{{title}}</h1>`, byline (`{{author}} · {{publishedDate}}`), body text bound to `{{body}}`. Owner can redesign this freely; it never appears in the public sitemap.

    d. **Seeded entries.** Inserts two real `collection_entry` rows: `"Welcome to your blog"` (body explains how to add posts and points at the Entries dashboard tab) and `"Your second post"` (placeholder body, deletable). Both are `status: 'published'`, dated today and yesterday respectively, no folder, no tags. They are real data, not synthetic — the Owner edits or deletes them like any other entry.

    e. **Navigation.** Editor switches the active page to the freshly-minted index. The Collection renders the two seeded entries as real cards immediately (no placeholder banner). Clicking either card in a preview window opens the working detail URL `/<slug>/welcome-to-your-blog` (or `/<slug>/your-second-post`), proving the end-to-end flow works without one configuration step.

    **Why.** The Owner's lived "done" for "I want a blog" is: *I see a working blog at a real URL right now, and I can start writing.* Every step of configuration friction between that intent and that outcome is friction the Owner did not sign up for. The current state-of-the-art (post-ADR 0060 F3) creates two empty pages and an empty source — the Owner then has to know to switch tabs, open the Entries dashboard, fill in a form, save, switch back, refresh — and only then sees something. Seeding real entries inverts the default: the Owner's first action is *deletion or editing*, not configuration. Both are direct, both are reversible, both teach the model by example.

    **Failure path.** If any sub-step fails (e.g. page creation succeeds but entry-insert fails), the whole wizard rolls back via a transaction at the API layer ([src/routes/api/sites.ts](../../src/routes/api/sites.ts) `+ New Collection` endpoint). No half-built blog. Failure surfaces as a dashboard toast with the failing step named — never a silent partial state.

    **Constraint.** Seeded content is real DB rows, never synthetic placeholders shown only in the editor. The Owner must be able to edit, delete, or re-date them with the same affordances as any other entry. Sample content that pretends to be real but isn't (e.g. JavaScript-rendered "demo" rows) is forbidden — Owners must never wonder why a row they see can't be edited.

## Shared types (contract for parallel implementation)

```ts
// src/canvas/elements/collection.ts — replaces the existing CollectionElement schema
export type CollectionDisplay = 'image-only' | 'card'; // 'custom' lands in F1

export interface CollectionElement extends CanvasElementBase {
  type: 'collection';
  collectionSlug: string | undefined;             // undefined = unbound; shows placeholders + prompt
  folder?: string;                                 // undefined = all entries in slug
  sort: 'date-desc' | 'date-asc' | 'manual';
  manualOrder?: string[];                          // entry IDs, present iff sort === 'manual'
  display: CollectionDisplay;
  // existing style + layout fields unchanged
}

// src/canvas/elements/container.ts — additive
export interface ContainerElement extends CanvasElementBase {
  type: 'container';
  preset?: 'card';                                 // additive; absence = ordinary container
  // existing fields unchanged
}

// src/canvas/schema.ts — change
// REMOVE: pageKind === 'collection-index' from the union (keep 'collection-item-template')
// KEEP: collectionSlug, required when pageKind === 'collection-item-template'

// src/db/schema.ts — collectionEntry additive
folder: text('folder'),                            // nullable; check constraint: length <= 64, no '/' '\'
```

```sql
-- drizzle migration 0017_collection_entry_folder.sql
ALTER TABLE "collection_entry" ADD COLUMN "folder" text;
CREATE INDEX "collection_entry_site_slug_folder_published_idx"
  ON "collection_entry" ("site_id", "collection_slug", "folder", "published_date" DESC);
```

```
REST endpoints (additive):
PATCH /api/sites/:siteId/entries/:entryId         body may include { folder?: string | null }
GET   /api/sites/:siteId/entries?collection=&folder=  filters by folder
```

## Out of scope

- `'custom'` display mode and the editor UX for editing the per-element card template (F1).
- Multi-source Collections (one element drawing from two slugs).
- Filter UI beyond `folder` + `sort` — no tag-based filtering, no date-range filtering, no `status` filtering in this pass.
- Pagination of Collection output at publish (assume render-all).
- `collection_group` as a first-class entity (folders are a free-text column).
- Migrating the portfolio-showcase fixture's blog pages to the new model (still tracked under ADR 0060 F2).
- Per-folder permissions, per-folder feeds, or per-folder dashboard sub-routes.

## Consequences

- Collection inspector is no longer empty. Source, folder, sort, manual reorder, and "Manage entries →" all live on the element where they belong.
- `pageKind === 'collection-index'` is a dead value. New pages cannot set it; existing pages are migrated in place on first load. Audit risk: any code path that grep-matches `'collection-index'` (search `pageKind`, `collection-index`, `collectionIndex`) must be checked and either updated or deleted.
- `Container.preset = 'card'` is a marker the materializer keys on. Owners can still freely use Containers without presets; only `preset === 'card'` containers participate in card defaulting. The marker is not a behaviour change for existing Containers — purely additive.
- The `folder` column is forward-compatible. Existing rows have `folder = NULL` and behave as "ungrouped." No data migration beyond adding the column.
- The manual-reorder list-reel is the first inline list-reorder pattern in the editor outside Carousel. Sets a precedent; F4 below considers extraction.
- Placeholders are editor-only DOM. Publish output is unaffected; the publish warning is the only visitor-facing signal that a Collection is empty.
- The materializer is the only writer of per-entry card DOM. Owners can never author per-entry content in `'card'` or `'image-only'` modes — clicks bubble to the Collection element. This is a deliberate constraint, not a limitation to work around.

## Failure modes (loud, per CLAUDE.md)

- `collectionSlug` references a non-existent or zero-entry slug → publish renders empty markup + warning line in the publish report; editor inspector shows `"0 entries match this source/folder"` inline.
- Migration encounters a `collection-index` page with multiple Collection elements → migration leaves the page untouched and surfaces a one-time editor banner: `"This page has multiple Collections — set the source on each one in the inspector."` No silent guess.
- `manualOrder` contains a stale entry ID (entry deleted from CMS) → materializer skips that ID and renders the rest in order; inspector strips stale IDs on next render. No fallback content.
- Folder value exceeds 64 chars or contains `/` `\` → API write rejected with 400 + explicit field error; never silently truncated.

## Follow-ups

### F1 — `'custom'` display mode and per-element template editing UX

**Decision space.** When `display === 'custom'`, the Collection's own children become the per-entry template (cloned + substituted). The interesting question is editor UX: where does the Owner edit that template? Three live options:

1. In-place: the editor renders ONE instance of the template (not the materialized grid) when the Collection is selected. Toggle between "preview rendered cards" and "edit template" via a button in the inspector. Familiar; one canvas, two modes.
2. Detail view: clicking "Edit template" opens a separate routed surface — the Collection collapses, the template fills the canvas like an open page. Cleanest separation; biggest navigation jump.
3. Floating panel: the template editor opens in a side panel over the canvas. Inspector controls live in the panel. Lowest navigation cost; busiest viewport.

**Touches.** Editor selection model, materializer (skip default-template fetch when `display === 'custom'`), inspector dispatch, possibly a new editor route, possibly the page model (does the template count as a "page" for Yjs purposes?).

**Why deferred.** The mode toggle is real UX design — wrong choice locks in friction for the long-tail use case that needs `'custom'` most. Worth its own decision driver.

### F2 — Multi-source Collection (one element pulls from two slugs)

**Decision space.** Realistic homepage strips often want "latest across blog + projects + case-studies." Today decision 1 ties `collectionSlug` to a single string. Two real options: (a) `collectionSlug: string[]` with a single sort across the union; (b) introduce a `CollectionGroup` element that hosts multiple Collections as children with a shared layout. (a) is cheaper, (b) composes better with mixed display modes per source.

**Touches.** Materializer (union + re-sort), inspector (multi-pick), validator (each slug must exist).

**Why deferred.** Not in the current Owner pain. Add only if demand surfaces; otherwise the new abstraction is incidental complexity.

### F3 — Migration audit: production sites still on `pageKind === 'collection-index'`

**Decision space.** Decision 2 migrates on first load, but the migration code must be written, tested, and run against real sites. Need: (a) a Neon query that enumerates affected sites and pages, (b) a dry-run mode that reports what would change without writing, (c) a smoke that loads each affected fixture before and after migration.

**Touches.** Drizzle script, `src/canvas/migrations/` (new directory if needed), startup hook in `src/editor-client/site-load.ts`, fixture smokes.

**Why deferred.** Migration code wants to be its own commit so its diff is auditable in isolation.

### F4 — Extract inline list-reorder as a shared editor-client component

**Decision space.** Decision 8 ships a manual-reorder UI. Carousel already has one. A third consumer is foreseeable (Tabs reorder, Nav links reorder). One shared component now vs. three divergent implementations later.

**Touches.** New `src/editor-client/components/sortable-list.ts`, refactor of Collection inspector and Carousel slide list.

**Why deferred.** Premature until the third caller is real. Extracting on N=2 risks designing the wrong shape.

### F5 — Validator and registry cleanup after `'collection-index'` retirement

**Decision space.** After F3's migration runs cleanly in prod, the validator can promote the rejection of `pageKind === 'collection-index'` from "warn" to "throw." The element registry dispatch tables ([src/canvas/elements/index.ts](../../src/canvas/elements/index.ts)) and the page-inspector ([src/editor-client/page-inspector.ts](../../src/editor-client/page-inspector.ts)) can drop the branches that reference the removed value.

**Touches.** Validator, page-inspector, page-kind unions, type narrowing in `src/canvas/render/`.

**Why deferred.** Pure cleanup; safe only after F3 confirms no prod data references the removed value.
