-- 0001_owner_asset.sql
-- Add owner_asset and slot_history. Copy every site_asset row into owner_asset
-- with the same id, reparented to the site's owning customer. site_asset is
-- left in place; it is dropped in 0002 after the application code is fully
-- switched over.

CREATE TABLE owner_asset (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  media_type text NOT NULL,
  bytes_base64 text NOT NULL,
  kind text NOT NULL,
  alt text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX owner_asset_by_customer
  ON owner_asset (customer_id, last_used_at DESC);

INSERT INTO owner_asset (
  id, customer_id, media_type, bytes_base64, kind, alt, created_at, last_used_at
)
SELECT
  sa.id,
  s.customer_id,
  sa.media_type,
  sa.bytes_base64,
  sa.kind,
  sa.alt,
  sa.created_at,
  sa.created_at
FROM site_asset AS sa
JOIN site AS s ON s.id = sa.site_id;

CREATE TABLE slot_history (
  site_id text NOT NULL REFERENCES site(id) ON DELETE CASCADE,
  element_id text NOT NULL,
  asset_id text NOT NULL REFERENCES owner_asset(id) ON DELETE CASCADE,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, element_id, asset_id)
);

CREATE INDEX slot_history_by_slot
  ON slot_history (site_id, element_id, last_used_at DESC);
