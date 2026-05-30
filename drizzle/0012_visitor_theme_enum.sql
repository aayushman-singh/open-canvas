-- ADR 0035 hard-cutover migration: visitor dark mode moves from a
-- boolean `darkModeEnabled` to a three-way enum `visitorTheme`. Both
-- fields live inside the JSONB `editable_state` and `published_snapshot`
-- columns on `site` (the canvas schema, not a DB column), so this
-- migration rewrites JSONB in place rather than ALTERing the table.
--
-- Mapping (per ADR 0035 decision 2):
--   darkModeEnabled === true  -> visitorTheme = 'toggleable'
--   darkModeEnabled === false -> remove key (default is 'light')
--   darkModeEnabled absent    -> no change (already defaults to 'light')
--
-- After the rewrite, the boolean key is dropped from every row so the
-- validator's hard-cutover rejection of `darkModeEnabled` (added in the
-- same deploy) never fires on legitimate live data.

-- editableState rewrite
UPDATE site
SET editable_state =
  CASE
    WHEN editable_state->>'darkModeEnabled' = 'true' THEN
      (editable_state - 'darkModeEnabled') || jsonb_build_object('visitorTheme', 'toggleable')
    ELSE
      editable_state - 'darkModeEnabled'
  END
WHERE editable_state ? 'darkModeEnabled';

-- publishedSnapshot rewrite (snapshot column is nullable; the WHERE
-- guard skips unpublished sites without an outer null check)
UPDATE site
SET published_snapshot =
  CASE
    WHEN published_snapshot->>'darkModeEnabled' = 'true' THEN
      (published_snapshot - 'darkModeEnabled') || jsonb_build_object('visitorTheme', 'toggleable')
    ELSE
      published_snapshot - 'darkModeEnabled'
  END
WHERE published_snapshot IS NOT NULL
  AND published_snapshot ? 'darkModeEnabled';

-- Historical snapshots in `site_snapshot.yjs_snapshot_bytes` are Yjs
-- binary encodings (per ADR 0007) and use 'darkModeEnabled' as the Y.Map
-- key. Those bytes are NOT rewritten here -- they survive as historical
-- record per the version-restore + preview pipelines. The Yjs decoder
-- (src/canvas/yjs-projection.ts) was updated to read 'visitorTheme' only;
-- a snapshot restore from before this migration would drop the dark-mode
-- flag entirely (effectively migrating it to the 'light' default on
-- restore). Acceptable per ADR 0035's hard-cutover stance: the
-- Owner-perceived loss is at most "dark-mode toggle no longer enabled
-- after restoring a pre-migration snapshot," which is correctable by
-- toggling the new enum control in Site Settings.
