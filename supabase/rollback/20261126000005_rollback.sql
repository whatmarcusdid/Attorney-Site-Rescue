-- Rollback: REVOKE ALL permissions
-- Reverses: 20261126000005_revoke_truncate.sql
--
-- Note: This restores the prior state by granting back the permissions
-- that older Supabase defaults typically grant (SELECT, INSERT, UPDATE, DELETE).
-- RLS and other security measures from earlier migrations remain in effect.
-- TRUNCATE is not restored (it was never granted in the first place).
-- No sequences exist (tables use UUID PKs).

-- Grant back typical Supabase default permissions to anon and authenticated
DO $$
BEGIN
  -- Grant to anon (if role exists)
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE audits TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE check_results TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE section_results TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE reports TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE rate_limit_events TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE scan_events TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE audit_state TO anon;
    
    RAISE NOTICE 'Granted SELECT, INSERT, UPDATE, DELETE to anon on all 7 tables';
  END IF;
  
  -- Grant to authenticated (if role exists)
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE audits TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE check_results TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE section_results TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE reports TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE rate_limit_events TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE scan_events TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE audit_state TO authenticated;
    
    RAISE NOTICE 'Granted SELECT, INSERT, UPDATE, DELETE to authenticated on all 7 tables';
  END IF;
END $$;
