# Supabase Migrations and Tests

## Directory Structure

```
supabase/
├── migrations/     # Applied migrations (versioned, sequential)
├── tests/          # Constraint and schema tests (not migrations)
└── rollback/       # Rollback scripts (manual recovery only)
```

## Migrations

Migrations in `migrations/` are applied sequentially by Supabase CLI (`supabase db push`).

**Current migrations:**
- `20261126000001_create_audit_schema.sql` - Creates all tables with constraints and RLS
- `20261126000003_atomic_rate_limit.sql` - Atomic rate limit function (secured)
- `20261126000005_revoke_truncate.sql` - Revoke ALL from anon/authenticated

### Prerequisites

**Required roles must exist before running migrations:**
- `anon` - Supabase public anonymous role
- `authenticated` - Supabase logged-in users role  
- `service_role` - Supabase service role (bypasses RLS)

Migrations 000001, 000003, and 000005 grant/revoke permissions conditionally based on role existence. If roles are missing, those operations are skipped (no error, but security may be incomplete).

### Applying Migrations

```bash
# Local Supabase (requires Supabase CLI)
supabase db push

# Or apply manually to any Postgres database (in order)
psql -d <database> -f supabase/migrations/20261126000001_create_audit_schema.sql
psql -d <database> -f supabase/migrations/20261126000003_atomic_rate_limit.sql
psql -d <database> -f supabase/migrations/20261126000005_revoke_truncate.sql
```

## Tests

Tests in `tests/` verify schema constraints and security but are **not** automatically applied.

### Running Tests

```bash
# Apply migrations first (see above)

# 1. Constraint tests (12 tests)
psql -d <database> -f supabase/tests/20261126000002_test_constraints.sql

# 2. Security tests (12 tests) - requires anon/authenticated/service_role roles
psql -d <database> -f supabase/tests/20261126000004_security_tests.sql
```

**Expected output (constraint tests):**
```
✓ TEST 1.1-1.6 PASSED (check_results constraint)
✓ TEST 2.1-2.6 PASSED (section_results constraint)
=== ALL CONSTRAINT TESTS COMPLETED SUCCESSFULLY ===
```

**Expected output (security tests):**
```
✓ TEST 1-12 PASSED
=== ALL SECURITY TESTS PASSED ===
```

**Security tests use `\set ON_ERROR_STOP on`:**
- Script exits non-zero if any security violation is detected
- Tests SELECT, INSERT, UPDATE, DELETE, TRUNCATE, EXECUTE permissions
- Verifies RLS is enabled on all 7 tables

## Rollback

Rollback scripts in `rollback/` are for **manual recovery only**. Use with caution.

### Rolling Back (Reverse Order)

```bash
# WARNING: This permanently deletes all audit data
# Apply rollbacks in REVERSE order of migrations:

# 1. Rollback 000005 (TRUNCATE permissions)
psql -d <database> -f supabase/rollback/20261126000005_rollback.sql

# 2. Rollback 000003 (rate limit function)
psql -d <database> -f supabase/rollback/20261126000003_rollback.sql

# 3. Rollback 000001 (all tables)
psql -d <database> -f supabase/rollback/20261126000001_rollback.sql
```

**What it does:**
- 000005: Grants TRUNCATE back to anon/authenticated (reverses revocation)
- 000003: Drops check_and_record_rate_limit function
- 000001: Drops all 7 tables (audits, check_results, section_results, etc.)
- Deletes data permanently (not recoverable without backup)

**When to use:**
- Development/testing: Reset schema to start fresh
- Production: Never (use Supabase migrations to evolve schema forward)

### Verifying Rollback

```bash
# Check that all tables are dropped
psql -d <database> -c "\dt"
# Expected: "Did not find any relations."
```

## Migration Development Workflow

1. **Create migration:** Add `YYYYMMDDHHMMSS_description.sql` to `migrations/`
2. **Write tests:** Add verification SQL to `tests/` (optional)
3. **Test locally:**
   ```bash
   # Create test database
   createdb test_audit
   
   # Apply migrations
   psql -d test_audit -f supabase/migrations/20261126000001_create_audit_schema.sql
   psql -d test_audit -f supabase/migrations/20261126000003_atomic_rate_limit.sql
   
   # Run tests
   psql -d test_audit -f supabase/tests/20261126000002_test_constraints.sql
   
   # Cleanup
   dropdb test_audit
   ```
4. **Write rollback:** Add rollback script to `rollback/` (name: `YYYYMMDDHHMMSS_rollback.sql`)
5. **Commit:** Commit migration, tests, and rollback together

## Why Tests Are Not Migrations

Supabase CLI treats every `.sql` file in `migrations/` as a migration to apply. If constraint tests were migrations:

1. They would insert test data into production
2. They would create/delete test audits on every deployment
3. The DO block would execute on every `supabase db push`

By keeping tests separate, we can:
- Run migrations without side effects
- Run tests on-demand for verification
- Keep test data out of production

## Why Rollbacks Are Separate

Rollback scripts are destructive and should never run automatically. They are:
- Documentation of how to undo a migration (if needed)
- Manual recovery tools (not automated)
- Kept separate to prevent accidental execution

In production, prefer forward-only migrations (add columns, don't drop) over rollbacks.
