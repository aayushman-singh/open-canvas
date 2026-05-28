# Architecture and DB Schema Review - Consolidated Action Plan

Date: 2026-05-26

Scope: current Worker monolith, Hono routes, Drizzle schema, Neon Postgres schema, publish flow, dashboard/admin read paths, canvas/editor runtime, and legacy schema surface.

## User-Visible Definition of Done

An Owner can create, edit, publish, manage, and delete a site with no hidden split-brain state:

- Dashboard loads remain fast as the account accumulates sites, assets, forms, domains, snapshots, and chat history.
- Publish either fully promotes the current editable site into the public version and related derived state, or it fails loudly before exposing partial state.
- Visitor paths read the published truth only.
- Database constraints enforce the invariants the product relies on; application code should not be the only guard.
- The stable product codebase is easy to navigate because dead tables, legacy bridges, and duplicate policy checks are removed.

## Overall Assessment

The core shape is right. The system is still best described as a single Cloudflare Worker monolith with shallow depth:

Router -> auth/access check -> handler/domain function -> Drizzle/Postgres/R2/Durable Object.

That is the correct amount of structure for this product. Do not add repositories, service locators, generic interactors, or a dependency-injection container. The complexity that remains is mostly domain complexity: canvas state, publish projection, owner assets, Yjs/co-editing, custom domains, forms, search, and addons.

The stable-product work is therefore not "add architecture." It is:

1. Delete dead nodes.
2. Collapse duplicate relations.
3. Move important invariants into the database.
4. Make failure contracts explicit.
5. Split only the files where one node is now carrying multiple behavioral responsibilities.

## Corrections to Earlier Notes

- `site_snapshot` is pruned, but only after capture. `src/version/capture.ts` calls `pruneSnapshots`; there is no cron-based snapshot prune. `src/version/prune.ts` keeps the newest 50 rows and publish rows inside the retention window. Prune failures are logged and swallowed.
- `site_snapshot` grows from publish and manual captures, not autosave. Autosave writes `site.editable_state`.
- `site_search_entry` rebuild currently deletes by `site_id` only in `src/search/indexer.ts`, not by `published_version < ?`. It still needs a btree index for that delete/filter path.
- `site_collaborator` and `site_addon` are covered for their main `site_id` lookups by unique composite indexes.
- The old `site_asset` table is already dropped by `drizzle/0001_owner_asset_pipeline.sql`; the current dead schema tables are `page` and `template`.

## Priority Summary

| Priority | Finding | Severity | Effort |
| --- | --- | --- | --- |
| P0 | Publish promotion is not all-or-nothing | Critical behavior contract | Medium |
| P1 | Missing indexes on growing owner/site tables | High performance risk | Small |
| P1 | `owner_asset(customer_id, content_hash)` dedupe is not enforced | High data integrity risk | Medium |
| P1 | Access policy is duplicated; custom-domain route has a 50-site false 404 bug | High correctness risk | Small/Medium |
| P1 | DB lacks check constraints for scalar state machines and password invariants | Medium data integrity risk | Medium |
| P2 | Drop dead `page` table and types | Medium schema noise | Small |
| P2 | Drop dead `template` table and types | Medium schema noise | Small |
| P2 | Dashboard card query loads full `editable_state` for summaries | Medium scaling cost | Medium |
| P2 | Public host router is carrying too many behaviors | Medium navigation risk | Medium |
| P2 | Editor client is a huge inline string instead of parsed TypeScript | Medium change risk | Medium/Large |
| P3 | Add search-entry site/version btree index | Low publish-path risk | Small |
| P3 | Define `form_submission` retention | Low/Medium storage and privacy risk | Small |
| P3 | Consolidate duplicated route `Bindings` types | Low maintenance cost | Small |
| P3 | Split `canvas/validate.ts` by concern | Low navigation cost | Medium |
| P3 | Tighten admin column projections | Low query cost | Small |

## P0 - Publish Promotion Is Not All-Or-Nothing

### Current Shape

`src/routes/api/publish.ts`:

- Builds and validates a `PublishedSnapshot`.
- Generates OG data as non-blocking work.
- Updates `site.published_snapshot` and `site.published_version`.
- Captures a version snapshot as non-blocking work.
- Rebuilds search as non-blocking work.
- Broadcasts to the `SITE_ROOM` Durable Object after the DB update; if broadcast fails, the route throws after the site row has already changed.

### Why This Is Not Optimal

The published site row, version history, search index, OG output, and live editor broadcast are directed relations from the same Owner action: Publish.

Today those relations can disagree:

- DB says version N is published, but the route returns failure because broadcast failed.
- DB says version N is published, but version history capture failed.
- DB says version N is published, but search still points at version N-1 or empty state.
- OG generation failure is hidden behind a successful publish.

This violates the repo's stated failure posture. It also makes support/debugging harder because "Publish failed" can mean "the public site changed anyway."

### Recommended Action

First define the external contract. There are only two coherent options:

1. Publish means "the durable public snapshot and all derived DB state are committed." Live room broadcast is a notification relation, not part of publish correctness.
2. Publish means "the durable public snapshot, derived DB state, and active editor broadcast all succeed together."

Option 1 is the minimal-complexity recommendation. Make DB-visible publish state the canonical behavior:

- Wrap the site update, version capture insert, and search rebuild in one explicit DB transaction or a carefully documented atomic sequence if the driver cannot provide a transaction.
- Remove non-blocking catch blocks for snapshot capture and search rebuild from the publish route.
- Treat OG generation as either required and fail before publish, or explicitly move it out of publish into a separate derived job with visible status. Do not keep it as hidden "best effort."
- Move Durable Object broadcast behind a named notification boundary. If it fails, record/log a publish notification failure with site id and version, and make clients reconcile against `published_version` on connect or refresh.
- Update tests so a forced capture/search failure leaves `site.published_version` unchanged.

If active-room broadcast is truly part of the user-visible publish guarantee, add a transactional outbox table and let the room consume versioned publish events. Do not keep "DB commit succeeded, response failed after broadcast" as the behavior.

### Acceptance Checks

- Inject a failing `captureOnPublish`: route returns an explicit error and `site.published_version` does not advance.
- Inject a failing `rebuildSearchIndex`: route returns an explicit error and `site.published_version` does not advance.
- Inject a failing room broadcast: either publish still succeeds by documented contract and clients reconcile by version, or publish does not commit. There is no ambiguous partial response.
- Logs include `siteId`, old version, new version, failure step, and stack/error detail.

## P1 - Add Missing DB Indexes

### Current Shape

Postgres does not automatically index foreign keys. The schema has several hot queries over `site_id` or `customer_id` without supporting btree indexes.

### Recommended Index Migration

Add one migration for the read/write paths that will grow:

```sql
CREATE INDEX "site_customer_id_idx"
  ON "site" USING btree ("customer_id");

CREATE INDEX "form_submission_site_form_submitted_idx"
  ON "form_submission" USING btree ("site_id", "form_element_id", "submitted_at" DESC);

CREATE INDEX "site_snapshot_site_captured_idx"
  ON "site_snapshot" USING btree ("site_id", "captured_at" DESC);

CREATE INDEX "chat_session_site_customer_started_idx"
  ON "chat_session" USING btree ("site_id", "customer_id", "started_at" DESC);

CREATE INDEX "site_font_site_id_idx"
  ON "site_font" USING btree ("site_id");

CREATE INDEX "custom_domain_site_id_idx"
  ON "custom_domain" USING btree ("site_id");

CREATE INDEX "site_search_entry_site_id_idx"
  ON "site_search_entry" USING btree ("site_id");
```

`site_customer_id_idx` is an addition to the pasted review. Dashboard listing and owner-scoped site lookups use `site.customer_id`; it should not become a sequential scan as owners accumulate sites.

### Files To Update

- `src/db/schema.ts`: add `index(...)` metadata to the affected `pgTable` definitions.
- `drizzle/<next>_indexes.sql`: add the migration.

### Acceptance Checks

- `EXPLAIN` for dashboard site list uses `site_customer_id_idx`.
- `EXPLAIN` for form inbox and rate-limit count uses `form_submission_site_form_submitted_idx`.
- `EXPLAIN` for version timeline/prune uses `site_snapshot_site_captured_idx`.
- `EXPLAIN` for search reindex delete uses `site_search_entry_site_id_idx`.
- Typecheck and lint stay green.

## P1 - Enforce Owner Asset Dedupe In The DB

### Current Shape

`owner_asset` comments promise one row per `(customer_id, content_hash)`, but the database only has a non-unique index:

```sql
CREATE INDEX "owner_asset_customer_id_content_hash_idx"
  ON "owner_asset" ("customer_id", "content_hash");
```

`src/assets/upload.ts` does a select-before-insert probe. Two concurrent uploads by the same owner can both miss the probe and insert duplicate rows.

### Why This Matters

Rendering resolves by asset id, so duplicates may not break visitor pages. But they do break the asset-gallery truth:

- Gallery shows duplicates for the same owner/file.
- Owner storage accounting can double-count the same logical asset.
- The schema comment describes an invariant the DB cannot enforce.

### Recommended Action

Use a two-step data-safe migration.

First audit for duplicates:

```sql
SELECT
  customer_id,
  content_hash,
  count(*) AS duplicate_count,
  array_agg(id ORDER BY created_at) AS ids
FROM owner_asset
GROUP BY customer_id, content_hash
HAVING count(*) > 1;
```

If the audit returns rows, stop the migration and repair explicitly. Do not blindly delete duplicates: canvas JSON, published snapshots, slot history, custom templates, and library sections may reference specific `owner_asset.id` values.

If no duplicates exist:

```sql
DROP INDEX "owner_asset_customer_id_content_hash_idx";

CREATE UNIQUE INDEX "owner_asset_customer_id_content_hash_unique"
  ON "owner_asset" USING btree ("customer_id", "content_hash");
```

Then update `src/assets/upload.ts` so the insert path is conflict-safe:

- Keep the R2 object content-addressed by hash.
- Insert `owner_asset` with `ON CONFLICT (customer_id, content_hash)`.
- On conflict, return the existing row and still record `slot_history` if `siteId` and `elementId` were supplied.
- Do not rely on select-before-insert as the invariant.

### Acceptance Checks

- A concurrency smoke test for two same-owner same-bytes uploads returns one `owner_asset` row.
- Cross-owner same-bytes upload still creates one row per owner while sharing the same `r2_key`.
- Slot history is recorded for both upload callers when element context is supplied.
- The unique index exists in Postgres and in `src/db/schema.ts`.

## P1 - Consolidate Owner Access Policy

### Current Shape

`src/auth/accessible-site.ts` exists, but many routes still hand-roll site ownership/collaboration checks.

Concrete bug: `src/custom-domain/route.ts` checks ownership by loading the first 50 sites for an owner and then searching in memory. An owner with more than 50 sites can receive a false 404 for a site they own.

### Recommended Action

Immediate fix:

- Replace the custom-domain ownership check with one query scoped by both `site.id` and `site.customer_id`.

Then consolidate:

- Create or extend a small access-policy helper around conceptual names:
  - `loadOwnedSite`
  - `loadEditableSite`
  - `loadAccessibleSite`
- Route handlers should call the helper instead of duplicating ownership/collaboration joins.
- Keep the helper thin; it should return the columns requested by the caller and should not become a repository layer.

### Acceptance Checks

- A smoke test with 51 sites verifies custom-domain listing for the 51st site.
- `rg "limit\\(50\\)" src/custom-domain src/routes src/assets src/forms src/version` does not find access-control limits.
- Ownership/collaboration decisions for canvas, publish, settings, forms, domains, addons, versions, and assets route through the same policy vocabulary.

## P1 - Add DB Check Constraints For Scalar Invariants

### Current Shape

Several text/boolean state machines are TypeScript-only:

- `custom_domain.status`
- `site_snapshot.reason`
- `site_font.style`
- `owner_asset.kind`
- `site_collaborator.role`
- `custom_template.visibility`
- `site.style_kit`

Password columns also allow inconsistent states:

- `password_enabled = true`
- `password_hash IS NULL`
- `password_set_at IS NULL`

### Recommended Action

Add check constraints in SQL migrations for scalar enums and cross-column invariants. Do not over-constrain JSONB canvas state in Postgres; that belongs in `validateEditableSite`.

Example:

```sql
ALTER TABLE "owner_asset"
  ADD CONSTRAINT "owner_asset_kind_check"
  CHECK ("kind" IN ('image', 'video'));

ALTER TABLE "site_snapshot"
  ADD CONSTRAINT "site_snapshot_reason_check"
  CHECK ("reason" IN ('publish', 'manual'));

ALTER TABLE "site"
  ADD CONSTRAINT "site_password_enabled_requires_hash_check"
  CHECK (
    "password_enabled" = false
    OR ("password_hash" IS NOT NULL AND "password_set_at" IS NOT NULL)
  );
```

### Acceptance Checks

- Invalid enum writes fail at the DB layer.
- Enabling a password without a hash fails at the DB layer.
- All existing smoke tests still pass.

## P2 - Drop Dead `page` Table

### Current Shape

`src/db/schema.ts` still defines `page` and exports `Page` / `NewPage`.

The canvas-first reset moved pages into `site.editable_state.pages` and `site.published_snapshot.pages`. There are no active route imports or queries against `page`.

### Recommended Action

- Create a migration: `DROP TABLE "page";`
- Remove `page`, `Page`, and `NewPage` from `src/db/schema.ts`.
- Remove the obsolete `page_site_slug_unique` index from schema history via the migration.

### Acceptance Checks

- `rg "\\bpage\\b|Page|NewPage" src/db src/routes src/canvas src/templates` has no live schema references except canvas page concepts.
- Typecheck and lint pass.

## P2 - Drop Dead `template` Table

### Current Shape

`src/db/schema.ts` still defines legacy `template` plus:

- `LegacyThemeTokenSet`
- `TEMPLATE_CATEGORIES`
- `TemplateCategory`
- `TEMPLATE_DESIGN_LANGUAGES`
- `TemplateDesignLanguage`
- `TemplatePageDescriptor`
- `Template`
- `NewTemplate`

The product now uses canvas-first template registries and custom template tables, not this legacy table.

### Recommended Action

- Create a migration: `DROP TABLE "template";`
- Remove the table definition and orphaned type exports from `src/db/schema.ts`.
- Keep `docs/specs/template-schema.md` only if it still describes the current registry/custom-template model; otherwise mark it historical or update it.

### Acceptance Checks

- `rg "from\\(template\\)|template\\.|NewTemplate|TemplatePageDescriptor|TEMPLATE_CATEGORIES|TEMPLATE_DESIGN_LANGUAGES" src` returns no live usage.
- Typecheck and lint pass.

## P2 - Reduce Dashboard JSONB Load

### Current Shape

`src/routes/dashboard/index.tsx` lists owner sites and selects the full `site.editable_state` JSONB for every card. The card uses that state for:

- Thumbnail HTML through `buildThumbHtml`.
- `darkModeEnabled`.
- `siteNoIndex`.

For 10 sites at 8-40 KB each, this is 80-400 KB of JSON from Neon on every dashboard load before rendering.

### Why The Fat Site Row Is Still Correct

The fat `site` row is deliberate and mostly good:

- `editable_state` is the Owner's aggregate.
- `published_snapshot` is the visitor aggregate.
- Publish can promote one aggregate into another with a single row update.

Do not normalize canvas pages into per-element relational tables. That would add nodes and relations without improving user-visible behavior.

The issue is projection, not the aggregate itself.

### Recommended Action

Choose one of these:

1. Store denormalized dashboard-card fields on `site`: thumbnail HTML or thumbnail asset key, `dark_mode_enabled`, `site_no_index`, maybe `primary_page_title`.
2. Store dashboard thumbnail HTML in R2 keyed by `site_id` and `editable_version` / update time.
3. Accept thumbnail generation from JSONB for now, but add generated card metadata at the next dashboard performance pass.

Option 1 is the simplest operationally. It keeps dashboard load to small scalar columns.

### Acceptance Checks

- Dashboard site list no longer selects `site.editable_state`.
- Card rendering still shows thumbnail, dark-mode status, and search-indexing status.
- An edit that changes thumbnail-relevant state updates the denormalized card field at the same boundary as saving editable state, or the UI clearly uses the last saved thumbnail.

## P2 - Split Public Host Router By Behavior

### Current Shape

`src/routes/public.ts` is a large route file carrying multiple behaviors:

- Host and path resolution.
- Custom-domain lookup.
- Public site loading.
- On-site editor mode.
- Invite/password gates.
- Live routes.
- Assets/fonts.
- Page routing.
- SEO/i18n/head emission.
- Visitor addons/runtime injection.

### Recommended Action

Keep one mounted public router, but split the internal nodes:

- `public/resolve-request.ts`: host/path -> route target.
- `public/load-published-site.ts`: target -> published snapshot plus metadata.
- `public/gates.ts`: password, edit mode, invite, and visibility decisions.
- `public/render-response.ts`: snapshot/page -> HTML response.
- `public/static-resources.ts`: assets/fonts/live helper routes if they remain in the same router.

Do not create a service layer. The goal is to name the relations that already exist and reduce the number of reasons to open one file.

### Acceptance Checks

- Public route behavior remains unchanged in smoke tests.
- Each extracted file has one reason to change.
- `src/routes/public.ts` becomes a mount/orchestration file, not the owner of every public behavior.

## P2 - Move Editor Runtime Out Of A Giant Inline String

### Current Shape

`src/editor/canvas-client.ts` returns a very large browser script string from `canvasClientScript()`. That script contains duplicated constants and validation helpers that TypeScript and ESLint cannot fully protect as normal imported code.

### Recommended Action

Move the browser runtime into parsed TypeScript modules:

- `src/editor/client/index.ts`
- `src/editor/client/state.ts`
- `src/editor/client/toolbar.ts`
- `src/editor/client/inspector.ts`
- `src/editor/client/network.ts`

Then build it into a Worker-served asset or importable string artifact. The important improvement is that the source becomes normal TS with imports from shared canvas constants where appropriate.

Do this after higher-risk DB and publish work. It is a navigation/testability improvement, not an urgent behavior fix.

### Acceptance Checks

- No new behavior is introduced.
- Browser runtime source is typechecked/linted as TypeScript.
- Shared constants like style kits and URL validation are imported or generated from canonical modules, not duplicated inside a string.
- Editor smoke/manual checks still pass.

## P3 - Clarify Search Entry Indexing

### Current Shape

`site_search_entry` has a GIN index on `tsv`, but no btree index on `site_id`.

`src/search/indexer.ts` deletes all entries for a site, then inserts rows for the new published snapshot.

### Recommended Action

Add:

```sql
CREATE INDEX "site_search_entry_site_id_idx"
  ON "site_search_entry" USING btree ("site_id");
```

If the design changes to retain multiple published versions in this table, use:

```sql
CREATE INDEX "site_search_entry_site_version_idx"
  ON "site_search_entry" USING btree ("site_id", "published_version");
```

Current code does not need the composite index unless cleanup starts filtering by version.

### Acceptance Checks

- Search rebuild delete uses a btree index on `site_id`.
- Public search still uses the GIN `tsv` index for text matching.

## P3 - Define Retention For Forms And Snapshots

### Current Shape

`site_snapshot` has a retention function wired after capture:

- Keep newest 50 snapshots.
- Keep publish snapshots within the retention window.
- Prune failures are logged and swallowed.

`form_submission` has no retention policy.

### Recommended Action

- Document the existing snapshot retention in `src/version/SUBSYSTEM.md`.
- Decide whether prune failure should remain housekeeping-only or should fail capture. Given the all-or-nothing posture, the current swallowed error deserves an explicit decision.
- Add a product retention policy for form submissions:
  - keep forever until Owner deletes/export deletes, or
  - retain for a fixed window, or
  - add Owner-controlled deletion/export workflow.

Do not add silent TTL behavior without a visible product rule.

### Acceptance Checks

- Retention behavior is documented where an operator will look.
- A form retention decision exists before the table contains meaningful customer data.
- If deletion is added, it is explicit and auditable.

## P3 - Consolidate Route Bindings Types

### Current Shape

Many route files define local `Bindings` types. Core bindings such as Clerk keys and `DATABASE_URL` are repeated, while feature-specific bindings differ.

### Recommended Action

Introduce a shared base type, then extend it locally:

```ts
export type CoreBindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};
```

Route files can still show their feature-specific runtime needs:

```ts
type Bindings = CoreBindings & {
  RESEND_API_KEY: string;
};
```

This preserves self-documenting routes while removing copy/paste drift.

### Acceptance Checks

- Adding a shared required binding touches one core type instead of many route files.
- Feature-specific bindings remain visible at the route boundary.

## P3 - Split Canvas Validator By Concern

### Current Shape

`src/canvas/validate.ts` validates the full `EditableSite` in one large pure-function file: pages, sections, element types, roles, style kit presets, and cross-field checks.

### Recommended Action

Keep the public API stable:

```ts
validateEditableSite(state)
```

Split internals by concern:

- `validate/site.ts`
- `validate/page.ts`
- `validate/section.ts`
- `validate/elements/*.ts`
- `validate/style-kit.ts`

This is low priority because the validator is a leaf module and not a dependency tangle.

### Acceptance Checks

- Public imports do not change.
- Every existing invalid fixture still fails with the same or clearer error.
- Adding a new element type touches one element validator plus the dispatch table.

## P3 - Tighten Admin Column Projections

### Current Shape

Some admin paths load both fat JSONB columns when they need one or only need a derived answer:

- `src/forms/route.ts` selects `published_snapshot` and `editable_state`.
- `src/routes/dashboard/forms-inbox.tsx` selects both.
- `src/assets/delete.ts` scans both to find references.

Some of this is legitimate: delete needs to know if an asset is referenced in editable or published state. The concern is to avoid accidental 80 KB row reads where 40 KB or scalar fields would do.

### Recommended Action

- Audit each path and document which aggregate it needs.
- Prefer one JSONB column when one is enough.
- For asset delete, keep both only if the product requires checking editable and published references before deleting bytes.

### Acceptance Checks

- Form inbox paths do not load `published_snapshot` unless published-state fallback is still an explicit behavior.
- Delete path comments state why both editable and published aggregates are required.

## P3 - Align Failure Posture In Addons And Custom Domains

### Current Shape

There are still "continue with stale/partial state" patterns:

- `src/custom-domain/route.ts` lazy-refresh polling catches and logs per-row failures, then returns stale domain status.
- Addon emission code has skip-style behavior for unknown or unavailable add-ons.

### Recommended Action

Make each alternate behavior explicit:

- Custom-domain dashboard can either fail loudly when refresh fails, or split "list stored rows" and "refresh verification" into separate actions. Do not bury refresh failure inside a normal list response if the UI implies the state is fresh.
- Addon emission should treat unknown enabled addon ids as data corruption unless the product has a named "disabled addon is ignored" rule.

### Acceptance Checks

- A failed domain refresh produces a visible response state or a separate refresh error.
- Unknown enabled addon ids are not silently skipped unless the behavior is documented as a product rule.

## What To Keep

### Keep The Single Worker Monolith

This product does not need separate services. The monolith is still the least complex system that satisfies the behavior.

### Keep Feature-Based Module Boundaries

`canvas`, `assets`, `auth`, `publish`, `forms`, `fonts`, `search`, `custom-domain`, `version`, and dashboard route areas mostly own their vocabulary and logic cleanly.

### Keep Direct Drizzle Usage In Route/Domain Functions

There is no evidence that a repository pattern would reduce complexity. Current direct queries are readable; the issue is duplicated policy in a few places, not lack of a generic data layer.

### Keep The Site JSONB Aggregate

`site.editable_state` and `site.published_snapshot` are correct aggregate roots for the canvas product. The fix is better projection and derived metadata, not relationalizing every canvas node.

### Keep `LlmAdapter`

The LLM adapter is justified:

- The orchestrator codes to an interface.
- Smoke tests can use a mock adapter.
- Schema types are provider-agnostic.
- Only bootstrap points instantiate the concrete Gemini adapter.

This is not premature abstraction.

### Keep Type Co-Location

Most types live where they are used. The central hubs that remain are justified:

- `src/canvas/schema.ts`: shared canvas contract.
- `src/db/schema.ts`: database contract.
- `src/agent/llm.ts`: model adapter contract.

## Suggested Work Batches

### Batch 1 - DB Integrity And Indexes

Commit shape:

1. `refactor(schema): add hot-path indexes`
2. `fix(assets): enforce owner asset dedupe in postgres`
3. `fix(schema): add scalar check constraints`

Run:

```bash
bun run typecheck
bun run lint
```

Also run DB duplicate audit before applying the owner-asset unique index.

### Batch 2 - Dead Schema Deletion

Commit shape:

1. `refactor(schema): drop legacy page table`
2. `refactor(schema): drop legacy template table`

Run:

```bash
rg "from\\(template\\)|NewTemplate|TemplatePageDescriptor|\\bpage\\b|NewPage" src
bun run typecheck
bun run lint
```

Review the `rg` output manually so canvas page concepts are not mistaken for the legacy DB table.

### Batch 3 - Publish Contract Repair

Commit shape:

1. `fix(publish): make derived publish state fail atomically`
2. `test(publish): cover capture and search failure rollback`

This batch needs the product decision from P0: whether active-room broadcast is part of the publish contract or a named notification relation.

### Batch 4 - Access Policy Cleanup

Commit shape:

1. `fix(domains): scope site ownership lookup by site id`
2. `refactor(auth): reuse site access policy across owner routes`

Start with the custom-domain false 404 bug, then consolidate the broader pattern.

### Batch 5 - Read-Path And Navigation Cleanup

Commit shape:

1. `perf(dashboard): avoid full editable state for site cards`
2. `refactor(public): split public router by behavior`
3. `refactor(editor): move canvas client into typed modules`
4. `refactor(canvas): split validator internals`

These are valuable, but they should follow integrity and correctness work.

## Final Recommendation

Complexity is close to optimal at the system level. The wrong move now would be adding layers.

The right stable-product move is to harden and simplify:

- Make the database enforce the invariants the product already assumes.
- Make publish failure behavior explicit and testable.
- Delete dead schema.
- Collapse duplicated access policy.
- Reduce fat JSON reads on dashboard paths.
- Split only the modules whose names no longer match one responsibility.

