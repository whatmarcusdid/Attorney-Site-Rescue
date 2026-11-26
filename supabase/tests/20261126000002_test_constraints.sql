-- Constraint tests for 20261126000001_create_audit_schema
-- Tests:
-- 1. check_results_scoring_requires_completion: not checked never scores
-- 2. section_results_grade_requires_data: no data never an F

-- =============================================================================
-- TEST SETUP
-- =============================================================================

-- Create test audit
DO $$
DECLARE
  test_audit_id UUID;
  test_check_id UUID;
  test_section_id UUID;
BEGIN
  -- Insert test audit
  INSERT INTO audits (website_url, email, first_name, audit_status)
  VALUES ('https://test.example.com', 'test@example.com', 'Test', 'in_progress')
  RETURNING audit_id INTO test_audit_id;
  
  RAISE NOTICE 'Created test audit: %', test_audit_id;
  
  -- =============================================================================
  -- TEST 1: check_results_scoring_requires_completion
  -- Rule: A check that was not run can never contribute to a score
  -- =============================================================================
  
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 1: check_results_scoring_requires_completion ===';
  
  -- TEST 1.1: Valid completed check with score (should succeed)
  BEGIN
    INSERT INTO check_results (
      audit_id, check_key, section_key, status, passed, score
    ) VALUES (
      test_audit_id, 'test_check_valid', 'security', 'completed', true, 85
    );
    RAISE NOTICE '✓ TEST 1.1 PASSED: Completed check with score accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION '✗ TEST 1.1 FAILED: Completed check with score rejected (should succeed)';
  END;
  
  -- TEST 1.2: Failed check with NULL score (should succeed)
  BEGIN
    INSERT INTO check_results (
      audit_id, check_key, section_key, status, passed, score, error_message
    ) VALUES (
      test_audit_id, 'test_check_failed', 'security', 'failed', NULL, NULL, 'Network timeout'
    );
    RAISE NOTICE '✓ TEST 1.2 PASSED: Failed check with NULL score accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION '✗ TEST 1.2 FAILED: Failed check with NULL score rejected (should succeed)';
  END;
  
  -- TEST 1.3: Skipped check with NULL score (should succeed)
  BEGIN
    INSERT INTO check_results (
      audit_id, check_key, section_key, status, passed, score
    ) VALUES (
      test_audit_id, 'test_check_skipped', 'seo', 'skipped', NULL, NULL
    );
    RAISE NOTICE '✓ TEST 1.3 PASSED: Skipped check with NULL score accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION '✗ TEST 1.3 FAILED: Skipped check with NULL score rejected (should succeed)';
  END;
  
  -- TEST 1.4: Failed check with score (should FAIL - violates constraint)
  BEGIN
    INSERT INTO check_results (
      audit_id, check_key, section_key, status, passed, score
    ) VALUES (
      test_audit_id, 'test_check_invalid_1', 'security', 'failed', NULL, 50
    );
    RAISE EXCEPTION '✗ TEST 1.4 FAILED: Failed check with score accepted (should reject)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 1.4 PASSED: Failed check with score rejected (constraint enforced)';
  END;
  
  -- TEST 1.5: Skipped check with passed=true (should FAIL - violates constraint)
  BEGIN
    INSERT INTO check_results (
      audit_id, check_key, section_key, status, passed, score
    ) VALUES (
      test_audit_id, 'test_check_invalid_2', 'security', 'skipped', true, NULL
    );
    RAISE EXCEPTION '✗ TEST 1.5 FAILED: Skipped check with passed=true accepted (should reject)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 1.5 PASSED: Skipped check with passed=true rejected (constraint enforced)';
  END;
  
  -- TEST 1.6: Completed check with NULL passed (should FAIL - violates constraint)
  BEGIN
    INSERT INTO check_results (
      audit_id, check_key, section_key, status, passed, score
    ) VALUES (
      test_audit_id, 'test_check_invalid_3', 'security', 'completed', NULL, 75
    );
    RAISE EXCEPTION '✗ TEST 1.6 FAILED: Completed check with NULL passed accepted (should reject)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 1.6 PASSED: Completed check with NULL passed rejected (constraint enforced)';
  END;
  
  -- =============================================================================
  -- TEST 2: section_results_grade_requires_data
  -- Rule: A section with no checks run has no letter grade (never an F)
  -- =============================================================================
  
  RAISE NOTICE '';
  RAISE NOTICE '=== TEST 2: section_results_grade_requires_data ===';
  
  -- TEST 2.1: Section with checks_run > 0 and a grade (should succeed)
  BEGIN
    INSERT INTO section_results (
      audit_id, section_key, status, letter_grade, numeric_score,
      checks_run, checks_passed, checks_failed
    ) VALUES (
      test_audit_id, 'security', 'completed', 'B', 85,
      5, 4, 1
    );
    RAISE NOTICE '✓ TEST 2.1 PASSED: Section with checks and grade accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION '✗ TEST 2.1 FAILED: Section with checks and grade rejected (should succeed)';
  END;
  
  -- TEST 2.2: Section with checks_run = 0 and no grade (should succeed)
  BEGIN
    INSERT INTO section_results (
      audit_id, section_key, status, letter_grade, numeric_score,
      checks_run, checks_passed, checks_failed
    ) VALUES (
      test_audit_id, 'seo', 'failed', NULL, NULL,
      0, 0, 0
    );
    RAISE NOTICE '✓ TEST 2.2 PASSED: Section with no checks and no grade accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION '✗ TEST 2.2 FAILED: Section with no checks and no grade rejected (should succeed)';
  END;
  
  -- TEST 2.3: Section with checks_run = 0 but assigned grade 'F' (should FAIL)
  BEGIN
    INSERT INTO section_results (
      audit_id, section_key, status, letter_grade, numeric_score,
      checks_run, checks_passed, checks_failed
    ) VALUES (
      test_audit_id, 'performance', 'failed', 'F', 0,
      0, 0, 0
    );
    RAISE EXCEPTION '✗ TEST 2.3 FAILED: Section with no checks but grade F accepted (should reject)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 2.3 PASSED: Section with no checks but grade F rejected (constraint enforced)';
  END;
  
  -- TEST 2.4: Section with checks_run = 0 but assigned grade 'A' (should FAIL)
  BEGIN
    INSERT INTO section_results (
      audit_id, section_key, status, letter_grade, numeric_score,
      checks_run, checks_passed, checks_failed
    ) VALUES (
      test_audit_id, 'ux', 'completed', 'A', 100,
      0, 0, 0
    );
    RAISE EXCEPTION '✗ TEST 2.4 FAILED: Section with no checks but grade A accepted (should reject)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 2.4 PASSED: Section with no checks but grade A rejected (constraint enforced)';
  END;
  
  -- TEST 2.5: Section with checks_run > 0 but no grade (should FAIL)
  BEGIN
    INSERT INTO section_results (
      audit_id, section_key, status, letter_grade, numeric_score,
      checks_run, checks_passed, checks_failed
    ) VALUES (
      test_audit_id, 'accessibility', 'completed', NULL, 75,
      3, 2, 1
    );
    RAISE EXCEPTION '✗ TEST 2.5 FAILED: Section with checks but no grade accepted (should reject)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 2.5 PASSED: Section with checks but no grade rejected (constraint enforced)';
  END;
  
  -- TEST 2.6: Section with inconsistent check counts (should FAIL)
  BEGIN
    INSERT INTO section_results (
      audit_id, section_key, status, letter_grade, numeric_score,
      checks_run, checks_passed, checks_failed
    ) VALUES (
      test_audit_id, 'other', 'completed', 'C', 70,
      3, 2, 2  -- passed + failed > checks_run
    );
    RAISE EXCEPTION '✗ TEST 2.6 FAILED: Section with inconsistent counts accepted (should reject)';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 2.6 PASSED: Section with inconsistent counts rejected (constraint enforced)';
  END;
  
  -- =============================================================================
  -- TEST CLEANUP
  -- =============================================================================
  
  -- Clean up test data
  DELETE FROM audits WHERE audit_id = test_audit_id;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== ALL CONSTRAINT TESTS COMPLETED SUCCESSFULLY ===';
  RAISE NOTICE 'Constraint 1 (not checked never scores): ✓ Enforced';
  RAISE NOTICE 'Constraint 2 (no data never an F): ✓ Enforced';
  
END $$;
