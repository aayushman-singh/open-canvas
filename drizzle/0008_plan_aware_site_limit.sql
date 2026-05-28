CREATE OR REPLACE FUNCTION rev01_enforce_free_site_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  existing_count integer;
  plan_id text;
  site_cap integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.customer_id));

  SELECT count(*)
  INTO existing_count
  FROM "site"
  WHERE "customer_id" = NEW.customer_id;

  SELECT "plan"
  INTO plan_id
  FROM "customer"
  WHERE "id" = NEW.customer_id;

  site_cap := CASE plan_id
    WHEN 'free' THEN 3
    WHEN 'pro' THEN NULL
    WHEN 'team' THEN NULL
    ELSE 3
  END;

  IF site_cap IS NOT NULL AND existing_count >= site_cap THEN
    RAISE EXCEPTION 'site limit exceeded for customer_id=%, plan=%, cap=%',
      NEW.customer_id, COALESCE(plan_id, 'free'), site_cap
      USING ERRCODE = 'check_violation',
            HINT = 'Upgrade your plan to create more sites.';
  END IF;

  RETURN NEW;
END;
$$;
