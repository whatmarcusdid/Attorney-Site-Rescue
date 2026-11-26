-- Atomic rate limit function with advisory locking
-- Migration: 20261126000003_atomic_rate_limit
-- For: B3 shared-store rate limiter
--
-- Strategy: PostgreSQL advisory locks (session-level)
-- - Faster than row locks (no actual row locking overhead)
-- - Automatically released on connection close
-- - Prevents concurrent requests from both passing the same limit
--
-- Why advisory locks over SELECT FOR UPDATE:
-- 1. No actual row to lock before the event exists
-- 2. Faster: no row-level lock overhead
-- 3. Automatic cleanup: lock released when function returns
-- 4. No deadlock risk: single lock per limiter_key
--
-- How it works:
-- 1. Take advisory lock on limiter_key hash (blocks concurrent checks)
-- 2. Count events in rolling window
-- 3. If under limit, insert event and return allowed
-- 4. If at/over limit, return denied
-- 5. Lock auto-released when function returns

CREATE OR REPLACE FUNCTION check_and_record_rate_limit(
  p_limiter_key TEXT,
  p_limit_type TEXT,
  p_limit INTEGER,
  p_window_ms INTEGER,
  p_client_ip INET DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_lock_key BIGINT;
  v_event_count INTEGER;
  v_window_start TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Generate lock key from limiter_key (hash to 64-bit integer)
  -- This ensures only one check per limiter_key at a time
  v_lock_key := ('x' || md5(p_limiter_key))::bit(64)::bigint;
  
  -- Acquire advisory lock (blocks concurrent checks for same key)
  -- pg_advisory_xact_lock is transaction-scoped, auto-released
  PERFORM pg_advisory_xact_lock(v_lock_key);
  
  -- Calculate rolling window
  v_window_start := NOW() - (p_window_ms || ' milliseconds')::INTERVAL;
  
  -- Count events in window
  SELECT COUNT(*)
  INTO v_event_count
  FROM rate_limit_events
  WHERE limiter_key = p_limiter_key
    AND event_time >= v_window_start;
  
  -- Check limit
  IF v_event_count >= p_limit THEN
    -- Limit exceeded
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', CASE p_limit_type
        WHEN 'ip_hourly' THEN 'ip_limited'
        WHEN 'email_daily' THEN 'email_limited'
        ELSE 'unknown'
      END,
      'count', v_event_count,
      'limit', p_limit
    );
  END IF;
  
  -- Under limit: insert event
  v_expires_at := NOW() + (p_window_ms || ' milliseconds')::INTERVAL;
  
  INSERT INTO rate_limit_events (
    limiter_key,
    limit_type,
    event_time,
    expires_at,
    client_ip,
    email,
    user_agent
  ) VALUES (
    p_limiter_key,
    p_limit_type,
    NOW(),
    v_expires_at,
    p_client_ip,
    p_email,
    p_user_agent
  );
  
  -- Return allowed
  RETURN jsonb_build_object(
    'allowed', true,
    'reason', NULL,
    'count', v_event_count + 1,
    'limit', p_limit
  );
  
  -- Advisory lock automatically released when function returns
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_and_record_rate_limit IS 
  'Atomically checks rate limit and records event. Uses advisory locks to prevent concurrent requests from both passing the same limit.';
