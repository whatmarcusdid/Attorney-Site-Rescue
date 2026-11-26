-- REVOKE ALL permissions from anon and authenticated roles
-- Migration: 20261126000005_revoke_truncate
-- For: B2 audit schema security hardening
--
-- Context: Older Supabase defaults grant SELECT, INSERT, UPDATE, DELETE
-- to anon and authenticated roles on new tables. This migration explicitly
-- revokes ALL privileges to enforce zero access via PostgREST.
-- Only service_role (which bypasses RLS) should have access.

-- Revoke ALL from all 7 tables (no sequences - tables use UUID PKs)
DO $$
BEGIN
  -- Revoke from anon (if role exists)
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE audits FROM anon;
    REVOKE ALL ON TABLE check_results FROM anon;
    REVOKE ALL ON TABLE section_results FROM anon;
    REVOKE ALL ON TABLE reports FROM anon;
    REVOKE ALL ON TABLE rate_limit_events FROM anon;
    REVOKE ALL ON TABLE scan_events FROM anon;
    REVOKE ALL ON TABLE audit_state FROM anon;
    
    RAISE NOTICE 'Revoked ALL from anon on all 7 tables';
  END IF;
  
  -- Revoke from authenticated (if role exists)
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE audits FROM authenticated;
    REVOKE ALL ON TABLE check_results FROM authenticated;
    REVOKE ALL ON TABLE section_results FROM authenticated;
    REVOKE ALL ON TABLE reports FROM authenticated;
    REVOKE ALL ON TABLE rate_limit_events FROM authenticated;
    REVOKE ALL ON TABLE scan_events FROM authenticated;
    REVOKE ALL ON TABLE audit_state FROM authenticated;
    
    RAISE NOTICE 'Revoked ALL from authenticated on all 7 tables';
  END IF;
END $$;

COMMENT ON TABLE audits IS 'Website audit records. ALL privileges revoked from anon/authenticated.';
COMMENT ON TABLE rate_limit_events IS 'Rate limiting events. ALL privileges revoked from anon/authenticated.';
