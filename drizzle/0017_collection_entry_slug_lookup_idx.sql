-- 2026-06-04 perf — Dashboard entries route SLOWPATH index.
--
-- The Entries tab (`GET /dashboard/sites/:siteId/entries`) issues a
-- `SELECT DISTINCT collection_slug FROM collection_entry WHERE site_id = ?
-- GROUP BY collection_slug ORDER BY collection_slug` to derive the
-- segmented-pill list of collections. Without a narrow `(site_id,
-- collection_slug)` index the planner had to climb the wider 3-column
-- `collection_entry_site_collection_published_idx` (which includes
-- `published_date DESC`) — bigger pages, more I/O, and slower index-only
-- scans on the dashboard hot path.
--
-- This new index is a strict prefix of the existing wider one but lets
-- Postgres pick the smaller btree for the DISTINCT/GROUP BY rewrite. Writes
-- pay the extra ~B-tree maintenance cost; the row size on this table is
-- small (two short text columns), so the overhead is negligible relative to
-- the dashboard page-open speed-up.
--
-- The wider 3-column index is intentionally kept — it serves
-- `materializeCollections` and the dashboard's "newest-first" listing
-- (`ORDER BY published_date DESC`).

CREATE INDEX IF NOT EXISTS "collection_entry_site_collection_idx"
  ON "collection_entry" USING btree ("site_id", "collection_slug");
