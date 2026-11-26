# Data Retention Policy

## Overview

Attorney Site Rescue audit data has a **12-month retention requirement** (NFR-3, per SDD §6 and WI-2).

## Affected Tables

The following tables contain audit data subject to 12-month retention:

- `audits` — main audit records
- `check_results` — individual check results (cascades via FK)
- `section_results` — section aggregates (cascades via FK)
- `reports` — generated reports (cascades via FK)
- `scan_events` — workflow events (cascades via FK)
- `audit_state` — workflow state (cascades via FK)
- `rate_limit_events` — rate limit tracking (independent lifecycle)

## Retention Strategy

### Primary Key: `audits.created_at`

Records are retained based on `audits.created_at`:
- Records older than 12 months are eligible for deletion.
- Dependent records cascade automatically via `ON DELETE CASCADE` foreign keys.

### Enforcement Options

#### Option 1: Scheduled Database Job (pg_cron)

Use Supabase's `pg_cron` extension to run a monthly cleanup:

```sql
-- Enable pg_cron (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule monthly cleanup (runs at 2 AM on the 1st of each month)
SELECT cron.schedule(
  'audit-retention-cleanup',
  '0 2 1 * *', -- minute hour day month weekday
  $$
    DELETE FROM audits
    WHERE created_at < NOW() - INTERVAL '12 months'
  $$
);
```

**Pros:**
- Fully automated
- No external dependencies
- Runs inside the database

**Cons:**
- Requires `pg_cron` extension (available in Supabase)
- Large deletes may impact performance during execution window

#### Option 2: Application-Level Scheduled Job

Use Vercel Cron or a workflow to trigger cleanup:

```typescript
// app/api/cron/cleanup-old-audits/route.ts
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createAdminClient();
  
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 12);
  
  const { error, count } = await supabase
    .from('audits')
    .delete()
    .lt('created_at', cutoffDate.toISOString());
  
  if (error) {
    console.error('Cleanup failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
  
  return Response.json({ deleted: count, cutoff: cutoffDate });
}
```

**Pros:**
- Explicit control and monitoring
- Can batch deletes to avoid performance impact
- Easier to test and debug

**Cons:**
- Requires external trigger (Vercel Cron, workflow, etc.)
- Must handle failures and retries in application code

#### Option 3: Archive-Then-Delete

For compliance or audit trails, archive old records before deletion:

1. Export records to cold storage (e.g., Supabase Storage, S3)
2. Delete from primary tables
3. Keep archive references for compliance

```sql
-- Example: Archive to a separate table before deletion
INSERT INTO audits_archive 
SELECT * FROM audits 
WHERE created_at < NOW() - INTERVAL '12 months';

DELETE FROM audits 
WHERE created_at < NOW() - INTERVAL '12 months';
```

**Pros:**
- Preserves historical data for compliance
- Can restore if needed

**Cons:**
- Increased storage costs
- More complex cleanup logic

## Rate Limit Events

`rate_limit_events` has an independent lifecycle and shorter retention:

- **IP events:** Retained for 1 hour (window size)
- **Email events:** Retained for 24 hours (window size)
- Cleanup based on `rate_limit_events.expires_at`

Recommended cleanup (more frequent than audit data):

```sql
-- Clean up expired rate limit events (run hourly)
DELETE FROM rate_limit_events
WHERE expires_at < NOW();
```

This can be a separate `pg_cron` job or combined with audit cleanup.

## Current State

As of migration `20261126000001_create_audit_schema`:

- ✅ Schema created with cascade constraints
- ✅ Retention requirement documented
- ⏳ Automated cleanup **not yet implemented**

**Next steps:**

1. Choose enforcement option (recommend Option 1: pg_cron for simplicity)
2. Implement and test cleanup job
3. Set up monitoring/alerting for cleanup failures
4. Document manual cleanup procedure for edge cases

## Manual Cleanup

If automated cleanup is unavailable, run this query monthly:

```sql
-- Preview count before deletion
SELECT COUNT(*) FROM audits 
WHERE created_at < NOW() - INTERVAL '12 months';

-- Delete (cascades to all dependent tables)
DELETE FROM audits 
WHERE created_at < NOW() - INTERVAL '12 months';

-- Verify cleanup
SELECT MIN(created_at) as oldest_audit FROM audits;
```

**Warning:** This will permanently delete records and all dependent data. Ensure backups are current before running manually.

## Monitoring

Recommended metrics:

- Total audit count
- Oldest audit age
- Cleanup execution frequency and duration
- Cleanup deletion count per run

Add these to observability dashboards (e.g., Vercel Analytics, Datadog).
