ALTER TABLE "custom_template" ADD COLUMN "source_template_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_template_source_template_id_unique" ON "custom_template" USING btree ("source_template_id") WHERE "source_template_id" IS NOT NULL;
