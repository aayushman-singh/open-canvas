-- ADR 0061 Phase A — Section Library lineage + category columns.
--
-- Additive widening of `library_section`. No row deletes, no behaviour
-- changes at this phase. Existing rows backfill to `base_slug = id`,
-- `version = 1`, `parent_id = NULL`, `category = 'other'` — keeping them
-- valid under the new NOT NULL constraints without any code change to
-- the existing GET / POST / DELETE routes.
--
-- Type note: `parent_id` is `text`, not `uuid`. `library_section.id` is
-- declared as `text` in `src/db/schema.ts` (UUID-shaped string in a text
-- column — see `$defaultFn(() => crypto.randomUUID())`). The FK must
-- carry the same SQL type as the referenced column; the ADR's "uuid"
-- wording is informal.
--
-- Unique index on `(base_slug, version)` enforces Decision 4's lineage
-- invariant: a `base_slug` can have many rows but each (base_slug, version)
-- pair is unique. v1 and v2 of `home-template-hero` coexist as separate
-- rows pointing at each other via `parent_id`.

ALTER TABLE "library_section" ADD COLUMN "base_slug" text;--> statement-breakpoint
UPDATE "library_section" SET "base_slug" = "id" WHERE "base_slug" IS NULL;--> statement-breakpoint
ALTER TABLE "library_section" ALTER COLUMN "base_slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "library_section" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "library_section" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "library_section" ADD CONSTRAINT "library_section_parent_id_library_section_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."library_section"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_section" ADD COLUMN "category" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "library_section_base_slug_version_idx" ON "library_section" USING btree ("base_slug","version");
