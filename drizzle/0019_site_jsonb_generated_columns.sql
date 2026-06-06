-- Denormalise two scalar fields from site.editable_state into STORED
-- generated columns so the dashboard listing query stops paying a full
-- ~300 KB JSONB read per row just to grab `visitorTheme` and `siteNoIndex`.
--
-- Generated columns are recomputed automatically on every UPDATE to
-- editable_state, so no application-level sync is required. They also
-- backfill on ADD COLUMN — Postgres rewrites the table once, then every
-- subsequent read is a narrow scalar column lookup.
--
-- Server-Timing on /dashboard had db.list at ~500 ms even with a warm
-- Hyperdrive connection (ping1 = 5 ms). The cost was Postgres reading
-- the full editable_state blob to evaluate `(editable_state->>'X')` in
-- the SELECT list. After this migration db.list should drop to <100 ms.

ALTER TABLE "site"
  ADD COLUMN "visitor_theme" text
    GENERATED ALWAYS AS ((editable_state->>'visitorTheme')) STORED;

ALTER TABLE "site"
  ADD COLUMN "site_no_index" boolean
    GENERATED ALWAYS AS (((editable_state->>'siteNoIndex')::boolean)) STORED;

ALTER TABLE "site"
  ADD COLUMN "favicon_asset_id" text
    GENERATED ALWAYS AS ((editable_state->>'faviconAssetId')) STORED;
