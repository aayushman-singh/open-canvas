CREATE OR REPLACE FUNCTION rev01_enforce_free_site_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  existing_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.customer_id));

  SELECT count(*)
  INTO existing_count
  FROM "site"
  WHERE "customer_id" = NEW.customer_id;

  IF existing_count >= 3 THEN
    RAISE EXCEPTION 'free site limit exceeded for customer_id=%', NEW.customer_id
      USING ERRCODE = 'check_violation',
            HINT = 'Free plan allows up to 3 sites.';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "rev01_free_site_limit_before_insert" ON "site";
--> statement-breakpoint
CREATE TRIGGER "rev01_free_site_limit_before_insert"
BEFORE INSERT ON "site"
FOR EACH ROW
EXECUTE FUNCTION rev01_enforce_free_site_limit();
