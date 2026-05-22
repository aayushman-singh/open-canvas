-- Phase 0 plan #2 — asset-pipeline migration.
--
-- Drops the legacy `site_asset` table (base64-in-Postgres bytes, site-rooted
-- per the pre-ADR-0004 shape) and creates `owner_asset` (R2-keyed bytes,
-- Owner-rooted per ADR 0004 + ADR 0006) and `slot_history` (per-slot MRU
-- list per ADR 0004 decision 4).
--
-- Destructive: any rows present in `site_asset` are lost. The dev database is
-- expected to be reset; production has not been provisioned. See
-- `src/assets/MIGRATION.md` for the migration strategy and rationale.

DROP TABLE IF EXISTS "site_asset";
--> statement-breakpoint
CREATE TABLE "owner_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"r2_key" text NOT NULL,
	"media_type" text NOT NULL,
	"kind" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"width" integer,
	"height" integer,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slot_history" (
	"site_id" text NOT NULL,
	"element_id" text NOT NULL,
	"owner_asset_id" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_history_site_id_element_id_owner_asset_id_pk" PRIMARY KEY("site_id","element_id","owner_asset_id")
);
--> statement-breakpoint
ALTER TABLE "owner_asset" ADD CONSTRAINT "owner_asset_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_history" ADD CONSTRAINT "slot_history_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_history" ADD CONSTRAINT "slot_history_owner_asset_id_owner_asset_id_fk" FOREIGN KEY ("owner_asset_id") REFERENCES "public"."owner_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Common lookup paths for the asset routes:
--   - dedup probe by (customer_id, content_hash) on upload
--   - public read by content_hash
--   - gallery listing by customer_id ordered by created_at
CREATE INDEX "owner_asset_customer_id_content_hash_idx" ON "owner_asset" USING btree ("customer_id","content_hash");--> statement-breakpoint
CREATE INDEX "owner_asset_content_hash_idx" ON "owner_asset" USING btree ("content_hash");
