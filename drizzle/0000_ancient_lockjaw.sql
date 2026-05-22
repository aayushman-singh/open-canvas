CREATE TABLE "chat_session" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"messages" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"hostname" text NOT NULL,
	"cf_hostname_id" text NOT NULL,
	"status" text NOT NULL,
	"verification_record" jsonb NOT NULL,
	"cert_issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_domain_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
CREATE TABLE "customer" (
	"id" text PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "form_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"form_element_id" text NOT NULL,
	"page_slug" text NOT NULL,
	"payload" jsonb NOT NULL,
	"ip_hash" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"doc" jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"style_kit" text NOT NULL,
	"editable_state" jsonb NOT NULL,
	"published_snapshot" jsonb,
	"published_version" integer DEFAULT 0 NOT NULL,
	"password_enabled" boolean DEFAULT false NOT NULL,
	"password_hash" text,
	"password_set_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "site_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"media_type" text NOT NULL,
	"bytes_base64" text NOT NULL,
	"kind" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_font" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"family" text NOT NULL,
	"weight" integer DEFAULT 400 NOT NULL,
	"style" text DEFAULT 'normal' NOT NULL,
	"content_hash" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_search_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"page_slug" text NOT NULL,
	"element_id" text NOT NULL,
	"text" text NOT NULL,
	"published_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"yjs_snapshot_bytes" "bytea" NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"label" text,
	"published_version" integer
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tagline" text NOT NULL,
	"category" text NOT NULL,
	"thumbnail" text,
	"design_language" text NOT NULL,
	"tokens" jsonb NOT NULL,
	"pages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_domain" ADD CONSTRAINT "custom_domain_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_asset" ADD CONSTRAINT "site_asset_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_font" ADD CONSTRAINT "site_font_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_search_entry" ADD CONSTRAINT "site_search_entry_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_snapshot" ADD CONSTRAINT "site_snapshot_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_site_slug_unique" ON "page" USING btree ("site_id","slug");--> statement-breakpoint
-- Phase 0 raw addition (drizzle-kit does not model PostgreSQL GENERATED
-- STORED columns natively). Adds the tsvector column + GIN index used by
-- Wave 3 #13 (site search) for full-text matching. Query code uses
-- `sql\`tsv @@ plainto_tsquery(...)\`` against this column; application
-- schema never reads `tsv` directly.
ALTER TABLE "site_search_entry" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED;--> statement-breakpoint
CREATE INDEX "site_search_entry_tsv_idx" ON "site_search_entry" USING gin ("tsv");