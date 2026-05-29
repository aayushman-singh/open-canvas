-- Add a free-text description column to `library_section` so Owners can
-- annotate why a saved section exists. Surfaced in the editor's
-- "Save to library" modal as a separate field (Gap 3 of the cheap-five
-- script-alignment pass — see act-1-script.md S6.F.1 voiceover plus the
-- S13.E.1 template-save beat that introduced description fields).
--
-- DEFAULT '' keeps the column NOT NULL while leaving every pre-existing
-- row valid without a backfill — same pattern as `tagline` on
-- `custom_template` (migration 0003).

ALTER TABLE "library_section" ADD COLUMN "description" text NOT NULL DEFAULT '';
