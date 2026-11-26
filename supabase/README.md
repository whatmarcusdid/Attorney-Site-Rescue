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
- `20261126000001_create_audit_schema.sql` - Creates all tables with constraints
- `20261126000003_atomic_rate_limit.sql` - Atomic rate limit function

### Applying Migrations

```bash
# Local Supabase (requires Supabase CLI)
supabase db push

# Or apply manually to any Postgres database
psql -d <database> -f supabase/migrations/20261126000001_create_audit_schema.sql
psql -d <database> -f supabase/migrations/20261126000003_atomic_rate_limit.sql
```

## Tests

Tests in `tests/` verify schema constraints but are **not** automatically applied.

### Running Constraint Tests

```bash
# Apply migrations first (see above)
psql -d <database> -f supabase/tests/20261126000002_test_constraints.sql
```

**Expected output:**
```
✓ TEST 1.1-1.6 PASSED (check_results constraint)
✓ TEST 2.1-2.6 PASSED (section_results constraint)
=== ALL CONSTRAINT TESTS COMPLETED SUCCESSFULLY ===
```

The test script:
1. Creates a test audit
2. Runs 12 constraint tests (6 for each rule)
3. Cleans up test data
4. Reports pass/fail for each test

## Rollback

Rollback scripts in `rollback/` are for **manual recovery only**. Use with caution.

### Rolling Back

```bash
# WARNING: This permanently deletes all audit data
psql -d <database> -f supabase/rollback/20261126000001_rollback.sql
```

**What it does:**
- Drops all tables (audits, check_results, section_results, etc.)
- Drops triggers and functions
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
