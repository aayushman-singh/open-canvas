CREATE TABLE "addon_entitlement" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"addon_id" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_template" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text,
	"visibility" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"style_kit" text NOT NULL,
	"site_state" jsonb NOT NULL,
	"asset_manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_addon" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"addon_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_collaborator" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"invited_by_customer_id" text NOT NULL,
	"invited_email" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "designer_template" CASCADE;--> statement-breakpoint
ALTER TABLE "addon_entitlement" ADD CONSTRAINT "addon_entitlement_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_template" ADD CONSTRAINT "custom_template_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_addon" ADD CONSTRAINT "site_addon_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_collaborator" ADD CONSTRAINT "site_collaborator_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_collaborator" ADD CONSTRAINT "site_collaborator_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_collaborator" ADD CONSTRAINT "site_collaborator_invited_by_customer_id_customer_id_fk" FOREIGN KEY ("invited_by_customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "addon_entitlement_customer_addon_unique" ON "addon_entitlement" USING btree ("customer_id","addon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_addon_site_addon_unique" ON "site_addon" USING btree ("site_id","addon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_collaborator_site_customer_unique" ON "site_collaborator" USING btree ("site_id","customer_id");