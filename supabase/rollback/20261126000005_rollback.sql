-- Rollback: REVOKE TRUNCATE permissions
-- Reverses: 20261126000005_revoke_truncate.sql
--
-- Note: This grants TRUNCATE back, but RLS and other security
-- measures from earlier migrations remain in effect.

-- Grant TRUNCATE back to anon and authenticated (if they exist)
DO $$
BEGIN
  -- Grant to anon (if role exists)
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT TRUNCATE ON TABLE audits TO anon;
    GRANT TRUNCATE ON TABLE check_results TO anon;
    GRANT TRUNCATE ON TABLE section_results TO anon;
    GRANT TRUNCATE ON TABLE reports TO anon;
    GRANT TRUNCATE ON TABLE rate_limit_events TO anon;
    GRANT TRUNCATE ON TABLE scan_events TO anon;
    GRANT TRUNCATE ON TABLE audit_state TO anon;
    RAISE NOTICE 'Granted TRUNCATE to anon on all 7 tables';
  END IF;
  
  -- Grant to authenticated (if role exists)
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT TRUNCATE ON TABLE audits TO authenticated;
    GRANT TRUNCATE ON TABLE check_results TO authenticated;
    GRANT TRUNCATE ON TABLE section_results TO authenticated;
    GRANT TRUNCATE ON TABLE reports TO authenticated;
    GRANT TRUNCATE ON TABLE rate_limit_events TO authenticated;
    GRANT TRUNCATE ON TABLE scan_events TO authenticated;
    GRANT TRUNCATE ON TABLE audit_state TO authenticated;
    RAISE NOTICE 'Granted TRUNCATE to authenticated on all 7 tables';
  END IF;
END $$;
