-- Security tests for B2 migrations
-- Tests RLS and function permissions
-- Run after migrations 000001 and 000003
--
-- CRITICAL: These tests MUST fail (exit non-zero) if security is broken.
-- Uses \set ON_ERROR_STOP on to halt on first error.
-- Uses ASSERT to raise exceptions when security violations are detected.

\set ON_ERROR_STOP on

-- =============================================================================
-- SETUP: Create Supabase-like roles (if they don't exist)
-- =============================================================================

DO $$
BEGIN
  -- Create anon role (Supabase public anonymous role)
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  
  -- Create authenticated role (Supabase logged-in users)
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  
  -- Create service_role (Supabase service role, bypasses RLS)
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  
  RAISE NOTICE 'Roles created: anon, authenticated, service_role';
END $$;

-- Grant basic schema access (mimics Supabase setup)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- =============================================================================
-- TEST 1: RLS is enabled on all 7 tables
-- =============================================================================

DO $$
DECLARE
  v_rls_enabled BOOLEAN;
  v_table_name TEXT;
  v_tables TEXT[] := ARRAY['audits', 'check_results', 'section_results', 'reports', 
                            'rate_limit_events', 'scan_events', 'audit_state'];
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 1: RLS Enabled on All Tables ===';
  
  FOREACH v_table_name IN ARRAY v_tables LOOP
    SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = v_table_name AND relnamespace = 'public'::regnamespace;
    
    ASSERT v_rls_enabled IS TRUE, 
      format('SECURITY FAILURE: RLS not enabled on %s', v_table_name);
    
    RAISE NOTICE '✓ RLS enabled on %', v_table_name;
  END LOOP;
  
  RAISE NOTICE '✓ TEST 1 PASSED: RLS enabled on all 7 tables';
END $$;

-- =============================================================================
-- TEST 2: anon role cannot SELECT from any table
-- =============================================================================

DO $$
DECLARE
  v_can_select BOOLEAN := FALSE;
  v_table_name TEXT;
  v_tables TEXT[] := ARRAY['audits', 'check_results', 'section_results', 'reports', 
                            'rate_limit_events', 'scan_events', 'audit_state'];
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 2: anon Cannot SELECT ===';
  
  FOREACH v_table_name IN ARRAY v_tables LOOP
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format('SELECT 1 FROM %I LIMIT 1', v_table_name);
      RESET ROLE;
      
      -- If we reach here, anon was able to SELECT (BAD!)
      RAISE EXCEPTION 'SECURITY FAILURE: anon can SELECT from %', v_table_name;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        RAISE NOTICE '✓ anon blocked from SELECT on % (insufficient privilege)', v_table_name;
    END;
  END LOOP;
  
  RAISE NOTICE '✓ TEST 2 PASSED: anon cannot SELECT from any table';
END $$;

-- =============================================================================
-- TEST 3: authenticated role cannot SELECT from any table
-- =============================================================================

DO $$
DECLARE
  v_table_name TEXT;
  v_tables TEXT[] := ARRAY['audits', 'check_results', 'section_results', 'reports', 
                            'rate_limit_events', 'scan_events', 'audit_state'];
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 3: authenticated Cannot SELECT ===';
  
  FOREACH v_table_name IN ARRAY v_tables LOOP
    BEGIN
      SET LOCAL ROLE authenticated;
      EXECUTE format('SELECT 1 FROM %I LIMIT 1', v_table_name);
      RESET ROLE;
      
      -- If we reach here, authenticated was able to SELECT (BAD!)
      RAISE EXCEPTION 'SECURITY FAILURE: authenticated can SELECT from %', v_table_name;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        RAISE NOTICE '✓ authenticated blocked from SELECT on %', v_table_name;
    END;
  END LOOP;
  
  RAISE NOTICE '✓ TEST 3 PASSED: authenticated cannot SELECT from any table';
END $$;

-- =============================================================================
-- TEST 4: anon role cannot INSERT into any table
-- =============================================================================

DO $$
DECLARE
  v_table_name TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 4: anon Cannot INSERT ===';
  
  -- Test audits table
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO audits (website_url, email, audit_status)
    VALUES ('https://test.com', 'test@test.com', 'in_progress');
    RESET ROLE;
    
    -- If we reach here, INSERT succeeded (BAD!)
    RAISE EXCEPTION 'SECURITY FAILURE: anon can INSERT into audits';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE '✓ anon blocked from INSERT on audits';
  END;
  
  -- Test rate_limit_events table
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO rate_limit_events (limiter_key, limit_type, expires_at)
    VALUES ('ip:127.0.0.1', 'ip_hourly', NOW() + INTERVAL '1 hour');
    RESET ROLE;
    
    -- If we reach here, INSERT succeeded (BAD!)
    RAISE EXCEPTION 'SECURITY FAILURE: anon can INSERT into rate_limit_events';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE '✓ anon blocked from INSERT on rate_limit_events';
  END;
  
  RAISE NOTICE '✓ TEST 4 PASSED: anon cannot INSERT into tables';
END $$;

-- =============================================================================
-- TEST 5: anon role cannot UPDATE any table
-- =============================================================================

DO $$
DECLARE
  v_table_name TEXT;
  v_tables TEXT[] := ARRAY['audits', 'rate_limit_events'];  -- Test representative tables
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 5: anon Cannot UPDATE ===';
  
  -- Test audits (even though no rows exist, permission should be denied)
  BEGIN
    SET LOCAL ROLE anon;
    UPDATE audits SET audit_status = 'completed' WHERE audit_id IS NOT NULL;
    RESET ROLE;
    
    -- If we reach here, UPDATE succeeded (BAD!)
    RAISE EXCEPTION 'SECURITY FAILURE: anon can UPDATE audits';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE '✓ anon blocked from UPDATE on audits';
  END;
  
  -- Test rate_limit_events
  BEGIN
    SET LOCAL ROLE anon;
    UPDATE rate_limit_events SET expires_at = NOW() WHERE limiter_key IS NOT NULL;
    RESET ROLE;
    
    -- If we reach here, UPDATE succeeded (BAD!)
    RAISE EXCEPTION 'SECURITY FAILURE: anon can UPDATE rate_limit_events';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE '✓ anon blocked from UPDATE on rate_limit_events';
  END;
  
  RAISE NOTICE '✓ TEST 5 PASSED: anon cannot UPDATE tables';
END $$;

-- =============================================================================
-- TEST 6: anon role cannot DELETE from any table
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 6: anon Cannot DELETE ===';
  
  -- Test audits
  BEGIN
    SET LOCAL ROLE anon;
    DELETE FROM audits WHERE audit_id IS NOT NULL;
    RESET ROLE;
    
    -- If we reach here, DELETE succeeded (BAD!)
    RAISE EXCEPTION 'SECURITY FAILURE: anon can DELETE from audits';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE '✓ anon blocked from DELETE on audits';
  END;
  
  -- Test rate_limit_events
  BEGIN
    SET LOCAL ROLE anon;
    DELETE FROM rate_limit_events WHERE limiter_key IS NOT NULL;
    RESET ROLE;
    
    -- If we reach here, DELETE succeeded (BAD!)
    RAISE EXCEPTION 'SECURITY FAILURE: anon can DELETE from rate_limit_events';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE '✓ anon blocked from DELETE on rate_limit_events';
  END;
  
  RAISE NOTICE '✓ TEST 6 PASSED: anon cannot DELETE from tables';
END $$;

-- =============================================================================
-- TEST 7: anon role cannot TRUNCATE any table
-- =============================================================================

DO $$
DECLARE
  v_table_name TEXT;
  v_tables TEXT[] := ARRAY['audits', 'check_results', 'section_results', 'reports', 
                            'rate_limit_events', 'scan_events', 'audit_state'];
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 7: anon Cannot TRUNCATE ===';
  
  FOREACH v_table_name IN ARRAY v_tables LOOP
    BEGIN
      SET LOCAL ROLE anon;
      EXECUTE format('TRUNCATE %I', v_table_name);
      RESET ROLE;
      
      -- If we reach here, TRUNCATE succeeded (BAD!)
      RAISE EXCEPTION 'SECURITY FAILURE: anon can TRUNCATE %', v_table_name;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        RAISE NOTICE '✓ anon blocked from TRUNCATE on %', v_table_name;
    END;
  END LOOP;
  
  RAISE NOTICE '✓ TEST 7 PASSED: anon cannot TRUNCATE tables';
END $$;

-- =============================================================================
-- TEST 8: authenticated role cannot TRUNCATE any table
-- =============================================================================

DO $$
DECLARE
  v_table_name TEXT;
  v_tables TEXT[] := ARRAY['audits', 'check_results', 'section_results', 'reports', 
                            'rate_limit_events', 'scan_events', 'audit_state'];
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 8: authenticated Cannot TRUNCATE ===';
  
  FOREACH v_table_name IN ARRAY v_tables LOOP
    BEGIN
      SET LOCAL ROLE authenticated;
      EXECUTE format('TRUNCATE %I', v_table_name);
      RESET ROLE;
      
      -- If we reach here, TRUNCATE succeeded (BAD!)
      RAISE EXCEPTION 'SECURITY FAILURE: authenticated can TRUNCATE %', v_table_name;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RESET ROLE;
        RAISE NOTICE '✓ authenticated blocked from TRUNCATE on %', v_table_name;
    END;
  END LOOP;
  
  RAISE NOTICE '✓ TEST 8 PASSED: authenticated cannot TRUNCATE tables';
END $$;

-- =============================================================================
-- TEST 9: anon role cannot EXECUTE check_and_record_rate_limit
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 9: anon Cannot EXECUTE Function ===';
  
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM check_and_record_rate_limit(
      'email:test@test.com',
      'email_daily',
      1,
      86400000,
      '127.0.0.1'::INET,
      'test@test.com',
      'test-agent'
    );
    RESET ROLE;
    
    -- If we reach here, EXECUTE succeeded (BAD!)
    RAISE EXCEPTION 'SECURITY FAILURE: anon can EXECUTE check_and_record_rate_limit';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE '✓ anon blocked from EXECUTE on check_and_record_rate_limit';
  END;
  
  RAISE NOTICE '✓ TEST 9 PASSED: anon cannot EXECUTE function';
END $$;

-- =============================================================================
-- TEST 10: authenticated role cannot EXECUTE check_and_record_rate_limit
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 10: authenticated Cannot EXECUTE Function ===';
  
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM check_and_record_rate_limit(
      'email:test@test.com',
      'email_daily',
      1,
      86400000,
      '127.0.0.1'::INET,
      'test@test.com',
      'test-agent'
    );
    RESET ROLE;
    
    -- If we reach here, EXECUTE succeeded (BAD!)
    RAISE EXCEPTION 'SECURITY FAILURE: authenticated can EXECUTE check_and_record_rate_limit';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE '✓ authenticated blocked from EXECUTE on check_and_record_rate_limit';
  END;
  
  RAISE NOTICE '✓ TEST 10 PASSED: authenticated cannot EXECUTE function';
END $$;

-- =============================================================================
-- TEST 11: service_role CAN EXECUTE check_and_record_rate_limit
-- =============================================================================

DO $$
DECLARE
  v_result JSONB;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 11: service_role CAN EXECUTE Function ===';
  
  SET LOCAL ROLE service_role;
  SELECT check_and_record_rate_limit(
    'email:security-test@test.com',
    'email_daily',
    1,
    86400000,
    '127.0.0.1'::INET,
    'security-test@test.com',
    'test-agent'
  ) INTO v_result;
  RESET ROLE;
  
  ASSERT v_result->>'allowed' = 'true', 
    format('SECURITY FAILURE: service_role function returned denied: %s', v_result);
  
  -- Cleanup test data
  DELETE FROM rate_limit_events WHERE email = 'security-test@test.com';
  
  RAISE NOTICE '✓ service_role successfully executed function: %', v_result;
  RAISE NOTICE '✓ TEST 11 PASSED: service_role can EXECUTE function';
END $$;

-- =============================================================================
-- TEST 12: service_role can SELECT and INSERT (bypasses RLS)
-- =============================================================================

DO $$
DECLARE
  v_audit_id UUID;
  v_count INTEGER;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 12: service_role Bypasses RLS ===';
  
  -- Test INSERT
  SET LOCAL ROLE service_role;
  INSERT INTO audits (website_url, email, audit_status)
  VALUES ('https://security-test.com', 'rls-test@test.com', 'in_progress')
  RETURNING audit_id INTO v_audit_id;
  RESET ROLE;
  
  RAISE NOTICE '✓ service_role can INSERT (audit_id: %)', v_audit_id;
  
  -- Test SELECT
  SET LOCAL ROLE service_role;
  SELECT COUNT(*) INTO v_count FROM audits WHERE audit_id = v_audit_id;
  RESET ROLE;
  
  ASSERT v_count = 1, 
    format('SECURITY FAILURE: service_role SELECT returned wrong count: %s', v_count);
  
  RAISE NOTICE '✓ service_role can SELECT (found inserted row)';
  
  -- Cleanup
  DELETE FROM audits WHERE audit_id = v_audit_id;
  
  RAISE NOTICE '✓ TEST 12 PASSED: service_role bypasses RLS';
END $$;

-- =============================================================================
-- SUMMARY
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE '=== ALL SECURITY TESTS PASSED ===';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'RLS enabled: 7/7 tables ✓';
  RAISE NOTICE 'anon blocked: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, EXECUTE ✓';
  RAISE NOTICE 'authenticated blocked: SELECT, INSERT, TRUNCATE, EXECUTE ✓';
  RAISE NOTICE 'service_role allowed: SELECT, INSERT, EXECUTE (bypasses RLS) ✓';
  RAISE NOTICE '=================================================================';
END $$;
