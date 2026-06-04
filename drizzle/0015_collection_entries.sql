-- ADR 0060 Stream A — CMS-style entries live in a dedicated table.
--
-- One row per entry (blog post / case study / etc.) for a given collection
-- on a given site. The canvas only carries `collection-index` and
-- `collection-item-template` pages; the publish-time `materializeCollections`
-- pass joins those template pages with rows from this table.
--
-- Cascade-delete on `site_id` so removing a site drops all its entries.
-- Unique index on `(site_id, collection_slug, slug)` is the slug-collision
-- guard surfaced as 409 by the REST handlers. The `(site_id, collection_slug,
-- published_date DESC)` index serves the dashboard listing + publish-time
-- materialiser, both of which iterate published entries newest-first.
--
-- `tags` defaults to `'[]'::jsonb` so inserts that omit it round-trip cleanly
-- through Drizzle's `.$type<string[]>().default([])` declaration. `status` is
-- a plain text column (not an enum) for forward-compatibility with extra
-- statuses (e.g. 'scheduled') — the application layer validates it against
-- `COLLECTION_ENTRY_STATUSES` in schema.ts.

CREATE TABLE "collection_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"collection_slug" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"published_date" text NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"og_image_asset_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_entry" ADD CONSTRAINT "collection_entry_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_entry_site_collection_published_idx" ON "collection_entry" USING btree ("site_id","collection_slug","published_date" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "collection_entry_site_collection_slug_unique" ON "collection_entry" USING btree ("site_id","collection_slug","slug");
