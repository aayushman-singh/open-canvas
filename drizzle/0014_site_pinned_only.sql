-- ADR 0059 hard-cutover migration: site header/footer become the only
-- canonical pinned sections. Page sections lose `role:'header'|'footer'`.
--
-- For each EditableSite-shaped JSONB (`site.editable_state`,
-- `site.published_snapshot`):
--   1. Walk every page section. If `site.header` is empty and a page
--      section carries `role='header'`, promote the FIRST such section
--      to `site.header` (with its `role` field stripped). Same for footer.
--   2. Strip the `role` field from `site.header` and `site.footer`
--      themselves -- after this deploy the field's only valid value is
--      'body' (which is implicit when absent), and the site-level slot
--      already conveys "this is the header/footer" by position.
--   3. Strip the `role` field from every page section.
--
-- Yjs snapshot bytes in `site_snapshot.yjs_snapshot_bytes` are NOT
-- rewritten -- they survive as historical record per ADR 0007. The Yjs
-- decoder will be updated to ignore page-section `role` values of
-- 'header'/'footer' on snapshot restore (any pinned page section in an
-- old snapshot becomes a plain section after restore).
--
-- Idempotent: re-running the migration is a no-op once every site has
-- been rewritten.

CREATE OR REPLACE FUNCTION pg_temp.rewrite_pinned_only(state jsonb) RETURNS jsonb AS $$
DECLARE
  pages_arr jsonb;
  page jsonb;
  sections_arr jsonb;
  section jsonb;
  new_pages jsonb := '[]'::jsonb;
  new_sections jsonb;
  promoted_header jsonb := NULL;
  promoted_footer jsonb := NULL;
  site_header jsonb;
  site_footer jsonb;
  i int;
  j int;
BEGIN
  IF state IS NULL THEN
    RETURN NULL;
  END IF;

  pages_arr := COALESCE(state->'pages', '[]'::jsonb);
  site_header := state->'header';
  site_footer := state->'footer';

  -- Pass 1: rewrite every page's sections array with `role:'header'|'footer'`
  -- stripped, capturing the first found candidate for promotion if the
  -- site-level slot is empty.
  FOR i IN 0..jsonb_array_length(pages_arr) - 1 LOOP
    page := pages_arr->i;
    sections_arr := COALESCE(page->'sections', '[]'::jsonb);
    new_sections := '[]'::jsonb;

    FOR j IN 0..GREATEST(jsonb_array_length(sections_arr) - 1, -1) LOOP
      EXIT WHEN jsonb_array_length(sections_arr) = 0;
      section := sections_arr->j;

      IF section->>'role' = 'header' THEN
        IF site_header IS NULL AND promoted_header IS NULL THEN
          promoted_header := section - 'role';
        END IF;
        -- Drop the page-level pinned marker; the section becomes regular.
        new_sections := new_sections || jsonb_build_array(section - 'role');
      ELSIF section->>'role' = 'footer' THEN
        IF site_footer IS NULL AND promoted_footer IS NULL THEN
          promoted_footer := section - 'role';
        END IF;
        new_sections := new_sections || jsonb_build_array(section - 'role');
      ELSE
        new_sections := new_sections || jsonb_build_array(section);
      END IF;
    END LOOP;

    new_pages := new_pages || jsonb_build_array(jsonb_set(page, '{sections}', new_sections));
  END LOOP;

  state := jsonb_set(state, '{pages}', new_pages);

  -- Promote first found candidates into the site slot.
  IF promoted_header IS NOT NULL THEN
    state := jsonb_set(state, '{header}', promoted_header);
  END IF;
  IF promoted_footer IS NOT NULL THEN
    state := jsonb_set(state, '{footer}', promoted_footer);
  END IF;

  -- Strip `role` from site.header / site.footer if present (was redundant
  -- at site level; will be invalid after the union narrows).
  IF state->'header' IS NOT NULL THEN
    state := jsonb_set(state, '{header}', (state->'header') - 'role');
  END IF;
  IF state->'footer' IS NOT NULL THEN
    state := jsonb_set(state, '{footer}', (state->'footer') - 'role');
  END IF;

  RETURN state;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Rewrite editable_state on every site.
UPDATE site
SET editable_state = pg_temp.rewrite_pinned_only(editable_state);

-- Rewrite published_snapshot where present (nullable column).
UPDATE site
SET published_snapshot = pg_temp.rewrite_pinned_only(published_snapshot)
WHERE published_snapshot IS NOT NULL;

DROP FUNCTION pg_temp.rewrite_pinned_only(jsonb);
