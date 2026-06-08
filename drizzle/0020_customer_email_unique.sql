-- Add UNIQUE constraint on customer.email so the "one opencanvas customer
-- per email" invariant is physically enforced. Until this migration the
-- invariant was only an application convention, and `upsertCustomerFromClerk`
-- looked up by `clerk_user_id` only — when Clerk minted a second user for
-- the same email (e.g. password sign-up then later "Continue with Google"
-- yields a fresh clerk user id), the ON CONFLICT (clerk_user_id) clause
-- saw no conflict and inserted a duplicate customer row. The original
-- Owner's sites / assets / chat sessions / paid plan stayed wired to the
-- first row's id while the active Clerk session pointed at the new row.
--
-- This migration:
--   (1) Merges any pre-existing email duplicates. Survivor = oldest
--       created_at row for each email. All FK references from later rows
--       are repointed to the survivor; the duplicates are deleted.
--   (2) Adds the UNIQUE constraint on customer.email.
--
-- The merge is a single transaction so a failure mid-step leaves the
-- table untouched. Idempotent: re-running on an already-merged DB is a
-- no-op because the CTE selects only rows where a same-email earlier row
-- exists.
--
-- Affected FK tables (every table with `customer_id text REFERENCES
-- customer(id)`): site, site_collaborator (customer_id + invited_by),
-- owner_asset, chat_session, library_section, custom_template,
-- addon_entitlement, notification_read. Polymorphic notification rows
-- (recipient_kind='customer', recipient_id=customer.id) are also
-- repointed — those columns aren't a SQL FK but they participate in the
-- invariant.
--
-- owner_asset has UNIQUE (customer_id, content_hash). When a duplicate's
-- asset shares a content_hash with the survivor's, the duplicate row is
-- a redundant copy of the same bytes and can be dropped after redirecting
-- any slot_history references to the survivor's row. Plain UPDATE would
-- throw on the unique index; the merge uses a "redirect then delete"
-- pass for collisions.

BEGIN;

-- Survivors: oldest row per email is canonical. Build a (loser_id ->
-- survivor_id) map for everything else to use. Created as a temp table
-- so subsequent statements can reference it without re-running the
-- window function.
CREATE TEMP TABLE customer_merge_map ON COMMIT DROP AS
SELECT
  c.id AS loser_id,
  first_value(c.id) OVER (
    PARTITION BY c.email
    ORDER BY c.created_at, c.id
  ) AS survivor_id,
  c.email
FROM customer c
WHERE c.email IN (
  SELECT email FROM customer GROUP BY email HAVING count(*) > 1
);

-- Drop the survivor-points-at-self rows so the loser/survivor distinction
-- holds in subsequent UPDATEs.
DELETE FROM customer_merge_map WHERE loser_id = survivor_id;

-- ----- FK repointing pass (per-table UPDATEs) -----------------------------

-- site.customer_id (no unique constraint shared with survivor)
UPDATE site SET customer_id = m.survivor_id
FROM customer_merge_map m
WHERE site.customer_id = m.loser_id;

-- site_collaborator.customer_id has UNIQUE (site_id, customer_id) — if
-- the survivor is already a collaborator on the same site, the loser's
-- row is redundant. Delete redundancies first, then repoint the rest.
DELETE FROM site_collaborator sc
USING customer_merge_map m
WHERE sc.customer_id = m.loser_id
  AND EXISTS (
    SELECT 1 FROM site_collaborator existing
    WHERE existing.site_id = sc.site_id
      AND existing.customer_id = m.survivor_id
  );
UPDATE site_collaborator SET customer_id = m.survivor_id
FROM customer_merge_map m
WHERE site_collaborator.customer_id = m.loser_id;

-- site_collaborator.invited_by_customer_id (no unique constraint)
UPDATE site_collaborator SET invited_by_customer_id = m.survivor_id
FROM customer_merge_map m
WHERE site_collaborator.invited_by_customer_id = m.loser_id;

-- owner_asset.customer_id has UNIQUE (customer_id, content_hash).
-- Collisions = duplicates of the same bytes; redirect any slot_history
-- references to the survivor's asset, then drop the colliding loser
-- asset rows. Non-colliding rows repoint cleanly.
WITH colliding AS (
  SELECT loser.id AS loser_asset_id, surv.id AS survivor_asset_id
  FROM owner_asset loser
  JOIN customer_merge_map m ON loser.customer_id = m.loser_id
  JOIN owner_asset surv
    ON surv.customer_id = m.survivor_id
   AND surv.content_hash = loser.content_hash
)
UPDATE slot_history SET owner_asset_id = colliding.survivor_asset_id
FROM colliding
WHERE slot_history.owner_asset_id = colliding.loser_asset_id;
DELETE FROM owner_asset loser
USING customer_merge_map m, owner_asset surv
WHERE loser.customer_id = m.loser_id
  AND surv.customer_id = m.survivor_id
  AND surv.content_hash = loser.content_hash;
UPDATE owner_asset SET customer_id = m.survivor_id
FROM customer_merge_map m
WHERE owner_asset.customer_id = m.loser_id;

-- chat_session.customer_id (no unique constraint)
UPDATE chat_session SET customer_id = m.survivor_id
FROM customer_merge_map m
WHERE chat_session.customer_id = m.loser_id;

-- library_section.customer_id (no unique constraint)
UPDATE library_section SET customer_id = m.survivor_id
FROM customer_merge_map m
WHERE library_section.customer_id = m.loser_id;

-- custom_template.customer_id (no unique constraint)
UPDATE custom_template SET customer_id = m.survivor_id
FROM customer_merge_map m
WHERE custom_template.customer_id = m.loser_id;

-- addon_entitlement.customer_id has UNIQUE (customer_id, addon_id).
-- Collisions = both rows entitle the survivor to the same addon. Delete
-- the loser row in that case, then repoint the rest.
DELETE FROM addon_entitlement ae
USING customer_merge_map m
WHERE ae.customer_id = m.loser_id
  AND EXISTS (
    SELECT 1 FROM addon_entitlement existing
    WHERE existing.customer_id = m.survivor_id
      AND existing.addon_id = ae.addon_id
  );
UPDATE addon_entitlement SET customer_id = m.survivor_id
FROM customer_merge_map m
WHERE addon_entitlement.customer_id = m.loser_id;

-- notification_read.customer_id is PK (notification_id, customer_id).
-- Collisions = survivor already read the notification. Delete the loser
-- side; otherwise repoint.
DELETE FROM notification_read nr
USING customer_merge_map m
WHERE nr.customer_id = m.loser_id
  AND EXISTS (
    SELECT 1 FROM notification_read existing
    WHERE existing.notification_id = nr.notification_id
      AND existing.customer_id = m.survivor_id
  );
UPDATE notification_read SET customer_id = m.survivor_id
FROM customer_merge_map m
WHERE notification_read.customer_id = m.loser_id;

-- notification.recipient_id is polymorphic. Only the
-- recipient_kind='customer' rows participate in customer dedupe.
UPDATE notification SET recipient_id = m.survivor_id
FROM customer_merge_map m
WHERE notification.recipient_kind = 'customer'
  AND notification.recipient_id = m.loser_id;

-- ----- Drop the loser customer rows -----------------------------------
DELETE FROM customer c
USING customer_merge_map m
WHERE c.id = m.loser_id;

-- ----- Add the UNIQUE constraint --------------------------------------
ALTER TABLE customer ADD CONSTRAINT customer_email_unique UNIQUE (email);

COMMIT;
