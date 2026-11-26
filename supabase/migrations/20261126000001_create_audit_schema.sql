-- Attorney Site Rescue: Audit schema foundation
-- Migration: 20261126000001_create_audit_schema
-- Creates: audits, check_results, section_results, reports, rate_limit_events tables
-- Constraints: not-checked-never-scores, no-data-never-F

-- =============================================================================
-- AUDITS TABLE
-- =============================================================================
-- Main audit record. One row per audit request.
-- Includes UTM tracking (source, medium, campaign, term, content) and referrer.
-- 12-month retention: see docs/RETENTION.md for enforcement strategy.

CREATE TABLE audits (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identity
  website_url TEXT NOT NULL,
  email TEXT NOT NULL, -- normalized: lowercase, trimmed
  first_name TEXT,
  business_name TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  audit_status TEXT NOT NULL DEFAULT 'in_progress' 
    CHECK (audit_status IN ('in_progress', 'completed', 'partial', 'failed')),
  schema_version TEXT NOT NULL DEFAULT 'v1',
  
  -- Traffic source tracking (Decision 1: approved by Marcus)
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  referrer TEXT,
  
  -- Client metadata
  client_ip INET,
  user_agent TEXT,
  
  -- Indexes
  CONSTRAINT audits_email_check CHECK (email = LOWER(TRIM(email)))
);

CREATE INDEX idx_audits_created_at ON audits(created_at DESC);
CREATE INDEX idx_audits_email ON audits(email);
CREATE INDEX idx_audits_status ON audits(audit_status);
CREATE INDEX idx_audits_email_created ON audits(email, created_at DESC);

COMMENT ON TABLE audits IS 'Main audit records with UTM tracking. Retention: 12 months (see docs/RETENTION.md).';
COMMENT ON COLUMN audits.email IS 'Normalized: lowercase, trimmed. Constraint enforced.';
COMMENT ON COLUMN audits.schema_version IS 'Schema version for forward compatibility.';

-- =============================================================================
-- CHECK_RESULTS TABLE
-- =============================================================================
-- Individual check results. Each check is atomic and can soft-fail independently.
-- Constraint: A check must have status='completed' to contribute to scoring.

CREATE TABLE check_results (
  check_result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(audit_id) ON DELETE CASCADE,
  
  -- Check identity
  check_key TEXT NOT NULL, -- e.g., 'ssl_certificate', 'meta_description', 'page_speed'
  section_key TEXT NOT NULL, -- e.g., 'security', 'seo', 'performance'
  
  -- Result
  status TEXT NOT NULL 
    CHECK (status IN ('completed', 'failed', 'skipped')),
  passed BOOLEAN, -- NULL when status != 'completed'
  score NUMERIC, -- NULL when status != 'completed', 0-100 scale where applicable
  details JSONB, -- check-specific output
  error_message TEXT, -- populated when status = 'failed'
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Constraint: scoring only valid for completed checks
  CONSTRAINT check_results_scoring_requires_completion 
    CHECK (
      (status = 'completed' AND passed IS NOT NULL) OR
      (status != 'completed' AND passed IS NULL AND score IS NULL)
    )
);

CREATE INDEX idx_check_results_audit ON check_results(audit_id);
CREATE INDEX idx_check_results_section ON check_results(audit_id, section_key);
CREATE INDEX idx_check_results_key ON check_results(check_key);

COMMENT ON TABLE check_results IS 'Individual check results. Constraint: only completed checks can have scores.';
COMMENT ON CONSTRAINT check_results_scoring_requires_completion ON check_results 
  IS 'Enforces: not checked never scores. A check must complete to contribute passed/score values.';

-- =============================================================================
-- SECTION_RESULTS TABLE
-- =============================================================================
-- Aggregated section results (e.g., security, SEO, performance).
-- Constraint: A section with no completed checks cannot have a letter grade.

CREATE TABLE section_results (
  section_result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(audit_id) ON DELETE CASCADE,
  
  -- Section identity
  section_key TEXT NOT NULL, -- e.g., 'security', 'seo', 'performance'
  
  -- Aggregated results
  status TEXT NOT NULL 
    CHECK (status IN ('completed', 'partial', 'failed')),
  letter_grade TEXT CHECK (letter_grade IN ('A', 'B', 'C', 'D', 'F')), -- NULL when insufficient data
  numeric_score NUMERIC CHECK (numeric_score >= 0 AND numeric_score <= 100),
  checks_run INTEGER NOT NULL DEFAULT 0,
  checks_passed INTEGER NOT NULL DEFAULT 0,
  checks_failed INTEGER NOT NULL DEFAULT 0,
  
  -- Narrative
  narrative TEXT,
  failing_signals TEXT[], -- Array of failing signal keys
  
  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraint: no data never an F (or any grade)
  CONSTRAINT section_results_grade_requires_data
    CHECK (
      (checks_run > 0 AND letter_grade IS NOT NULL) OR
      (checks_run = 0 AND letter_grade IS NULL)
    ),
  
  CONSTRAINT section_results_checks_consistency
    CHECK (checks_passed + checks_failed <= checks_run),
  
  UNIQUE (audit_id, section_key)
);

CREATE INDEX idx_section_results_audit ON section_results(audit_id);
CREATE INDEX idx_section_results_key ON section_results(section_key);

COMMENT ON TABLE section_results IS 'Aggregated section results. Constraint: sections with no checks run have no grade.';
COMMENT ON CONSTRAINT section_results_grade_requires_data ON section_results
  IS 'Enforces: no data is never an F. A section must have at least one check run to receive a letter grade.';

-- =============================================================================
-- REPORTS TABLE
-- =============================================================================
-- Generated reports (e.g., PDF, email body).

CREATE TABLE reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(audit_id) ON DELETE CASCADE,
  
  -- Report metadata
  report_type TEXT NOT NULL CHECK (report_type IN ('pdf', 'email', 'json')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'generated', 'failed')),
  
  -- Storage
  storage_path TEXT, -- e.g., Supabase Storage path or external URL
  size_bytes BIGINT,
  
  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at TIMESTAMPTZ,
  
  -- Error tracking
  error_message TEXT,
  
  UNIQUE (audit_id, report_type)
);

CREATE INDEX idx_reports_audit ON reports(audit_id);
CREATE INDEX idx_reports_status ON reports(status);

COMMENT ON TABLE reports IS 'Generated audit reports (PDF, email, JSON).';

-- =============================================================================
-- RATE_LIMIT_EVENTS TABLE
-- =============================================================================
-- Rate limit events for shared-store rate limiter (B3 ticket).
-- Tracks both IP-based (20/hour) and email-based (1/24h) limits.

CREATE TABLE rate_limit_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Limiter identity
  limiter_key TEXT NOT NULL, -- 'ip:<address>' or 'email:<normalized_email>'
  limit_type TEXT NOT NULL CHECK (limit_type IN ('ip_hourly', 'email_daily')),
  
  -- Event data
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audit_id UUID REFERENCES audits(audit_id) ON DELETE SET NULL, -- NULL if audit creation failed
  
  -- Context
  client_ip INET,
  email TEXT,
  user_agent TEXT,
  
  -- Window tracking (for efficient cleanup)
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_rate_limit_key_time ON rate_limit_events(limiter_key, event_time DESC);
CREATE INDEX idx_rate_limit_expires ON rate_limit_events(expires_at);
CREATE INDEX idx_rate_limit_email_time ON rate_limit_events(email, event_time DESC) WHERE email IS NOT NULL;

COMMENT ON TABLE rate_limit_events IS 'Rate limit events for B3 shared-store limiter. IP: 20/hour, Email: 1/24h.';
COMMENT ON COLUMN rate_limit_events.limiter_key IS 'Composite key: "ip:<address>" or "email:<normalized>"';
COMMENT ON COLUMN rate_limit_events.expires_at IS 'For cleanup. IP events: +1 hour, Email events: +24 hours.';

-- =============================================================================
-- SCAN_EVENTS TABLE
-- =============================================================================
-- Scan state and events (C2 workflow logging).
-- Tracks individual page scans and audit workflow progress.

CREATE TABLE scan_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(audit_id) ON DELETE CASCADE,
  
  -- Event metadata
  event_type TEXT NOT NULL, -- e.g., 'page_scan_started', 'page_scan_completed', 'check_failed'
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Context
  page_url TEXT, -- NULL for audit-level events
  check_key TEXT, -- NULL for page-level events
  section_key TEXT,
  
  -- Event data
  status TEXT, -- e.g., 'success', 'failed', 'timeout', 'skipped'
  details JSONB,
  error_message TEXT,
  
  -- Performance
  duration_ms INTEGER
);

CREATE INDEX idx_scan_events_audit ON scan_events(audit_id, event_time);
CREATE INDEX idx_scan_events_type ON scan_events(event_type);
CREATE INDEX idx_scan_events_page ON scan_events(audit_id, page_url) WHERE page_url IS NOT NULL;

COMMENT ON TABLE scan_events IS 'Workflow scan events for debugging and audit trails.';

-- =============================================================================
-- AUDIT_STATE TABLE
-- =============================================================================
-- Current state of in-progress audits for workflow coordination.

CREATE TABLE audit_state (
  audit_id UUID PRIMARY KEY REFERENCES audits(audit_id) ON DELETE CASCADE,
  
  -- State
  current_stage TEXT NOT NULL, -- e.g., 'scanning', 'grading', 'generating_report', 'completed'
  progress_percentage INTEGER CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  
  -- Tracking
  pages_discovered INTEGER DEFAULT 0,
  pages_scanned INTEGER DEFAULT 0,
  checks_completed INTEGER DEFAULT 0,
  
  -- Timestamps
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Metadata
  metadata JSONB -- Workflow-specific state
);

CREATE INDEX idx_audit_state_stage ON audit_state(current_stage);
CREATE INDEX idx_audit_state_updated ON audit_state(updated_at);

COMMENT ON TABLE audit_state IS 'Current state of in-progress audits for workflow coordination.';

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Function to automatically update audit_state.updated_at
CREATE OR REPLACE FUNCTION update_audit_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_state_updated_at
  BEFORE UPDATE ON audit_state
  FOR EACH ROW
  EXECUTE FUNCTION update_audit_state_timestamp();

COMMENT ON FUNCTION update_audit_state_timestamp IS 'Auto-update audit_state.updated_at on row modification.';
