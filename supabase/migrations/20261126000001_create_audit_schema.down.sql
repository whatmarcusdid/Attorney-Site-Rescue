-- Rollback for 20261126000001_create_audit_schema
-- Drops all tables and functions in reverse dependency order

-- Drop trigger and function
DROP TRIGGER IF EXISTS audit_state_updated_at ON audit_state;
DROP FUNCTION IF EXISTS update_audit_state_timestamp();

-- Drop tables (in reverse dependency order)
DROP TABLE IF EXISTS audit_state CASCADE;
DROP TABLE IF EXISTS scan_events CASCADE;
DROP TABLE IF EXISTS rate_limit_events CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS section_results CASCADE;
DROP TABLE IF EXISTS check_results CASCADE;
DROP TABLE IF EXISTS audits CASCADE;
