-- 0002_drop_site_asset.sql
-- Drop the legacy site_asset table. All rows were migrated to owner_asset
-- in 0001_owner_asset.sql; every code reader has been switched.
BEGIN;
DROP TABLE IF EXISTS site_asset;
COMMIT;
