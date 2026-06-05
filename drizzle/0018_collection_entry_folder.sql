-- ADR 0063 dec 7 — Collection entries gain an optional `folder` column so
-- Owners can sub-group entries inside one `collection_slug` ("tech notes"
-- vs "design notes" inside `blog`) without forking the slug or the
-- dashboard tab.
--
-- Constraints:
--   * `text NULL` — `NULL` means "ungrouped" (the default and current
--     behaviour). No data migration is required: every existing row reads
--     as ungrouped.
--   * `length <= 64` and `NOT LIKE '%/%' / '%\%'` — keeps the value
--     URL-safe and free of path separators so folder values can never
--     collide with future `/<slug>/<folder>` route shapes. Enforcing at
--     the DB level means a direct SQL writer (admin tooling, future
--     migration) cannot sneak in a malformed value; the API write
--     boundary (Phase 2C) returns 400 with an explicit field error before
--     the row hits Postgres.
--
-- Index:
--   `(site_id, collection_slug, folder, published_date DESC)` matches the
--   Collection materializer's filtered listing path. Parallel in shape to
--   the existing `collection_entry_site_collection_published_idx` so the
--   planner has a folder-aware peer for the folder-narrowed query without
--   needing to climb the wider index and re-filter.

ALTER TABLE "collection_entry"
  ADD COLUMN "folder" text;
--> statement-breakpoint
ALTER TABLE "collection_entry"
  ADD CONSTRAINT "collection_entry_folder_shape_check"
  CHECK (
    "folder" IS NULL
    OR (
      length("folder") <= 64
      AND "folder" NOT LIKE '%/%'
      AND "folder" NOT LIKE E'%\\\\%'
    )
  );
--> statement-breakpoint
CREATE INDEX "collection_entry_site_collection_folder_published_idx"
  ON "collection_entry"
  USING btree ("site_id", "collection_slug", "folder", "published_date" DESC);
