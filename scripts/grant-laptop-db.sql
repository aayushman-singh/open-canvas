-- One-shot grants for the Open Canvas app role on laptop Postgres.
-- Run as the cluster superuser (usually postgres) on the machine that
-- hosts appdb — not through the Access TCP client:
--
--   psql -h 127.0.0.1 -U postgres -d appdb -f scripts/grant-laptop-db.sql
--
-- Hyperdrive and wrangler dev connect as admin; without these grants every
-- authenticated route dies with "permission denied for table …".

GRANT USAGE ON SCHEMA public TO admin;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO admin;
