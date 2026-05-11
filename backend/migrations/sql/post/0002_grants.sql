-- Grants for app_user. Lever behind "audit_log is append-only at the engine level":
-- even a buggy handler cannot UPDATE/DELETE/TRUNCATE audit_log via DATABASE_URL.

GRANT SELECT, INSERT, UPDATE, DELETE ON
    users,
    sessions,
    accounts,
    verifications,
    user_roles,
    applications,
    documents,
    document_blobs
  TO app_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- review_notes: append-only commentary. audit_log row per insert covers tamper-evidence.
GRANT SELECT, INSERT ON review_notes TO app_user;
REVOKE UPDATE, DELETE, TRUNCATE ON review_notes FROM app_user;

-- audit_log: INSERT only.
GRANT SELECT, INSERT ON audit_log TO app_user;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_user;

-- Defaults for tables created by future migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
