-- Belt-and-braces invariants. Catches anyone bypassing the state machine
-- (including app_owner via raw psql).

-- applications: terminal states are final.
CREATE OR REPLACE FUNCTION applications_block_terminal_update()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'REJECTED', 'WITHDRAWN') THEN
    RAISE EXCEPTION
      'application % is in terminal state %, no further updates permitted',
      OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_applications_no_terminal_update ON applications;
CREATE TRIGGER trg_applications_no_terminal_update
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION applications_block_terminal_update();

-- audit_log: append-only.
CREATE OR REPLACE FUNCTION audit_log_no_mutate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_mutate();
