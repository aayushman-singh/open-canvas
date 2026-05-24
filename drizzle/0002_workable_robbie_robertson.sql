CREATE TABLE "designer_template" (
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
CREATE TABLE "library_section" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text,
	"visibility" text NOT NULL,
	"name" text NOT NULL,
	"recipe_id" text NOT NULL,
	"section_data" jsonb NOT NULL,
	"asset_manifest" jsonb NOT NULL,
	"heading_preview" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "designer_template" ADD CONSTRAINT "designer_template_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_section" ADD CONSTRAINT "library_section_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;