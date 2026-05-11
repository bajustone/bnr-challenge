-- Restricted runtime role. The bootstrap (compose entrypoint) issues
-- `ALTER ROLE app_user LOGIN PASSWORD …` so no password is in source.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;
