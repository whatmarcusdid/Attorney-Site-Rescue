-- REVOKE TRUNCATE permissions from anon and authenticated roles
-- Migration: 20261126000005_revoke_truncate
-- For: B2 audit schema security hardening
--
-- Context: TRUNCATE bypasses RLS and can wipe tables.
-- Even though anon/authenticated have no other permissions,
-- explicitly revoke TRUNCATE for defense in depth.

-- Revoke TRUNCATE from all 7 tables
DO $$
BEGIN
  -- Revoke from anon (if role exists)
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE TRUNCATE ON TABLE audits FROM anon;
    REVOKE TRUNCATE ON TABLE check_results FROM anon;
    REVOKE TRUNCATE ON TABLE section_results FROM anon;
    REVOKE TRUNCATE ON TABLE reports FROM anon;
    REVOKE TRUNCATE ON TABLE rate_limit_events FROM anon;
    REVOKE TRUNCATE ON TABLE scan_events FROM anon;
    REVOKE TRUNCATE ON TABLE audit_state FROM anon;
    RAISE NOTICE 'Revoked TRUNCATE from anon on all 7 tables';
  END IF;
  
  -- Revoke from authenticated (if role exists)
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE TRUNCATE ON TABLE audits FROM authenticated;
    REVOKE TRUNCATE ON TABLE check_results FROM authenticated;
    REVOKE TRUNCATE ON TABLE section_results FROM authenticated;
    REVOKE TRUNCATE ON TABLE reports FROM authenticated;
    REVOKE TRUNCATE ON TABLE rate_limit_events FROM authenticated;
    REVOKE TRUNCATE ON TABLE scan_events FROM authenticated;
    REVOKE TRUNCATE ON TABLE audit_state FROM authenticated;
    RAISE NOTICE 'Revoked TRUNCATE from authenticated on all 7 tables';
  END IF;
END $$;

COMMENT ON TABLE audits IS 'Website audit records. TRUNCATE revoked from anon/authenticated.';
COMMENT ON TABLE rate_limit_events IS 'Rate limiting events. TRUNCATE revoked from anon/authenticated.';
