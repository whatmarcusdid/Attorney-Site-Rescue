-- Rollback for 20261126000003_atomic_rate_limit
-- Function permissions are dropped automatically with the function

DROP FUNCTION IF EXISTS check_and_record_rate_limit(TEXT, TEXT, INTEGER, INTEGER, INET, TEXT, TEXT);
