-- Drop legacy `template` and `page` tables.
--
-- `template` predates the canvas-first creation flow; Template Seeds now live
-- in `src/templates/registry.ts` and Owner-saved templates live in
-- `custom_template` (added in 0003).
--
-- `page` predates the canvas model; site content now lives in
-- `site.editable_state` (jsonb) and is projected per-page at render time.
--
-- Audit (2026-05-29) confirmed zero `src/` imports of either table from
-- `src/db/schema.ts`. No other table holds a foreign key to `template` or
-- `page`, so dropping them is safe without touching neighbouring tables. The
-- only inbound dependency on `page` was its own `site_id -> site(id)` FK
-- (declared in 0000), which goes away with the table.

DROP TABLE IF EXISTS "page";--> statement-breakpoint
DROP TABLE IF EXISTS "template";
