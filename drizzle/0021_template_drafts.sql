ALTER TABLE "site" ADD COLUMN "site_kind" text DEFAULT 'owner_site' NOT NULL;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_kind_check" CHECK ("site_kind" IN ('owner_site', 'template_draft'));--> statement-breakpoint
ALTER TABLE "custom_template" ADD COLUMN "publication_status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_template" ADD CONSTRAINT "custom_template_publication_status_check" CHECK ("publication_status" IN ('drafting', 'published', 'unpublished'));--> statement-breakpoint
ALTER TABLE "custom_template" ADD COLUMN "template_draft_site_id" text;--> statement-breakpoint
ALTER TABLE "custom_template" ADD CONSTRAINT "custom_template_template_draft_site_id_site_id_fk" FOREIGN KEY ("template_draft_site_id") REFERENCES "public"."site"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_template_template_draft_site_id_unique" ON "custom_template" USING btree ("template_draft_site_id") WHERE "template_draft_site_id" IS NOT NULL;
