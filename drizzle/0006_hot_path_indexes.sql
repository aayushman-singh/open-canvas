CREATE INDEX "site_customer_id_idx" ON "site" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_asset_customer_content_hash_unique" ON "owner_asset" USING btree ("customer_id","content_hash");--> statement-breakpoint
CREATE INDEX "custom_domain_site_id_idx" ON "custom_domain" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "form_submission_site_form_submitted_idx" ON "form_submission" USING btree ("site_id","form_element_id","submitted_at" DESC);--> statement-breakpoint
CREATE INDEX "site_snapshot_site_captured_idx" ON "site_snapshot" USING btree ("site_id","captured_at" DESC);--> statement-breakpoint
CREATE INDEX "site_font_site_id_idx" ON "site_font" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "site_search_entry_site_id_idx" ON "site_search_entry" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "chat_session_site_customer_started_idx" ON "chat_session" USING btree ("site_id","customer_id","started_at" DESC);
