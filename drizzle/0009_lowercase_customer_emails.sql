-- Backfill: normalize customer.email to lowercase so that lookups from the
-- collaborator-invite endpoint (which lowercases the invitee email before
-- WHERE customer.email = ?) match rows synced before this migration.
--
-- The Clerk -> customer sync is being updated in the same change to always
-- lowercase the email on insert and on update, so this UPDATE only has to
-- run once on existing rows. New writes after this migration are already
-- normalized at the application layer.

UPDATE "customer" SET "email" = LOWER("email") WHERE "email" <> LOWER("email");
